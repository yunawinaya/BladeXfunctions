# 2026-10-28 IA → Location Transfer Request (ENH-20261027-001) + the IA split's No. of Split

> **NOT READY TO PASTE.** The dev browser test is still open. This folder shows the size of the paste; I re-check every prod base
> and refresh this folder before you paste.

**Status (built 28 Oct, 18:55):**
- **Files:** 12 to paste, plus 3 setup steps on prod (the dictionary entry, 3 permission keys, renaming Workflow 5) and the
  role grants at the end.
- **Prod check:** prod runs exactly the base each change was built on, for 11 of the 12 targets. The 12th, the IA list, differs
  from that base only by two form-designer leftovers (below). So the paste brings only today's work.
- **Dev check:** every paste file is identical to what dev runs now.
- **Builder:** `python3 scratchpad/iatr/deploy/prod_folder.py --write` re-pulls and refreshes this folder.

## What users get
- **Transfer requests:** production can request an Item Assembly's materials from a saved Draft IA, with **Request Materials**.
  This creates a Location Transfer in the new status **Requested** (purpose Item Assembly Supply).
- **Warehouse:**
  - picks the stock and uses **Save Picks**, which moves nothing;
  - uses **Dispatch**, which sends the stock to In Transit (background, all-or-nothing).
- **Production:**
  - uses **Receive**, which puts the stock into the staging bin;
  - completes the IA from that bin. The IA save refuses picks taken from anywhere else.
- **Changes and cancelling:** Refresh after an IA change and Cancel (before dispatch) are done from the IA. A dispatched request
  is cancelled from the transfer list (the stock goes back).
- **Item Assembly split receipt:** **No. of Split** + **Split** replace the switch. Split makes all the rows at once, the total
  sits under the rows, and the table is only as tall as its rows.
- **Ordinary transfers and IAs:** unchanged (tested on dev: Draft, In Progress, Completed, direct Completed, cancel, plain IA
  complete + revert).

## Before the first paste (prod, by you)
1. **Dictionary:** System Management → System Dictionary → the `status` row's children → Add key **`Requested`**, value
   **`Requested`**, sort **52**, not sealed.
2. **Permission keys:** create them exactly as on dev. **Don't grant them to roles yet** (step 13), so nobody sees the new
   buttons halfway through the paste.
   - `ia_create_transfer_request` "Create Transfer Request", under the **Item Assembly** menu
   - `lot_ia_dispatch` "Item Assembly Dispatch", under the **Location Transfer** menu
   - `lot_ia_receive` "Item Assembly Receive", under the **Location Transfer** menu
3. **Rename** Workflow 5 → `IA_TRANSFER_REQUEST` (id `1985966508400201729`): **done on prod 28 Oct.** Leave it in its current
   folder. Moving it into "BOM + IA" fails on prod with "新父节点…不存在有效闭包路径": prod's folder tree lacks the folders' own
   entries (`su_code_app_files_closure`), and dev has them. This affects only where it's listed.
4. **Tell me before you paste.** I re-check that every prod base is still unchanged. If one changed, the paste would wipe that
   change.

## Paste order
Each target is named with its id; paste `<n>_….prod_paste.json`.

| # | File | Target on prod | Prod now → after |
|---|---|---|---|
| 1 | `1_LOT_form.prod_paste.json` | form **Location Transfer** (`sm_location_transfer`, id `2013791389687349250`) | v113 → dev v115 |
| 2 | `2_IA_form.prod_paste.json` | form **Item Assembly** (`sm_item_assembly`, id `2098256587713404929`); not Item Disassembly | v36 → dev v75 |
| 3 | `3_LOT_list.prod_paste.json` | page **Location Transfer** list (id `2013863255693197313`) | v49 → dev v50 |
| 4 | `4_IA_list.prod_paste.json` | page **Item Assembly** list (id `2098312073316716546`) | v18 → dev v32 |
| 5 | `5_SM_LOCATION_TRANSFER.prod_paste.json` | workflow `SM_LOCATION_TRANSFER` (id `2013133675374927874`) | v85 → dev v86 |
| 6 | `6_LOT_V2_PREPARE.prod_paste.json` | workflow `LOT_V2_PREPARE` (id `2110992359150977026`) | v7 → dev v8 |
| 7 | `7_LOT_V2_COMMIT.prod_paste.json` | workflow `LOT_V2_COMMIT` (id `2110992400045441026`) | v8 → dev v9 |
| 8 | `8_LOT_V2_WORKER.prod_paste.json` | workflow `LOT_V2_WORKER` (id `2110992316335521793`) | v6 → dev v7 |
| 9 | `9_LOT_V2_SUBMIT.prod_paste.json` | workflow `LOT_V2_SUBMIT` (id `2110992282596540417`) | v5 → dev v6 |
| 10 | `10_IA_TRANSFER_REQUEST.prod_paste.json` | workflow `IA_TRANSFER_REQUEST`, formerly "Workflow 5" (id `1985966508400201729`) | empty placeholder → dev v5 |
| 11 | `11_IA_SAVE.prod_paste.json` | workflow `IA_SAVE` (id `2098335576774463489`) | prod v12 → dev v27 |
| 12 | `12_IA_V2_SUBMIT.prod_paste.json` | workflow `IA_V2_SUBMIT` (id `2112141238600376321`) | prod v14 → dev v16 |
| 13 | none | grant the 3 permissions to the roles that request, dispatch and receive | |

**Why this order:**
- **Forms first:** their publish creates the new columns, and the workflows (LOT V2, IA_SAVE) read those columns on every save.
- **PREPARE, COMMIT and WORKER before SUBMIT:** a dispatch must never meet the old PREPARE.
- **The grants last:** nobody sees the new buttons before everything is in.

**After the paste** I run read-only checks: all 12 identical to these files, the new columns there, the Workflow 5 slot filled,
and `python3 scratchpad/prod_health.py`.

## Notes
- **IA list (#4):** besides today's change (the Transfer Request column, last, and Delete refused while a request is live), it
  carries two form-designer leftovers, neither of which changes behaviour:
  - an empty `onFormChange` rule entry that dev has;
  - an empty `select-card` property that dev doesn't have.
- **IA form (#2):** carries all of today's IA form work:
  - the Transfer Request section and Request Materials;
  - No. of Split + Split;
  - the table height and empty hint fixes.
- **IA_SAVE / IA_V2_SUBMIT (#11, #12):** prod v12 / v14 are the 10-27 pastes. The only change on top of them is the transfer
  request checks:
  - Created / Completed are refused while a request is live;
  - picks must come from the request's staging bin.
- **Workflow 5 (#10):** still the empty placeholder on prod (checked 18:55).

## Rollback
Paste the `<n>_….prod_base.json` files back in reverse order (12 → 1). The new columns and the dictionary entry stay, and
nothing else reads them. Any request created after the paste would be left without its screens, so roll back only before the
first request.
