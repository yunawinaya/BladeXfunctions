# GD-2610-1245 cannot complete: 5 Reserved lost from the Packing bin (LSH, 2026-10-25)

GD-2610-1245 (LSH, Picking and Packing Completed) has failed Complete 4 times with `GDC_INVENTORY_INSUFFICIENT`, the last at
14:32 today. Its line for material 2113380262850207757 needs 5 Reserved in its box HU/2610/1684 at bin 2108721631730995201.
That bin's balance for the batch reads 0.

## Cause

On 2026-10-24, two writers updated the same balance row within one second, with no lock in common:

- 13:38:09.5: GD-2610-1245's classic Packing save (PACKING_SAVE, then classic GOODS_DELIVERY / ADD_INVENTORY_NEW) added
  +5 Reserved at the bin.
- 13:38:08-12: GD-2610-1180's V2 completion (INVENTORY_BULK_APPLY) took -20 Reserved from the same bin. It had read the row
  before the +5 landed and wrote 0.

Classic stock writers take no V2 stock lock (readiness item 5, MIN-01 classic lock OFF). The mobile V2 release moves mobile
Packing to the V2 engine, which removes most of this window.

## Evidence (prod, read-only)

- That bin's movement ledger for the batch nets +5 Reserved (35 in, 30 out). Both `item_batch_balance` 2113441470903095298
  and `item_balance` 2113441470873735170 read 0.
- GD-2610-1245's two reservations (5 and 36, Allocated, box HU/2610/1684) match the movements. The 36 line's balance is right.
- Checked across every LSH batch balance: this is the only Reserved quantity that disagrees with its movements.

## Fix

1. Run `repair.sql` on prod: 2 statements, expect 1 row each. Both are guarded by the current values; a 0 means stop.
2. Click Complete on GD-2610-1245 in the LSH GD list.
