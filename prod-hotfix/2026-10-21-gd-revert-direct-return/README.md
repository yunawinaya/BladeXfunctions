# Stock a GD revert never put back (prod, tenant 836238), 2026-10-21

## What happened

A Goods Delivery line with no reservation behind it is delivered straight from Unrestricted when the GD is completed
(GD_UNUSED_FN_NEW's "deliver remaining directly from unrestricted" branch: `GDL OUT Unrestricted`, no reservation row).
The classic revert (GD_PROCESS_REVERT up to v13) returned only reserved stock, so those units stayed out of the system.
When the GD was then completed again, the same stock left a second time.

GD_PROCESS_REVERT v14 (dev since 10-21, prod with the cut) returns such stock to Unrestricted at the cost it left at. It
also covers GD Revert V2. This folder repairs what the old revert already lost on prod.

## Scan: every reverted completion on prod

`scan_lost.py` uses v14's own rule on every `Reverted` completion snapshot (154 of them, 7 tenants): the GD's movements
between the snapshot and the revert, net quantity out per item, batch, bin and handling unit, less what the revert returned.
Output: `repairs/scan_lost_20261021.json`. Only tenant 836238 lost stock: 5 GDs, 8,998 units. Each case was then checked
by hand against the GD's full movement history.

| GD | Reverted | Lost (bin 2031936537033715714) | Cost | Since then on those batches |
|---|---|---|---|---|
| JO-01054 | 10-14 16:56 | 4 batches × 1 | 0 | deliveries only |
| JO-01069 | 10-15 15:38 | 2 + 1 + 1 | 0 | deliveries only |
| JO-00346 | 07-30 15:35 | 1,680 (…109001 / …642753) | 0 | deliveries only |
| JO-00346 | 07-30 15:35 | 2,560 (…131265 / …634881) | 0.0053 (13.57) | **3 stock adjustments, −3,520** |
| JO-00761 | 09-30 11:25 | 1,870 (…976279 / …424833) | 0 | **4 stock adjustments, −5,880** |
| JO-00765 | 10-01 13:31 | 2,880 (…407510 / …687809) | 0.0688 (198.14) | **4 stock adjustments, −7,080** |

## The repair (October: JO-01054 + JO-01069, 8 units at cost 0)

One file: `repairs/R1_gd_revert_direct_return_836238.sql`, built by `build_repair_sql.py` from the scan. It writes what v14
would have written through ADD_INVENTORY_NEW, for each of the 7 lost keys:

- a `GDL-R` IN Unrestricted movement at cost 0;
  - same columns as the platform's own revert rows (e.g. JO-01025, 10-20);
  - user = the person who reverted (2031950952575545345);
  - `doc_date` = the day of the revert;
  - ids from worker 1001, the repair convention;
- the item_batch_balance and the item_balance row + qty (the platform keeps item_balance = sum of batch rows; checked);
- a FIFO layer: next sequence of its batch (as ADD_INVENTORY_NEW computes it), initial = available = qty, cost 0.

**The file, in the layout of the earlier prod repairs (run it in Bytebase, top to bottom):**
1. **BEFORE** (read-only). Each check's expected result is in its comment:
   - B1: the repair has not run yet;
   - B2: every batch's FIFO total equals its balance;
   - B3: every item balance equals the sum of its batch rows.
2. **REPAIR**, one transaction. Each key's statements are guarded by its own movement id, so running it twice changes nothing.
3. **AFTER** (read-only):
   - A1: 7 movements and 7 layers exist;
   - A2 / A3: the same equalities hold again, and each row is up by its quantity:
     - +2 for …2702976794639 and …3307329863684;
     - +1 for the others;
   - A4: the new FIFO layers (sequence 2, or 3 for the second unit of the doubled batch);
   - A5: the new movements.
4. **ROLLBACK**, commented out. It undoes each key only while its new FIFO layer is untouched.

Every statement was checked against prod's schema without running it:
- the UPDATEs were EXPLAINed on dev;
- the INSERT columns were checked against prod's `information_schema`, and their SELECTs were EXPLAINed on prod;
- the rollback DELETEs' WHERE clauses were run on prod as SELECTs;
- the BEFORE / AFTER checks were run on prod (10-21 16:0x: B1 0 | 0, and every equality held).

**Not done by SQL:** the reorder tracker (REORDER_SET_REDIS) is not told about the 8 units. That is negligible against
balances of 70,000–290,000.

**Independent of the cost-0 repair:** `scratchpad/revcost/gen_repair.py` now skips worker-1001 rows, so the two repairs
can run in either order.

## Not included: JO-00346, JO-00761, JO-00765 (8,990 units)

These losses are real in the movement history. But three of the four batches have had stock adjustments since, all
negative. A count that caught our under-statement would have come out positive. So whether those units are still on the
shelf is for the customer to confirm with a stock count of those batches. If they are, re-run the builder with those GD
numbers:

```
python3 build_repair_sql.py repairs/scan_lost_20261021.json <out_dir> JO-00346 JO-00761 JO-00765
```

Two of those keys carry a cost, 211.71 in all.
