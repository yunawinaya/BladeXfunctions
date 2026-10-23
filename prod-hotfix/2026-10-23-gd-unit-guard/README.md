# GOODS_DELIVERY: refuse a line whose unit the item does not have (2026-10-23)

The classic save (GOODS_DELIVERY) never checked that a line's unit belongs to the item. Where it converts to base units, a missing conversion counts as 1 (`convFactor` in GD_UNUSED_FN_NEW). GD Created V2 already refuses such a line as GD_INVALID_UOM; classic now refuses it too.

**Why:** on 10-23, GD-2610-971 (tenant 128671) delivered 1 箱CTN of Instant Noodle VIT'S. The item only knows 箱Ctn, which is 6 packets, so stock went down by 1 packet instead of 6. Classic is reached in several ways:

- **SO_AUTO_GD:** an order with a description-only line goes to classic as a whole.
- **"Created and Post":** for 128671, a classic save followed by the Versa Fleet post.
- **The form's frozen saves.**
- **Mobile.**

| Prod workflow | File here | Base on prod |
|---|---|---|
| **GOODS_DELIVERY** (2017151544868491265) | `GOODS_DELIVERY.json` | v245, identical to dev v245 (checked 10-23) |

## What it does

A new block sits right after the SO guard (`if_GdSoGuard`), before any read or write of the save. It is 10 new nodes; no existing node changed.

- **When it checks:** a *new* delivery, meaning saveAs Created or Completed on an Add, Clone or SO_AUTO_GD save, or on a stored Draft. A stored Created GD (Picking or Packing completion, SO cascade) is never refused.
- **What it checks:** lines with a material, gd_qty > 0 and a stock-controlled item (stock_control 1), including bundle items. A line passes when its `gd_order_uom_id || good_delivery_uom_id` is the item's base unit, or one of its conversions with base_qty > 0.
- **What it skips:**
  - Picking Plan deliveries (`is_select_picking` 1), which use their own unit fields;
  - non-stock items, zero-quantity lines, and items it cannot find.
- **How it reads:** one SQL statement returns the stored status, the items' units and the unit names.
- **When it refuses:** it returns code 400 with "Not saved: line 3 (Instant Noodle…) is in 箱CTN. That unit is not one of the item's units, so the stock quantity cannot be worked out. Choose the item's own unit, or add the unit to the item's unit conversions, then save again."
  - It names up to 3 lines, then "and N more line(s)".
  - The form shows it as its usual error toast. SO_AUTO_GD lists the order as not converted, with the message.

**Expected impact** (prod scan on 10-23, read-only, last 30 days, all tenants): it would have refused 17 deliveries in 3 tenants, all saved through classic.

| Tenant | Deliveries | What the lines carried |
|---|---|---|
| 528521 | 9 | case twins of the item's unit |
| 073522 | 3 | 4 exact-name duplicate units, plus "CA*MS3000*6" against the item's "CA*MS3000*" |
| 128671 | 5 | case twins of the item's unit |

## Paste

Paste `GOODS_DELIVERY.json` into the designer and publish. It is independent of the other 10-23 pastes.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/GDheadWorkflow.json"   # IDENTICAL
```

## Undo

`RESTORE_GOODS_DELIVERY.json` is prod v245, what prod runs now.

## Source and tests

- **Patch:** `scratchpad/gdc/gdcreate/patch_gd_uom_guard.py`, a text-level insert built from the Processing guard's node layout, as `patch_gd_so_guard.py`.
- **Tests:** `scratchpad/gdc/gdcreate/test/test_uom_guard.js` runs 24 cases on the patched JSON's own code. 5 mutants are each caught.
- **Lint:** unchanged (54 findings, the same before and after).
- **SQL:** ran read-only on dev and prod. The one statement mixes collations, so every column is pinned to `utf8mb4_general_ci`.
- **Dev:** v246, published 10-23 11:44. The publish smoke, a Created save of dev item POST 2 (base PCS) in BOX, came back with the exact refusal at `return_node_GdUomCheck` in 104 ms, and no delivery was written.
- **Lifts:** GD Edit V2 and GD Cancel V2 lift nodes from GOODS_DELIVERY v245. This change only adds nodes, so the lifted nodes are byte-identical. GD Edit V2's `check_fresh.sh` compares version numbers, so it will report v246 as STALE; re-pinning is safe.
