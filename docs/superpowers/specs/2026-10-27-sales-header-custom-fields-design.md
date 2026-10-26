# Sales header custom fields: SO → GD → SI (design)

Date: 2026-10-27 (MYT). Source request: handoff ENH-20261026-001 ("LSH Sales Header Custom Fields Developer Steps"),
narrowed and decided with the user in chat on 2026-10-27. This document replaces the handoff where they differ.

## Why

LSH (tenant 128671) fills four header custom fields on its Sales Orders (Envelope, Restday, RestHour, ReceiveHour). It
needs them on the Goods Delivery and Sales Invoice made from those orders. Today the header values are lost on every
sales route, although the same fields exist on all three documents. Line-level custom fields already travel SO → GD → SI,
and procurement already carries header custom fields PR → PO → GR → PI (dev 2026-10-16, prod since the 10-19 promotion).

## Decisions (the user's, 2026-10-27)

1. **Scope: every same-named header field.** The whole header custom-field object is copied by field name. A field
   whose name also exists on the target shows there. LSH's four work, and any field a tenant adds later works too.
   Not a hard-coded list of LSH's four (the handoff's proposal).
2. **Combined documents take the first source document's values.** This applies when several SOs make one GD or SI, or
   several GDs make one SI. It is the same rule as the 10-26 SI Shipping Method / Vehicle carry and procurement's header
   fillback. Conversions are never blocked over differing values (the handoff's "stop on conflict" is rejected).
3. **Every creation route** gets the copy, including the routes the handoff does not list: the GD form and SI form
   when the user picks the source documents inside the form, and SO_SAVE's automatic SI.
4. **Dev first, then a prod paste** that the user does. The user adds test definitions on dev (below).

Taken as defaults, which the user did not object to:
- The copy is a snapshot at creation. Later SO edits do not reach an existing GD/SI; later GD edits do not reach an
  existing SI.
- Existing documents get no backfill.
- Print templates, reports and integrations are not changed.

## Goals, non-goals, anti-goals

- **Goals:**
  - A GD or SI created by any route starts with its source's header custom-field values.
  - A user's later edit of those values on the GD/SI form is saved.
  - No save path wipes them.
- **Non-goals:**
  - Line custom fields: they already travel, and nothing here changes how lines are built or saved.
  - Procurement.
  - Mobile apps.
  - Printing.
  - Backfill.
  - A generic "custom field mapping" configuration.
- **Anti-goals (a failure even if values appear):**
  - A conversion or save that is slower on the common path, or blocked.
  - A save that wipes stored values because its caller did not send the key.
  - Storing another table's definition ids on a GD/SI.
  - Breaking GD V2 jobs already queued without the key.
  - Any stock, reservation, quantity, status, credit or accounting effect.

## How custom fields behave (verified, do not re-derive)

- **Storage.** A form's `custom-fields` container maps to a JSON column. Each tenant's definitions live in
  `su_code_custom_field` (tenant_id, table_id, `sub_table_key` NULL = header, `field_name`, `field_type`).
  - Header columns: SO `custom_fields_m07krnod`, GD `custom_fields`, SI `custom_fields_h35azf2l`. GD lines are also called
    `custom_fields` (a different record).
  - The containers exist on the dev and prod forms (SO v1252 / v446, GD v1492 / v678, SI v394 / v202). No form layout
    change is needed.
- **Translation by the platform** (procurement, verified on dev 2026-10-16):
  - Writes (workflow add/update nodes, browser saves) turn field names into the TARGET table's own definition ids.
  - Read nodes (get/search) and form loads turn ids back into names.
  - On a table that has definitions, a name it does not define is dropped on write.
  - A table's own ids written back are kept.
- **Raw SQL reads return the stored ids** (the source table's definitions). It is unverified what a write does with
  another table's ids, so **never write a raw SQL custom-field object across tables. Turn ids into names first.**
  (Procurement's GR_Convert_PI copies its raw SQL object today; that is not this project's to change.)
- **A save whose payload lacks the key writes NULL** (verified 2026-10-16). The "cfwipe" guard,
  `scratchpad/cfwipe/patch_cf.py`, is already on 11 dev/prod saves. Before an update node it checks whether the key is
  missing, only then reads the stored record by id (read nodes give names) and writes that. The common path has no
  extra read.

## What is broken today (dev, checked 2026-10-26)

| Where | Finding |
|---|---|
| GOODS_DELIVERY `2017151544868491265` | None of the 5 GD header writes carries `custom_fields`: add_node_ROqbYEI6, add_node_2r51lmua, update_node_elLmtlLm, update_node_aJCo6wbf, update_node_wq10Ecg3. |
| GD V2 | `GDC.header_fields` (111 fields) lacks `custom_fields` in GD_BULK_PREPARE and GD_BULK_COMMIT. The COMMIT header insert add_node_7uwrPwCt lacks the prop. The GD form's and SO_AUTO_GD's V2 payload header lists lack it. Line custom fields do pass through V2 (2,341 of 26,027 V2-made dev lines carry them). |
| SO_Convert_GD `1985267806223810561` | Add Data (add_node_sJZrsg5i) already binds `custom_fields` ← `{{node:code_node_HOWEZH5S.data.custom_fields}}`, but mapHeaderData never sets it. |
| SO_AUTO_GD `2076557490389835777` | code_build's header has no `custom_fields`. code_v2plan's header list filters it out anyway. |
| SO_Convert_SI `2029006184569364481`, GD_Convert_SI `2070069049332416514` | Headers are read by SQL (sql_node_socvDone / sql_node_gdcvDone) without the custom-field column. mapHeaderData (code_node_sQX9tldw) has no `custom_fields_h35azf2l`. Both create the SI through SI_SAVE. |
| SO_SAVE `1988908545345945602` | "Map SI Data" (code_node_CVVyuAj3) for the automatic SI has no `custom_fields_h35azf2l`. |
| SI_SAVE `2029040374929154050` | Add Data add_node_adYeQB4a and Update Data update_node_I7KGszOE carry no `custom_fields_h35azf2l`. |
| GD form, SI form | `onChange_soID` (picking the source inside the form) does not touch header custom fields. |
| GD Edit V2 | GD_EDIT_COMMIT update_node_GXe6head already writes header `custom_fields`. Nothing is broken; this needs checking only. |

## The change, route by route

The source object is always name-keyed when it is written. It is copied whole: no field list, no per-field logic. Rules:
- An object is taken as is; JSON text is parsed. If parsing fails, the header custom fields are skipped for that document
  (logged); the conversion is not failed. *(builder's call, chosen: a conversion should not fail over a display field.
  The source columns are MySQL JSON columns, which cannot hold invalid JSON, so this is defensive only.)*
- `false`, `0` and `""` are values. Never test for presence by truthiness.
- No source value writes `{}` on creation.
- No diagnostic for fields the target lacks, and no type check. A name without a target definition is simply not copied
  (the platform drops it on write), which follows from the user's "every same-named field" decision. Tenant admins keep
  same-named fields the same type; LSH's are identical.

**The keep-stored guard's read** (GOODS_DELIVERY's three updates, SI_SAVE's update).
- Picking and PACKING_SAVE re-save GDs through GOODS_DELIVERY from read nodes, and read nodes drop a NULL JSON column, so
  the key is missing on almost every existing GD.
- The guard must therefore not read the whole document. When the key is missing it reads only the header column by id,
  in one sql-node.
- Writing a table's own raw stored ids back is verified safe (prod, 2026-10-25), so that raw read can be written as is.
- When the key is present there is no read.
- `scratchpad/cfwipe/patch_cf.py`'s get-node read is replaced by this for these two workflows.

**GD**
- **G1 SO_Convert_GD:** in mapHeaderData, set `custom_fields` from the first source SO's `custom_fields_m07krnod`.
  - The SO comes from search_node_ZidRIRxa, so it is already name-keyed.
  - The code node must return and declare it. The existing Add Data binding then writes it (multiple GDs).
  - The single-GD route passes it to the GD form it opens.
- **G2 SO_AUTO_GD:** code_build's buildHeader sets `header.custom_fields` from the first SO (search_so, name-keyed).
  code_v2plan's header list gains `custom_fields`. The classic route passes it in allData to GOODS_DELIVERY.
- **G3 GD form `onChange_soID`:** on a new GD only (not an edit of a stored GD), and only while the header `custom_fields`
  is still empty, set it from the first selected SO.
  - The handler can fire again on later SO picks or batch adds; a value the user already has (or edited) is never
    overwritten.
  - This also serves the Picking Plan batch add, which sets the SO.
  - It assumes the client read (`db.collection`) gives names, like other read paths. The dev test must confirm it.
  - Reuse the handler's existing SO read rather than adding a fetch.
- **G4 V2 payload:** the payload's header list (`UXC.header_fields`, 111 fields) exists in three copies (checked on dev
  2026-10-27):
  - SO_AUTO_GD `code_v2plan`;
  - the GD form's `gdV2_onClick_save_as_created`;
  - the GD form's `gdV2_func_processGDLineItem`.

  `custom_fields` joins it in all three, identically.
  - GD_ASYNC_SUBMIT carries only the fit library (`v2fit_lib.js`), not this list, so it does not change.
  - `scratchpad/gdc/gdcreate/test/test_v2fit_sync.js` (the fit library) must still pass.
  - A new test keeps the three `UXC` blocks byte-identical.
- **G5 GOODS_DELIVERY:**
  - Both add nodes get `custom_fields` ← `{{node:code_node_IyJHrBst.data.allData.custom_fields}}`.
  - The three header update nodes get the same prop through the cfwipe guard, header only (no line handling, as
    CUSTOMER_SAVE is configured).
- **G6 GD V2 backend:**
  - `custom_fields` joins `GDC.header_fields` in GD_BULK_PREPARE (code_node_J5T1G2s9, code_node_egoCivrm) and GD_BULK_COMMIT
    (code_node_KBrubvGI).
  - add_node_7uwrPwCt gets the prop ← `{{node:code_node_KBrubvGI.data.headerRows.custom_fields}}`.
  - GD_ASYNC_SUBMIT does not change. SUBMIT and PREPARE hash the payload as it is.
  - Per GD Completed & Created V2 (2026-10-27): `GDC.header_fields` only builds header rows, in exactly these three
    copies. P0 revalidate, the P1 / P6 / P7 checks and GD_JOB_RECONCILE check status, counts and keys, never header
    values. An object travels through add nodes as line custom fields already do.
  - Jobs already queued without the key must still commit (an absent key writes the platform default).
  - Bases: GD_BULK_COMMIT dev v32 (content = prod v30, tonight's hidden Packing shell); GD_BULK_PREPARE v21; SO_AUTO_GD v21;
    the GD form's `gdV2_*` handlers as in the repo. "Build on the current repo files" (GD session): they equal live dev,
    including that session's uncommitted GD_BULK_COMMIT change.
- **G7 GD Complete V2 keeps a header edit made just before Complete** (user, 2026-10-27).
  - Today GD_COMPLETE_SUBMIT `2110182609618337794` (dev v13) sends a completion to the classic save only when the form
    differs in `GC_GD_WRITE_COLS` (`gsFormDiff`). That list has 107 columns and no `custom_fields`, and GD_COMPLETE_COMMIT
    never writes it.
  - So a user who edits Envelope and presses Complete would lose the edit, and the automatic SI (step C6) would copy the
    old value.
  - Add header `custom_fields` to that comparison, compared by name. Add the GD header definitions as one row in a read
    SUBMIT already makes, the way GD Edit V2 does (`cfh` / `geCfCanon`), so stored ids and form names match.
    - A real edit then routes the completion through the classic save, which stores it after G5.
    - An unedited completion stays V2.
    - Over 500 lines the classic path answers "save it as Created first", as for any other header edit.
  - Without the name match, every LSH completion with filled fields would go classic: an anti-goal.
  - Built by this session, reviewed by GD Completed & Created V2. It lands with G5 and the producers, never after them.

**SI**
- **S1 SO_Convert_SI:** sql_node_socvDone adds the SO header custom fields to its header `JSON_OBJECT`, **turned into a
  name-keyed object inside the SQL**. Each key that is a definition id becomes that definition's `field_name` via
  `su_code_custom_field`; a key that is already a name stays; values are unchanged. mapHeaderData sets
  `custom_fields_h35azf2l` from the first SO.
- **S2 GD_Convert_SI:** the same in sql_node_gdcvDone for the GD header `custom_fields`, and in mapHeaderData from the
  first GD.
  - This also serves the automatic GD → SI (GOODS_DELIVERY and GD_COMPLETE_COMMIT step C6 call GD_Convert_SI).
  - It reads the GD's own stored values, never the SO's.
- **S3 SO_SAVE "Map SI Data":** set `custom_fields_h35azf2l` from the SO's `custom_fields_m07krnod`. This is allData,
  the form's payload, so it is name-keyed.
- **S4 SI form `onChange_soID`:** on a new SI only, and only while `custom_fields_h35azf2l` is still empty, take the first
  GD's values if the SI comes from GDs, else the first SO's. This is the Shipping Method / Vehicle source rule.
  - The handler runs on every batch add's setData of `so_id`, not only on a new SI.
  - It already reads the SO and a projected GD in one `Promise.all`; the GD read is
    `.field("di_shipping_method,di_vehicle_number")`. Add the GD header custom-field column to that `.field()` list
    rather than a second fetch.
- **S5 SI_SAVE:** Add Data gets `custom_fields_h35azf2l` ← `{{node:code_si_prep.data.entry.custom_fields_h35azf2l}}`.
  Update Data gets the same through the cfwipe guard (header only). Check that code_si_prep keeps the key intact,
  including `false` values.

**Unchanged here, but a hard prerequisite: GD Edit V2.**
GD Edit & Picking V2 confirmed (2026-10-27) that GD Edit V2 compares the form's header, which carries names, with the raw
stored row, which carries definition ids:
- SUBMIT `geDelta` (`scratchpad/gde/code/submit/delta.js`);
- PREPARE `GDH` (`prepare/plan_edit.js`);
- COMMIT E6 (`code_node_GXe6plan`'s conflict check, `code_node_GXe6check`'s "every cell reads back").

Once a GD header holds values, every form edit of that GD sees `custom_fields` as changed. E6 writes it, the read-back
never matches, and the edit retries into REQUIRES_REVIEW with the GD stuck in Processing.
- Only LSH has GD header definitions on prod (4, created 2026-10-26), and no prod GD header holds values yet.
- Their fix: the same id ↔ name matching they built for lines on 10-25, applied to the header.
- **It must be live on dev and prod before any GD header gets values**: before G1–G6 reach prod, and before the dev
  edit tests.
- GD V2's own checks do not have this problem: none compares header values (see G6).

**Unchanged, check only:**
- Classic PICKING: its two GOODS_DELIVERY calls pass the whole stored GD (a search node spread), so `custom_fields` is
  present by name. Picking V2 and PICKING_LOOP never call GOODS_DELIVERY.
- SO_SAVE (already guarded).
- SI_SAVE: look for any stored-versus-submitted comparison over header fields before relying on the guard.
- Every other GD/SI writer: they carry no custom-field prop, so they cannot wipe it.

## Ownership and coordination

- **GD Completed & Created V2** owns the V2 chain (SUBMIT / PREPARE / COMMIT), SO_AUTO_GD and the GD form's `gdV2_*`
  handlers. Answer 2026-10-27: this session builds G1–G6, and they review the diffs before any publish (their own work
  is the worker freeze fixes).
- **GD Edit & Picking V2** owns GD Edit V2 and Picking. Asked whether a populated header trips their compare paths, and
  whether Picking / Packing call GOODS_DELIVERY updates without the key.
- **SI:** this session builds S1–S5. bladexfunctions-22 owned the 10-26 Shipping / Vehicle carry, which is finished,
  and said go ahead.
  - Build on the live versions, which already hold its edits in the same nodes. Live: dev SI form v393, SI_SAVE v85,
    GD_Convert_SI / SO_Convert_SI / SO_SAVE enabled at 11:33. Prod: SI form v201, SI_SAVE v47, GD_Convert_SI v27,
    SO_Convert_SI v39, SO_SAVE v89.
  - The converters' header `JSON_OBJECT` now ends with `di_vehicle_number`.
  - Prod's three Map SI Data nodes differ from dev only in where a comment and carryDescription sit, so the prod paste is
    built from prod's own enabled JSON.
  - Never rerun `scratchpad/si2k/build_si_convert.py`; it builds from v25 / v56 and would drop later changes.
  - `scratchpad/si_ship/build_si_ship.py` (dev and prod bases) and its read-only harness `si_ship/test/test_fill.py` are
    the model for this project's SI builder.
- Every dev publish needs the user's yes. Each one backs up the live version and uses a base guard (others publish the
  GD form, SO_SAVE and the SO / SI pages too). GDonMounted.js-style shared handlers are announced before editing.

## Testing

- **Dev definitions (user, before the end-to-end tests):** tenant 000000, on the SO, GD and SI headers: `lsh_envelope`
  (boolean), `lsh_restday`, `lsh_resthour`, `lsh_receivehour` (text). Same field names as prod LSH.
- **Unit:** each changed code node runs from the workflow JSON with filled placeholders (the repo's harness pattern):
  first-document rule, `false` / `0` / `""` kept, JSON text, invalid text skipped, absent → `{}`.
- **SQL:** run S1 / S2 read-only on dev. Use real must-match rows once test SOs carry values. Edge cases go through a CTE
  that shadows the table: id keys, name keys, unknown ids, invalid JSON, NULL. Check EXPLAIN.
- **End to end on dev, per route:** create the document, reopen it, read the stored row (raw ids must be the TARGET
  table's definitions) and the form (names). Then:
  - edit the value on the GD / SI form and save;
  - save through a key-less caller and check the value is kept;
  - run an old-shape V2 job (no key) and check it still commits.
  The handoff's U01–U16 are the checklist, with these changes:
  - U09 becomes "first document's values".
  - U07 becomes "JSON text is parsed; invalid text is skipped and logged".
  - U12 becomes "a field the target lacks is not copied, with no diagnostic".
  - Add a G7 case: edit Envelope on a Created GD, press Complete, and check that the GD and its automatic SI keep the
    edit; an unedited Complete stays V2.

  The handoff is at `/Users/yunawinaya/Downloads/LSH-Sales-Header-Custom-Fields-Developer-Steps-20261026.md` (not in the
  repo).
- **Regression:** the existing GD / SI / SO_AUTO_GD / GD form tests in `scratchpad/` (soautogd, gdc/gdcreate,
  gdform_zero, si2k, si_ship) and the linter on every changed workflow.

## Rollout

- **Dev first, in one approved batch:** backends (SI_SAVE, GOODS_DELIVERY, GD_BULK_COMMIT, GD_BULK_PREPARE,
  GD_COMPLETE_SUBMIT), then producers (converters, SO_AUTO_GD, SO_SAVE, forms). Either order is safe: a backend without the prop drops the key as today, and a
  backend with it keeps the stored value when the key is missing. Backends-first just lets every producer test land.
- **Gate:** GD Edit V2's header fix goes first on each environment. The SI items (S1–S5) do not depend on it and may go
  earlier.
  - **Dev:** LIVE 2026-10-27 01:00 (GD_EDIT_SUBMIT v13, GD_EDIT_PREPARE v10, GD_EDIT_COMMIT v13). They read the GD header
    definitions `{cf_defs: {id: name}}` and compare names.
  - **Prod:** LIVE 2026-10-27 01:12–01:14 (GD_EDIT_SUBMIT v13, GD_EDIT_PREPARE v10, GD_EDIT_COMMIT v13; checked IDENTICAL
    to the repo by this session). The gate is open.
  - The dev GD edit tests need GD header definitions in the test tenant: the user's LSH four in 000000 provide them.
- **Prod:** a `prod-hotfix/<date>-sales-header-custom-fields/` folder, each item seeded from prod's enabled version and
  checked for dev == prod parity, with RESTORE files and the paste order above. Timing is the user's call (LSH volume
  hours). After each paste: `.dbtools/wf --prod deployed`, form diff, `scratchpad/prod_health.py`.

## Left to the builder

The code itself; new node ids; test files; the exact SQL for the id → name step; how the cfwipe tool is extended for
props that do not exist yet; the order of commits.
