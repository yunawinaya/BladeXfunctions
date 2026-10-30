# 2026-10-30 GD Created V2: delivery summaries show bin ids (Kenhin)

**Status:** dev GD_BULK_PREPARE v23 LIVE 10-30 12:05 (= repo), live test PASSED. Prod paste + repair built, checked read-only,
NOT pasted / run yet.

## What happened
- Kenhin's GD lines read `1. 2011257408998285313: 200 KG` in the delivery summary (`view_stock`) instead of `1. 501: 200 KG`.
- GD Created V2's PREPARE (GD_BULK_PREPARE, prod v22) names the bins of its auto-allocations from its facts read, whose BIN
  part loaded the plant's first 500 bins by id. Kenhin's plant has 1,500; its main bin "501" is the 501st and "1500" the
  1,500th, so both printed as ids.
- **Display only:** the bin list names bins in that text and nothing else. Allocations, stock and quantities are right. The
  only reader that parses `view_stock` (Picking) takes the unit from its `Total:` line.
- **Scope:** Kenhin only (the other plant over 500 bins, tenant 094552 with 622, creates GDs through classic). 876 lines on
  336 GDs since 10-23 10:42.

## The fix (`GD_BULK_PREPARE.prod_paste.json`)
- Prod enabled v22 + `scratchpad/gdc/gdcreate/patch_prepare_bin_names.py`. Only `sql_node_rCfSqwDY` changes; the paste =
  the repo file = dev v23 (`build.py` asserts both).
- The BIN part now reads only the bins of the balance rows the allocation reads (these items at this plant with unrestricted
  stock), by primary key, as the BATCH part already does. `LIMIT 500` stays as a cap.
- **Read-only prod check (Kenhin):** GD/20261030/2347, 2353, 2341: old read 500 rows without bin 501, new read 1 row "501".
  LSH's 89-item GD: 65 rows -> 24, all named, all in the old result. Same times (~0.2 s).
- **Dev 10-30:** GD/20261030/657 from SO/20261013-019 through SO_AUTO_GD v2: both summaries `1. A1-B1: 1 UNIT`, the bin
  allocated; then cancelled by GD Cancel V2 (reservations released, SO lines back to 0). Dev has no plant over 500 bins, so
  dev proves the wiring; the prod read proves the fix.

## Run, in order
1. **Paste** `GD_BULK_PREPARE.prod_paste.json` into GD_BULK_PREPARE (id 2104840044642754561), save, enable.
2. **Then** `python3 verify.py`: enabled = the paste; Kenhin lines created since showing an id = 0.
3. **Then** `repair_view_stock.sql` (Completed / Cancelled GDs only; 870 lines bin 501, 2 lines bin 1500 at build time):
   - PART 1: lines per bin id;
   - PART 2: rows affected = PART 1's count for each bin;
   - PART 3: no rows.
   - The 2 open GDs (GD/20261027/2194 Created, GD/20261030/2341 Processing at build time) are left out: an open GD's form
     would see the change. Run the file again once they are completed.
4. **Rollback:** paste `GD_BULK_PREPARE.prod_v22.base.json`. The repair has no rollback (the old text was an id).
