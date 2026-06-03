# Picking — Alternate-UOM Entry: Platform-UI Hand-off

All code logic (form handlers + the process workflow) is done in the repo. The
items below must be created/changed **in the low-code platform UI**, because
form-component definitions and collection schema are platform-generated (not
safe to hand-author in the JSON).

## How it works (1-line recap)
The picker chooses a **Pick UOM** per line and enters `picked_qty` in that UOM.
All canonical quantities stay in the **order UOM** (`item_uom`). The process
workflow converts the picked qty back to the order UOM at the
`Create Table Picking Records` funnel using two helper numbers carried on each
row (`order_base_qty`, `picking_base_qty`). Handling Unit + Packing are
unaffected — they read the order UOM from the GD `temp_qty_data`.

---

## 1. Collection schema — `Transfer Order Picking` (id `1935556443668959233`)

**`table_picking_items` sub-table — add fields:**
| Field | Type | Notes |
|---|---|---|
| `picking_uom` | string (UOM ref) | the UOM the picker counts in |
| `to_pick_alt` | number | display: Qty To Pick in Pick UOM |
| `pending_alt` | number | display: Pending in Pick UOM |
| `order_base_qty` | number | helper (base units per 1 order UOM) |
| `picking_base_qty` | number | helper (base units per 1 Pick UOM) |

**`table_picking_records` sub-table — add fields:**
| Field | Type | Notes |
|---|---|---|
| `picked_uom` | string (UOM ref) | UOM actually picked in |
| `picked_qty_alt` | number | picked qty in that UOM (audit) |

> These must be real columns or they get dropped on save: `Update Picking`
> writes `table_picking_items`/`table_picking_records` as whole arrays.

---

## 2. Form — Picking items table (`table_picking_items`, first tab)

Add 5 columns (clone the closest existing column type, then set the model):

1. **`picking_uom`** — select (props `value:id` / `label:uom_name`). **Editable**
   (do *not* disable). Configure its datasource to retrieve the UOM options
   **from the item's UOM conversion** (base UOM + `table_uom_conversion`), as set
   up in the form. Set its `onChange` to **`PickingOnChangePickingUOM.js`**.
   (onMounted no longer overrides the options — it only caches the item's
   conversion data for the conversion math.)
2. **`to_pick_alt`** — number, **disabled**, precision 3. Label e.g. "To Pick (Pick UOM)".
3. **`pending_alt`** — number, **disabled**, precision 3. Label e.g. "Pending (Pick UOM)".
4. **`order_base_qty`** — number, **hidden**.
5. **`picking_base_qty`** — number, **hidden**.

Optionally relabel `picked_qty` → "Picked Qty (Pick UOM)" so pickers know the
input is in the chosen UOM.

## 3. Form — Picking records table (`table_picking_records`, records tab)
Add read-only display columns **`picked_uom`** and **`picked_qty_alt`** next to
`store_out_qty`.

---

## 4. Re-sync changed code into the platform
- `PickingOnMounted.js` (adds `enrichPickingUOM`)
- `PickingOnChangePickingUOM.js` (**new** — bind to `picking_uom` onChange)
- `PickingOnChangeHuSelect.js`
- `PickingQuantityValidation.js` — **paste into the `picked_qty` column validator**
  (both `options.validator` and `rules[].func` on that column carry this code)
- `PickingWorkflow_prepareData.js`
- `PickingProcessWorkflow.json` (re-import)

---

## 5. Verify (Item: 1 Box = 10 Unit; GD line = 5 Box)
1. **No change:** leave Pick UOM = Box, pick 5 → store_out_qty 5, line Completed, Packing 5 Box. Matches today.
2. **Alt exact:** Pick UOM = Unit, pick 50 → store_out_qty 5 Box, Completed; record shows picked_uom=Unit, picked_qty_alt=50.
3. **Alt partial:** pick 30 Unit → store_out_qty 3 Box, pending 2 Box, In Progress; to_pick_alt=50, pending_alt=20.
4. **Fractional:** pick 5 Unit on a 1-Box line → 0.5 Box.
5. **Validator:** 60 Unit when 50 Unit pending → blocked.
6. **HU / hu_select:** HU rows force Pick UOM = order UOM; HU + Packing stay in order UOM.
7. **PP-sourced Picking:** repeat (2) — same funnel change applies to the Picking-Plan branch.

### Scope note (desktop vs mobile)
The desktop form only has the **inline per-row `picked_qty`** entry (+ `hu_select`).
Split-by-location (`split_data` / `split_locations`) and `_mobile_locations` are
**mobile-only** inputs to the workflow — there is no desktop split dialog.

The funnel converts those mobile allocations using each row's `picking_uom` +
the base-qty scalars. Until the **mobile app** is updated to send `picking_uom`
(and the `order_base_qty` / `picking_base_qty` helpers) per row, those rows
default to **factor 1 (identity)** → mobile picking stays in the order UOM,
unchanged. Alt-UOM picking on mobile is therefore a separate, backward-compatible
follow-up for the mobile team.
