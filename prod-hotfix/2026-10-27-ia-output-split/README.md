# 2026-10-27 Item Assembly: split the finished good's receipt across bins and batches (output split) + IA V2 stock-lock fix

**Status:**
- **Dev:** LIVE. Form v64, IA list v31, IA_SAVE v26, IA_HOLD v13, IA_REVERT v9, IA_REVERT_V2_PREPARE v7 / SUBMIT v5 / COMMIT v6 /
  WORKER v4, IA_V2_PREPARE v6 / COMMIT v9 / WORKER v5 / SUBMIT v15. Every paste file here is byte for byte what dev runs.
- **Server live tests on dev passed:**
  - Classic: a non-batch split completed and reverted (711077).
  - Background (IA V2): a System-batch split, 3 rows in 2 batches, completed and reverted by Revert V2 (000000).
  - The same IA completed again with the split switched off.
  - The stock-lock fix (000000, IA-2610-015, a 3-row split):
    - The completion took two worker runs. Run 1 issued the components and parked at 75 %; run 2 received the 3 rows.
    - The revert took two runs as well. Run 1 took the stock back and parked at 80 %; run 2 restored the costing and set the IA
      back to Draft.
    - Afterwards: stock back to the start, Batch rows soft-deleted, nothing left under review.
- **Not done yet: the browser pass on dev.** Do it before step 13, which is the step that shows the grid to users. Check:
  - the split grid: bin dropdown, date pickers, reopening a saved split;
  - one IA V2 completion from the form (more than 50 picks): the spinner closes a few seconds after "Components issued", not 15 s
    later.
- **Prod:** paste pending. Checked 18:52-19:00 that prod runs exactly the version each paste was built on:
  - Form v58 and IA list v29: same content.
  - The 11 workflows: same content.
  - Unchanged, and the same on dev and prod: ADD_INVENTORY v68, SUBTRACT_INVENTORY v63, GENERATE_BATCH v20,
    INVENTORY_BULK_APPLY v12.
  - Prod uses the same workflow ids as dev, so the files' calls to each other resolve there.

## What users get
- **Form, Output Location:** a **Split receipt** switch.
  - Switched on, a grid of 2-20 rows: Qty, Storage, Bin, Category.
  - A batch item also gets a Group (System numbering: rows in one group share one batch) or a typed Batch No (Manual), plus
    the batch's dates.
  - The rows must add up to the output quantity. The header's single fields show row 1.
- **Completing:**
  - One receipt per row, all at one unit price.
  - A System batch gets one new number per group, a Manual batch keeps its typed number, a non-batch item just goes to the
    bins.
  - Up to 50 picks the classic save does it (IA_SAVE); above 50 the background completion (IA V2).
- **Revert (classic and V2):** every receipt goes back, the IA's Batch rows are soft-deleted and the IA returns to Draft with its
  rows kept. Completing it again gives a System split new numbers.
- **List label print:** one label line per split row that has a batch.
- **Unchanged:** with the switch off, everything behaves as today. Existing IAs are untouched; their empty split is read as "no
  split". Mobile is unchanged: it leaves `output_split` out and keeps the stored rows (`Item Assembly & BOM/SmallCycle/MOBILE_RES01_GUIDE.md`,
  section 8b).
- **The stock-lock fix (IA V2 and Revert V2, steps 6, 7, 10, 11, 13):**
  - **Why:** a stock lock stays held until the worker's whole run ends. Before the fix, one run could make two stock calls,
    and so could several jobs in a row. That is the pattern that froze GD and Picking stock on prod on 10-26 until the
    20-minute limit.
  - **Now:** each worker run makes at most one stock call.
    - Completion: run 1 issues the components and stops at 75 % ("Components issued; receiving the assembled item"). Run 2
      receives the item.
    - Revert: run 1 takes the stock back and stops at 80 %. Run 2 restores the costing.
  - **How fast:** no lock is held between the two runs, so other documents are never blocked by it.
    - The form kicks run 2 as soon as it sees 75 %, so a completion finishes a few seconds after run 1.
    - The list's revert starts run 2 straight away.
  - **If the user closes the form between the runs:** the IA stays Processing (read-only) until the next kick, which comes
    from opening the IA list or the IA itself.
  - **Exposure today:** IA V2 has run once on prod (710478, 10-26). Every other prod IA is classic, which makes no engine lock.
- **Riding along:**
  - IA_REVERT / Revert V2: a Weighted Average batch receipt is matched by its own quantity first, so two receipts into one batch
    can't be mixed up.
  - IA_HOLD's completion check now says which split row's receipt failed.

## Paste (user), in this order
The form creates the two columns (`output_split` json, `output_split_on` int) before anything writes them. The first form paste
keeps the split hidden. The grid only appears with step 13, so nobody can split while the workflows are half pasted.

**Before each paste:** check that the step's base file still matches prod. If it doesn't, someone changed it on prod after
19:00. Stop and tell me: the paste would wipe their change.
- A workflow: `.dbtools/wf --prod deployed <n>_<NAME>.prod_v<N>_base.json` says IDENTICAL.
- The form: `.dbtools/form --prod status sm_item_assembly prod-hotfix/2026-10-27-ia-output-split/1_IA_form.prod_v58_base.json`
  says IDENTICAL.

1. **Form, split hidden.**
   - Table **Item Assembly** (`sm_item_assembly`, id **`2098256587713404929`**). Not Item Disassembly (`2106937624568991746`),
     not the Item Assembly history table.
   - File `1_IA_form_OFF.prod_paste.json` (= dev v59: prod v58 plus the hidden split widgets).
   - Check: `.dbtools/form --prod status sm_item_assembly prod-hotfix/2026-10-27-ia-output-split/1_IA_form_OFF.prod_paste.json`
     says IDENTICAL.
   - And `.dbtools/db --prod "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sm_item_assembly' AND COLUMN_NAME LIKE 'output_split%'"`
     returns 2 rows: `output_split` json and `output_split_on` int.
2. Workflow **IA_HOLD**, id **`2112752274794217473`**. File `2_IA_HOLD.prod_paste.json`.
3. Workflow **IA_REVERT**, id **`2099319746652852225`**: the classic revert, not the IA_REVERT_V2_* ones. File `3_IA_REVERT.prod_paste.json`.
4. Workflow **IA_REVERT_V2_PREPARE**, id **`2112141455206817794`**. File `4_IA_REVERT_V2_PREPARE.prod_paste.json`.
5. Workflow **IA_REVERT_V2_SUBMIT**, id **`2112141384234999809`**. File `5_IA_REVERT_V2_SUBMIT.prod_paste.json`.
6. Workflow **IA_REVERT_V2_COMMIT**, id **`2112141490329919490`**. File `6_IA_REVERT_V2_COMMIT.prod_paste.json` (the lock fix).
7. Workflow **IA_REVERT_V2_WORKER**, id **`2112141417890095105`**. File `7_IA_REVERT_V2_WORKER.prod_paste.json` (the lock fix). Paste
   it right after step 6.
8. Workflow **IA_SAVE**, id **`2098335576774463489`**. File `8_IA_SAVE.prod_paste.json`.
9. Workflow **IA_V2_PREPARE**, id **`2112141312130719745`**. File `9_IA_V2_PREPARE.prod_paste.json`.
10. Workflow **IA_V2_COMMIT**, id **`2112141346016501762`**. File `10_IA_V2_COMMIT.prod_paste.json`: the split and the lock fix.
11. Workflow **IA_V2_WORKER**, id **`2112141277456408577`**. File `11_IA_V2_WORKER.prod_paste.json` (the lock fix). Paste it right
    after step 10.
12. Workflow **IA_V2_SUBMIT**, id **`2112141238600376321`**. File `12_IA_V2_SUBMIT.prod_paste.json`. It goes after 9 and 10: it queues
    split jobs that only the new PREPARE / COMMIT can run.
13. **Form, split ON.** The same table as step 1 (id `2098256587713404929`). File `13_IA_form_ON.prod_paste.json` (= dev v64).
    - Contents: v60's grid plus the grid's Add Row and per-row Delete buttons (browser pass 10-27 17:00), and a new row's default
      bin (the header's rule).
    - The total line warns when two rows are one batch in one bin and category, which the save refuses.
    - The IA V2 wait kicks run 2 at the park (the lock fix).
    - Check: `.dbtools/form --prod status sm_item_assembly prod-hotfix/2026-10-27-ia-output-split/13_IA_form_ON.prod_paste.json` says IDENTICAL.
    - Users with the IA form open get it when they reload.
14. **IA list page.** Page **Item Assembly**, id **`2098312073316716546`**. Not "MC2 Item Assembly" (`1942762614229053441`), not
    "Item Disassembly" (`2107013669846454273`).
    - Replace only the event script **`onItemAssemblyPrintTemplateConfirm`** (key `iaprcf01`) with `14_IA_list_printConfirm.js`, and
      change nothing else.
    - Or paste the whole page `14_IA_list_page.prod_paste.json`: it is prod v29 plus that handler, checked.
    - This step works with or without step 13: an IA without split rows prints as before.

**Check each workflow:** `.dbtools/wf --prod deployed prod-hotfix/2026-10-27-ia-output-split/<n>_<NAME>.prod_paste.json` says IDENTICAL.

**Between a COMMIT and its WORKER** (6 to 7, 10 to 11), the lock behaviour is the same as prod today, never worse. That's why
each worker goes right after its COMMIT.

**After the paste I run read-only checks:** every file IDENTICAL, the two columns present, `python3 scratchpad/prod_health.py`.

## Rollback
- **How:** paste the matching `*_base.json` back in reverse order: 14, then 13 (use `1_IA_form.prod_v58_base.json`), then 12 down to 2.
  For the list handler, `14_IA_list_printConfirm.prod_v29_base.js`.
- **The columns stay:** the old code never reads them.
- **If split IAs were completed meanwhile:** they keep their receipts and rows; the old revert still reverses every receipt by
  its bin.
- **A V2 job parked at 75 % or 80 % during a rollback:** the old COMMIT and WORKER finish it. They already parked jobs above
  1,000 picks.

## Notes
- **Who uses it:** LSH (128671) is the only prod tenant with batch-managed outputs. Nothing changes until someone switches the
  split on.
- **Posting is not ours:** a split IA posts the header's batch (row 1's) with the total quantity. If a customer posts split IAs,
  flag it to the posting owner.
- **No new permission, no data repair.**
- **Revert V2 COMMIT / WORKER (steps 6 and 7) also carry two shared-code updates that the revert never runs:**
  - the RES-01 "Created" status list, used only by the completion side;
  - the split-aware header fingerprint. The revert checks only its movement-row fingerprint.

  A diff against prod shows them in many nodes. The only live changes are the hand-over (run 1 stops after the stock call) and
  the worker's one-call stop.
- **Not touched:** the IA list's Cancel button and the stock engine.

## Tests (dev and offline)
- **Offline suites:**
  - Small Cycle suite green. Client 1,221 checks in 19 files, including the IA V2 wait's park kick (6); all 251 client
    mutants killed.
  - Classic IA_SAVE split 107/107. SUBMIT v6 16/16 mutants killed.
- **IA V2 suites:**
  - PREPARE: 505 checks, 14 + 5 mutants killed.
  - COMMIT: steps 179 checks, simulation 1,419 (crash after every write, then resume).
  - WORKER: simulation 38, including the one-call stop.
  - 14 mutants killed across COMMIT and WORKER.
  - SUBMIT simulation: 81 checks.
  - Integration end-to-end: 130 checks (two worker kicks per completion and per revert).
  - Revert V2: COMMIT unit 90, simulation 339, worker simulation 34, classic 92.
- **Independent review:** a fresh code review found one real bug, fixed in COMMIT v8. A split with 12 or more batches could
  not resume after a crash in the Batch step. The fix was proven by a failing test first, then a passing one.
- **Live on dev:** the results under Status.
