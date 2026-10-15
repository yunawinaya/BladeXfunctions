# BUG-20261015-020: GD-from-PP leaves Picking records unstamped

TAF TA189054 was blocked by "planned quantity would become negative (-25)". The guard was right. The real
cause is in `GD_UNUSED_FN_NEW` Branch 4. It fetched only the Pickings named by each GD line's
`line_to_id`, so it never stamped picks the line drew from any other Picking. TA188799 delivered 30
from PK-03767 while its `line_to_id` pointed at PK-03768. PK-03767 kept `delivered_qty = 0`, and
TA189054 delivered 25 of the same 30 again.

## Fix

- `code_node_OBz5tEws` also returns `recordIds`, every stamped record. Empty → `["0"]`.
- New `search_node_PkRec8Hd`: Picking Items by `id in recordIds`, to read each record's `transfer_order_id`.
- New `code_node_PkHdrIds`: `line_to_id`s ∪ those headers. Empty → `["0"]` (an empty `in` matches every Picking).
- `search_node_68C0TVzK` reads `code_node_PkHdrIds.data.pickingIds`.
- `code_node_xVqrs3Yi`: `|| []` on the Pickings search.

## Files

- `GD_UNUSED_FN_NEW.prod.json`: prod enabled v49 plus the fix. **This is the prod paste.** Do not paste the
  repo file into prod: dev v54 also drops `LIMIT 500` from `sql_node_ItemDatas`.
- Dev: `Goods Delivery/GDinventoryProcessWorkflow.json` (dev v54 plus the same fix).
- `build.py` rebuilds both and asserts the baseline text. `replay.py` replays real prod runs, BASE vs fix.

## Data repair

`repairs/R1_restamp_picking_delivered.sql` (Bytebase, prod) sets `delivered_qty` on the 8 TAF records the bug left
unstamped to what Completed GDs delivered from them, and marks 7 Picking headers Fully Delivered. Its readiness SELECTs
returned 8 / 7 read-only on 2026-10-15. Not executed yet.
