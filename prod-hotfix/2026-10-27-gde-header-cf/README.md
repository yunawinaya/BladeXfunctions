# GD Edit V2: header custom fields compare as names (2026-10-27)

> **Second paste (02:2x): `GD_EDIT_COMMIT.json` again, as COMMIT v14 (the wipe fix).** SUBMIT v13 and PREPARE v10 are already
> on prod (01:12-01:13) and stay. Prod COMMIT v13 (01:14) is `GD_EDIT_COMMIT.v13.json` here.
> - **What was wrong:** the platform DROPS a header custom_fields keyed by definition ids on write. E6 rewrote the whole header
>   with the fresh id-keyed value, so any edit of a GD whose header has values wiped them. Dev GD/20261027/632 -> {}, job
>   2114781343696629762. The check only compared changed cells, so the step was DONE.
> - **v14:** E6 writes custom_fields by NAME, and the platform stores the ids. Its check also requires a non-empty custom_fields
>   it wrote to read back. Only `code_node_GXe6plan` and `code_node_GXe6check` change.
> - **Evidence:**
>   - test_commit 66/66, with the new mutants `e6_cf_write_raw` and `e6_cf_no_wrote_check` caught;
>   - the dev browser re-test of GD/20261027/633 (Remark 1 only), job 2114784176818958337 COMPLETED. E6 wrote
>     {"lsh_envelope":true,"lsh_resthour":"1-2"} and read back the ids; the values survived.
> - **Still open:** a form edit of a header custom field is not SAVED by GD Edit V2 until it re-lifts bladexfunctions-68's
>   GOODS_DELIVERY (names-read guard), which is not on dev yet. Nothing is wiped meanwhile.

**Hard gate for bladexfunctions-68's "SO header custom fields on GDs"** (`docs/superpowers/specs/2026-10-27-sales-header-custom-fields-design.md`).
None of its GD routes (G1–G6) may be pasted to prod before these three files.

| Workflow | id | Paste file | Prod now (= base here) | Dev |
|---|---|---|---|---|
| `GD_EDIT_SUBMIT` | 2110618741159940097 | `GD_EDIT_SUBMIT.json` | v12 (`GD_EDIT_SUBMIT.base.json`) | v13, 2026-10-27 01:00, identical |
| `GD_EDIT_PREPARE` | 2110618832105033730 | `GD_EDIT_PREPARE.json` | v9 (`GD_EDIT_PREPARE.base.json`) | v10, 01:00, identical |
| `GD_EDIT_COMMIT` | 2110618866011787266 | `GD_EDIT_COMMIT.json` | v12 (`GD_EDIT_COMMIT.base.json`) | v13, 01:00, identical |

All three are needed together.

## The bug it prevents

The platform stores a custom-fields value by the table's **definition ids** where the table has definitions; the form sends
**names**. Proof: prod 502801's GD lines read `{"2074066865204011010": 6.72, ...}`. For GD **headers** only LSH 128671 has
definitions: `lsh_envelope`, `lsh_restday`, `lsh_resthour` and `lsh_receivehour`, ids 2114702689144279042 and up, created
10-26. Today no GD header on prod holds a non-empty `custom_fields`.

Once LSH GD headers hold values (bladexfunctions-68's change), every **form** edit of such a GD would:

1. see `custom_fields` as changed in SUBMIT's delta and PREPARE's `GDH`, because the stored ids differ from the form's names;
2. write it in E6;
3. fail E6's read-back ("the header does not read back (custom_fields)"), retry, then go to REQUIRES_REVIEW, leaving the GD
   stuck in Processing.

This is the header twin of the 10-25 line fix (502801, E2). SO_CASCADE edits were never exposed, because their base is the
stored row.

## The change

- **New read `cfh`** in SUBMIT (`sql_node_GScfh`) and PREPARE (`sql_node_GEcfh`), and `sql_node_GXe6cf` in COMMIT E6: the GD
  header table's definitions as `{ cf_defs: { id: name } }` (`su_code_custom_field`, table 1902054888473481218,
  `sub_table_key` empty).
- **`scratchpad/gde/code/commit/cf.js`** (new, self-contained): `geCfDefs`, `geCfCanon` and `geSame`, moved out of `e2.js`.
  It is included where `e2.js` or `e6.js` is, and in the SUBMIT gate and the PREPARE plan.
- **The header compares as names:**
  - `geDelta(form, stored, K, cfDefs)` (submit/delta.js);
  - `geGdParts(stored, after, K, cfDefs)` (prepare/plan_edit.js);
  - the adapter carries `cfDefs`;
  - E6's conflict check, its at-target check and its read-back (`commitE6Plan` / `commitE6Check`, e6.js).
- **Unchanged without definitions:** every tenant except LSH, and all of dev. In that case nothing changes: `geCfCanon`
  keeps every key.
- **Writes are unchanged.** The platform converts names to ids, and keeps ids it is given.

Builder: `python3 scratchpad/gde/build_gde.py --write GD_EDIT_SUBMIT GD_EDIT_PREPARE GD_EDIT_COMMIT`. Against the bases:

- real changes only in the gate, the plan, the E2 / E5 nodes (cf.js now included; same functions), E6 plan / check, and the
  3 new reads;
- every other "change" is a builder-renumbered `response_json` key;
- lint: only informational CONDITIONAL notes for the new reads;
- every changed code node compiles.

## Evidence

- **`scratchpad/gde/test/test_commit.js` 62/62**, with 6 new header cases on LSH's real definition ids:
  - the form's names against the stored ids are no edit (`geDelta`, `geGdParts`);
  - a changed value is still an edit;
  - E6 writes names and reads back ids, and is saved with no retry;
  - an already-saved header is recognised;
  - a real concurrent change is still a conflict.
  - Before the change, 4 of them failed with exactly "the header does not read back (custom_fields) - retry 1 of 3".
  - Mutants: `e6_cf_raw`, `e2_cf_raw` and `e2_cf_keep_undefined` are all caught; every other mutant is still caught.
- **Other suites:** `replay_cf_0654` 5/5 (the recorded 502801 line case), `test_lanes`, `test_prepare_glue`, `test_worker`,
  `test_client`, `test_mounted`, `test_edit_open`, `test_picking_guards`, `test_so_save_v2`, `test_so_form` and `test_lift`
  all pass.
- **The new read on prod data:**
  - tenant 128671 → `{"cf_defs": {"2114702689144279042": "lsh_envelope", ...}}` (4);
  - tenant 073522 → `{"cf_defs": {}}`.
- **Not run live:** dev has no GD header definitions (only 239760's line ones), so the id-keyed path only runs where header
  definitions exist. bladexfunctions-68's dev tests need LSH-like header definitions in their test tenant to exercise it.

## After the paste

`.dbtools/wf --prod deployed "Goods Delivery/EditV2/<name>.json"` must say `IDENTICAL` for all three:
'GD_EDIT_SUBMIT' (2110618741159940097), 'GD_EDIT_PREPARE' (2110618832105033730) and 'GD_EDIT_COMMIT' (2110618866011787266).
