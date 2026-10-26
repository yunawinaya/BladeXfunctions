# 2026-10-26 GD Created V2 stores allocation quantities as numbers (GD_BULK_PREPARE)

**PASTED and verified, 2026-10-26 17:13:13:** GD_BULK_PREPARE (id 2104840044642754561) prod v21 is IDENTICAL to this file. The
replaced v20 equals the base, and only code_node_egoCivrm changed. Live: the next V2 GDs (GD-26/10/0566, 0567 in tenant 900938;
JO-01162 in 836238) store numbers on 12 of 12 stock lines, where 0564 / 0565 before the paste stored text.

**Paste into: GD_BULK_PREPARE (id 2104840044642754561).** Prod live: v20 (2026-10-23 15:27:25), identical to the base this
was built on. Dev: v21, identical to this file.

## What was wrong
- **Since 10-08, every stock line created by GD Created V2 stored its allocation quantity as text:**
  `temp_qty_data` held `"gd_quantity":"100"`. The classic save and every other writer store a number.
- **The writer:** code_node_egoCivrm (Finish) rebuilds each line's allocations from the staged rows. Their quantity is a
  decimal string (fmt() in auto-allocation, s() in the parse node).
- **Prod evidence:** on V2-created GDs since about 14:20, nearly every stock line is text; the numeric ones are on GDs rewritten
  later.
- **Impact:** KF 073522's loading-bay Picking merge added the values as text. PICK-FG2610-160 was refused: "temp_qty_data total
  (100100100100100) != gd_qty (500)".
- **What already tolerates text:** the Picking side now does (the Picking session's fix, `../2026-10-26-picking-text-qty/`).
  GD Complete V2 also did (the 7 Kenhin GDs completed today were all text).

## The change
One line in code_node_egoCivrm: `gd_quantity: Number(A.a.quantity)`.
- **Why it's exact:** the staged quantity is validated as a positive decimal with at most 8 decimals, so Number() keeps it
  exact in JSON.
- **Untouched:** the decimal columns the node writes (reserved_qty, open_qty, ...), which the platform stores as decimals.
- **Existing open lines are not rewritten.** No SQL; their readers are tolerant.

## Tests
- **Dev, end to end (17:07):**
  1. the 100-line test GD (SO/20261026-059) was cancelled through GD Cancel V2 and re-created through SO_AUTO_GD;
  2. GD/20261026/631: all 100 lines store a number (`"gd_quantity":10`), none text. Before the fix the same SO gave text.
- **Lint:** no new findings. The existing prepare tests pass.
- **Script:** `scratchpad/gdc/gdcreate/patch_prepare_number_qty.py`.

After the paste: `.dbtools/wf --prod deployed "prod-hotfix/2026-10-26-gd-prepare-number-qty/GD_BULK_PREPARE.json"` must say IDENTICAL.
