# 2026-10-29 Item Assembly split: No. of Split + Split, without the transfer request

**Status:** ready to paste.
- **Prod check (10:30):** prod runs the base, form **Item Assembly** v38 (the 10-27 form + the 10-28 `sc_main` Create IA fix).
- **Builder:** `python3 scratchpad/iasc/deploy/prod_folder_split.py --write` builds the form with `SC_NO_TR=1`, without the
  transfer request, re-checks prod and rewrites this folder. `--after` checks the paste once it's in.

## What users get (the split's dev work of 10-28 / 10-29, nothing else)
- **No. of Split + Split** (as GR): type a number and press Split, and every row is made at once.
  - The output is spread over the rows: whole numbers when the output is whole, otherwise 8 decimals with the last row taking the
    rounding.
  - Each row gets the Output Location's storage location, bin, category and dates, plus the batch number for Manual items.
  - This replaces the "Split receipt" switch.
- **Layout:** the total sits under the rows, and the rows table is only as tall as its rows.
- **Undo:**
  - No. of Split 1 or blank + Split (asked first) gives one receipt again, with row 1's details in the Output Location fields.
  - Deleting rows down to one does the same by itself.

## Paste
| # | File | Target on prod | Prod now → after |
|---|---|---|---|
| 1 | `1_IA_form.prod_paste.json` (the whole form, full JSON as on 10-27 / 10-28 #4) | form **Item Assembly** (`sm_item_assembly`, id `2098256587713404929`); not Item Disassembly | v38 → v38 + the split |

- **After the paste:** tell me. I run `python3 scratchpad/iasc/deploy/prod_folder_split.py --after` (expect IDENTICAL), then
  `python3 scratchpad/prod_health.py`.
- **Rollback:** paste `1_IA_form.prod_base.json` back.

## What the paste changes against prod v38 (checked, nothing else)
- **Handlers:**
  - `os_main`: equals dev v78's;
  - `os_onClick_split`, new: the Split button;
  - `iaV2_onClick_completed` and `iaV2_onClick_completed_post`: one line each, the 3 new split fields added to the list of fields
    not sent with a save.
- **Widgets:**
  - `output_split_pick`, `output_split_count`, `output_split_btn`, new: the No. of Split row;
  - `output_split`: auto height, not a virtual table.
- **Unchanged:** everything else, including `sc_main` (the Create IA fix), `mounted` and the form config. There's no transfer request:
  no Request Materials, no transfer-request fields or columns.
- **Server side:** none needed. The split's save checks (IA_SAVE / IA V2) have been on prod since 10-27.

## Tests
- **The same build without the transfer request:** the IA form client suite passes, including the split form 83/83, SO-line entry
  89/89, legacy 316/316, RES and IA V2 suites. Only the transfer request's own checks fail, because it is absent: `test_tr_form` and 6
  transfer-request checks in `test_sc_json`.
- **Against dev v78:** this build differs from dev v78 only by the transfer request.

## Later
The transfer-request folder (`2026-10-28-ia-transfer-request`, NOT READY) carries the whole dev form. After this paste its IA form base
check will differ by the split, which is expected. Re-pin it to the new prod version when that folder is refreshed.
