# Mobile Implementation Guide — GR Handling Unit & Split

This guide documents the **client-side form logic** for Handling Unit (HU) selection and Split features in Goods Receiving (GR), so that the mobile app produces the **same `table_gr` shape** as the web app. The backend workflow is shared between both apps and keys off specific fields (`parent_or_child`, `is_split`, `line_index`, `temp_hu_data`, `split_source_index`); any deviation will silently mis-allocate or be rejected.

Workflow logic is **out of scope** — only form-side behavior is covered here.

---

## Table of Contents

1. [Mental Model](#1-mental-model)
2. [Data Schemas](#2-data-schemas)
3. [Quantity Math](#3-quantity-math)
4. [Manual Split Flow](#4-manual-split-flow)
5. [Handling Unit Flow](#5-handling-unit-flow)
6. [Field Visibility & Lock Matrix](#6-field-visibility--lock-matrix)
7. [Validation Rules & Tolerance Math](#7-validation-rules--tolerance-math)
8. [Edge Cases & Gotchas](#8-edge-cases--gotchas)
9. [Mobile Porting Checklist](#9-mobile-porting-checklist)

---

## 1. Mental Model

The GR form has two mechanisms that can transform a single `table_gr` line into multiple lines:

| Mechanism | Trigger | Result | When used |
|-----------|---------|--------|-----------|
| **Manual Split** (`table_split`) | User clicks Split button on a row | Hierarchy: 1 Parent + N Children<br>OR Parallel: N Split-Parents | User wants to split qty across batches/locations/serials |
| **HU Selection** (`table_hu`) | User clicks Select HU button | Auto-split: 1 Parent + N Children (one per HU) + optional remainder Child | User receives multiple physical containers |

Both mechanisms write the **same set of fields** on each resulting row. The workflow only sees the final `table_gr` — it does not know which mechanism produced the rows.

### Row types

After any split, every row falls into one of these states (`is_split` × `parent_or_child`):

| State | `is_split` | `parent_or_child` | Notes |
|-------|------------|-------------------|-------|
| Regular | `"No"` | `"Parent"` (or `null`) | Untouched line item |
| Hierarchy Parent | `"Yes"` | `"Parent"` | Summary; quantities live in children |
| Hierarchy Child | `"No"` | `"Child"` | Receives qty; locked except batch/serial flow |
| Split-Parent | `"Yes"` | `"Split-Parent"` | Independent row, behaves like Regular but cannot re-split |

### Identifier conventions (workflow-critical)

| Field | Regular | Hierarchy Parent | Hierarchy Child | Split-Parent |
|-------|---------|------------------|-----------------|--------------|
| `line_index` | `N` (number) | `parent_index + 1` (e.g. `1`) | `"N - M"` (e.g. `"1 - 1"`, with **spaces** around hyphen) | `"N-A"`, `"N-B"` (no spaces, letter suffix) |
| `parent_index` | row index | row index | parent's row index | original row index |
| `split_source_index` | `null` | `null` | `null` | original row index (for re-split filtering) |

> ⚠️ **The exact string format of `line_index` matters** — `"1 - 1"` vs `"1-1"` are different strings, and the workflow groups rows by these literals.

---

## 2. Data Schemas

### 2.1 `table_gr` row (persisted to backend)

The workflow keys off these. Every split path must produce these fields verbatim.

**Identification**
- `line_index` — see [identifier conventions](#identifier-conventions-workflow-critical)
- `parent_index` — index of parent row (Children) or self (Parent / Split-Parent)
- `split_source_index` — original row index before split (Split-Parent only); `null` otherwise
- `is_split` — `"Yes"` or `"No"`
- `parent_or_child` — `"Parent"` | `"Child"` | `"Split-Parent"` | `null`

**Item info** (copied from item record)
- `item_id`, `item_name`, `item_desc`, `more_desc`
- `is_serialized_item` (1 = serialized) — drives received_qty disable
- `item_costing_method`, `item_category_id`
- `has_formula`, `formula`

**Quantity fields** (see §3)
- `ordered_qty` — from PO line; **0 on Children**, full value on Parent / Split-Parent / Regular
- `base_ordered_qty` — same rule
- `initial_received_qty` — qty already received in prior **Received** GRs (children get 0)
- `to_received_qty` — depends on row type (see §2.2)
- `received_qty` — qty being received now
- `base_received_qty` — `received_qty * uom_conversion`
- `uom_conversion`, `item_uom`, `base_item_uom`
- `ordered_qty_uom`, `to_received_qty_uom`, `base_ordered_qty_uom`, `base_received_qty_uom`

**Location**
- `storage_location_id` — warehouse/storage location
- `location_id` — bin within storage location

**Batch & inspection**
- `item_batch_no` — batch number; sentinels: `"-"` (non-batch item), `"Auto-generated batch number"`
- `manufacturing_date`, `expired_date` — set only when batch managed
- `inspection_required`, `inv_category`

**PO reference**
- `line_po_no`, `line_po_id`, `po_line_item_id`

**Pricing**
- `unit_price`, `total_price`

**Serialization**
- `serial_numbers[]`, `select_serial_number[]`

**Remarks**
- `line_remark_1`, `line_remark_2`, `line_remark_3`

**HU data**
- `temp_hu_data` — JSON **string**; `"[]"` when no HU; `JSON.stringify([huObject])` for one HU; `JSON.stringify([hu1, hu2, ...])` for grouped (only on the no-split confirm path)
- `view_hu` — display string; format `"{handling_no}: {qty} qty\n[HU Material: {material_code}]"`. Empty string when no HU.

> ⚠️ **`temp_hu_data` is a JSON string, not an array.** Mobile must `JSON.stringify` before write and `JSON.parse` before read.

### 2.2 Field rules per row type (`setGrItemData`)

Quick reference table:

| Field | Parent | Child | Split-Parent | Regular |
|-------|--------|-------|--------------|---------|
| `ordered_qty` | full | **0** | full | full |
| `base_ordered_qty` | full | **0** | full | full |
| `initial_received_qty` | full | **0** | full | full |
| `to_received_qty` | `ordered_qty - initial_received_qty` | `received_qty` | `ordered_qty - initial_received_qty - received_qty` | `received_qty` |
| `received_qty` | `totalSplitQty` (sum) | dialog qty | dialog qty | preserved |
| `base_received_qty` | preserved (when `is_split === "No"` && Parent) else `received_qty * uom_conversion` | `received_qty * uom_conversion` | `received_qty * uom_conversion` | preserved |
| `total_price` | preserved | `received_qty * unit_price` | `received_qty * unit_price` | preserved |
| `item_batch_no` | inherited | inherited | `""` for manual-batch items; `"-"` and `"Auto-generated batch number"` preserved | inherited |
| `manufacturing_date` / `expired_date` | inherited | inherited | `null` (when batch managed); inherited (when `"-"`) | inherited |

The full helper used by the manual split flow:

```javascript
const setGrItemData = (
  itemData,
  lineIndex,
  receivedQty,
  storageLocationId,
  locationId,
  lineRemark1,
  lineRemark2,
  lineRemark3,
  isSplit,
  parentOrChild,
  parentIndex,
  selectSerialNumber = [],
  splitSourceIndex = null,
) => {
  // For Split-Parent: treat like regular row (keeps ordered_qty, initial_received_qty, etc.)
  const isSplitParent = parentOrChild === "Split-Parent";

  return {
    // Line identification
    line_index: lineIndex,

    // Item information (copied from parent)
    item_id: itemData.item_id,
    item_name: itemData.item_name,
    item_desc: itemData.item_desc,
    more_desc: itemData.more_desc,

    // Quantity fields - Split-Parent keeps ordered_qty proportionally
    ordered_qty:
      parentOrChild === "Parent" || isSplitParent ? itemData.ordered_qty : 0,
    ordered_qty_uom: itemData.ordered_qty_uom,
    base_ordered_qty:
      parentOrChild === "Parent" || isSplitParent
        ? itemData.base_ordered_qty
        : 0,
    base_ordered_qty_uom: itemData.base_ordered_qty_uom,
    to_received_qty:
      parentOrChild === "Parent"
        ? (itemData.ordered_qty || 0) - (itemData.initial_received_qty || 0)
        : isSplitParent
          ? (itemData.ordered_qty || 0) -
            (itemData.initial_received_qty || 0) -
            receivedQty
          : receivedQty,
    to_received_qty_uom: itemData.to_received_qty_uom,
    received_qty:
      isSplit === "No" && parentOrChild === "Parent"
        ? itemData.received_qty
        : receivedQty,
    base_received_qty:
      isSplit === "No" && parentOrChild === "Parent"
        ? itemData.base_received_qty
        : receivedQty * (itemData.uom_conversion || 1),
    base_received_qty_uom: itemData.base_received_qty_uom,
    initial_received_qty:
      parentOrChild === "Parent" || isSplitParent
        ? itemData.initial_received_qty
        : 0,
    item_uom: itemData.item_uom,
    base_item_uom: itemData.base_item_uom,
    uom_conversion: itemData.uom_conversion,

    // Location fields
    storage_location_id: storageLocationId,
    location_id: locationId,

    // Batch and inspection - Split-Parent clears batch only for manual-entry
    // batch items. "-" (non-batch) and "Auto-generated batch number" are
    // sentinels that must be preserved.
    item_batch_no: isSplitParent
      ? itemData.item_batch_no === "-" ||
        itemData.item_batch_no === "Auto-generated batch number"
        ? itemData.item_batch_no
        : ""
      : itemData.item_batch_no,
    manufacturing_date:
      isSplitParent && itemData.item_batch_no !== "-"
        ? null
        : itemData.manufacturing_date,
    expired_date:
      isSplitParent && itemData.item_batch_no !== "-"
        ? null
        : itemData.expired_date,
    inspection_required: itemData.inspection_required,
    inv_category: itemData.inv_category,

    // PO reference (copied from parent)
    line_po_no: itemData.line_po_no,
    line_po_id: itemData.line_po_id,
    po_line_item_id: itemData.po_line_item_id,

    // Pricing
    unit_price: itemData.unit_price,
    total_price:
      parentOrChild === "Parent"
        ? itemData.total_price
        : receivedQty * itemData.unit_price,
    item_costing_method: itemData.item_costing_method,
    item_category_id: itemData.item_category_id,

    // Serialization
    is_serialized_item: itemData.is_serialized_item,
    serial_numbers: selectSerialNumber,
    select_serial_number: selectSerialNumber,

    // Formula
    has_formula: itemData.has_formula,
    formula: itemData.formula,

    // Remarks
    line_remark_1: lineRemark1,
    line_remark_2: lineRemark2,
    line_remark_3: lineRemark3,

    // Split tracking fields
    is_split: isSplit,
    parent_or_child: parentOrChild,
    parent_index: parentIndex,

    // Split-Parent tracking: original row index before split
    split_source_index: splitSourceIndex,
  };
};
```

The HU split flow uses a similar helper — `buildGrRow` — that takes `tempHuData` and `viewHu` instead of split-specific fields:

```javascript
const buildGrRow = (
  sourceItem,
  lineIndex,
  receivedQty,
  storageLocationId,
  locationId,
  isSplit,
  parentOrChild,
  parentIndex,
  tempHuData,
  viewHu,
  overrides = {},
) => {
  const uomConversion = sourceItem.uom_conversion || 1;
  const isParent = isSplit === "Yes" && parentOrChild === "Parent";
  const isChild = parentOrChild === "Child";

  return {
    line_index: lineIndex,

    // Item information
    item_id: sourceItem.item_id,
    item_name: sourceItem.item_name,
    item_desc: sourceItem.item_desc,
    more_desc: sourceItem.more_desc,

    // Quantity fields
    ordered_qty: isParent ? sourceItem.ordered_qty : isChild ? 0 : sourceItem.ordered_qty,
    ordered_qty_uom: sourceItem.ordered_qty_uom,
    base_ordered_qty: isParent ? sourceItem.base_ordered_qty : isChild ? 0 : sourceItem.base_ordered_qty,
    base_ordered_qty_uom: sourceItem.base_ordered_qty_uom,
    to_received_qty: isParent
      ? (sourceItem.ordered_qty || 0) - (sourceItem.initial_received_qty || 0)
      : receivedQty,
    to_received_qty_uom: sourceItem.to_received_qty_uom,
    received_qty: receivedQty,
    base_received_qty: receivedQty * uomConversion,
    base_received_qty_uom: sourceItem.base_received_qty_uom,
    initial_received_qty: isChild ? 0 : sourceItem.initial_received_qty,
    item_uom: sourceItem.item_uom,
    base_item_uom: sourceItem.base_item_uom,
    uom_conversion: uomConversion,

    // Location
    storage_location_id: storageLocationId,
    location_id: locationId,

    // Batch and inspection (inherited as-is from source)
    item_batch_no: sourceItem.item_batch_no,
    manufacturing_date: sourceItem.manufacturing_date,
    expired_date: sourceItem.expired_date,
    inspection_required: sourceItem.inspection_required,
    inv_category: sourceItem.inv_category,

    // PO reference
    line_po_no: sourceItem.line_po_no,
    line_po_id: sourceItem.line_po_id,
    po_line_item_id: sourceItem.po_line_item_id,

    // Pricing
    unit_price: sourceItem.unit_price,
    total_price: isParent
      ? sourceItem.total_price
      : receivedQty * (sourceItem.unit_price || 0),
    item_costing_method: sourceItem.item_costing_method,
    item_category_id: sourceItem.item_category_id,

    // Serialization (deep-copy arrays!)
    is_serialized_item: sourceItem.is_serialized_item,
    serial_numbers: sourceItem.serial_numbers
      ? [...sourceItem.serial_numbers]
      : [],
    select_serial_number: sourceItem.select_serial_number
      ? [...sourceItem.select_serial_number]
      : [],

    // Formula
    has_formula: sourceItem.has_formula,
    formula: sourceItem.formula,

    // Remarks
    line_remark_1: sourceItem.line_remark_1,
    line_remark_2: sourceItem.line_remark_2,
    line_remark_3: sourceItem.line_remark_3,

    // HU data
    temp_hu_data: tempHuData,
    view_hu: viewHu,

    // Split tracking
    is_split: isSplit,
    parent_or_child: parentOrChild,
    parent_index: parentIndex,
    split_source_index: sourceItem.split_source_index ?? null,

    ...overrides,
  };
};
```

> 📌 **Why two helpers?** `setGrItemData` is for manual split (carries `splitSourceIndex` + serial-number positional args). `buildGrRow` is for HU split (carries `tempHuData` + `viewHu`). Both produce the same `table_gr` row shape; the difference is which fields the caller is varying.
>
> The post-split field-lock pass that runs immediately after each helper is shown inline in §4.5 (manual) and §5.3 (HU).

### 2.3 `hu_dialog.table_hu` row (in-memory; not persisted directly)

Fields populated during HU selection. Only `confirmedHUs` (those with `store_in_quantity > 0`) survive into `temp_hu_data`.

| Field | Editable for new HU | Source |
|-------|--------------------|--------|
| `handling_unit_id` | — | DB id (truthy = existing HU; falsy = user-created) |
| `handling_no` | ✅ | DB or user input |
| `hu_material_id` | ✅ | **Required if `store_in_quantity > 0`** |
| `hu_type` | — | DB |
| `hu_quantity` | — | DB original quantity in HU |
| `hu_uom` | — | DB UOM |
| `store_in_quantity` | ✅ | **User input — qty to receive from this HU** |
| `gross_weight` | ✅ | New HUs only |
| `net_weight` | ✅ | New HUs only |
| `hu_status` | — | DB |
| `remark` | ✅ | New HUs only |
| `parent_hu_id` | — | DB; for nested pallets |
| `line_index` | — | row position; assigned on add |

For newly added (user-created) HU rows, these five fields must be enabled:

```
handling_no
hu_material_id
gross_weight
net_weight
remark
```

Existing HU rows loaded from DB keep these read-only.

### 2.4 `split_dialog.table_split` row (in-memory)

Generated when user enters `no_of_split`:

```javascript
{
  sub_seq: i + 1,
  received_qty: qtyByRow,        // toReceivedQty / noOfSplit, rounded to 3 decimals
  item_uom: uom,                 // copied from parent row
  storage_location_id: "",
  location_id: "",
  line_remark_1: "",
  line_remark_2: "",
  line_remark_3: "",
}
```

Plus, for serialized items, `select_serial_number[]` is populated with the parent's serial numbers as options.

### 2.5 `split_dialog` shape

- `item_id`, `item_name` — copied from current row
- `to_received_qty` — `(ordered_qty - initial_received_qty)` for the row being split
- `rowIndex` — index of row in `table_gr` being split
- `is_parent_split` — `0` = hierarchy mode (default), `1` = parallel (Split-Parent) mode
- `no_of_split` — user input; triggers row generation
- `table_split[]` — see §2.4
- `serial_number_data` — for serialized items

---

## 3. Quantity Math

```javascript
let initialReceivedQty = receivedQty;       // Only count Received GRs by default
let toReceivedQty = orderQty - receivedQty;

// Special handling when editing a Created GR
if (status === "Created" && currentGRNo) {
  initialReceivedQty = receivedQty;
  const currentGRQty = item.received_qty || 0;
  toReceivedQty = orderQty - receivedQty - currentGRQty;
}
```

- **`orderQty`** = PO line's ordered quantity
- **`receivedQty`** = PO line's `received_qty` (only counts **Received** status GRs; Draft/Created GRs not yet posted)
- **`initial_received_qty`** = the qty already counted as Received in upstream PO line
- **`to_received_qty`** = remaining capacity for this GR

> 📌 **The Created-status subtraction quirk**: when re-opening a Created GR, `to_received_qty` subtracts the current GR's own `received_qty` so the user doesn't see their own qty as "already received." Warnings about overcommitment fire on save, not on display.

### Decimal precision

All quantities are rounded to **3 decimal places** with `parseFloat(x.toFixed(3))`. Mobile must match exactly to avoid sum-mismatch rejects.

---

## 4. Manual Split Flow

### 4.1 Entry point — Split button click

**Pre-check:**
```javascript
const toReceivedQty =
  (grItem.ordered_qty || 0) - (grItem.initial_received_qty || 0);

if (toReceivedQty <= 0) {
  // Show error: "Cannot split when quantity to receive is 0 or less."
  return;
}
```

**HU data warning:** if the row already has `temp_hu_data` (not `"[]"`), warn the user that splitting will reset the selected Handling Units, then clear:
```javascript
table_gr[rowIndex].temp_hu_data = "[]";
table_gr[rowIndex].view_hu = "";
```

**Routing:**
- If row already split (`is_split === "Yes"`) → open `confirm_split_dialog` (asks user to choose: re-split or cancel)
- Otherwise → open `split_dialog` directly

**Dialog initialization:**
```javascript
split_dialog.item_id = grItem.item_id;
split_dialog.item_name = grItem.item_name;
split_dialog.to_received_qty = toReceivedQty;
split_dialog.rowIndex = rowIndex;
split_dialog.is_parent_split = 0;   // Default hierarchy; set to 1 for split-parent

if (isSerializedItem === 1) {
  // Show split_dialog.table_split.select_serial_number column
  split_dialog.serial_number_data = grItem.serial_numbers;
} else {
  // Hide split_dialog.table_split.select_serial_number column
}
```

### 4.2 Re-opening from confirm dialog (already-split rows)

When the user chose "split again" from `confirm_split_dialog`, the existing children/split-parents of that source row must be **filtered out of `table_gr`** before the dialog opens. Different filter for each split type:

```javascript
let latestTableGR;

if (currentRow.parent_or_child === "Split-Parent") {
  // For Split-Parent: filter out all Split-Parent rows with same split_source_index
  const splitSourceIndex = currentRow.split_source_index;
  latestTableGR = tableGR.filter(
    (item) => !(
      item.parent_or_child === "Split-Parent" &&
      item.split_source_index === splitSourceIndex
    ),
  );
} else {
  // For hierarchy split: filter out existing child rows for this parent
  latestTableGR = tableGR.filter(
    (item) => !(item.parent_or_child === "Child" && item.parent_index === rowIndex),
  );
}
```

**Why two filters?** Split-Parent siblings share `split_source_index`; Hierarchy children share `parent_index`. Mobile must choose the matching filter based on `parent_or_child`.

### 4.3 Generating split rows in dialog

When user enters `no_of_split` and confirms:

**Serialized item validation:**
```javascript
if (isSerializedItem === 1 && noOfSplit > toReceivedQty) {
  // Error: "Number of split cannot be greater than quantity to receive for serialized item"
  return;
}
```

**Even distribution:**
```javascript
const qtyByRow = parseFloat((toReceivedQty / noOfSplit).toFixed(3));
const splitData = [];
for (let i = 0; i < noOfSplit; i++) {
  splitData.push({
    sub_seq: i + 1,
    received_qty: qtyByRow,
    item_uom: uom,
    storage_location_id: "",
    location_id: "",
    line_remark_1: "", line_remark_2: "", line_remark_3: "",
  });
}
split_dialog.table_split = splitData;
```

**Serialized handling:** disable `received_qty`, set to `0`, populate serial number options for each split row from the parent's serial numbers.

### 4.4 Deleting a row in the dialog

When a user deletes one row from `split_dialog.table_split`:
- Decrement `no_of_split`
- **Redistribute qty evenly** across remaining rows (`qtyByRow = toReceivedQty / noOfSplit`)
- Re-apply serialized handling
- (Implementation tip: wrap in a small delay like `setTimeout(..., 100)` for UI sync)

### 4.5 Final commit (Split confirm)

The meatiest step. Two modes branch on `is_parent_split`.

**Tolerance fetch:**
```javascript
const itemId = tableGR[rowIndex].item_id;
let overReceiveTolerance = 0;
if (itemId) {
  const itemData = await db.collection("Item").where({ id: itemId }).get();
  if (itemData?.data?.length > 0) {
    overReceiveTolerance = itemData.data[0].over_receive_tolerance || 0;
  }
}
```

**Max qty validation:**
```javascript
const totalSplitQty = parseFloat(
  tableSplit.reduce((sum, item) => sum + (parseFloat(item.received_qty) || 0), 0).toFixed(3),
);
const maxAllowedQty = parseFloat(
  ((toReceivedQty * (100 + overReceiveTolerance)) / 100).toFixed(3),
);

if (totalSplitQty <= 0) throw new Error("Total split quantity must be greater than 0.");
if (totalSplitQty > maxAllowedQty) {
  throw new Error(
    `Total split quantity (${totalSplitQty}) exceeds maximum allowed quantity (${maxAllowedQty}) based on tolerance.`,
  );
}
```

**Letter suffix helper (for Split-Parent line_index):**
```javascript
const getLetterSuffix = (index) => {
  let suffix = "";
  let num = index;
  while (num >= 0) {
    suffix = String.fromCharCode(65 + (num % 26)) + suffix;
    num = Math.floor(num / 26) - 1;
  }
  return suffix;
};
// 0 → "A", 1 → "B", ..., 25 → "Z", 26 → "AA", 27 → "AB", ...
```

**Mode A: Hierarchy (`is_parent_split === 0`)**

Replaces the original row with: 1 Parent + N Children.

```javascript
// Parent row (summary)
const parentItem = setGrItemData(
  grItem,
  grItem.parent_index + 1,             // line_index
  totalSplitQty,                        // received_qty (= sum of children)
  "",                                   // storage_location_id cleared
  "",                                   // location_id cleared
  grItem.line_remark_1, grItem.line_remark_2, grItem.line_remark_3,
  "Yes",                                // is_split
  "Parent",                             // parent_or_child
  index,                                // parent_index = own row index
  grItem.select_serial_number,
);
latestTableGR.push(parentItem);

// One child per split dialog row
for (const [dialogLineIndex, dialogItem] of tableSplit.entries()) {
  const childItem = setGrItemData(
    grItem,
    `${grItem.parent_index + 1} - ${dialogLineIndex + 1}`,  // "1 - 1", "1 - 2"
    dialogItem.received_qty,
    dialogItem.storage_location_id,
    dialogItem.location_id,
    dialogItem.line_remark_1, dialogItem.line_remark_2, dialogItem.line_remark_3,
    "No",                                 // is_split
    "Child",                              // parent_or_child
    index,                                // parent_index
    dialogItem.select_serial_number || [],
  );
  latestTableGR.push(childItem);
}
```

**Mode B: Parallel / Split-Parent (`is_parent_split === 1`)**

Replaces the original row with N independent Split-Parent rows.

```javascript
const baseLineIndex = grItem.parent_index + 1;
for (const [dialogLineIndex, dialogItem] of tableSplit.entries()) {
  const letterSuffix = getLetterSuffix(dialogLineIndex);
  const splitParentItem = setGrItemData(
    grItem,
    `${baseLineIndex}-${letterSuffix}`,   // "1-A", "1-B"  (NO spaces around hyphen)
    dialogItem.received_qty,
    dialogItem.storage_location_id,
    dialogItem.location_id,
    dialogItem.line_remark_1, dialogItem.line_remark_2, dialogItem.line_remark_3,
    "Yes",                                // is_split
    "Split-Parent",                       // parent_or_child
    index,                                // parent_index
    dialogItem.select_serial_number || [],
    index,                                // split_source_index
  );
  latestTableGR.push(splitParentItem);
}
```

> ⚠️ **`line_index` format differs between modes**: Hierarchy uses `"N - M"` (with spaces), Parallel uses `"N-A"` (no spaces).

**Other rows are preserved unchanged** but rebuilt via `setGrItemData` — this prevents shared object references between rows from breaking reactivity / row identity. Mobile must do the same: don't share references between rows in `table_gr`.

**Apply field locks per row** after writing `latestTableGR`:

```javascript
for (const [index, grItem] of updatedTableGR.entries()) {
  if (grItem.is_split === "Yes" && grItem.parent_or_child === "Parent") {
    // Disable most fields for split parent, but keep editable:
    // - item_batch_no (if manually entered)
    // - manufacturing_date / expired_date
    // (user fills these on parent, children inherit them)
    disable([
      `table_gr.${index}.received_qty`,
      `table_gr.${index}.base_received_qty`,
      `table_gr.${index}.storage_location_id`,
      `table_gr.${index}.location_id`,
      `table_gr.${index}.line_remark_1`,
      `table_gr.${index}.line_remark_2`,
      `table_gr.${index}.line_remark_3`,
      `table_gr.${index}.select_serial_number`,
      `table_gr.${index}.inv_category`,
    ]);
    table_gr[index].storage_location_id = "";
    table_gr[index].location_id = "";

  } else if (grItem.parent_or_child === "Split-Parent") {
    // Split-Parent: behaves like regular row but cannot re-split
    disable([`table_gr.${index}.button_split`]);
    enable([
      `table_gr.${index}.received_qty`,
      `table_gr.${index}.base_received_qty`,
      `table_gr.${index}.storage_location_id`,
      `table_gr.${index}.location_id`,
      `table_gr.${index}.line_remark_1`,
      `table_gr.${index}.line_remark_2`,
      `table_gr.${index}.line_remark_3`,
      `table_gr.${index}.inv_category`,
    ]);

    // Batch field: enabled only for manual-entry batch items ("").
    // "-" and "Auto-generated batch number" stay disabled.
    const isManualBatch = grItem.item_batch_no === "" && grItem.item_id;
    setDisabled(`table_gr.${index}.item_batch_no`, !isManualBatch);

    // mfg/exp dates: disabled for non-batch items
    const isNonBatch = grItem.item_batch_no === "-";
    setDisabled([
      `table_gr.${index}.manufacturing_date`,
      `table_gr.${index}.expired_date`,
    ], isNonBatch);

    if (grItem.is_serialized_item === 1) {
      enable([
        `table_gr.${index}.select_serial_number`,
        `table_gr.${index}.received_qty`,
      ]);
    }

  } else if (grItem.parent_or_child === "Child") {
    disable([`table_gr.${index}.button_split`]);
    disable([
      `table_gr.${index}.item_batch_no`,
      `table_gr.${index}.manufacturing_date`,
      `table_gr.${index}.expired_date`,
    ]);
    if (grItem.is_serialized_item === 1) {
      disable([
        `table_gr.${index}.select_serial_number`,
        `table_gr.${index}.received_qty`,
      ]);
    }

  } else {
    // Regular non-split row - enable split button
    enable([`table_gr.${index}.button_split`]);
    if (grItem.is_serialized_item === 1) {
      enable([
        `table_gr.${index}.select_serial_number`,
        `table_gr.${index}.received_qty`,
      ]);
    }
  }
}
```

### 4.6 Cancelling a split

Invoked from `confirm_split_dialog`:

```javascript
if (isSplit === "Yes") {
  // Re-enable fields on the source row
  enable([
    `table_gr.${rowIndex}.received_qty`,
    `table_gr.${rowIndex}.storage_location_id`,
    `table_gr.${rowIndex}.location_id`,
    `table_gr.${rowIndex}.line_remark_1`,
    `table_gr.${rowIndex}.line_remark_2`,
    `table_gr.${rowIndex}.line_remark_3`,
  ]);
  table_gr[rowIndex].is_split = "No";
}

// Re-enable split button on Parent rows; keep disabled on Children
for (const [index, row] of tableGR.entries()) {
  if (row.parent_or_child === "Child") {
    disable(`table_gr.${index}.button_split`);
  } else {
    enable(`table_gr.${index}.button_split`);
  }
}
```

> ⚠️ **Cancel only flips `is_split` flag and re-enables fields. It does NOT remove children/split-parents from `table_gr`.** That happens via the `clear_split` flow when re-opening the split dialog (§4.2).

---

## 5. Handling Unit Flow

### 5.1 Open HU dialog

**Pre-check (auto-fill received_qty from to_received_qty if zero):**
```javascript
let receivedQty = grItem.received_qty || 0;
if (receivedQty <= 0) {
  receivedQty = grItem.to_received_qty || 0;
  table_gr[rowIndex].received_qty = receivedQty;
}
if (receivedQty <= 0) {
  // Error: "Unable to select handling unit when received quantity is 0 or less."
  return;
}
```

**Loading bay resolution (in order):**

Step 1 — query `putaway_setup` for plant's `default_loading_bay`:
```javascript
const resPutawaySetup = await db
  .collection("putaway_setup")
  .where({
    plant_id: data.plant_id,
    is_deleted: 0,
    movement_type: "Good Receiving",
  })
  .get();

if (resPutawaySetup?.data?.length > 0) {
  loadingBayLocationId = resPutawaySetup.data[0].default_loading_bay || "";
}
```

Step 2 — fallback to default Loading Bay storage location's default bin:
```javascript
if (!loadingBayLocationId) {
  const resStorageLocation = await db
    .collection("storage_location")
    .where({
      plant_id: data.plant_id,
      storage_status: 1,
      location_type: "Loading Bay",
      is_default: 1,
    })
    .get();

  if (resStorageLocation?.data?.length > 0) {
    const defaultBin = resStorageLocation.data[0].table_bin_location?.find(
      (bin) => bin.is_default_bin === 1,
    );
    if (defaultBin) loadingBayLocationId = defaultBin.bin_location_id;
  }
}
```

Step 3 — if neither found, open dialog with no pre-loaded HUs (user must add manually).

**HU query (scoped by plant + organization + loading bay):**
```javascript
const responseHU = await db
  .collection("handling_unit")
  .where({
    plant_id: data.plant_id,
    organization_id: data.organization_id,
    location_id: loadingBayLocationId,
  })
  .get();

const huData = responseHU.data.map((item, index) => ({
  handling_unit_id: item.id,
  store_in_quantity: 0,
  line_index: index,
  ...item,
}));
```

**Merge with previously saved HUs (preserves user's edits):**
```javascript
const tempHUdata = JSON.parse(grItem.temp_hu_data || "[]");
let combinedHUdata = [];

if (tempHUdata.length > 0) {
  // Separate by source
  const existingHUsFromTemp = tempHUdata.filter((hu) => hu.handling_unit_id);
  const newHUsFromUser = tempHUdata.filter((hu) => !hu.handling_unit_id);

  // Build lookup of existing HUs from tempHUdata
  const tempHUMap = {};
  existingHUsFromTemp.forEach((hu) => { tempHUMap[hu.handling_unit_id] = hu; });

  // Use tempHU values when present (preserves user's store_in_quantity)
  combinedHUdata = huData.map((hu, index) => {
    if (tempHUMap[hu.handling_unit_id]) {
      return { ...tempHUMap[hu.handling_unit_id], line_index: index };
    }
    return { ...hu, line_index: index };
  });

  // Append user-created HUs at end
  let maxLineIndex = combinedHUdata.length;
  newHUsFromUser.forEach((hu) => {
    combinedHUdata.push({ ...hu, line_index: maxLineIndex });
    maxLineIndex++;
  });
} else {
  combinedHUdata = huData;
}
```

**Dialog data set:**
```javascript
hu_dialog.table_hu = combinedHUdata;
hu_dialog.item_id = grItem.item_id;
hu_dialog.item_name = grItem.item_name;
hu_dialog.received_qty = receivedQty;
hu_dialog.storage_location_id = grItem.storage_location_id;
hu_dialog.location_id = grItem.location_id;
hu_dialog.rowIndex = rowIndex;
```

### 5.2 Adding a new HU row

```javascript
hu_dialog.table_hu[rowIndex].line_index = rowIndex;

enable([
  `hu_dialog.table_hu.${rowIndex}.handling_no`,
  `hu_dialog.table_hu.${rowIndex}.hu_material_id`,
  `hu_dialog.table_hu.${rowIndex}.gross_weight`,
  `hu_dialog.table_hu.${rowIndex}.net_weight`,
  `hu_dialog.table_hu.${rowIndex}.remark`,
]);
```

> 📌 Only newly added rows have these fields editable. Existing HU rows (loaded from DB) keep these read-only.

### 5.3 Confirm HU selection

**Filter & validate:**
```javascript
const confirmedHUs = tableHU.filter(
  (hu) => parseFloat(hu.store_in_quantity) > 0,
);
const totalStoreInQty = confirmedHUs.reduce(
  (sum, hu) => sum + (parseFloat(hu.store_in_quantity) || 0), 0,
);

const missingMaterialHUs = confirmedHUs.filter((hu) => !hu.hu_material_id);
if (missingMaterialHUs.length > 0) {
  // Warning: "Please select a material for all handling units with store in quantity."
  return;
}

if (totalStoreInQty > receivedQty) {
  // Warning: "Total store in quantity ({totalStoreInQty}) cannot exceed received quantity ({receivedQty})."
  return;
}
```

**Decide if split is needed:**
```javascript
const remainingQty = parseFloat((receivedQty - totalStoreInQty).toFixed(3));
const needsSplit = confirmedHUs.length > 1 || remainingQty > 0;
```

**Confirm dialog for partial coverage:**
If `remainingQty > 0` and `totalStoreInQty > 0`, prompt user:

> "Total HU quantity ({totalStoreInQty}) is less than received quantity ({receivedQty}). A new line with {remainingQty} without HU will be created. Continue?"

If user cancels, abort.

**Path A: No split — single HU == receivedQty exactly:**
```javascript
table_gr[rowIndex].temp_hu_data = JSON.stringify(confirmedHUs);
table_gr[rowIndex].view_hu = await formatViewHU(confirmedHUs);
hu_dialog.table_hu = [];
closeDialog("hu_dialog");
```

**Path B: Split — current row is a Child:**
- First HU goes to current child row (in place; updates its `temp_hu_data`)
- Additional HUs become **sibling children** under the same parent
- `nextChildNum` continues from the existing child count: `nextChildNum = existingChildren.length + 1`
- If `remainingQty > 0`, append one more sibling Child with `temp_hu_data: "[]"`

**Path C: Split — current row is Regular/Parent:**
- Original row replaced by: 1 Parent + 1 Child per HU + optional remainder Child (no HU)

```javascript
// Parent row
latestTableGR.push(buildGrRow(
  item,
  parentIndex + 1,
  receivedQty,
  "", "",
  "Yes", "Parent", parentIndex,
  "[]", "",
));

// One child per HU
let childNum = 1;
for (const hu of confirmedHUs) {
  const huQty = parseFloat(hu.store_in_quantity) || 0;
  latestTableGR.push(buildGrRow(
    item,
    `${parentIndex + 1} - ${childNum}`,
    huQty,
    storageLocationId, locationId,
    "No", "Child", parentIndex,
    JSON.stringify([hu]),
    await formatViewHU([hu]),
  ));
  childNum++;
}

// Remainder child (no HU)
if (remainingQty > 0) {
  latestTableGR.push(buildGrRow(
    item,
    `${parentIndex + 1} - ${childNum}`,
    remainingQty,
    storageLocationId, locationId,
    "No", "Child", parentIndex,
    "[]", "",
  ));
}
```

**`view_hu` format:**
```
{handling_no}: {qty} qty
[HU Material: {material_code}]
```
where `material_code` is fetched from `Item` collection by `hu_material_id`. If no material, show only the first line. If `huArray` is empty, return `""`.

```javascript
const formatViewHU = async (huArray) => {
  if (!huArray || huArray.length === 0) return "";
  const hu = huArray[0];
  const huName = hu.handling_no || hu.handling_unit_id || "New HU";
  const qty = hu.store_in_quantity || 0;

  let materialCode = "";
  if (hu.hu_material_id) {
    const res = await db.collection("Item").where({ id: hu.hu_material_id }).get();
    materialCode = res.data?.[0]?.material_code || hu.hu_material_id;
  }

  let result = `${huName}: ${qty} qty`;
  if (materialCode) result += `\n[HU Material: ${materialCode}]`;
  return result;
};
```

> 📌 **Build all rows explicitly (no spread)** — children's `ordered_qty`, `base_ordered_qty`, `initial_received_qty` must be set to `0`. Mobile that uses reactive frameworks must avoid sharing object references between rows in `table_gr`.

**Apply field locks per row** after writing `latestTableGR`. The HU split's lock pass is simpler than the manual split's (no Split-Parent branch since HU split never produces Split-Parents):

```javascript
for (const [index, item] of updatedTableGR.entries()) {
  if (item.is_split === "Yes" && item.parent_or_child === "Parent") {
    disable([
      `table_gr.${index}.received_qty`,
      `table_gr.${index}.base_received_qty`,
      `table_gr.${index}.storage_location_id`,
      `table_gr.${index}.location_id`,
      `table_gr.${index}.select_serial_number`,
      `table_gr.${index}.inv_category`,
      `table_gr.${index}.button_hu`,
    ]);
  } else if (item.parent_or_child === "Child") {
    disable([`table_gr.${index}.button_split`]);
    disable([
      `table_gr.${index}.item_batch_no`,
      `table_gr.${index}.manufacturing_date`,
      `table_gr.${index}.expired_date`,
    ]);
  }
}
```

---

## 6. Field Visibility & Lock Matrix

### 6.1 Lock matrix by row state (after split)

| Field | Regular | Hierarchy Parent | Hierarchy Child | Split-Parent | After HU split (Parent) | After HU split (Child) |
|-------|---------|------------------|-----------------|--------------|-------------------------|------------------------|
| `received_qty` | ✏️ | 🔒 | 🔒 (if serialized; else 🔒 from child rule) | ✏️ | 🔒 | (not explicitly locked; status-based) |
| `base_received_qty` | ✏️ | 🔒 | — | ✏️ | 🔒 | — |
| `storage_location_id` | ✏️ | 🔒 (cleared to `""`) | — | ✏️ | 🔒 (cleared to `""`) | — |
| `location_id` | ✏️ | 🔒 (cleared to `""`) | — | ✏️ | 🔒 (cleared to `""`) | — |
| `select_serial_number` | ✏️ if `is_serialized_item===1` | 🔒 | 🔒 (if serialized) | ✏️ (if serialized) | 🔒 | — |
| `inv_category` | ✏️ | 🔒 | — | ✏️ | 🔒 | — |
| `button_hu` | ✏️ (gated on `putaway_setup.show_hu`) | — | — | — | 🔒 | — |
| `button_split` | ✏️ | ✏️ (re-split allowed) | 🔒 | 🔒 | — | 🔒 |
| `item_batch_no` | depends on sentinel | ✏️ (parent fills, children inherit) | 🔒 | ✏️ (only if `""` sentinel) | — | 🔒 |
| `manufacturing_date` | depends on `item_batch_no` | ✏️ | 🔒 | 🔒 (if `item_batch_no === "-"`); ✏️ otherwise | — | 🔒 |
| `expired_date` | depends on `item_batch_no` | ✏️ | 🔒 | 🔒 (if `item_batch_no === "-"`); ✏️ otherwise | — | 🔒 |
| `line_remark_1/2/3` | ✏️ | 🔒 | ✏️ | ✏️ | (not explicitly locked) | (not explicitly locked) |

### 6.2 Item-flag-driven visibility (independent of split state)

| Rule | Effect |
|------|--------|
| `is_serialized_item === 1` | Show `select_serial_number`; **disable `received_qty`** (qty derived from serial count) |
| `item_batch_no === "-"` | Hide & disable `manufacturing_date` and `expired_date` |
| `item_batch_no` not in `["-", "Auto-generated batch number"]` | Show `manufacturing_date` and `expired_date`; editable in **Draft only** |
| `item_uom !== base_item_uom` | Show base UOM columns (`base_ordered_qty`, `base_received_qty`, etc.) |
| `putaway_setup.show_hu === 1` | Show `select_hu` and `view_hu` buttons on each row |
| `putaway_setup.putaway_required === 1` | Show `assigned_to` header field |

### 6.3 Status-driven locks

| Status | Header fields | Line items | Batch fields | Buttons shown |
|--------|---------------|------------|--------------|---------------|
| **Draft** | ✏️ all | ✏️ all | ✏️ if not sentinel | save_as_draft, save_as_comp |
| **Created** | 🔒 org/PO/supplier/plant; ✏️ everything else | ✏️ | ✏️ if not in `["-", "Auto-generated batch number"]` | save_as_created, save_as_comp |
| **Received** | 🔒 all | 🔒 | 🔒 | completed |
| **Completed** | 🔒 all | 🔒 | 🔒 | (none) |

---

## 7. Validation Rules & Tolerance Math

### 7.1 Manual split

```
totalSplitQty = sum(table_split[].received_qty)
maxAllowedQty = toReceivedQty * (100 + over_receive_tolerance) / 100

assert totalSplitQty > 0
assert totalSplitQty <= maxAllowedQty
```

`over_receive_tolerance` is fetched per-item from the `Item` collection. Default `0`.

### 7.2 HU split

```
totalStoreInQty = sum(table_hu[].store_in_quantity where > 0)

assert all(hu.hu_material_id != null) for hu where store_in_quantity > 0
assert totalStoreInQty <= receivedQty   # Note: HU does NOT use tolerance; manual split does
```

### 7.3 Serialized items

```
# Manual split
assert no_of_split <= toReceivedQty

# Each split row
received_qty = derived from serial count (input disabled)
```

### 7.4 Required-on-confirm fields

| Mechanism | Field | Required when |
|-----------|-------|---------------|
| Manual split | `received_qty` | Always per row (must sum > 0) |
| Manual split | `storage_location_id`, `location_id` | Per row (set per child/split-parent) |
| HU dialog | `hu_material_id` | If `store_in_quantity > 0` |
| HU dialog | `store_in_quantity` | At least one row > 0 |
| Manual split + batch | `manufacturing_date`, `expired_date` | When `item_batch_no` not in `["-", "Auto-generated batch number"]` |

### 7.5 Decimal precision rule

**All quantities use `parseFloat(x.toFixed(3))`.** Never compare floats directly; always round first. Mismatch by ≥ 0.001 will fail validation.

---

## 8. Edge Cases & Gotchas

### 8.1 HU data wiped on manual split

When user clicks Split on a row that already has `temp_hu_data`, the system warns and clears it. Mobile must surface the same warning, not silently overwrite.

### 8.2 Always-create-remainder-child

Even when there's just one HU and it has partial coverage, a sibling Child row is created with `temp_hu_data: "[]"` and qty = `remainingQty`. The user is prompted first.

### 8.3 Deep copy on every `table_gr` rebuild

Both flows explicitly rebuild **all** rows (including untouched ones) via the helper functions. Reason: the platform's reactive system treats shared object references as the same row. Mobile that doesn't share refs may skip this — but if you use Vue/MobX/Redux with proxies, you must replicate it.

### 8.4 `line_index` string format gotchas

| Mode | Format | Example |
|------|--------|---------|
| Hierarchy Child (manual or HU) | `"N - M"` (space-hyphen-space) | `"1 - 1"`, `"1 - 2"` |
| Split-Parent (manual) | `"N-A"` (no spaces, letter) | `"1-A"`, `"1-B"`, `"1-Z"`, `"1-AA"` |

A regex like `/^\d+ - \d+$/` for children and `/^\d+-[A-Z]+$/` for split-parents can disambiguate. The workflow's grouping breaks if these strings drift.

### 8.5 Loading bay fallback

If `putaway_setup` for the plant has no `default_loading_bay`, the system falls back to the default `Loading Bay` storage location's default bin. If that's also missing, the dialog opens without pre-loaded HUs — the user adds them manually.

### 8.6 `from_convert === "Yes"` triggers extra init

In Edit mode, if `from_convert === "Yes"` (GR was converted from another doc like a PO), `func_processGRLineItem` and `onChange_Supplier` events are re-triggered. Mobile must call the same downstream handlers in conversion-from-other-docs flows.

### 8.7 Created-status `to_received_qty` quirk

For Created GRs, `to_received_qty = orderQty - receivedQty - currentGRQty` so the user doesn't see their own qty as "already received." Overcommitment warnings appear on save, not on form display.

### 8.8 Cancel split doesn't remove rows

Cancel only flips `is_split` to `"No"` and re-enables fields. The Children/Split-Parent rows **remain in `table_gr`**. Removal happens on next split via the clear-split filter (§4.2). Mobile must mirror this — don't auto-delete rows on cancel.

### 8.9 Batch sentinels

| Value | Meaning | Splitting behavior |
|-------|---------|-------------------|
| `"-"` | Non-batch item | `manufacturing_date`/`expired_date` always disabled; not editable post-split |
| `"Auto-generated batch number"` | Backend assigns batch on save | Stays locked even on Split-Parent |
| `""` (empty) | Manual entry pending | Editable on Split-Parent |
| any other string | User-set batch | Inherited by children; disabled |

The split helper clears the manual batch on Split-Parent rows but preserves the two sentinels (`"-"` and `"Auto-generated batch number"`).

### 8.10 HU number uniqueness

The web form does **not** validate HU `handling_no` uniqueness when adding new HUs in the dialog. Mobile should match this — the workflow handles dedup on save.

---

## 9. Mobile Porting Checklist

Use this as a smoke test for parity with the web app.

### Schema parity
- [ ] `table_gr` row produced by mobile contains exact same field names as §2.1
- [ ] `temp_hu_data` is **always a JSON string**, never an array (`"[]"` / `JSON.stringify([...])`)
- [ ] `view_hu` matches the format `"{handling_no}: {qty} qty\n[HU Material: {material_code}]"`
- [ ] `is_split` is `"Yes"` / `"No"` strings (not booleans)
- [ ] `parent_or_child` is `"Parent"` / `"Child"` / `"Split-Parent"` / `null`

### Quantity math
- [ ] Mirrors §3 formulas, including the Created-status subtraction
- [ ] All quantities rounded with `parseFloat(x.toFixed(3))` before any comparison
- [ ] Children get `ordered_qty=0`, `base_ordered_qty=0`, `initial_received_qty=0`
- [ ] Parent's `received_qty = sum(children[].received_qty)`
- [ ] Split-Parent's `to_received_qty = ordered_qty - initial_received_qty - received_qty` (note the extra subtraction vs Parent)

### Manual split
- [ ] Split button blocked when `to_received_qty <= 0`
- [ ] HU warning fires before clearing `temp_hu_data`
- [ ] Both modes (`is_parent_split === 0` hierarchy / `=== 1` parallel) supported
- [ ] Hierarchy children: `line_index = "${parent_index + 1} - ${childNum}"` (with spaces)
- [ ] Split-Parents: `line_index = "${parent_index + 1}-${getLetterSuffix(N)}"` (no spaces, letter)
- [ ] `getLetterSuffix(0..25) = "A".."Z"`, `26 = "AA"`, `27 = "AB"`, ...
- [ ] Tolerance fetched from `Item.over_receive_tolerance` before validation
- [ ] `totalSplitQty <= toReceivedQty * (100 + tolerance) / 100`

### HU dialog
- [ ] `received_qty <= 0` blocks dialog open (or auto-fills from `to_received_qty`)
- [ ] Loading bay resolution: `putaway_setup.default_loading_bay` → fallback to `storage_location` Loading Bay default bin → no pre-load
- [ ] HU query scoped by `plant_id + organization_id + location_id`
- [ ] Existing-HU + new-HU merge preserves user's `store_in_quantity`
- [ ] No-split path (single HU == receivedQty exactly): only writes `temp_hu_data` and `view_hu`, doesn't restructure `table_gr`
- [ ] Split path: 1 Parent + N Children + optional remainder Child
- [ ] Remainder Child carries `temp_hu_data: "[]"`

### Field locks
- [ ] §6.1 lock matrix applied after every state transition
- [ ] Cancel-split re-enables the locked fields and flips `is_split` to `"No"`
- [ ] Cancel-split does **not** remove children — that's the clear-split filter on next dialog open
- [ ] Item-flag rules in §6.2 applied at form load and on every row mutation

### Sentinels
- [ ] `item_batch_no === "-"` keeps `manufacturing_date`/`expired_date` disabled forever
- [ ] `item_batch_no === "Auto-generated batch number"` stays locked even on Split-Parent
- [ ] Manual batches (`""`) become editable per Split-Parent row

### Reference checks (do these last)
- [ ] Spot-check 5 random web-app GR records → each row from mobile produces identical `table_gr` JSON
- [ ] Walk through both split modes with a known input; compare to expected output
- [ ] Walk through HU dialog with 1 HU == qty (no split) and with 2 HUs + remainder (full split); compare to expected output
- [ ] Run a save → verify backend workflow accepts the `table_gr` shape
