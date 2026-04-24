# Packing Module — Mobile Re-Implementation Spec

## Context

The desktop Packing module has been rewritten end-to-end: new data model,
new nested-table schema, new picking flows (whole-HU + nested HUs),
row-level complete/unpack actions, and a rewritten save-completed pipeline
that writes directly into Goods Delivery's `temp_qty_data`. The mobile
implementation still targets the old schema/logic and must be rebuilt.

This document is the authoritative spec for the mobile team to reimplement
the front-end. **Backend workflows are not re-built** — mobile calls the
same workflow IDs the desktop calls. Scope here is: form state, data
shapes, client-side logic, user flows, and integration contracts.

---

## 1. Architecture overview

```
┌──────────────────┐
│ Picking module   │ auto-creates a Packing record (status "Created")
└────────┬─────────┘   with table_hu_source + table_item_source populated
         ↓
┌──────────────────┐
│ Packing form     │ user picks items/HUs into table_hu, completes each row,
│ (Mobile scope)   │ then Saves as Completed
└────────┬─────────┘
         ↓
┌──────────────────┐    workflow 1994279909883895810
│ Packing workflow │    (saveAs: Draft | Created | Completed)
│   (backend)      │    → persists packing doc
│                  │    → on "Completed": patches GD.temp_qty_data,
│                  │      triggers GD workflow 2017151544868491265
└──────────────────┘
```

**Relationship invariant:** 1 packing ↔ 1 GD (via `packing.gd_id`).

---

## 2. Data model

### 2.1 Collections the client reads/writes

| Collection | ID | Accessed as | Purpose |
|---|---|---|---|
| `packing` | 1993515601863524353 | `db.collection("packing")` | Main document |
| `handling_unit` | 2036736671686529026 | `db.collection("handling_unit")` | HU records (target HUs created at Complete) |
| `item_balance` | 1902698977724317697 | `db.collection("item_balance")` | Non-batch inventory lookup |
| `item_batch_balance` | 1902718803880558594 | `db.collection("item_batch_balance")` | Batch inventory lookup |
| `goods_delivery` | 1902054888473481218 | read only | GD parent (not written directly by client) |
| `goods_delivery_fwii8mvb_sub` | 1939904186426433537 | read only | GD lines |
| `Item` | 1901546842240438273 | read only | Material master |
| `bin_location` | 1902282127538507778 | read only | Location master |
| `batch` | 1902719754154655746 | read only | Batch master |

### 2.2 Packing document (collection: `packing`)

Persisted top-level fields:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Platform-generated |
| `packing_no` | string | Auto-generated at save (prefix + date + serial) |
| `packing_no_type` | string | Prefix rule reference |
| `packing_status` | enum | `Draft` / `Created` / `Completed` / `Cancelled` |
| `plant_id` | relation | required |
| `organization_id` | relation | hidden, auto from context |
| `gd_id` | **string** (was array — old schema is broken) | Required; points to linked GD |
| `gd_no` | string | Display |
| `so_id` / `so_no` | relation / string | Display |
| `to_id` | relation | Picking Plan ref |
| `customer_id` | relation | |
| `billing_address` / `shipping_address` | string | From GD |
| `packing_mode` | enum | `Basic` / `Detail` |
| `packing_location` | string | |
| `assigned_to` / `created_by` / `created_at` | user / date | |
| `to_validity_period` | date | |
| `ref_doc` | string | |
| `remarks` | string | |
| `total_hu_count` | number | Rolled up by headerCalculation |
| `total_item_count` | number | Distinct items across table_hu |
| `total_item_qty` | number | Sum of qty across table_hu |
| `table_hu` | array | Target HUs (see 2.3) |
| `table_hu_source` | array | Source HUs snapshot (see 2.4) |
| `table_item_source` | array | Loose items snapshot (see 2.5) |

**Removed vs old schema:**
- `table_items` — gone; replaced by `temp_data` string on each `table_hu` row
- `gd_id` — was array, now **single string**

Form-only state (NOT persisted, used by handlers):
- `selected_hu_index` — int, tracks which table_hu row is the active pick target; `-1` = none
- `page_status` — `Add` / `Edit` / `View`
- `packing_title` — readonly display

### 2.3 `table_hu` (target HU table, persisted)

One row per physical HU being built. Full row shape:

```jsonc
{
  // --- identity ---
  "handling_unit_id": "",        // empty until Complete creates the HU; then persisted
  "handling_no": "Auto-generated number", // placeholder; replaced at Complete
  "hu_row_type": "generated" | "locked",  // see below
  "source_hu_id": "",            // for locked rows: links back to source HU in DB
  "parent_hu_id": "",            // if this HU is itself nested inside another; rarely used from client
  "packing_id": "",              // stamped on save for back-reference

  // --- HU properties ---
  "hu_material_id": "",          // packaging material
  "hu_type": "",                 // derived from material
  "hu_quantity": 0,              // Basic mode only: number of physical boxes
  "hu_uom": "",

  // --- contents (computed from temp_data) ---
  "temp_data": "[]",             // JSON STRING of entries — see section 3
  "item_count": 0,               // distinct item_ids inside this HU
  "total_quantity": 0,           // sum of quantities inside this HU

  // --- location ---
  "storage_location_id": "",     // parent storage area
  "location_id": "",             // specific bin

  // --- lifecycle ---
  "hu_status": "Unpacked" | "Packed" | "Completed",
  "select_hu": 0 | 1,            // single-select "active target" toggle

  // --- dimensions (Detail mode, often 0 in Basic) ---
  "gross_weight": 0, "net_weight": 0, "net_volume": 0,

  // --- metadata ---
  "remark": "",
  "line_ref_doc": [],
  "closed_by": "",
  "plant_id": "", "organization_id": "",
  "customer_id": [],

  // --- platform ---
  "fm_key": "auto-generated"     // platform-managed; do not touch
}
```

**Key enums:**
- `hu_row_type`:
  - `generated` — user created an empty HU in packing; items picked into it individually.
  - `locked` — user "Pick to HU"'d an existing HU from `table_hu_source`; row is immutable (no further item picking). `source_hu_id` links back.
- `hu_status`:
  - `Unpacked` — empty placeholder, no items yet.
  - `Packed` — has items in `temp_data` but not yet finalized.
  - `Completed` — row is finalized, `handling_unit_id` populated with the real HU id.

### 2.4 `table_hu_source` (picking HUs, persisted)

Flat list mixing "header" and "item" rows for HUs available from the upstream picking. Populated initially by the Picking workflow during auto-trigger.

```jsonc
{
  "row_type": "header" | "item",   // groups item rows under their HU
  "handling_unit_id": "",          // for both: links rows to a source HU
  "handling_no": "",               // header only
  "hu_material_id": "", "hu_type": "", "hu_uom": "",
  "storage_location": "",
  "gross_weight": 0, "net_weight": 0, "net_volume": 0,
  "hu_status": "Unpacked" | "Picked" | "Completed",  // header: summary status
  "hu_select": 0 | 1,              // header only: for bulk-pick

  // item row additions:
  "id": "<stable id>",             // matches line_item_id in packing.temp_data
  "item_id": "...", "item_code": "...", "item_name": "...",
  "item_desc": "...", "item_uom": "...",
  "batch_no": "", "bin_location": "",
  "total_quantity": 0,
  "so_id": "", "so_no": "", "so_line_id": "",
  "gd_id": "", "gd_no": "", "gd_line_id": "",
  "to_id": "", "to_line_id": ""
}
```

Status lifecycle (header + items move together):
- `Unpacked` — not yet picked into any `table_hu` row.
- `Picked` — picked (via `Pick to HU` or `Pick to Parent HU`).
- `Completed` — target row in `table_hu` was Completed.

### 2.5 `table_item_source` (loose items, persisted)

One row per pickable item-location-batch tuple from GD lines.

```jsonc
{
  "id": "<stable id>",             // source row id; referenced as line_item_id by picks
  "item_id": "", "item_code": "", "item_name": "", "item_desc": "",
  "item_uom": "",
  "batch_no": "", "bin_location": "",
  "location_id": "",               // actual bin id (for balance lookup)
  "balance_id": "",                // inventory balance record

  "total_quantity": 0,             // max pickable (from GD line allocation)
  "picked_qty": 0,                 // sum of picked qty across table_hu rows — RECOMPUTED
  "remaining_qty": 0,              // total_quantity - picked_qty — RECOMPUTED
  "qty_to_pick": 0,                // user input for the next pick
  "line_status": "Open" | "Partially Picked" | "Fully Picked",  // RECOMPUTED
  "select_item": 0 | 1,            // for bulk pick

  // upstream refs:
  "so_id": "", "so_no": "", "so_line_id": "",
  "gd_id": "", "gd_no": "", "gd_line_id": "",
  "to_id": "", "to_line_id": ""
}
```

`picked_qty` / `remaining_qty` / `qty_to_pick` / `line_status` are **recomputed after every pick/unpack** by walking `table_hu[*].temp_data`. Mobile must call the equivalent of `PackingRecomputeSource` on every mutation.

### 2.6 `handling_unit` collection

Target of `Complete` on a Generated row. Written by the repack backend workflow (`2043602532898443266`), not directly by the client.

```jsonc
{
  "id": "", "plant_id": "", "organization_id": "",
  "handling_no": "", "handling_no_type": "",
  "hu_material_id": "", "hu_type": "",
  "hu_quantity": 1, "hu_uom": "",
  "item_count": 0, "total_quantity": 0,
  "storage_location_id": "", "location_id": "",
  "remark": "",
  "parent_hu_id": "",
  "hu_status": "Packed",            // set at creation
  "table_hu_items": [
    {
      "material_id": "", "material_uom": "",
      "location_id": "", "batch_id": "",
      "balance_id": "",
      "quantity": 0,
      "is_deleted": 0
    }
  ]
}
```

Client updates it directly for:
- Row complete (Locked flow): `hu_status = "Packed"` via `db.collection("handling_unit").doc(huId).update(...)`
- Nested child relinking: `parent_hu_id = <new parent>` (set on Complete, cleared on Unpack) per child

---

## 3. `temp_data` format (critical)

`table_hu[i].temp_data` is **a JSON string** (not an array). Parse on read, stringify on write.

Two entry shapes:

### 3.1 Direct item entry

```jsonc
{
  "line_index": 0,                 // positional for UI
  "line_item_id": "<source row id from table_item_source or table_hu_source>",
  "balance_id": "",
  "item_id": "", "item_code": "", "item_name": "", "item_desc": "",
  "item_uom": "",
  "batch_no": "",                  // ⚠ stores the BATCH ID (not display number)
  "bin_location": "",              // ⚠ stores the BIN LOCATION ID (original picking bin)
  "total_quantity": 0,             // qty picked of this item into this HU
  // upstream refs (flow through to GD/SO/TO):
  "so_id": "", "so_no": "", "so_line_id": "",
  "gd_id": "", "gd_no": "", "gd_line_id": "",
  "to_id": "", "to_no": "", "to_line_id": ""
}
```

⚠️ **Field-name gotcha** — the pick handlers (`PackingPickItemToHU`, `PackingBulkPickItems`, `PackingPickHUToHU`, `PackingPickToParentHU`, `PackingBulkPickHUs`) all write entries using the form-field names `batch_no` and `bin_location`. Per the form schema (`props.value: "id"`), their **stored values ARE the batch id and the bin id** — the names are misleading. Downstream the workflow APIs expect `batch_id` and `location_id`, so the Complete / Unpack / GD-patch handlers must read with the packing names and pass into the workflow-named slots:

```js
// In Complete / Unpack / save workflow code-node:
const isBatch = !!it.batch_no;
filter.batch_id   = it.batch_no;     // ⚠ read batch_no, pass as batch_id
filter.location_id = it.bin_location;

items.push({
  material_id: it.item_id,
  location_id: it.bin_location,     // ⚠ read bin_location, pass as location_id
  batch_id:    it.batch_no || null, // ⚠ read batch_no,    pass as batch_id
  ...
});
```

### 3.2 Nested HU entry (Pick to Parent HU flow)

```jsonc
{
  "type": "nested_hu",
  "line_index": 0,
  "nested_hu_id": "<source HU's handling_unit_id>",
  "handling_no": "",
  "hu_material_id": "", "hu_type": "", "hu_uom": "",
  "item_count": 0,                 // distinct items in this nested HU's children
  "total_quantity": 0,             // sum across children
  "children": [
    {
      "line_index": 0, "line_item_id": "",
      "item_id": "", "item_code": "", "item_name": "", "item_desc": "",
      "item_uom": "",
      "batch_no": "", "bin_location": "",
      "total_quantity": 0,
      "so_id": "", "so_no": "", "so_line_id": "",
      "gd_id": "", "gd_no": "", "gd_line_id": "",
      "to_id": "", "to_line_id": ""
    }
    // ... more child items
  ]
}
```

**Aggregation rule** for `table_hu[i].item_count` / `total_quantity`:
- Walk every entry in `temp_data`.
- If direct: contribute its `item_id` and `total_quantity`.
- If nested: walk `children`; each child's `item_id` and `total_quantity` contribute.
- `item_count` = `Set(all item_ids).size` (distinct).
- `total_quantity` = sum.

**Dedup on repeated pick** (Flow A): if user picks the same `line_item_id` into the same HU twice, the handler merges by bumping `total_quantity` on the existing entry instead of creating a second entry.

---

## 4. Status enums (complete reference)

| Field | Location | Values | Notes |
|---|---|---|---|
| `packing_status` | `packing` header | `Draft`, `Created`, `Completed`, `Cancelled` | Driven by Save buttons |
| `hu_status` | `table_hu` row | `Unpacked`, `Packed`, `Completed` | Row lifecycle |
| `hu_status` | `table_hu_source` row | `Unpacked`, `Picked`, `Completed` | Picked-into-packing state |
| `line_status` | `table_item_source` row | `Open`, `Partially Picked`, `Fully Picked` | Recomputed |
| `hu_row_type` | `table_hu` row | `generated`, `locked` | Set at row creation |
| `row_type` | `table_hu_source` row | `header`, `item` | Flat-list grouping |
| `hu_status` | `handling_unit` collection | `Packed` (after complete), later `Delivered` at GD complete | Lifecycle of the physical HU record |

---

## 5. Features / user flows

### 5.1 Form lifecycle

**Add mode:**
- Status badge shows `Draft`. All upstream fields unlocked.
- Defaults: `packing_mode = "Basic"`, `created_by = currentUser`, `created_at = today`.
- Buttons visible: `Save as Draft`.

**Edit mode (Draft):**
- All fields still editable. All three save buttons visible.

**Edit mode (Created):**
- Upstream fields (plant_id, packing_no, gd/so/to refs, customer, addresses) **disabled**.
- `table_hu` remains editable. `Save as Draft` hidden; `Save as Created` + `Save as Completed` visible.

**Edit mode (Completed / Cancelled):**
- Everything disabled. All save buttons hidden. Read-only view.

**View mode:** all disabled, no save buttons.

Initialization at onMounted:
1. Resolve `page_status` from `isAdd`/`isEdit`/`isView`.
2. Resolve `organization_id` (from global var or system var) and `plant_id` (via `blade_dept`).
3. Apply status HTML badge + `disabledField()` by status.
4. Apply `packing_mode` column visibility (see 5.2).
5. If `packing_required` is off for the org, hide the `gd_id` selector.
6. `triggerEvent("PackingRecomputeSource")` to refresh source projections.

### 5.2 Packing modes

| Mode | `table_hu.hu_quantity` | `table_hu.item_count` / `total_quantity` |
|---|---|---|
| `Basic` | visible, editable (# of boxes) | hidden |
| `Detail` | hidden | visible |

Switching from Basic → Detail clears `hu_quantity` and resets `hu_status` to `Unpacked` on every row (so operator doesn't ship a stale basic-count).

### 5.3 Flow A — Pick individual items to Generated HU

Precondition: user is in a Packing in Draft or Created status, Edit mode.

1. User adds a new row to `table_hu`. Row initializes:
   - `hu_row_type = "generated"`, `handling_no = "Auto-generated number"`,
     `temp_data = "[]"`, `item_count = 0`, `total_quantity = 0`,
     `hu_status = "Unpacked"`, `storage_location_id` / `location_id` from the
     organization's default loading bay.
2. User fills in `hu_material_id` (required), `hu_type` auto-derives.
3. User toggles `select_hu = 1` on the row.
   - Single-select: all other rows' `select_hu` set to 0.
   - `selected_hu_index` set to this row's index.
   - **Rejected** if: `hu_material_id` empty, `hu_status === "Completed"`, or `hu_row_type === "locked"`. Toast + revert checkbox.
4. In `table_item_source`, user enters `qty_to_pick` on a row (clamped to `[0, remaining_qty]` on change).
5. User clicks row action **Pick to HU** (on the item source row).
   - Validations: `selected_hu_index >= 0`, target exists, target not locked, source has `id`, `0 < qty_to_pick <= remaining_qty`.
   - Append new direct-item entry to target's `temp_data` — OR merge (bump `total_quantity`) if entry with same `line_item_id` already exists.
   - Recompute target's `item_count`, `total_quantity` (walk direct + nested).
   - Set target's `hu_status = "Packed"`.
   - Trigger `PackingRecomputeSource` (updates `table_item_source.picked_qty` / `remaining_qty` / `line_status`).
   - Toast: `Picked X [item_name] to HU [handling_no or "1"]`.

**Bulk variant (`PackingBulkPickItems`):** toolbar button; processes all `table_item_source` rows with `select_item === 1`. Same dedup, same validation per row. Skipped rows logged in the toast: `Picked N, skipped M`. On success, `select_item` is reset to 0 on picked rows.

### 5.4 Flow B — Pick whole HU as Locked row

1. In `table_hu_source`, user clicks row action **Pick to HU** on a **header** row.
2. Validations: `row_type === "header"`, `hu_status !== "Picked"`, header has `handling_unit_id`.
3. Fetch source HU master from `handling_unit` collection (for `handling_no`, `hu_material_id`, etc. not carried on the header row).
4. Collect all item rows in `table_hu_source` with matching `handling_unit_id` → serialize into `temp_data` as direct-item entries.
5. Append a new row to `table_hu`:
   - `hu_row_type = "locked"`, `source_hu_id = sourceHuId`, `handling_unit_id = sourceHuId`.
   - HU-level fields copied from master.
   - `temp_data` set, `item_count` / `total_quantity` computed.
   - `hu_status = "Packed"`.
6. Update `table_hu_source`: for every row (header + items) with matching `handling_unit_id`, set `hu_status = "Picked"`.
7. Toast: `HU [handling_no] added as locked row`.

**Locked rows are immutable downstream:**
- `PackingOnSelectHuChange` rejects selecting Locked as active target.
- `PackingPickItemToHU` / `PackingBulkPickItems` / `PackingPickToParentHU` all reject Locked as target.

**Bulk variant (`PackingBulkPickHUs`):** picks all `table_hu_source` headers with `hu_select === 1`.

### 5.5 Flow C — Pick to Parent HU (nesting)

Precondition: active target HU in `table_hu` is Generated (not Locked).

1. User clicks row action **Pick to Parent HU** on a `table_hu_source` header.
2. Validations: `selected_hu_index >= 0`, target not locked, source header not already picked, source has `handling_unit_id`, not nesting into itself.
3. Fetch source HU master from `handling_unit`.
4. Snapshot source's item rows from `table_hu_source` as `children[]`.
5. Append a `nested_hu` entry to target's `temp_data`.
6. Recompute target's `item_count` / `total_quantity` (now includes nested children).
7. Target's `hu_status = "Packed"`.
8. Source HU's rows in `table_hu_source` → `hu_status = "Picked"`.
9. Toast: `HU [source handling_no] nested inside [target handling_no]`.

### 5.6 Row-level **Complete** action (table_hu)

Event key `j7xrn9c8`, handler `PackingTableHUCompleted`.

Skipped if `temp_data` is empty.

**Generated row (with or without nested HUs):**
1. Split `temp_data` into `directItems` and `nestedHus`.
2. For each `directItems` entry: resolve `balance_id` via `item_balance` (or `item_batch_balance` if batch) by `(plant_id, material_id, location_id, batch_id)`.
3. Call repack workflow `2043602532898443266` with:
   - `process_type: "Load"`, `trx_no: packing_no`,
   - `parent_trx_no: <first item's gd_no>`,
   - `items: [ ... direct items only ... ]`,
   - `source_hu: null`,
   - `target_hu: <row>` (with id empty for new HU creation),
   - `target_storage_location_id`, `target_location_id`, `remark`, `transaction_type: "Packing"`.
4. On 200 response, receive `{ huId, huNo }`.
5. For each `nestedHus` entry: `db.collection("handling_unit").doc(nestedHuId).update({ parent_hu_id: huId })`.
6. In-memory update: `table_hu[rowIndex].handling_unit_id = huId`, `handling_no = huNo`, `hu_status = "Completed"`.
7. If Locked-source HU(s) involved: update `table_hu_source.hu_status` to `"Completed"` for all rows matching `source_hu_id`.
8. **Append the completed row (with its new identifiers) to `packing.table_hu` in DB** (`db.collection("packing").doc(packingId).update({ table_hu: [...existing, completedRow], table_hu_source, table_item_source })`).
9. Toast: `HU completed`.

**Locked row (whole-HU pick):**
- No workflow call (inventory is already in the source HU).
- `db.collection("handling_unit").doc(huId).update({ hu_status: "Packed" })`.
- `table_hu[rowIndex].hu_status = "Completed"`.
- Lock source HU rows in `table_hu_source` → `hu_status: "Completed"`.
- Append completed row to packing DB (same as Generated step 8).

### 5.7 Row-level **Unpack** action (table_hu)

Event key `j6g72duk`, handler `PackingOnUnpackHU`. Three variants:

**Non-completed row:**
1. Confirm if `temp_data` non-empty: `Unpack HU X? N item(s) will be removed`.
2. Splice row out of `table_hu`.
3. If `hu_row_type === "locked"` or temp_data contains nested_hu entries: collect source HU ids → revert their `table_hu_source.hu_status` to `"Unpacked"` (header + items).
4. Fix `selected_hu_index`: set to -1 if deleted row was selected; decrement by 1 if deleted row was before the selected one.
5. Trigger `PackingRecomputeSource`.
6. Toast: `HU X unpacked`.

**Completed Generated row:**
1. Confirm: `Unload HU X? N item(s) will be moved out of the HU; the HU will remain as an empty row.`
2. Split direct items vs nested HUs.
3. Build items array for direct items (resolve balance_id).
4. Call repack workflow `2043602532898443266` with `process_type: "Unload"`, `source_hu: <this row>`, `target_hu: null`, target bin = row's location.
5. On 200: for each nested: `db.collection("handling_unit").doc(childHuId).update({ parent_hu_id: "" })`.
6. Revert source HU locks in `table_hu_source` to `"Unpacked"`.
7. Update row in-memory: `temp_data = "[]"`, `item_count = 0`, `total_quantity = 0`, `hu_status = "Unpacked"`. **Keep** `handling_unit_id` and `handling_no` (the real HU record stays, just empty).
8. Recompute source projections.
9. Remove row from packing doc's recorded `table_hu` via filter on `handling_unit_id`.
10. Toast: `HU X unloaded`.

**Completed Locked row:**
1. Confirm: `Un-complete HU X? The HU stays picked but will no longer be marked completed.`
2. No workflow call.
3. Revert source HU rows in `table_hu_source` from `"Completed"` to `"Picked"`.
4. Row's `hu_status` flips back to `"Packed"` (not deleted; items stay).
5. Remove row from packing doc's recorded `table_hu`.
6. Toast: `HU X un-completed`.

### 5.8 Other row actions

- **View Detail**: opens a read-only dialog with parsed `temp_data` items (including flattened nested children showing a `from_hu` column). Visibility: `temp_data !== "[]"`.
- **Delete** (platform's built-in row delete): visibility gated on `hu_status === "Unpacked"` (can only delete empty rows).

### 5.9 Save actions

#### 5.9.1 Save as Draft
- Handler: `PackingDraftWorkflow.js`.
- Calls workflow `1994279909883895810` with `{ entry: data, saveAs: "Draft" }`.
- Backend validates required fields (falls back to client error toast if any missing).
- On success: add (new packing) or update (existing), close dialog, toast `Packing drafted successfully`.

#### 5.9.2 Save as Created
- Handler: `PackingCreatedWorkflow.js`.
- Same workflow, `saveAs: "Created"`.
- Sets packing status to `Created`, locking upstream fields; downstream creates/updates GD line references with `packing_id`.

#### 5.9.3 Save as Completed
- Handler: `PackingCompletedWorkflow.js`. **This is the critical flow.**
- Client-side pre-checks:
  1. Every `table_item_source` row: `remaining_qty <= 0.001` AND `line_status === "Fully Picked"`.
  2. `table_hu` non-empty.
- If any `table_hu` row has `temp_data !== "[]"` AND `hu_status !== "Completed"`:
  - Confirm dialog: `N HU(s) are not yet completed. Complete them now as part of finalizing this packing?`
  - On confirm: loop pending rows, `await this.triggerEvent("TableHUCompleted", { row, rowIndex })` for each.
- Re-read state; post-check: every row with `temp_data` is Completed; every `table_hu_source` header is Completed.
- Call workflow `1994279909883895810` with `{ entry: finalData, saveAs: "Completed" }`.
- Backend Save As Completed branch:
  - Updates SO / GD / TO headers and line items (`packing_status`).
  - Patches GD's `temp_qty_data` with packed HU assignments (splits entries across HUs when one GD entry packed into multiple HUs).
  - Writes `temp_hu_data`, `prev_temp_qty_data`, `prev_temp_hu_data`, `view_stock`, `packing_id` on GD lines.
  - Triggers GD workflow `2017151544868491265` with `saveAs: "Created"` for inventory rebalance.
- Response handling: `errorStatus === "missingFields"` / `"fullyPacked"` / generic error → toast + stop.
- `status === "Success"` → toast + close dialog.

### 5.10 Source projection (`PackingRecomputeSource`)

Called after every mutation to `table_hu`. Walks all `table_hu[*].temp_data` entries (direct + nested children), counts picked qty per `line_item_id`, and updates every `table_item_source` row:

```
picked = picks[row.id] || 0
remaining = max(0, row.total_quantity - picked)
status = picked <= EPS ? "Open"
       : row.total_quantity - picked > EPS ? "Partially Picked"
       : "Fully Picked"
qty_to_pick = clamp to [0, remaining]
```

EPS = 0.001. Mobile must ensure this runs after every pick / unpack / bulk action / row add / row delete.

---

## 6. Required handlers (for mobile re-implementation)

| Handler | Trigger | Purpose |
|---|---|---|
| `PackingOnMounted` | form `onMounted` | Init page state, resolve plant/org, recompute sources |
| `PackingOnTableHuRowAdd` | row-add on `table_hu` | Initialize new Generated row (defaults, loading bay) |
| `PackingOnSelectHuChange` | toggle `select_hu` | Single-select + gates (material set, not Completed, not Locked) |
| `PackingOnChangeQtyToPick` | onChange on `table_item_source.qty_to_pick` | Clamp to `[0, remaining_qty]` |
| `PackingRecomputeSource` | triggered after every mutation | Recompute `picked_qty` / `remaining_qty` / `line_status` |
| `PackingPickItemToHU` | row action on `table_item_source` | Flow A single-item |
| `PackingBulkPickItems` | toolbar button | Flow A bulk |
| `PackingPickHUToHU` | row action on `table_hu_source` header | Flow B single HU |
| `PackingBulkPickHUs` | toolbar button | Flow B bulk |
| `PackingPickToParentHU` | row action on `table_hu_source` header | Flow C nest |
| `PackingTableHUCompleted` | row action **Complete** on `table_hu` | Row-level complete |
| `PackingOnUnpackHU` | row action **Unpack** on `table_hu` | Three-branch unpack |
| `PackingDraftWorkflow` | `Save as Draft` button | Save draft |
| `PackingCreatedWorkflow` | `Save as Created` button | Status → Created |
| `PackingCompletedWorkflow` | `Save as Completed` button | Finalize + GD rebalance |

Optional (skip on mobile v1 if tight):
- `PackingOpenExistingHUDialog` / `PackingConfirmExistingHU` — pre-existing HU picker dialog
- `PackingOnChangePackingMode` — column visibility on mode switch (do in layout instead on mobile)
- `PackingViewDetailHU` — read-only detail dialog
- `PackingSetupOnMounted` / `PackingSetupSave` — admin-only config

---

## 7. Invariants & gotchas

1. **`temp_data` is a JSON string, not an array.** Always parse on read, stringify on write.
2. **`gd_id` is a single string**, not an array (old mobile treated it as array — breaks new saves).
3. **Source projection runs after every mutation.** Picking, un-picking, row add, row delete — always followed by a recompute.
4. **`selected_hu_index` is stable through in-place setData updates but shifts when rows splice.** Decrement when earlier row removed; set to -1 when selected row removed.
5. **Locked rows are immutable for further picking.** Every pick action rejects them as targets.
6. **Dedup on repeat pick.** Picking the same source line into the same target HU bumps existing entry's qty, does not create duplicate.
7. **Aggregate rollup includes nested children.** `item_count` and `total_quantity` walk both direct items and `nested_hu.children`.
8. **Completed rows must stay visible.** Unpack on Completed does NOT delete the row — it empties it. The `handling_unit_id` stays; the HU record exists as an empty container.
9. **Float tolerance EPS = 0.001** for `remaining_qty` and qty comparisons.
10. **Packing DB persistence on Complete / Unpack (ledger):** on every row-level Complete and every Unpack-of-Completed, mobile writes **only the Completed rows** (filtered from the form's `table_hu`) to `packing.table_hu`, plus the current `table_hu_source` and `table_item_source`. In-progress rows stay in the form but are not persisted by these row-level actions — they get saved via the main Save-as-Draft / Save-as-Created / Save-as-Completed workflow call (which sends the full form `entry`).
11. **`handling_unit_id` is empty until Complete runs.** Don't assume every `table_hu` row has a real HU id before completion.
12. **Nested HU children are not re-patched in GD.** They retain their original child HU id; only the child's `parent_hu_id` is updated to the new parent.

---

## 8. Validation messages (exact copy for UX parity)

| Trigger | Level | Message |
|---|---|---|
| Selecting a row with no `hu_material_id` | warning | `Please fill in the HU material before selecting this HU.` |
| Selecting a Completed HU | warning | `This HU is already completed and cannot be selected.` |
| Selecting a Locked HU | warning | `Locked HUs cannot receive more items. Select a generated HU instead.` |
| No target selected on Pick | warning | `Please select a target HU in the packing table first.` |
| Pick onto a Locked target | warning | `Cannot add items to a locked HU. Select a generated HU instead.` |
| `qty_to_pick <= 0` | warning | `Quantity to pick must be greater than zero.` |
| `qty_to_pick > remaining_qty` | warning | `Quantity (X) exceeds remaining (Y).` |
| Nesting into self | warning | `Cannot nest an HU inside itself.` |
| Unpack confirm (items present) | confirm | `Unpack HU X? N item(s) will be removed from this packing.` |
| Unload confirm (Completed) | confirm | `Unload HU X? N item(s) will be moved out of the HU; the HU will remain as an empty row.` |
| Un-complete confirm (Locked) | confirm | `Un-complete HU X? The HU stays picked but will no longer be marked completed.` |
| Save Completed — pending rows | confirm | `N HU(s) are not yet completed. Complete them now as part of finalizing this packing?` |
| Save Completed — source items not all packed | error | `Cannot complete packing: Item X is not fully packed. (+N more)` |
| Save Completed — post-check failure | error | `Cannot complete packing: HU X is not completed. (+N more)` |
| Save Completed — backend `missingFields` | error | `Validation errors: <backend message>` |

---

## 9. Backend integration contracts

### 9.1 Main Packing workflow (`1994279909883895810`)

Request: `{ entry: <packing object>, saveAs: "Draft" | "Created" | "Completed" }`.

Response: `{ code, status, message, errorStatus, entry }`.
- `status === "Success"` → proceed.
- `errorStatus === "missingFields"` → backend-side validation failed.
- `errorStatus === "fullyPacked"` → the "all items packed" check failed at backend.

### 9.2 Repack process workflow (`2043602532898443266`)

Called from `PackingTableHUCompleted` and from `PackingOnUnpackHU` (Completed Generated branch).

Request shape:
```jsonc
{
  "plant_id": "", "organization_id": "",
  "process_type": "Load" | "Unload",
  "trx_no": "<packing_no>",
  "parent_trx_no": "<gd_no>",
  "items": [
    {
      "material_id": "", "material_uom": "",
      "location_id": "",           // original/current location of items
      "batch_id": null,
      "balance_id": "",
      "quantity": 0
    }
  ],
  "source_hu": null | { id, handling_no, hu_material_id, hu_type, hu_quantity, hu_uom, storage_location_id, location_id, parent_hu_id, hu_status },
  "target_hu": null | { id (empty for new), handling_no ("Auto-generated number" for new), ...same fields },
  "target_storage_location_id": "",
  "target_location_id": "",
  "remark": "",
  "transaction_type": "Packing"
}
```

Response: `{ code, message, huId, huNo }` (huId/huNo are new HU identifiers returned when a new HU was created).

### 9.3 GD rebalance workflow (`2017151544868491265`)

Not called directly by mobile. Invoked server-side by the Packing workflow at Save Completed. Mobile just needs to know: after Save Completed succeeds, the linked GD has updated `temp_qty_data` (with HU tags), and its allocations/inventory reservations are rebalanced.

---

## 10. Mobile-specific considerations

- **Offline handling**: source projections are entirely local (compute from in-memory `table_hu`). Picking, unpacking, and bulk actions do not need network calls. Row-level Complete and Save Completed DO need the backend — queue-and-retry is advisable if offline support matters.
- **Large `temp_data`**: for HUs with many nested children, the JSON string can grow. Parse lazily when user expands a detail view.
- **`select_hu` UX**: on touch devices, consider making the whole row tappable to toggle selection (rather than a small checkbox).
- **`line_status` badge**: display on each `table_item_source` row; drives user awareness of which items remain.
- **Confirmation prompts**: preserve the exact wording (see section 8) — QA parity across platforms.
- **Error toasts**: cap at 3 messages + `(+N more)` suffix to avoid wall-of-text.
- **Workflow IDs** should be read from a config, not hardcoded — so staging vs prod can swap.
- **Schema migration**: old mobile records may have `gd_id` as array and `table_items` field. Before touching a legacy record, normalize: `gd_id = Array.isArray(x) ? x[0] : x`; drop `table_items`.

---

## 11. Verification checklist

To verify the mobile implementation against the desktop:

1. **Open a Packing in Edit mode** (auto-created from Picking). Confirm `table_hu_source` + `table_item_source` are pre-populated from the upstream Picking workflow.
2. **Flow A**: add a Generated row, select it, pick 1 item. Verify `temp_data` has one entry, `item_count=1`, source `remaining_qty` decremented, `line_status` updated.
3. **Dedup**: pick the same item again into same HU. Verify existing entry's qty bumped, no duplicate entry.
4. **Flow B**: pick a whole source HU. Verify a Locked row appears, source `hu_status` shows `Picked` on both header and items, Locked row cannot receive more picks.
5. **Flow C**: with a Generated target selected, Pick to Parent HU on a different source HU. Verify a `nested_hu` entry appears in target's `temp_data`, `item_count`/`total_quantity` includes nested children.
6. **Row complete (Generated)**: Click Complete. Verify toast, `handling_unit_id`/`handling_no` populated, `hu_status = "Completed"`, new record in `handling_unit` collection with `table_hu_items` + `hu_status: "Packed"`.
7. **Row complete (Locked)**: Click Complete. Verify source HU's `handling_unit.hu_status = "Packed"`, source rows `Completed`, no new HU created.
8. **Row complete (Parent w/ nested)**: Verify each child's `handling_unit.parent_hu_id` updated to the new parent HU id.
9. **Unpack non-Completed**: row spliced, source reverts to `Unpacked`, `selected_hu_index` adjusted.
10. **Unpack Completed Generated**: row stays, emptied; items move out via Unload workflow; `handling_unit_id` kept.
11. **Unpack Completed Locked**: row stays with `hu_status: "Packed"`, source reverts to `Picked`.
12. **Save as Completed**: pre-check blocks if any `line_status !== "Fully Picked"`; confirm dialog shows pending HU count; after confirm, all pending rows auto-complete via `TableHUCompleted`; backend call succeeds; toast + close dialog; linked GD's `temp_qty_data` entries now have `handling_unit_id` populated.

---

## 12. Files to reference (desktop implementation)

Read-only references for the mobile team (do not port the code — reimplement
in the mobile framework):

| Concern | File |
|---|---|
| Form schema | `Packing/PackingFullJSON.json` |
| Init & status HTML | `Packing/PackingOnMounted.js` |
| Row add init | `Packing/PackingOnTableHuRowAdd.js` |
| Select HU (single) | `Packing/PackingOnSelectHuChange.js` |
| Qty clamp | `Packing/PackingOnChangeQtyToPick.js` |
| Source projection | `Packing/PackingRecomputeSource.js` |
| Pick single item | `Packing/PackingPickItemToHU.js` |
| Bulk pick items | `Packing/PackingBulkPickItems.js` |
| Pick single HU | `Packing/PackingPickHUToHU.js` |
| Bulk pick HUs | `Packing/PackingBulkPickHUs.js` |
| Pick to parent HU | `Packing/PackingPickToParentHU.js` |
| Complete row | `Packing/PackingTableHUCompleted.js` |
| Unpack row | `Packing/PackingOnUnpackHU.js` |
| Save as Draft | `Packing/PackingDraftWorkflow.js` |
| Save as Created | `Packing/PackingCreatedWorkflow.js` |
| Save as Completed | `Packing/PackingCompletedWorkflow.js` |
| Existing HU dialog (optional) | `Packing/PackingOpenExistingHUDialog.js`, `PackingConfirmExistingHU.js` |
| Pure helpers | `Packing/PackingProcessHelpers.js` |

Backend workflow JSONs (mobile calls the same):
- Main Packing save: workflow id `1994279909883895810` (file `Packing/PackingSaveWorkflowJSON.json`)
- Repack/HU create/unload: `2043602532898443266` (`Repack Order/ROrepackingProcessWorkflow.json`)
- GD rebalance (indirect, server-side): `2017151544868491265` (`Goods Delivery/GDheadWorkflow.json`)
