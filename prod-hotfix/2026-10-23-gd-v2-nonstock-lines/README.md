# GD Created V2 takes non-stock lines (charge items) instead of sending the whole GD to the slow classic save (2026-10-23)

| # | Prod target | File here | Base on prod |
|---|---|---|---|
| 1 | **GD_BULK_PREPARE** (2104840044642754561) | `GD_BULK_PREPARE.json` | v19, identical to dev v19 |
| 2 | **GD_ASYNC_SUBMIT** (2105133540498116609) | `GD_ASYNC_SUBMIT.json` | v13, identical to dev v13 |
| 3 | **SO_AUTO_GD** (2076557490389835777) | `SO_AUTO_GD.json` | v18. It differs from the dev base only in `code_build`, where dev moved a helper and added a comment; nothing is lost. |
| 4 | **GD form**, event script `gdV2_onClick_save_as_created` | `gdV2_onClick_save_as_created.js` (the handler only) | v675; its handler is the one this was built on |

**Paste 1 first.** Steps 2, 3 and 4 are the routers that start sending non-stock lines to V2, and PREPARE v19 would refuse such a line (GD_ITEM_NOT_SUPPORTED). Steps 2, 3 and 4 can then go in any order.

## Why

A Goods Delivery with one line whose item is not stock-controlled and not shown in delivery (stock_control 0, show_delivery 0: delivery charges, labour and so on) was sent whole to the classic save.
- At LSH on 10-23, 22 of the day's 25 classic GDs went classic for this reason.
- It is also why a 4-SO convert took 90 s and lost its answer: two SOs with a charge line took 63 s and 25 s on classic.

## What changes

**PREPARE** takes such a line exactly as the classic save does (classic's `code_node_IyJHrBst` descriptive-line branch, `code_node_kJx9p9Nh`, `code_node_QtyCheckBatch`):
- No stock work:
  - no allocation, no reservation, no movement;
  - no unit, batch, serial or costing check;
  - nothing to pick.
- It must have a description (the item name or line description).
- It counts against its sales order line with no over-delivery tolerance, and adds to that line's planned quantity.
- The GD line is written as submitted:
  - `temp_qty_data` "[]";
  - picking_status Completed (picking required, not from a Picking);
  - packing_status Completed.
- A line that carries allocations anyway is refused.
- Items with stock_control 0 but show_delivery 1, and lines with no material, still go classic. Neither reaches a GD on prod today,
  so this was decided with the user on 10-23:
  - one such item exists, 073522's DISCOUNT-001: on 137 SO lines, never on a GD line; plus 8 LSH items with show_delivery
    NULL, never on a GD;
  - free-text SO lines: 28 since August, on 10 SOs that were never delivered; no GD line without a material since August.

**The V2 check** routes such deliveries to V2. It changed in every copy: the GD form's `gdV2Route`, GD_ASYNC_SUBMIT's fit (`v2fit_lib.js`, whose read now marks these items NS), and SO_AUTO_GD's copies of both.

**Switch:** `GD_V2_NONSTOCK_ENABLED` is declared in the GD form handler, in GD_ASYNC_SUBMIT's `code_node_GSfit`, and in SO_AUTO_GD's `code_v2plan`. Setting it to `false` sends such deliveries back to classic.

**Unchanged:**
- GD_BULK_COMMIT writes the lines and the SO projection from PREPARE's payload as before.
- GD Completed V2 already carries the stock_control / show_delivery flags into classic's own lifted logic.

## Tests

- **Offline:**
  - SO_AUTO_GD's plan on LSH's real 13:59 convert run (`scratchpad/soautogd/test_plan_nonstock.js`, with the fixture kept outside the repo):
    - **before**, the two SOs with a charge line went CLASSIC;
    - **after**, all four go V2 and every payload passes GD_ASYNC_SUBMIT's guard;
    - **switch off**, those two go back to CLASSIC.
  - `test_submit_v2fit.js`: 13 cases.
  - The form handler, `scratchpad/gdform_zero/test_save_created.js`: 25 cases.
  - `test_v2fit_sync.js` (the copies stay identical).
  - Lint: no new findings on any of the four.
  - One older test, `test_create_form_fit.js`, fails the same way before and after this change: a stale expectation from the morning's "the form waits for the verdict" change.
- **Dev** (published 15:10: PREPARE v20, SUBMIT v14, SO_AUTO_GD, GD form v1490), live test in tenant 000000. Item TES502 was made non-stock for about 2 minutes with the user's yes, then restored.
  - SO_AUTO_GD planned SO/20261013-019 (TES501 + TES502) **V2**, and the job COMPLETED on the first attempt: GD/20261023/616.
    - **TES502 line:** `temp_qty_data` [], picking and packing Completed, no reservation, no movement.
    - **TES501 line:** 1 reservation and 2 movements.
    - **SO lines:** both planned 1.
  - GD Cancel V2 then cancelled it in one 6 s run:
    - both lines Cancelled;
    - TES501's reservation released;
    - both SO lines planned back to 0;
    - no movement for TES502 at any point.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_BULK_PREPARE.json"        # IDENTICAL
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json"        # IDENTICAL
.dbtools/wf --prod deployed "Goods Delivery/SOconvertGDCreatedWorkflow.json"     # IDENTICAL
.dbtools/form diff goods_delivery                                                # only the expected handler differences
```

## Undo

The `RESTORE_*` files are what prod runs now: PREPARE v19, SUBMIT v13, SO_AUTO_GD v18, and the form handler.

To turn the change off without undoing the files, set `GD_V2_NONSTOCK_ENABLED = false` in the three places listed under "Switch".

## Source

- `scratchpad/gdc/gdcreate/patch_prepare_nonstock.py`
- `scratchpad/gdc/gdcreate/patch_nonstock_fit.py`
- `scratchpad/gdc/gdcreate/nonstock/`: bases, publish plan, live tests
