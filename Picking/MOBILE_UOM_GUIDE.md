# Mobile Implementation Guide — Picking Alternate-UOM Entry

How to let a mobile picker enter the picked quantity in an **alternate UOM**
(e.g. count loose stock in *Unit*) while the Sales Order / Goods Delivery /
Picking documents remain in their **order UOM** (e.g. *Box*).

This guide is a **delta** on the existing mobile Picking integration. It assumes
you already build `table_picking_items` rows and call the Picking process
workflow with `runWorkflow(id, { arrayData: <pickingForm>, saveAs, ... })`. It
only describes what to **add** for alternate-UOM support.

> Companion to the web implementation. The conversion is implemented in
> `PickingProcessWorkflow.json` → `Create Table Picking Records` (both the
> Picking-Plan and Goods-Delivery branches). Web reference handlers:
> `PickingOnMounted.js`, `PickingOnChangePickingUOM.js`, `PickingQuantityValidation.js`.

---

## Table of Contents
1. [Mental Model](#1-mental-model)
2. [What Changes for Mobile (the delta)](#2-what-changes-for-mobile-the-delta)
3. [Data to Fetch from the Item Master](#3-data-to-fetch-from-the-item-master)
4. [Schema Additions](#4-schema-additions)
5. [Computing the Conversion Scalars](#5-computing-the-conversion-scalars)
6. [Where Picked Qty Lives & Its UOM](#6-where-picked-qty-lives--its-uom)
7. [Conversion Math (workflow side)](#7-conversion-math-workflow-side)
8. [Validation Rules](#8-validation-rules)
9. [Worked Examples](#9-worked-examples)
10. [Edge Cases & Gotchas](#10-edge-cases--gotchas)
11. [Mobile Porting Checklist](#11-mobile-porting-checklist)

---

## 1. Mental Model

There are **three** units of measure in play. Keep them straight:

| UOM | Field | What it is | Example |
|-----|-------|-----------|---------|
| **Order UOM** | `item_uom` | What the SO/GD ordered in. The **canonical** UOM for everything downstream. | Box |
| **Base UOM** | `based_uom` (on Item) | The stock-keeping unit; inventory balances live in this. | Unit |
| **Pick UOM** | `picking_uom` (new) | What the picker chooses to **count in** on this line. | Unit |

**The one invariant you must respect:**

> Everything the backend stores and reconciles stays in the **order UOM**:
> `qty_to_pick`, `pending_process_qty`, `store_out_qty`, the GD `temp_qty_data`,
> Handling-Unit rows, and Packing. The picked quantity entered in the Pick UOM
> is converted **back to the order UOM at the workflow funnel** before any of
> that math runs.

| Concept | Stays in **order UOM** | Picker-facing in **Pick UOM** |
|---------|------------------------|-------------------------------|
| `qty_to_pick`, `pending_process_qty` | ✅ canonical | (optional display copies `to_pick_alt` / `pending_alt`) |
| the picked qty you send | — | ✅ `picked_qty` / `allocated_quantity` are in `picking_uom` |
| `store_out_qty` (workflow output) | ✅ converted result | — |
| GD `temp_qty_data`, HU, Packing | ✅ untouched | — |

Because HU and Packing derive from the GD's `temp_qty_data` (order UOM), and the
funnel converts before writing it, **HU and Packing need no mobile changes at all.**

> ⚠️ **Default = identity.** If `picking_uom` equals `item_uom` (or you omit the
> new fields entirely), the conversion factor is `1` and behaviour is exactly
> what mobile does today. **This is fully backward-compatible** — you can ship
> alt-UOM line-by-line.

---

## 2. What Changes for Mobile (the delta)

Two changes, nothing else:

1. **Add 3 fields to each `table_picking_items` row** you send:
   `picking_uom`, `order_base_qty`, `picking_base_qty`.
   (Optionally `to_pick_alt` / `pending_alt` if you want to display the
   to-pick / pending values in the Pick UOM — display only, not used by the workflow.)

2. **The picked quantity you send is now expressed in `picking_uom`.** This
   applies to *all three* sources the workflow already reads (see §6):
   `item.picked_qty`, `item._mobile_locations[].allocated_quantity`, and
   `split_data[...].split_locations[].allocated_quantity`.

That's it. You do **not** send `store_out_qty` — the workflow computes it.

---

## 3. Data to Fetch from the Item Master

You already need the Item to render the line. For alt-UOM, read two fields:

```javascript
// db.collection("Item").where({ id: materialId }).get()  ->  data[0]
item.based_uom               // string: the base UOM id  (e.g. "Unit")
item.table_uom_conversion    // array of conversion rows:
//   [{ alt_uom_id: "<uomId>", base_qty: <number> }, ...]
//   base_qty = how many BASE units make 1 of that alt UOM.
//   e.g. { alt_uom_id: "Box", base_qty: 10 }  =>  1 Box = 10 Unit
```

**Building the Pick-UOM picker for a line** = the base UOM **plus** every
`alt_uom_id` in `table_uom_conversion`:

```javascript
const pickUomOptionIds = [
  item.based_uom,
  ...item.table_uom_conversion.map(c => c.alt_uom_id),
].filter(Boolean);
```

**Resolving UOM display names** (the picker shows names, not ids): query the
**`unit_of_measurement`** collection by id and read `uom_name`.

```javascript
// db.collection("unit_of_measurement").where({ id }).get()  ->  data[0].uom_name
```

> ⚠️ The collection is **`unit_of_measurement`**, not `"UOM"`. (Querying `"UOM"`
> throws "UOM数据表尚未发布 / UOM table not published".)

---

## 4. Schema Additions

### 4.1 New fields on each `table_picking_items` row

| Field | Type | Value | Notes |
|-------|------|-------|-------|
| `picking_uom` | string (UOM id) | the UOM the picker chose | **Default = `item_uom`.** |
| `order_base_qty` | number | base units per **1 `item_uom`** | fixed per line (`item_uom` never changes) — see §5 |
| `picking_base_qty` | number | base units per **1 `picking_uom`** | recompute whenever `picking_uom` changes |
| `to_pick_alt` *(optional)* | number | `qty_to_pick` shown in `picking_uom` | display only |
| `pending_alt` *(optional)* | number | `pending_process_qty` shown in `picking_uom` | display only |

The canonical fields you already send are **unchanged and stay in order UOM**:
`item_uom`, `qty_to_pick`, `pending_process_qty`, `source_bin`, `batch_no`,
`target_location`, `target_batch`, `handling_unit_id`, `gd_line_id` / `to_line_id`, …

> ⚠️ Send `order_base_qty` / `picking_base_qty` as **numbers**, not strings.
> The workflow does arithmetic on them.

### 4.2 `_mobile_locations[]` row (multi-location pick — unchanged shape)

```jsonc
{
  "location_id": "<source bin id>",
  "target_location_id": "<target bin id>",
  "allocated_quantity": 30,          // ⚠️ now in the row's picking_uom
  "batch_no": "<source batch id|null>",
  "target_batch": "<target batch id|null>"
}
```
The row-level `picking_uom` / scalars apply to **every** entry in that row's
`_mobile_locations` (one Pick UOM per line).

### 4.3 `split_data` (split-by-location — unchanged shape)

```jsonc
// keyed by gd_line_id (GD-sourced) or to_line_id (PP-sourced)
{
  "<lineId>": {
    "is_split": true,
    "split_locations": [
      {
        "target_location_id": "<bin id>",
        "allocated_quantity": 20,     // ⚠️ now in the row's picking_uom
        "batch_no": "<batch id|null>",
        "batch_number": "<display|null>",
        "target_batch": "<batch id|null>"
      }
    ]
  }
}
```
Split-child rows additionally carry `_is_split_entry: true` and
`_split_index: <n>` (as today). Conversion still uses the **row's** `picking_uom`
+ scalars.

---

## 5. Computing the Conversion Scalars

`base_qty` for a UOM = how many base units are in **one** of it. The base UOM
itself is `1`; an alt UOM uses its `table_uom_conversion.base_qty`.

```javascript
// Adapted from getBaseQtyForUom in PickingOnMounted.js
function getBaseQtyForUom(uom, basedUom, tableUomConversion) {
  if (!uom) return 1;
  if (String(uom) === String(basedUom)) return 1;          // base UOM -> 1
  const c = (tableUomConversion || []).find(x => x.alt_uom_id === uom);
  return c && c.base_qty ? c.base_qty : 1;                 // unknown -> 1 (identity)
}

// Per line:
const order_base_qty   = getBaseQtyForUom(item_uom,    based_uom, table_uom_conversion);
const picking_base_qty = getBaseQtyForUom(picking_uom, based_uom, table_uom_conversion);
```

Example (1 Box = 10 Unit, base = Unit):
- order UOM `Box`   → `order_base_qty   = 10`
- pick  UOM `Unit`  → `picking_base_qty = 1`

> 📌 Send the **two scalars**, not a single pre-divided factor. The workflow
> divides `picking_base_qty / order_base_qty` itself so the result is exact
> (`50 × 1 / 10 = 5`), avoiding rounded-factor drift.

### Converting for display / validation (Pick UOM ↔ Order UOM)

```javascript
// Adapted from convertQuantityFromTo (PickingOnMounted.js / PickingQuantityValidation.js)
function convertQuantityFromTo(value, conv, fromUom, toUom, baseUom) {
  if (!value || fromUom === toUom) return value;
  let baseQty = value;
  if (fromUom !== baseUom) {                                  // from -> base
    const f = (conv || []).find(x => x.alt_uom_id === fromUom);
    if (f && f.base_qty) baseQty = value * f.base_qty;
  }
  if (toUom === baseUom) return round3(baseQty);              // base -> to
  const t = (conv || []).find(x => x.alt_uom_id === toUom);
  return t && t.base_qty ? round3(baseQty / t.base_qty) : round3(baseQty);
}
const round3 = v => Math.round(v * 1000) / 1000;
```

---

## 6. Where Picked Qty Lives & Its UOM

The workflow funnel resolves the picked quantity per row from the **first**
source that applies, in this order. **All of them are interpreted in the row's
`picking_uom`:**

| Priority | Source | Used when |
|----------|--------|-----------|
| 1 | `split_data[lineId].split_locations[].allocated_quantity` | the line was split by location |
| 2 | `item._mobile_locations[].allocated_quantity` | mobile multi-location pick |
| 3 | `item.picked_qty` (falls back to `item.qty_to_pick`) | simple single-bin pick |

For each resolved location the funnel emits one picking record.

> ⚠️ The priority-3 fallback to `item.qty_to_pick` treats it as **order UOM**
> (factor 1), since `qty_to_pick` is canonical. So leave `picked_qty` unset only
> when you intend a full-line pick in the order UOM. For an alt-UOM pick, always
> set `picked_qty` (or use a location source).

---

## 7. Conversion Math (workflow side)

For every picked location the funnel computes:

```javascript
store_out_qty = round3( allocated_quantity * picking_base_qty / order_base_qty );
```

and stamps the picking record with audit fields:

```jsonc
{
  "store_out_qty": 5,        // converted to ORDER UOM (canonical)
  "item_uom": "Box",         // order UOM
  "picked_uom": "Unit",      // = picking_uom (what the picker counted in)
  "picked_qty_alt": 50,      // the pre-conversion value, in picking_uom
  // ...source_bin, target_location, batch_no, target_batch, gd_line_id, etc.
}
```

Downstream (pending recompute, GD `temp_qty_data`, HU, Packing) consumes only
`store_out_qty` (order UOM) — so nothing else needs to know about the Pick UOM.

**Decimal precision:** everything rounds to **3 decimals** (`round3`). Match this
on the mobile side for any client-side preview to avoid display mismatches.

---

## 8. Validation Rules

1. **Pending check (in order UOM).** Before allowing a pick, convert the entered
   qty back to the order UOM and require it not exceed the remaining `pending_process_qty`:

   ```javascript
   const pickedInOrderUom = convertQuantityFromTo(
     enteredQty, table_uom_conversion, picking_uom, item_uom, based_uom);
   if (pickedInOrderUom > pending_process_qty) {
     // reject: "Quantity is not enough to pick"
   }
   ```
   (Mirror of `PickingQuantityValidation.js`.)

2. **Reset on UOM change.** When the picker changes `picking_uom` on a line,
   reset that line's entered qty to `0` and recompute `picking_base_qty` (and
   `to_pick_alt` / `pending_alt` if you show them). A value typed in the old UOM
   must not silently carry over. (Mirror of `PickingOnChangePickingUOM.js`.)

3. **Serialized items.** Qty is driven by the serial-number count — keep
   `picking_uom = item_uom` and don't expose the UOM picker.

4. **Handling-Unit (atomic) picks.** HU picks move the whole HU; keep
   `picking_uom = item_uom` for HU-bound rows (conversion stays identity).

---

## 9. Worked Examples

All examples: Item base = `Unit`, `table_uom_conversion = [{ alt_uom_id:"Box", base_qty:10 }]`
⇒ `order_base_qty(Box)=10`, `picking_base_qty(Unit)=1`.

### 9.1 Exact full pick — GD line 5 Box, pick 50 Unit
```jsonc
row: { item_uom:"Box", picking_uom:"Unit", order_base_qty:10, picking_base_qty:1,
       qty_to_pick:5, pending_process_qty:5, picked_qty:50 }
// store_out_qty = 50 * 1/10 = 5 Box
// => line Completed, GD temp_qty_data 5 Box, record picked_uom=Unit picked_qty_alt=50
```

### 9.2 Partial pick — pick 30 Unit
```jsonc
row: { ...same..., picked_qty:30 }
// store_out_qty = 30 * 1/10 = 3 Box ; pending = 5 - 3 = 2 Box ; status In Progress
// to_pick_alt = 50, pending_alt = 20  (display)
```

### 9.3 Fractional — 1-Box line, pick 5 Unit
```jsonc
row: { item_uom:"Box", picking_uom:"Unit", order_base_qty:10, picking_base_qty:1,
       qty_to_pick:1, pending_process_qty:1, picked_qty:5 }
// store_out_qty = 5 * 1/10 = 0.5 Box   (rounded to 3 dp)
```

### 9.4 Order UOM **is** the base — line 50 Unit, pick in Box
```jsonc
// item_uom = Unit (base), picker chooses Box
row: { item_uom:"Unit", picking_uom:"Box", order_base_qty:1, picking_base_qty:10,
       qty_to_pick:50, pending_process_qty:50, picked_qty:5 }
// store_out_qty = 5 * 10/1 = 50 Unit
```

### 9.5 Multi-location split in Pick UOM — pick 50 Unit across 2 bins
```jsonc
row: { item_uom:"Box", picking_uom:"Unit", order_base_qty:10, picking_base_qty:1,
       gd_line_id:"L1" }
split_data: { "L1": { is_split:true, split_locations:[
  { target_location_id:"BIN-A", allocated_quantity:30, batch_no:null, target_batch:null },
  { target_location_id:"BIN-B", allocated_quantity:20, batch_no:null, target_batch:null }
]}}
// two records: 30*0.1=3 Box and 20*0.1=2 Box  (total 5 Box)
```

---

## 10. Edge Cases & Gotchas

- **Default to `item_uom`.** A line that isn't being picked in an alt UOM must
  send `picking_uom = item_uom` (or omit the trio) → factor 1 → identity. No regression.
- **Omitting the scalars is safe.** If `order_base_qty` / `picking_base_qty` are
  absent, the workflow falls back to factor `1`. So a mixed payload (some lines
  alt-UOM, some not) works fine.
- **Never send `store_out_qty`.** It's computed by the funnel; sending it has no effect.
- **`unit_of_measurement`**, not `"UOM"`, for name lookups.
- **Numbers, not strings**, for `order_base_qty` / `picking_base_qty` / `picked_qty` / `allocated_quantity`.
- **3-decimal rounding** everywhere; mirror `round3` for any client preview.
- **HU & serialized rows** keep `picking_uom = item_uom` (no picker).
- **One Pick UOM per line** — it governs all of that line's `_mobile_locations`
  / split allocations.
- **`picked_qty` is in Pick UOM; `qty_to_pick` / `pending_process_qty` stay in
  order UOM.** Don't compare them directly without converting (see §8.1).

---

## 11. Mobile Porting Checklist

Smoke test for parity with the web app.

### Schema
- [ ] Each `table_picking_items` row carries `picking_uom`, `order_base_qty`, `picking_base_qty`
- [ ] `picking_uom` defaults to `item_uom`; omitting the trio behaves identically to today
- [ ] Scalars sent as **numbers**; picked quantities sent as numbers
- [ ] `store_out_qty` is **not** sent from mobile

### UOM picker
- [ ] Options = `based_uom` + `table_uom_conversion[].alt_uom_id`
- [ ] Names resolved from `unit_of_measurement.uom_name`
- [ ] Hidden / locked for serialized and HU-bound rows

### Scalars & math
- [ ] `getBaseQtyForUom` matches §5 (base → 1; alt → `base_qty`; unknown → 1)
- [ ] `order_base_qty = baseQty(item_uom)`, `picking_base_qty = baseQty(picking_uom)`
- [ ] Recompute `picking_base_qty` when the picker changes `picking_uom`
- [ ] All quantities rounded with `round3`

### Picked-qty sources (all in `picking_uom`)
- [ ] `item.picked_qty` for single-bin picks
- [ ] `item._mobile_locations[].allocated_quantity` for multi-location
- [ ] `split_data[lineId].split_locations[].allocated_quantity` for splits

### Validation
- [ ] Pending check converts picked → order UOM before comparing to `pending_process_qty`
- [ ] Changing `picking_uom` resets the entered qty to 0

### Reference checks (do these last)
- [ ] Run example 9.1 through the process workflow → `store_out_qty = 5`, line Completed,
      record `picked_uom=Unit` / `picked_qty_alt=50`
- [ ] Run examples 9.2–9.5 → results match the comments
- [ ] Backward-compat: send a pick with **no** UOM fields → identical result to current mobile
- [ ] Spot-check that HU & Packing outputs are still in the order UOM
