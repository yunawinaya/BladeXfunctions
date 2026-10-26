# GD Edit V2: save a header custom-field edit (2026-10-27)

> **PROD LIVE 2026-10-27:** GD_EDIT_PREPARE v11 at 02:45:57 and GD_EDIT_SUBMIT v14 at 02:47:04. Both are IDENTICAL, as are
> COMMIT and WORKER. prod_health afterwards showed only the CHECK sections that were already there before this paste.

Follows `prod-hotfix/2026-10-27-gde-header-cf/` (header custom fields compare as names, E6 wipe fix; COMMIT v14 already on
prod). That fix stopped a header custom-field edit from wiping or sticking a GD, but GD Edit V2 still dropped the edit.
This one saves it. It is bladexfunctions-68's open step for header edits (`prod-hotfix/2026-10-27-sales-header-cf-gd/`).

| Workflow | id | Paste file | Prod now (= base here) | Dev |
|---|---|---|---|---|
| `GD_EDIT_SUBMIT` | 2110618741159940097 | `GD_EDIT_SUBMIT.json` | v13 (`GD_EDIT_SUBMIT.base.json`) | v14, 2026-10-27 02:38, identical |
| `GD_EDIT_PREPARE` | 2110618832105033730 | `GD_EDIT_PREPARE.json` | v10 (`GD_EDIT_PREPARE.base.json`) | v11, 02:38, identical |

`GD_EDIT_COMMIT` (2110618866011787266) and `GD_EDIT_WORKER` do not change. Either paste order is safe; paste both.

## What was wrong

PREPARE emulates the classic save's GD write with gdc's `gcGdWrite` (`scratchpad/gdc/code/prepare/chain.js`), a fixed list
of 111 header columns from GOODS_DELIVERY v246. `custom_fields` is not in it, so the after-image kept the stored value. A form
change of a header custom field (LSH's Envelope, Rest Day, Rest Hour, Receive Hour) made no header part, and the job
completed with the old values.

## The change

`gcGdWrite` writes `custom_fields` as the form sent it, when it is an object (`{}` clears). If it is null, absent, text or an
array, the column is left alone and the stored value stays. This is GOODS_DELIVERY v251's rule (GdCfNeed / GdCfOut).

- **It is not added to `GC_GD_WRITE_COLS`:** GD Complete's gate compares those columns raw, so stored ids against form
  names would send every completion to the classic save.
- **The rest is already on prod:**
  - PREPARE's planner compares the value as names, so only a real change becomes a header cell.
  - COMMIT v14's E6 writes it by name, and the platform stores ids.
  - E6 checks that a non-empty value reads back.
- **The built diff:** 4 lines in `code_node_GSgate` (SUBMIT) and `code_node_GEplan` (PREPARE), the two nodes that bundle
  chain.js. In SUBMIT the gate stops before the write, so its behaviour is unchanged.
- **GD Complete V2 / GD Cancel V2:** they bundle the same chain.js and pick it up on their next rebuild. Their afterImage
  starts from the stored GD, so nothing changes for them. Reviewed by the GD session, who checked live plans on dev GD/20261027/633.

## Evidence

- **`scratchpad/gde/test/test_commit.js`: 72/72.** New cases:
  - a form edit reaches the header part;
  - `{}` clears;
  - the unchanged value is no cell, whether sent as names or as the stored ids (SO_CASCADE's base is the stored row);
  - null, absent and text leave the column;
  - a NULL-stored header with the form's `{}` writes `{}`, reads back, and does not stick. 1,622 Created GDs on prod still
    hold NULL; the classic save writes `{}` too.
  - `GC_GD_WRITE_COLS` stays without custom_fields.
  - The new mutants `chain_cf_none` and `chain_cf_null` are caught, and every older mutant is still caught.
- **Other suites:** `replay_cf_0654`, `test_prepare_glue`, `test_submit`, `test_lanes`, `test_worker`, `test_client` and
  `test_so_form` pass, and so does gdc's `test_submit_force`. Lint findings are unchanged from the deployed versions, and
  both changed nodes compile.
- **Dev browser test, GD/20261027/633:** Envelope was unticked and Rest Hour changed from "1-2" to "3-4". Job 2114789141583048706
  COMPLETED in 5 s: E2 changed no lines, E6_HEADER was DONE on its first attempt. The header now stores
  `{"2114765569527459842": 0, "2114765681024643073": "3-4", ...}` (ids).

## After the paste

`.dbtools/wf --prod deployed "Goods Delivery/EditV2/<name>.json"` must say `IDENTICAL` for 'GD_EDIT_SUBMIT'
(2110618741159940097) and 'GD_EDIT_PREPARE' (2110618832105033730).
