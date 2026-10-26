# Sales Header Custom Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GD or SI created by any route starts with its source's header custom fields; later edits on the GD/SI form
are saved, including the Complete button; and no save wipes them.

**Architecture:**
- Every producer copies the source's header custom-field object, keyed by field name, into the target's header column.
  SQL-reading producers turn stored definition ids into names inside their SQL.
- Saves gain the column. Updates are fronted by a keep-stored guard that reads one column only when the key is missing.
- All changes are patches on live versions, applied by one builder that asserts exact anchors. Outputs are made for dev
  and for prod, each from that environment's own enabled JSON.

**Tech Stack:**
- BladeX su-code workflow JSON (code / sql / add / update / if nodes) and MySQL 8.4.
- Form client handlers (Element Plus).
- Python 3 builders, Node test harnesses, and `.dbtools` (`db`, `wf`, `wf_upload.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-27-sales-header-custom-fields-design.md`

## Global Constraints

- Header columns: SO `custom_fields_m07krnod`, GD `custom_fields`, SI `custom_fields_h35azf2l`. Line columns are untouched.
- Copy the whole name-keyed object, from the FIRST source document. `false`, `0` and `""` are values; never test by
  truthiness. No source value means `{}` on creation.
- Never write a raw SQL custom-field object to another table. Turn ids into names first. A numeric key without an active
  definition is dropped, never copied.
- Keep-stored guard on update nodes:
  - key present → no read;
  - key missing → read only that header column by id, in one sql-node, and write it back as is (same table).
- No new read on any common path. Form handlers reuse their existing reads (add a column to `.field()`, never a second
  fetch).
- Build on the live versions (repo = dev except GD_Convert_SI, dev v30, which is ahead of the repo, and both forms).
  Prod outputs are built from prod's enabled JSON. Never rerun `scratchpad/si2k/build_si_convert.py` or
  `scratchpad/si_ship/build_si_ship.py`.
- Every dev publish needs the user's yes:
  - via `node .dbtools/wf_upload.mjs --publish --plan <own plan>`, with `base` set on every item;
  - one plain command, with no pipe, redirect or `cd`.
- GD items reach prod only after GD Edit V2's header fix is on prod. It is, as of 2026-10-27 01:12–01:14 (checked
  IDENTICAL), so the gate is open. SI items may still go first.
- GD Completed & Created V2 reviews every diff to SO_AUTO_GD, GD_BULK_PREPARE / COMMIT, GOODS_DELIVERY, GD_COMPLETE_SUBMIT
  and the GD form's `gdV2_*` handlers before it is published.

## Review Focus

1. **A combined document whose first source has no custom fields but a later one does** comes out `{}` (first-document
   rule), not merged. The test is in Task 3 (`first_source_empty_wins`).
2. **A stored key whose definition was deleted** is dropped by the id → name SQL, never written as a foreign id. The
   test is in Task 1 (`deleted_definition_dropped`).
3. **`{"lsh_envelope": false}` counts as "not empty"** for the form fills, and survives every route. The tests are in
   Task 1 (`false_kept`), Task 5 and Task 10 (`false_is_a_value`).
4. **A Picking / Packing re-save of a GD whose column is NULL** takes the guard's one-column read, writes NULL back and
   never reads the whole GD. The test is in Task 6 (`null_column_one_read`).
5. **Text values with quotes, CJK or emoji** come out of the SQL byte-identical. The test is in Task 1 (`unicode_kept`).

---

### Task 1: Shared pieces: builder, JS helper, id → name SQL

**Files:**
- Create:
  - `scratchpad/salescf/fetch.py`
  - `scratchpad/salescf/build.py`
  - `scratchpad/salescf/lib/cf_header.js`
  - `scratchpad/salescf/lib/cf_sql.py`
- Test:
  - `scratchpad/salescf/test/test_cf_header.js`
  - `scratchpad/salescf/test/test_cf_sql.py`

**Interfaces:**
- Produces:
  - `fetch.py --env dev|prod`: every workflow and form below → `base/<env>/<NAME>.json`, exact stored JSON plus the
    version in `base/<env>/versions.json`.
  - `build.py --env dev|prod [NAME ...]`: `base/<env>/` → `out/<env>/`. One patch function per workflow / form
    handler, each asserting its anchors exist exactly once. It prints the per-item dev == prod parity of the bases.
  - `lib/cf_header.js`: `const headerCustomFields = (v) => object`. An object is returned as is; JSON text is parsed;
    anything else, or invalid text, gives `{}` (the latter logged). It is inlined verbatim into every code node or
    handler that copies.
  - `lib/cf_sql.py`: `cf_names_sql(col_sql: str) -> str`, a scalar SQL subquery that returns a name-keyed JSON object for
    an id-keyed JSON column.
    - Each key is resolved via `su_code_custom_field` (`is_deleted = 0`, matched only when the key is all digits).
    - A non-numeric key is kept.
    - A numeric key with no active definition is dropped.
    - The result is never NULL; it falls back to `JSON_OBJECT()`.
- Workflows / forms fetched (name: id): SI_SAVE 2029040374929154050, SO_Convert_SI 2029006184569364481, GD_Convert_SI
  2070069049332416514, SO_SAVE 1988908545345945602, GOODS_DELIVERY 2017151544868491265, GD_BULK_PREPARE
  2104840044642754561, GD_BULK_COMMIT 2104840402446245890, SO_AUTO_GD 2076557490389835777, SO_Convert_GD
  1985267806223810561, GD_COMPLETE_SUBMIT 2110182609618337794; forms `goods_delivery`, `sales_invoice` (form_json).

- [ ] **Step 1: Write the failing tests**
  - `test_cf_header.js`:
    - `obj_kept`: `{a:1}` → same object;
    - `text_parsed`: `'{"a":false}'` → `{a:false}`;
    - `invalid_text_empty`: `"{"` → `{}`, with one log line;
    - `null_empty`: `null`, `undefined`, `""`, `[]` → `{}`;
    - `false_kept`: `{lsh_envelope:false}` → `{lsh_envelope:false}`.
  - `test_cf_sql.py`, read-only on dev. A CTE named `t` holds rows `(id, cf JSON)`, and the query selects
    `cf_names_sql("t.cf")`. Rows and expectations:
    - `ids_to_names`: SO definition ids → `{"lsh_envelope": true, "lsh_restday": "Sun"}`. Use dev 000000's SO ids from
      `su_code_custom_field`.
    - `names_kept`: `{"so_email":"x"}` → same.
    - `deleted_definition_dropped`: a key `"1"` → `{}`.
    - `null_column`: NULL → `{}`.
    - `false_kept`: `false` stays a JSON boolean.
    - `unicode_kept`: the value `'He said "hi" 你好 😀'` comes back byte-identical.
- [ ] **Step 2: Run them; both fail** (files missing). `node scratchpad/salescf/test/test_cf_header.js`,
  `python3 scratchpad/salescf/test/test_cf_sql.py`.
- [ ] **Step 3: Implement `lib/cf_header.js` and `lib/cf_sql.py`, then `fetch.py --env dev` and `fetch.py --env prod`**.
  In `cf_sql.py`:
  - put JSON_TABLE over `IFNULL(JSON_KEYS(col), JSON_ARRAY())` inside a SELECT-list subquery, never inside EXISTS;
  - `JSON_EXTRACT(col, CONCAT('$."', k, '"'))` keeps value types;
  - wrap SQL lines at 160 characters (addDraft rejects very long SQL lines).
- [ ] **Step 4: Both tests pass**, and `base/dev/` + `base/prod/` hold 12 files each, with versions recorded.
- [ ] **Step 5: Leave uncommitted** (the user handles git).

### Task 2: SI_SAVE keeps and stores the SI header (S5)

**Files:**
- Modify: `build.py` (`patch_si_save`).
- Output: `out/<env>/SI_SAVE.json`.
- Test: `scratchpad/salescf/test/test_si_save.js`.

**Interfaces:**
- Produces:
  - `add_node_adYeQB4a` gets the prop `custom_fields_h35azf2l` ← `{{node:code_si_prep.data.entry.custom_fields_h35azf2l}}`.
  - `update_node_I7KGszOE` gets the same prop ← `{{node:code_node_SiCfOut.data.cf}}`.
  - The new nodes, in order, before `update_node_I7KGszOE`:
    - `code_node_SiCfNeed` → `{need: "1"|"0", id}`. Need is `"1"` only when `entry` has no `custom_fields_h35azf2l`
      key at all (or the value is `undefined` / `null`) and the id is digits.
    - `if_SiCfNeed` (true block: `sql_node_SiCfRead`, a SELECT of `custom_fields_h35azf2l` from `sales_invoice` by id
      and tenant).
    - `code_node_SiCfOut` → `{cf}`: the payload's value when present, else the read's column, else `null`.

- [ ] **Step 1: Failing test.** `test_si_save.js` runs the new code nodes from the output JSON with filled placeholders:
  - `present_no_read`: key `{a:1}` → need `"0"`, cf `{a:1}`;
  - `false_present`: `{lsh_envelope:false}` → need `"0"`;
  - `missing_reads`: key absent → need `"1"`; CfOut with read row `{custom_fields_h35azf2l:{"2114...":"x"}}` → that
    object as is;
  - `missing_null_column`: read row without the column → cf `null`.

  It also asserts the add / update node props and the response_json declarations.
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement `patch_si_save`.** Use `wfkit` keys and the `if` node shape from
  `scratchpad/gdc/pkv2tools/wfkit.py`. The new sql-node declares `custom_fields_h35azf2l` in its response_json.
- [ ] **Step 4: Test passes; `python3 scratchpad/validate.py out/dev/SI_SAVE.json` shows no new MISSING / FORWARD /
  DIVERGENT / UNDECLARED / IDIGNORED.**
- [ ] **Step 5: Leave uncommitted.**

### Task 3: SO → SI and GD → SI converters (S1, S2)

**Files:**
- Modify: `build.py` (`patch_so_convert_si`, `patch_gd_convert_si`).
- Test: `scratchpad/salescf/test/test_si_convert.py` (SQL on dev) and `test_si_convert_map.js` (mapHeaderData).

**Interfaces:**
- Consumes: `cf_names_sql`, `headerCustomFields`.
- Produces:
  - `sql_node_socvDone`'s header JSON_OBJECT ends with `'custom_fields_m07krnod', <cf_names_sql("s.custom_fields_m07krnod")>`.
  - `sql_node_gdcvDone`'s ends with `'custom_fields', <cf_names_sql("g.custom_fields")>`.
  - Both go after the current last pair, `di_vehicle_number`.
  - In each `code_node_sQX9tldw` mapHeaderData: `custom_fields_h35azf2l: headerCustomFields(record.<col>)`, placed after
    the `si_vehicle_number` line.

- [ ] **Step 1: Failing tests.**
  - `test_si_convert.py` (dev, read-only) runs each patched header SQL with filled placeholders on a dev SO and a GD
    carrying test values (Task 12 creates them; until then, a CTE shadows `sales_order` / `goods_delivery`). Assert:
    - the header row's object is name-keyed;
    - all other columns are byte-identical to the unpatched SQL's.
  - `test_si_convert_map.js` asserts:
    - `first_source_wins`: two records with different values → the first's;
    - `first_source_empty_wins`: first `{}`, second filled → `{}`;
    - `false_kept`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement both patches.** The anchors are the `di_vehicle_number` SQL pair and the `si_vehicle_number:`
  map line, each asserted exactly once per workflow and environment.
- [ ] **Step 4: Tests pass; linter clean; `EXPLAIN` shows `su_code_custom_field` by PRIMARY.**
- [ ] **Step 5: Leave uncommitted.**

### Task 4: SO_SAVE automatic SI (S3)

**Files:**
- Modify: `build.py` (`patch_so_save`).
- Test: `scratchpad/salescf/test/test_so_save_map.js`.

**Interfaces:**
- Produces: in `code_node_CVVyuAj3`, `custom_fields_h35azf2l: headerCustomFields(record.custom_fields_m07krnod)` after the
  `si_vehicle_number` line.

- [ ] **Step 1: Failing test.** Run the Map SI Data node, unpatched and patched, on 3 real dev SOs (the `si_ship/test/test_fill.py`
  approach). Only `custom_fields_h35azf2l` differs, and it equals the SO's object.
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Passes; linter clean.**
- [ ] **Step 5: Leave uncommitted.**

### Task 5: SI form fills the header from its source (S4)

**Files:**
- Modify: `build.py` (`patch_si_form`: handler `onChange_soID` in form `sales_invoice`).
- Test: `scratchpad/salescf/test/test_si_form.js`.

**Interfaces:**
- Produces:
  - The existing projected GD read's `.field("di_shipping_method,di_vehicle_number")` becomes
    `.field("di_shipping_method,di_vehicle_number,custom_fields")`.
  - After the shipping lines, when the SI is new (`this.isAdd || this.isCopy`) and the current
    `custom_fields_h35azf2l` is empty (no keys), set it to `headerCustomFields(shippingSource.<col>)`. Here `<col>` is
    `custom_fields` for a GD source and `custom_fields_m07krnod` for an SO source.

- [ ] **Step 1: Failing test.** Mock `db.collection` reads and `this.setData`. Cases:
  - `new_si_from_gd`;
  - `new_si_from_so`;
  - `edit_keeps` (a stored SI is not filled);
  - `user_value_kept` (non-empty is not overwritten);
  - `false_is_a_value` (`{lsh_envelope:false}` counts as non-empty);
  - `no_second_fetch` (exactly the reads it made before).
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement** on the live dev handler text (form v394) and on prod's (v202).
- [ ] **Step 4: Passes.**
- [ ] **Step 5: Leave uncommitted.**

### Task 6: GOODS_DELIVERY stores the GD header (G5)

**Files:**
- Modify: `build.py` (`patch_goods_delivery`).
- Test: `scratchpad/salescf/test/test_gd_classic.js`.

**Interfaces:**
- Produces:
  - `add_node_ROqbYEI6` and `add_node_2r51lmua` get `custom_fields` ← `{{node:code_node_IyJHrBst.data.allData.custom_fields}}`.
  - Each of `update_node_elLmtlLm`, `update_node_aJCo6wbf` and `update_node_wq10Ecg3` gets `custom_fields` ←
    `{{node:code_node_GdCfOut<n>.data.cf}}`, fronted by the Task 2 trio for `goods_delivery`:
    `code_node_GdCfNeed<n>` / `if_GdCfNeed<n>` / `sql_node_GdCfRead<n>`, with `n` = 1, 2, 3. The id is
    `allData.id`.

- [ ] **Step 1: Failing test.** The same cases as Task 2, plus `null_column_one_read`: a Picking-style allData without the
  key → exactly one sql-node read of one column, and no get-node.
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement.** Insert each trio directly before its update node, in the same block.
- [ ] **Step 4: Passes; linter clean; the add / update prop lists differ from base by exactly this prop.**
- [ ] **Step 5: Leave uncommitted.**

### Task 7: GD V2 backend carries the header (G6)

**Files:**
- Modify: `build.py` (`patch_gd_bulk`).
- Test: `scratchpad/salescf/test/test_gd_v2_header.js`.

**Interfaces:**
- Produces:
  - `"custom_fields"` appended to `header_fields` in the GDC literal of GD_BULK_PREPARE `code_node_J5T1G2s9` and
    `code_node_egoCivrm`, and of GD_BULK_COMMIT `code_node_KBrubvGI`;
  - `add_node_7uwrPwCt` gets the prop `custom_fields` ← `{{node:code_node_KBrubvGI.data.headerRows.custom_fields}}`.

- [ ] **Step 1: Failing test.**
  - All three literals list 112 header fields, including `custom_fields`, and are otherwise identical to base.
  - Running `code_node_KBrubvGI` on a payload with `custom_fields: {lsh_envelope:false}` puts the object on headerRows.
  - An old-shape payload without it still builds (the key absent).
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Passes. The GD session's tests still pass: `scratchpad/gdc/gdcreate/test/test_commit_*.js`,
  `test_convert_check*.js`, `test_v2fit_sync.js`.**
- [ ] **Step 5: Send the diff to GD Completed & Created V2; leave uncommitted.**

### Task 8: V2 payload and SO_AUTO_GD header (G2, G4)

**Files:**
- Modify: `build.py` (`patch_so_auto_gd`, and `patch_gd_form_v2` for the handlers `gdV2_onClick_save_as_created` and
  `gdV2_func_processGDLineItem`).
- Test: `scratchpad/salescf/test/test_v2_payload.js`, plus `scratchpad/soautogd/test_plan.js` (existing).

**Interfaces:**
- Produces:
  - `"custom_fields"` appended to `UXC.header_fields` (111 → 112) in SO_AUTO_GD `code_v2plan` and in both GD form
    handlers. The three `UXC` blocks must stay byte-identical.
  - GD_ASYNC_SUBMIT does not change (it has no header list).
  - In SO_AUTO_GD `code_build`'s buildHeader: `custom_fields: headerCustomFields(<first SO>.custom_fields_m07krnod)`. The
    classic route then gets it through allData.

- [ ] **Step 1: Failing test.**
  - The three `UXC` blocks are identical.
  - gdV2Payload's header keeps `custom_fields`.
  - buildHeader on two SOs takes the first's, keeps `false`, and gives `{}` when absent.
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Passes; `soautogd/test_plan.js`, `test_summary.js`, `test_client.js` still pass.**
- [ ] **Step 5: Send the diff to the GD session; leave uncommitted.**

### Task 9: SO_Convert_GD draft and form route (G1)

**Files:**
- Modify: `build.py` (`patch_so_convert_gd`).
- Test: `scratchpad/salescf/test/test_so_convert_gd.js`.

**Interfaces:**
- Produces:
  - In `code_node_HOWEZH5S` mapHeaderData: `custom_fields: headerCustomFields(record.custom_fields_m07krnod)`, with the
    record being the first SO of the GD.
  - `custom_fields` is added to the node's response_json.
  - The existing `add_node_sJZrsg5i` binding is unchanged.

- [ ] **Step 1: Failing test.** Run the node on real dev SOs (search-node shape): each mapped GD carries its first SO's
  object, and the response_json declares `custom_fields`.
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Passes; linter clean.**
- [ ] **Step 5: Leave uncommitted.**

### Task 10: GD form fills the header from the SO (G3)

**Files:**
- Modify: `build.py` (`patch_gd_form_soid`: handler `onChange_soID` in form `goods_delivery`).
- Test: `scratchpad/salescf/test/test_gd_form.js`.

**Interfaces:**
- Produces: after its existing `db.collection("sales_order").where({ id: firstSO }).get()`, when the GD is new
  (`this.isAdd || this.isCopy`) and header `custom_fields` is empty, set it to
  `headerCustomFields(so.custom_fields_m07krnod)`.

- [ ] **Step 1: Failing test.** Cases: `new_gd_filled`, `edit_keeps`, `user_value_kept`, `false_is_a_value`,
  `no_second_fetch`.
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement.** Do it in the same `build.py` run as Task 8's form edit, so there is one GD form publish.
- [ ] **Step 4: Passes.**
- [ ] **Step 5: Leave uncommitted.**

### Task 11: GD Complete V2 keeps a header edit (G7)

**Files:**
- Modify: `build.py` (`patch_gd_complete_submit`).
- Test: `scratchpad/salescf/test/test_gd_complete_cf.js`.

**Interfaces:**
- Produces:
  - `sql_node_GShdr`'s JSON_OBJECT adds `'cf_defs'`: a JSON object `{id: field_name}` of the tenant's active GD header
    definitions (table_id `1902054888473481218`, `sub_table_key IS NULL`). This is a SELECT-list subquery, so no new
    node.
  - `code_node_GSgate`'s `gsFormDiff` also compares header `custom_fields`. The stored side is mapped id → name with
    `cf_defs`, then both sides go through sorted-key JSON; `{}` equals `null`.
  - `custom_fields` is not added to `GC_GD_WRITE_COLS`; the comparison is a separate step inside `gsFormDiff`, so the
    other 107 columns are untouched.

- [ ] **Step 1: Failing test.**
  - `unchanged_stays_v2`: stored `{"2114..":true}`, defs `{"2114..":"lsh_envelope"}`, form `{lsh_envelope:true}` → no
    diff.
  - `edit_goes_classic`: form `{lsh_envelope:false}` → a diff naming `custom_fields`.
  - `empty_vs_null`: `{}` against NULL → no diff.
  - `no_defs`: names on both sides compare directly.
- [ ] **Step 2: Run, fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Passes; linter clean; the GD session's CompleteV2 tests (if present in `scratchpad/`) still pass.**
- [ ] **Step 5: Send the diff to the GD session; leave uncommitted.**

### Task 12: Dev publish and live tests

**Files:**
- Create: `scratchpad/salescf/deploy/publish_si.json`, `publish_gd.json` (own plans, `base` = `base/dev/` files),
  `scratchpad/salescf/test/live_e2e.md` (the checklist and results).

- [ ] **Step 1: Dry-run both plans:** `node .dbtools/wf_upload.mjs --dry-run --plan scratchpad/salescf/deploy/publish_si.json`,
  and the same for GD. Expected: every item is listed, with no BASE MOVED and no SAME.
- [ ] **Step 2: Ask the user's yes (AskUserQuestion), then publish the SI batch.** Order: SI_SAVE, SO_Convert_SI,
  GD_Convert_SI, SO_SAVE, then the SI form.
- [ ] **Step 3: Get GD Completed & Created V2's OK on the Task 6–11 diffs, ask the user's yes, then publish the GD
  batch.** Order: GOODS_DELIVERY, GD_BULK_PREPARE, GD_BULK_COMMIT, GD_COMPLETE_SUBMIT, SO_AUTO_GD, SO_Convert_GD, then
  the GD form. GD Edit's dev fix is live already (01:00).
- [ ] **Step 4: Live end to end on dev, tenant 000000.** Two test SOs:
  - A: Envelope ticked, Restday "Sun";
  - B: Envelope unticked, RestHour "12-1".

  Run every route of the spec's checklist (U01–U16 as amended, plus G7). For each, record:
  - the stored raw keys (must be the target table's own definition ids);
  - the form view.
- [ ] **Step 5: Sync the repo with dev:** `.dbtools/wf --dev pull "<repo file>" --write` for each workflow with a repo
  copy, then `.dbtools/wf --dev deployed` must be IDENTICAL.

### Task 13: Prod paste folders

**Files:**
- Create: `prod-hotfix/2026-10-27-sales-header-cf-si/` and `prod-hotfix/2026-10-27-sales-header-cf-gd/`. Each holds the
  paste files from `out/prod/`, `RESTORE_*` files from `base/prod/`, and a README (target name + id, paste order,
  checks).

- [ ] **Step 1: Re-run `fetch.py --env prod` and `build.py --env prod`.** Abort on any BASE drift since Task 1.
- [ ] **Step 2: Write both folders.** The GD README states the gate (GD Edit V2's header fix, live on prod since
  2026-10-27 01:14), and re-checks it with `.dbtools/wf --prod deployed "Goods Delivery/EditV2/GD_EDIT_COMMIT.json"`
  before the paste.
- [ ] **Step 3: After each user paste:** `.dbtools/wf --prod deployed` per item (check name AND id),
  `.dbtools/form diff goods_delivery|sales_invoice`, `python3 scratchpad/prod_health.py`.
