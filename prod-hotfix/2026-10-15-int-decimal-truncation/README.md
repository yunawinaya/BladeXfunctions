# Decimal quantities cut to whole numbers (code-node outputs declared `int`)

A code-node output whose `response_json` entry says `"bsonType": "int"` reaches every reader as a whole number: 7.5
arrives as 7. Nothing fails, so it went unnoticed. Found by the GR V2 twin test on 2026-10-15 (a classic receipt of 7.5
moved on-order by 7, V2 by 7.5).

| Workflow | Node.output | Effect |
|---|---|---|
| GOODS_RECEIVING | `code_node_D9IbUV8t.onOrderQty` | On-order `received_qty` 7 for a 7.5 receipt; `open_qty` 0.5 stays open on a fully received PO line |
| SUBTRACT_INVENTORY_NEW | `code_node_fVEv7HuP.wa_quantity` | Weighted-average quantity written rounded down after a fractional issue |
| SUBTRACT_INVENTORY | `code_node_4yvZMf0Q.wa_quantity` | Same |
| SM_PLANT_TRANSFER | `code_node_CdNEX3lE.quantity` | The picked quantity of a fractional batch transfer reaches the per-batch lines (saved In Progress) and the cost-price call as a whole number: 2.5 becomes 2 |

## Fix

Those four entries become `"decimal"`. The values are already rounded to 8 decimal places by the code, and nothing else
changes. The other `int` outputs of `code_node_D9IbUV8t` are indices and 0/1 flags and stay `int`.

## Files

- `GOODS_RECEIVING.prod.json`: prod enabled v99 plus the fix. **Paste into prod GOODS_RECEIVING.**
- `SUBTRACT_INVENTORY_NEW.prod.json`: prod enabled v24 plus the fix. **Paste into prod SUBTRACT_INVENTORY_NEW.**
- `SUBTRACT_INVENTORY.prod.json`: prod enabled v58 plus the fix. **Paste into prod SUBTRACT_INVENTORY.**
- `SM_PLANT_TRANSFER.prod.json`: prod enabled v102 plus the fix. **Paste into prod SM_PLANT_TRANSFER.** (`SM_PLANT_TRANSFER.dev.json` is dev v103; dev has since moved to v104 with the
  BUG-20261015-023 price fix, which this paste does not include.)
- `build.py`: refetches the enabled prod versions and re-applies the fix (asserts the entry is still `int`);
  `--dev` does the same against dev, `--check` prints the diff only.

Dev: published 2026-10-15 14:36 (GOODS_RECEIVING v101, SUBTRACT_INVENTORY_NEW v25, SUBTRACT_INVENTORY v59) and 15:07
(SM_PLANT_TRANSFER v103), backups in `~/Documents/ASC-dev/workflow-backups/dev/`. Verified live on dev: a classic receipt of
2.25 + 7.5 moved on-order by exactly that; a 0.5 weighted-average issue left 9,999.5 (not 9,999); a 2.5 batch Plant Transfer
saved In Progress gave `quantity` 2.5 and a 2.5 per-batch line. The repo's undeployed Plant Transfer copy has the same fix.

Prod: SM_PLANT_TRANSFER pasted 2026-10-15 15:16, enabled as **v61** (the platform numbered it below the old v102, which is
now "history"), identical to `SM_PLANT_TRANSFER.prod.json`. GOODS_RECEIVING, SUBTRACT_INVENTORY_NEW and SUBTRACT_INVENTORY
are **not pasted yet** (prod still enabled v99 / v24 / v58); `build.py --check` lists what is still pending.

## Data already affected on prod (2026-10-15, read-only counts)

The fix stops new damage. These rows keep their wrong values until repaired:

- **On-order** (`on_order_purchase_order`): 81 rows with `open_qty` below 1 on a fully received PO line, tenant 073522
  (80 rows, 28.60) and 681409 (1 row, 0.25). Repair: `received_qty += open_qty`, `open_qty = 0` on those rows.
  Partly received lines can also be short by a fraction; a full repair recomputes each row from its PO line
  (`received_qty` = the line's received quantity in base UOM, `open_qty` = ordered minus that, not below 0).
- **Weighted average** (`wa_costing_method`, latest non-batch row per item and plant): 27 rows in tenant 681409 sit
  exactly at the rounded-down on-hand quantity (gap 13.468 in total), e.g. 189 vs 189.5, 17 vs 17.875. Repair: set
  `wa_quantity` to the on-hand quantity for those rows. Costs already calculated from the short quantity are not
  recalculated.
- **Plant Transfer**: none. Prod has no fractional Plant Transfer movement (3,522 out / 3,523 in since 2026-03).

No repair has been run.

## Not fixed here

`CALCULATE_COSTING_PRICE` (prod and dev v5, called by SM_PLANT_TRANSFER and PROCESS_HU_BALANCE) declares every output
`int`, the incoming quantity included: on dev it returned total 2 for 2.5 units at cost 1.00. Its prod impact is not
established. Fixing it means checking that both callers round the now-decimal prices before writing them. Backlog:
`bug-list.md` BUG-20261015-023.
