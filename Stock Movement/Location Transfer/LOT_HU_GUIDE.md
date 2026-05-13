# Location Transfer — HU Integration Guide

> **Audience:** mobile engineers who have already implemented GD ([Goods Delivery/GD_HU_AND_AUTO_ALLOCATION_GUIDE.md](../../Goods%20Delivery/GD_HU_AND_AUTO_ALLOCATION_GUIDE.md)) and MSI ([Misc Issue/MSI_HU_GUIDE.md](../Misc%20Issue/MSI_HU_GUIDE.md)). This guide is a **delta** off the MSI guide — almost everything is the same; the differences are concentrated in the open-dialog HU loading rules.
>
> **Source files covered (full code in Part 8):**
> 1. `LOTopenDialog.js`
> 2. `LOTconfirmDialog.js`

---

## Table of Contents

1. [Orientation](#part-1--orientation)
2. [What's the Same as MSI](#part-2--whats-the-same-as-msi)
3. [What's Different from MSI](#part-3--whats-different-from-msi)
4. [LOTopenDialog Walkthrough](#part-4--lotopendialog-walkthrough)
5. [LOTconfirmDialog Walkthrough](#part-5--lotconfirmdialog-walkthrough)
6. [Mobile Cheat Sheet](#part-6--mobile-cheat-sheet)
7. [Edge Cases](#part-7--edge-cases)
8. [Full Source Code](#part-8--full-source-code)

---

## Part 1 — Orientation

**Location Transfer (LOT)** moves inventory between bin locations within the same plant. The source-side stock selection is what these two files do; the destination is set on the `stock_movement` line itself (outside this guide).

LOT is structurally a "stock-out from one location" — almost identical to MSI in everything except the HU loading rules and the `temp_hu_data` re-hydration mechanic. The key difference: **LOT enforces NO_SPLIT** (whole-HU pick via `hu_select` checkbox), where MSI uses ALLOW_SPLIT (per-item qty editing).

### The two files

| File | Role |
|---|---|
| [LOTopenDialog.js](LOTopenDialog.js) | Opens the inventory dialog. Sequential async helpers (NOT optimized — fetches `handling_unit` twice). Loads HUs with the "no mixed-item" rule and NO_SPLIT UI defaults. |
| [LOTconfirmDialog.js](LOTconfirmDialog.js) | On Confirm: validates and persists. **Effectively identical to MSIconfirmDialog.js** — same UOM normalisation, same category-based validation, same cross-row serial dup check, same persistence shape. |

> An optimized variant `LOTopenDialogOptimized.js` exists in the folder but isn't covered here. This guide tracks the currently-deployed file.

### End-to-end flow

```mermaid
flowchart TD
    A[User clicks line in stock_movement] --> B[LOTopenDialog]
    B -->|"Sequential: Item → on_reserved_gd → HUs → balance"| C[applyLooseDeduction]
    C --> D[fetchHandlingUnits<br/>NO_SPLIT + no-mixed-item rule]
    D --> E{User ticks hu_select<br/>on whole HUs<br/>(or sets sm_quantity on loose)}
    E --> F[Confirm]
    F --> G[LOTconfirmDialog<br/>same as MSI confirm]
    G --> H[Persist temp_qty_data,<br/>temp_hu_data, stock_summary,<br/>total_quantity]
```

---

## Part 2 — What's the Same as MSI

Read the MSI guide for these:

| Concept | Reference |
|---|---|
| Form-level field names: `stock_movement`, `sm_quantity`, `item_selection`, `quantity_uom`, `issuing_operation_faci`, `stock_summary`, `error_message` | MSI guide Δ5 |
| HU header/item row shape | MSI guide Part 2 |
| HU-qty deduction from loose balance (`fetchHuQtyByLocation`) | MSI guide Part 4, step 6 |
| `on_reserved_gd` full HU exclusion via `reservedHuIds`, loose-reserved subtraction from `unrestricted_qty` / `balance_quantity` | MSI guide Δ1 |
| Category dimension (`Unrestricted` / `Reserved` / `Quality Inspection` / `Blocked` / `In Transit`); HU items hardcoded to `Unrestricted` | MSI guide Δ2 |
| Loose tab filter to rows with `unrestricted_qty > 0 OR block_qty > 0` | MSI guide Δ2 |
| UOM dual-universe + back-conversion on Confirm | GD guide Part 6 |
| Cross-row serial duplicate detection on Confirm | MSI guide Δ4 |
| Persist shape: `temp_qty_data` (loose + HU mixed, HU rows carry `handling_unit_id`) + `temp_hu_data` (raw HU rows for re-render) + `stock_summary` (display string) | MSI guide Δ5, Part 5 step 9 |
| `dialog_expired_date` → `expired_date` rename on persist | MSI guide Part 7 |
| Hidden columns `category_from`, `category_to` (designed for transfer dialogs but currently hidden in LOT too) | MSI guide Δ2 |

---

## Part 3 — What's Different from MSI

### Δ1 — NO_SPLIT instead of ALLOW_SPLIT

LOT picks **whole HUs**, not per-item quantities inside an HU. The `hu_select` checkbox on the HU header row is the picker; the user can't directly type `sm_quantity` on any HU row.

| Behavior | MSI (ALLOW_SPLIT) | LOT (NO_SPLIT) |
|---|---|---|
| `hu_select` column | Hidden | **Visible** |
| `sm_quantity` on header rows | Disabled (summary only) | Disabled |
| `sm_quantity` on item rows | **Editable** | Disabled |
| `hu_select` on item rows | N/A (column hidden) | Disabled (header-only checkbox) |
| HU pick mechanic | Type qty per item | Tick `hu_select` on header → platform-side handler sets `sm_quantity = item_quantity` on every item in that HU |

### Δ2 — "No mixed-item HU" rule

In MSI's `buildHandlingUnits`, items inside an HU are filtered down to those matching the current material — foreign items are silently hidden.

LOT is stricter: an HU is shown only if **every** active item matches the current material. From `LOTopenDialog.js` `fetchHandlingUnits`:

```js
const allActiveItems = (hu.table_hu_items || []).filter(
  (item) => item.is_deleted !== 1,
);
if (allActiveItems.length === 0) continue;

// No mixed-item HUs: skip if any active item is a different material
const allMatch = allActiveItems.every(
  (item) => item.material_id === matId,
);
if (!allMatch) continue;
```

So an HU containing both Material A and Material B will appear in MSI's dialog when you pick Material A (with B hidden), but in LOT's dialog the entire HU is excluded for both A and B picks. The rationale: NO_SPLIT means committing the whole HU, and you can't move stock you're not supposed to touch.

### Δ3 — Restore both `sm_quantity` AND `hu_select` on reopen

MSI restores only `sm_quantity` from `temp_hu_data` (no `hu_select` to restore since the column is hidden).

LOT additionally re-ticks the `hu_select` checkbox on header rows whose HU has any restored allocation:

```js
const huIdsWithAllocation = new Set();
for (const tempItem of parsedTempHu) {
  if (tempItem.row_type !== "item") continue;
  const match = filtered.find(...);
  if (match) {
    match.sm_quantity = tempItem.sm_quantity || 0;
    if (match.sm_quantity > 0) {
      huIdsWithAllocation.add(tempItem.handling_unit_id);
    }
  }
}

// LOT enforces NO_SPLIT: set hu_select = 1 on headers whose HU has any
// restored allocation, so the checkbox state matches the item rows.
if (huIdsWithAllocation.size > 0) {
  for (const row of filtered) {
    if (
      row.row_type === "header" &&
      huIdsWithAllocation.has(row.handling_unit_id)
    ) {
      row.hu_select = 1;
    }
  }
}
```

### Δ4 — `LOTopenDialog.js` is partially optimized

This file is between the raw "1.0" pattern and `LOTopenDialogOptimized.js`:

| Optimization | LOTopenDialog (this file) | LOTopenDialogOptimized |
|---|---|---|
| 5000-cap bypass via `handling_unit_atu7sreg_sub` | ✅ Applied | ✅ Applied |
| Single shared HU fetch | ❌ Each helper (`fetchHuQtyByLocation`, `fetchHandlingUnits`) issues its own sub + parent query — TWO sets of HU queries per dialog open | ✅ One shared fetch inside `Promise.all`, consumed by sync builders |
| `fetchUomData` as single `in` query | ❌ N parallel `.where({id})` calls | ✅ One `in` filter |
| Top-level parallelization | ❌ Sequential: Item → reservations → balance → HUs | ✅ `Promise.all` batches UOM / reservations / HUs / balance |
| Sync vs async builders | `fetchHandlingUnits`, `fetchHuQtyByLocation`, `applyLooseDeduction` are all `async` | Builders are sync; only the top-level fetch is async |

For mobile, **mirror the logic, not the structure**. Use whatever batching / parallelization fits the device.

### Δ5 — No optimizations in disable loop

MSI builds a single `disabledPaths` array and calls `this.disabled(disabledPaths, true)` once. LOT calls `this.disabled([...], true)` inside a per-row `.forEach` loop ([LOTopenDialog.js line 706-711](LOTopenDialog.js#L706-L711)). Same end behaviour, just slower at scale. Mobile doesn't need to match this — batch disables on your platform if cheap.

### Δ6 — LOTconfirmDialog is effectively identical to MSIconfirmDialog

Step-for-step identical. The only practical differences:
- LOT's confirm reads `item.category ?? item.category_from` ([line 140](LOTconfirmDialog.js#L140)) — same as MSI. Falls back to `category_from` if `category` is missing (legacy compat).
- No other behavioural differences. The serial dup check, HU validation, category check, summary builder, persistence — all mirror MSI.

If you've already written the MSI Confirm logic on mobile, **the LOT Confirm reuses it as-is**. Just point the same function at the LOT row's data.

---

## Part 4 — LOTopenDialog Walkthrough

In execution order. Only LOT-specific notes; everything else mirrors the MSI guide.

1. **Hide MSI-irrelevant columns** ([line 448-452](LOTopenDialog.js#L448-L452)) — `category_from`, `category_to`, `serial_number`. **NOTE: `hu_select` is NOT hidden** (the LOT difference from MSI).

2. **Reset tables + clear default `category`** ([line 455-459](LOTopenDialog.js#L455-L459)).

3. **Fetch Item** ([line 461-471](LOTopenDialog.js#L461-L471)), determine `isSerial`, `isBatchManaged`.

4. **Sequential fetches** (not parallelized; mobile should `Promise.all` them):
   - `unit_of_measurement` per alt UOM (N parallel queries — mobile should switch to one `in` filter).
   - `on_reserved_gd` scoped to plant/org/material ([line 495-511](LOTopenDialog.js#L495-L511)).
   - Build `reservedHuIds` + `looseReservedMap` from active reservations ([line 522-539](LOTopenDialog.js#L522-L539)).

5. **Per-flavor balance fetch + `applyLooseDeduction`** ([line 601-709](LOTopenDialog.js#L601-L709)). `applyLooseDeduction` internally calls `fetchHuQtyByLocation` which does sub-collection → scoped parent fetch ([line 174-238](LOTopenDialog.js#L174-L238)) — bypasses the 5000-row cap. Subtracts `huQty + reservedQty` from `unrestricted_qty` and `balance_quantity` per (location, batch) key. Skipped for serialized.

6. **`fetchHandlingUnits`** ([line 242-420](LOTopenDialog.js#L242-L420)):
   - **Sub-collection lookup first** ([line 253-289](LOTopenDialog.js#L253-L289)) — query `handling_unit_atu7sreg_sub` by `material_id`, collect candidate HU IDs, then fetch only those parents via `id: in [...]`. Bypasses 5000-cap.
   - Skip HUs in `reservedHuIdSet`.
   - **`allMatch` check** ([line 304-307](LOTopenDialog.js#L304-L307)) — skip HU unless every active item matches the current material.
   - Deduct `otherLinesHuAllocations.sm_quantity` per HU item.
   - Drop empty headers.
   - Restore `sm_quantity` from `temp_hu_data` + **re-tick `hu_select` on headers with restored allocations** ([line 402-413](LOTopenDialog.js#L402-L413), Δ3).

7. **HU table setData + disable loop** ([line 759-770](LOTopenDialog.js#L759-L770)):
   - Per-row `disabled([...sm_quantity], true)` on EVERY row.
   - For item rows, also `disabled([...hu_select], true)`.
   - Mobile should batch these into a single call.

8. **Tab visibility** — same as MSI/GD.

---

## Part 5 — LOTconfirmDialog Walkthrough

Identical to MSIconfirmDialog. Quick reference:

1. **Read state** — `temporaryData`, `huData`, `rowIndex`, `quantityUOM`, `selectedUOM`.
2. **UOM normalisation** — see MSI guide Part 5, step 2.
3. **HU row validation** — `sm_quantity <= item_quantity`.
4. **Loose row validation** — switch on `category ?? category_from`, validate against matching bucket.
5. **Sum `totalCombined` = loose + HU**, write to `stock_movement.${rowIndex}.total_quantity`.
6. **Cross-row serial dup check**.
7. **Build `stock_summary`** display string (same three layouts).
8. **Persist** — `combinedTempQty`, `temp_hu_data`, `stock_summary`, clear `error_message`, close dialog.

**Bug carried over from MSI**: the `formatLooseDetails` helper references `itemData` from outer closure scope ([line 349](LOTconfirmDialog.js#L349)). If the Item fetch at line 19-27 fails silently, `itemData` is `null` and the optional chaining `itemData?.serial_number_management` short-circuits to undefined — non-fatal but flag if mobile reimplements.

---

## Part 6 — Mobile Cheat Sheet

- [ ] LOT is NO_SPLIT — show `hu_select` checkbox on HU headers; users pick whole HUs, not per-item qtys.
- [ ] Apply the "no mixed-item HU" rule — exclude HUs that contain ANY item with a different `material_id` than the current line's material.
- [ ] Disable `sm_quantity` field on every HU row (header + item). The header checkbox is the only picker.
- [ ] Disable `hu_select` checkbox on item rows — only headers are clickable.
- [ ] When `hu_select` is ticked on a header, set `sm_quantity = item_quantity` on every item row in that HU (platform-side handler — implement as part of the checkbox change handler).
- [ ] On reopen from `temp_hu_data`: restore `sm_quantity` on item rows AND set `hu_select = 1` on the matching header rows where any restored item has `sm_quantity > 0`.
- [ ] Everything else (category buckets, serial dup check, on_reserved_gd exclusion, persist shape) is the same as MSI — reuse the mobile code you already wrote.
- [ ] The current desktop `LOTopenDialog.js` is NOT optimized; mobile should parallelize fetches and apply the `handling_unit_atu7sreg_sub` 5000-cap bypass anyway (see [LOTopenDialogOptimized.js](LOTopenDialogOptimized.js) for the pattern).

---

## Part 7 — Edge Cases

- **No-mixed-item rule is plant-wide.** An HU that the warehouse uses to consolidate Material A and Material B is invisible to LOT for both materials. Practical impact: warehouses that consolidate mixed materials into single HUs can't use LOT to move them — they have to use a different stock_movement type or unbundle first.

- **`hu_select` is platform-driven.** The `LOTopenDialog.js` source disables it on item rows and shows it on header rows, but doesn't wire up the "checking the box copies item_quantity into sm_quantity on every item" behaviour. That handler lives on the low-code platform's component side (separate file like `onChangeHuSelect.js` in the GD module). Mobile must implement this explicitly.

- **`hu_select` is form-state, not DB-persisted.** Persisted state is the `sm_quantity` on item rows; `hu_select = 1` on a header is reconstructed on reopen from "did any of this HU's items have sm_quantity > 0?". Don't add `hu_select` to your `temp_hu_data` payload — keep it derived.

- **Serial dup check still applies to whole-HU picks.** If two LOT rows tick the same HU (same handling_unit_id, same serial somewhere inside), the cross-row check will catch it via `temp_qty_data`'s HU entries.

- **5000-cap is already handled.** Both `fetchHuQtyByLocation` and `fetchHandlingUnits` already query `handling_unit_atu7sreg_sub` first and use the scoped `id: in [...]` filter on `handling_unit`. Mobile should mirror this pattern.

- **Category dropdown vs filter mismatch** — same as MSI Part 7 note. Dialog filters loose to `unrestricted_qty > 0 OR block_qty > 0`, but the category dropdown still shows the full set.

- **`error_message` is form-level** — same as MSI.

- **`stock_summary` is display-only** — same as MSI/GD.

---

## Part 8 — Full Source Code

### File 1 — `Stock Movement/Location Transfer/LOTopenDialog.js`

```js
(async () => {
  this.showLoading("Loading inventory data...");
  try {
    const allData = this.getValues();
    const lineItemData = arguments[0]?.row;
    const rowIndex = arguments[0]?.rowIndex;
    const plant_id = allData.issuing_operation_faci;
    const materialId = lineItemData.item_selection;
    const tempQtyData = lineItemData.temp_qty_data;
    const tempHuData = lineItemData.temp_hu_data;
    const quantityUOM = lineItemData.quantity_uom;
    const organizationId = allData.organization_id;

    if (!materialId) return;

  // ============= HELPERS =============

  const fetchUomData = async (uomIds) => {
    if (!uomIds || uomIds.length === 0) return [];
    try {
      const resUOM = await Promise.all(
        uomIds.map((id) =>
          db.collection("unit_of_measurement").where({ id }).get(),
        ),
      );
      return resUOM.map((response) => response.data[0]).filter(Boolean);
    } catch (error) {
      console.error("Error fetching UOM data:", error);
      return [];
    }
  };

  const convertBaseToAlt = (baseQty, itemData, altUOM) => {
    if (
      !baseQty ||
      !Array.isArray(itemData.table_uom_conversion) ||
      itemData.table_uom_conversion.length === 0 ||
      !altUOM
    ) {
      return baseQty || 0;
    }
    const uomConversion = itemData.table_uom_conversion.find(
      (c) => c.alt_uom_id === altUOM,
    );
    if (!uomConversion || !uomConversion.base_qty) return baseQty;
    return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
  };

  const parseJSON = (str) => {
    if (!str || str === "[]" || (typeof str === "string" && str.trim() === ""))
      return [];
    try {
      const parsed = JSON.parse(str);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const filterZeroQuantityRecords = (data, itemData) => {
    return data.filter((record) => {
      if (itemData.serial_number_management === 1) {
        const hasValidSerial =
          record.serial_number && record.serial_number.trim() !== "";
        if (!hasValidSerial) return false;
        return (
          (record.block_qty && record.block_qty > 0) ||
          (record.reserved_qty && record.reserved_qty > 0) ||
          (record.unrestricted_qty && record.unrestricted_qty > 0) ||
          (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
          (record.intransit_qty && record.intransit_qty > 0) ||
          (record.balance_quantity && record.balance_quantity > 0)
        );
      }
      return (
        (record.block_qty && record.block_qty > 0) ||
        (record.reserved_qty && record.reserved_qty > 0) ||
        (record.unrestricted_qty && record.unrestricted_qty > 0) ||
        (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
        (record.intransit_qty && record.intransit_qty > 0) ||
        (record.balance_quantity && record.balance_quantity > 0)
      );
    });
  };

  const generateKey = (item, itemData) => {
    if (itemData.serial_number_management === 1) {
      if (itemData.item_batch_management === 1) {
        return `${item.location_id || "no_location"}-${
          item.serial_number || "no_serial"
        }-${item.batch_id || "no_batch"}`;
      }
      return `${item.location_id || "no_location"}-${
        item.serial_number || "no_serial"
      }`;
    }
    if (itemData.item_batch_management === 1) {
      return `${item.location_id || "no_location"}-${
        item.batch_id || "no_batch"
      }`;
    }
    return `${item.location_id || item.balance_id || "no_key"}`;
  };

  const mergeWithTempData = (freshDbData, tempDataArray, itemData) => {
    if (!tempDataArray || tempDataArray.length === 0) {
      return freshDbData;
    }

    const tempDataMap = new Map(
      tempDataArray.map((tempItem) => [
        generateKey(tempItem, itemData),
        tempItem,
      ]),
    );

    const mergedData = freshDbData.map((dbItem) => {
      const key = generateKey(dbItem, itemData);
      const tempItem = tempDataMap.get(key);

      if (tempItem) {
        return {
          ...dbItem,
          ...tempItem,
          id: dbItem.id,
          balance_id: dbItem.id,
          fm_key: tempItem.fm_key,
          category: tempItem.category,
          sm_quantity: tempItem.sm_quantity,
          remarks: tempItem.remarks || dbItem.remarks,
        };
      }

      return {
        ...dbItem,
        balance_id: dbItem.id,
      };
    });

    tempDataArray.forEach((tempItem) => {
      const key = generateKey(tempItem, itemData);
      const existsInDb = freshDbData.some(
        (dbItem) => generateKey(dbItem, itemData) === key,
      );

      if (!existsInDb) {
        mergedData.push({
          ...tempItem,
          balance_id: tempItem.balance_id || tempItem.id,
        });
      }
    });

    return mergedData;
  };

  const mapBalanceData = (itemBalanceData) => {
    return Array.isArray(itemBalanceData)
      ? itemBalanceData.map((item) => {
          const { id, ...itemWithoutId } = item;
          return {
            ...itemWithoutId,
            balance_id: id,
          };
        })
      : (() => {
          const { id, ...itemWithoutId } = itemBalanceData;
          return { ...itemWithoutId, balance_id: id };
        })();
  };

  // Sum HU-bound qty by location/batch for current material — used to subtract
  // from loose item_balance display so the same physical stock isn't pickable both ways
  const fetchHuQtyByLocation = async (
    matId,
    plantId,
    orgId,
    isBatchManaged,
  ) => {
    try {
      // Query sub-collection by material — bypasses 5000-row cap on handling_unit
      const subRes = await db
        .collection("handling_unit_atu7sreg_sub")
        .where({ material_id: matId, is_deleted: 0 })
        .get();

      const subRows = subRes.data || [];
      if (subRows.length === 0) return new Map();

      // Fetch the relevant parent HUs (scoped by plant/org, for location fallback)
      const candidateHuIds = [
        ...new Set(subRows.map((r) => r.handling_unit_id).filter(Boolean)),
      ];

      const huRes = await db
        .collection("handling_unit")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "id", operator: "in", value: candidateHuIds },
              { prop: "plant_id", operator: "equal", value: plantId },
              {
                prop: "organization_id",
                operator: "equal",
                value: orgId,
              },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ])
        .get();

      const huLocationMap = new Map();
      for (const hu of huRes.data || []) {
        huLocationMap.set(hu.id, hu.location_id);
      }

      const huQtyMap = new Map();
      for (const item of subRows) {
        // Skip sub-rows whose parent HU isn't in this plant/org (or deleted)
        if (!huLocationMap.has(item.handling_unit_id)) continue;

        const locationId =
          item.location_id || huLocationMap.get(item.handling_unit_id);
        const key = isBatchManaged
          ? `${locationId}-${item.batch_id || "no_batch"}`
          : `${locationId}`;
        const qty = parseFloat(item.quantity) || 0;
        huQtyMap.set(key, (huQtyMap.get(key) || 0) + qty);
      }
      return huQtyMap;
    } catch (error) {
      console.error("Error fetching HU quantities:", error);
      return new Map();
    }
  };

  // Fetch HUs for the material. "No mixed item HU" rule: only show HUs whose every
  // active item matches the current row's material (foreign-item HUs are skipped).
  const fetchHandlingUnits = async (
    plantId,
    orgId,
    matId,
    tempHuStr,
    itemData,
    altUOM,
    otherLinesHuAllocations,
    reservedHuIdSet,
  ) => {
    try {
      // Find HU IDs containing this material via the flat sub-collection.
      // Avoids the 5000-row default cap on `handling_unit` when many HUs exist.
      const subRes = await db
        .collection("handling_unit_atu7sreg_sub")
        .where({ material_id: matId, is_deleted: 0 })
        .get();

      const candidateHuIds = [
        ...new Set(
          (subRes.data || []).map((r) => r.handling_unit_id).filter(Boolean),
        ),
      ];

      if (candidateHuIds.length === 0) {
        return [];
      }

      // Fetch only the HUs that contain this material — scoped by plant/org
      const responseHU = await db
        .collection("handling_unit")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "id", operator: "in", value: candidateHuIds },
              { prop: "plant_id", operator: "equal", value: plantId },
              {
                prop: "organization_id",
                operator: "equal",
                value: orgId,
              },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ])
        .get();

      const allHUs = responseHU.data || [];
      const huTableData = [];

      for (const hu of allHUs) {
        // Full HU exclusion: skip any HU with an active reservation in on_reserved_gd
        if (reservedHuIdSet && reservedHuIdSet.has(hu.id)) continue;

        const allActiveItems = (hu.table_hu_items || []).filter(
          (item) => item.is_deleted !== 1,
        );
        if (allActiveItems.length === 0) continue;

        // No mixed-item HUs: skip if any active item is a different material
        const allMatch = allActiveItems.every(
          (item) => item.material_id === matId,
        );
        if (!allMatch) continue;

        // Header row placeholder — item_quantity updated after items are added
        const headerRow = {
          row_type: "header",
          handling_unit_id: hu.id,
          handling_no: hu.handling_no,
          material_id: "",
          material_name: "",
          storage_location_id: hu.storage_location_id,
          location_id: hu.location_id,
          batch_id: null,
          item_quantity: 0,
          sm_quantity: 0,
          remark: hu.remark || "",
          balance_id: "",
        };
        huTableData.push(headerRow);

        let headerItemTotal = 0;
        for (const huItem of allActiveItems) {
          const baseQty = parseFloat(huItem.quantity) || 0;
          let displayQty = convertBaseToAlt(baseQty, itemData, altUOM);

          // Deduct other stock_movement lines' HU allocations for same HU+material+batch
          const otherLineAlloc = otherLinesHuAllocations.find(
            (a) =>
              a.handling_unit_id === hu.id &&
              a.material_id === huItem.material_id &&
              (a.batch_id || "") === (huItem.batch_id || ""),
          );
          if (otherLineAlloc) {
            displayQty = Math.max(
              0,
              displayQty - (otherLineAlloc.sm_quantity || 0),
            );
          }

          if (displayQty <= 0) continue;

          headerItemTotal += displayQty;
          huTableData.push({
            row_type: "item",
            handling_unit_id: hu.id,
            handling_no: "",
            material_id: huItem.material_id,
            material_name: huItem.material_name,
            storage_location_id: hu.storage_location_id,
            location_id: huItem.location_id || hu.location_id,
            batch_id: huItem.batch_id || null,
            item_quantity: displayQty,
            item_quantity_base: baseQty,
            sm_quantity: 0,
            remark: "",
            balance_id: huItem.balance_id || "",
            expired_date: huItem.expired_date || null,
            manufacturing_date: huItem.manufacturing_date || null,
            create_time: huItem.create_time || hu.create_time,
          });
        }

        headerRow.item_quantity = Math.round(headerItemTotal * 1000) / 1000;
      }

      // Drop header rows whose items were all fully allocated by other lines
      const huIdsWithItems = new Set(
        huTableData
          .filter((r) => r.row_type === "item")
          .map((r) => r.handling_unit_id),
      );
      const filtered = huTableData.filter(
        (r) => r.row_type === "item" || huIdsWithItems.has(r.handling_unit_id),
      );

      // Restore sm_quantity from existing temp_hu_data on re-open, and re-check
      // hu_select on the matching header rows so the UI reflects prior selection.
      const parsedTempHu = parseJSON(tempHuStr);
      const huIdsWithAllocation = new Set();
      for (const tempItem of parsedTempHu) {
        if (tempItem.row_type !== "item") continue;
        const match = filtered.find(
          (row) =>
            row.row_type === "item" &&
            row.handling_unit_id === tempItem.handling_unit_id &&
            row.material_id === tempItem.material_id &&
            (row.batch_id || "") === (tempItem.batch_id || ""),
        );
        if (match) {
          match.sm_quantity = tempItem.sm_quantity || 0;
          if (match.sm_quantity > 0) {
            huIdsWithAllocation.add(tempItem.handling_unit_id);
          }
        }
      }

      // LOT enforces NO_SPLIT: set hu_select = 1 on headers whose HU has any
      // restored allocation, so the checkbox state matches the item rows.
      if (huIdsWithAllocation.size > 0) {
        for (const row of filtered) {
          if (
            row.row_type === "header" &&
            huIdsWithAllocation.has(row.handling_unit_id)
          ) {
            row.hu_select = 1;
          }
        }
      }

      return filtered;
    } catch (error) {
      console.error("Error fetching handling units:", error);
      return [];
    }
  };

  // Drawer-scoped selectors so we don't collide with same-id tabs on the parent page
  const TAB_SCOPE = `.el-drawer[role="dialog"] .el-tabs__item`;

  const hideTab = (tabName) => {
    const tab = document.querySelector(`${TAB_SCOPE}#tab-${tabName}`);
    if (tab) tab.style.display = "none";
  };

  const showTab = (tabName) => {
    const tab = document.querySelector(`${TAB_SCOPE}#tab-${tabName}`);
    if (tab) {
      tab.style.display = "flex";
      tab.setAttribute("aria-disabled", "false");
      tab.classList.remove("is-disabled");
    }
  };

  const activateTab = (tabName) => {
    const tab = document.querySelector(`${TAB_SCOPE}#tab-${tabName}`);
    if (tab) tab.click();
  };

  // ============= MAIN =============

  // Hide category-from/to + serial column. hu_select stays visible — LOT enforces
  // NO_SPLIT (whole-HU pick) and the checkbox on header rows is the picker.
  this.hide([
    "sm_item_balance.table_item_balance.category_from",
    "sm_item_balance.table_item_balance.category_to",
    "sm_item_balance.table_item_balance.serial_number",
  ]);

  // Reset tables and clear category default
  this.setData({
    "sm_item_balance.table_item_balance": [],
    "sm_item_balance.table_hu": [],
    "sm_item_balance.table_item_balance.category": undefined,
  });

  let itemData;
  try {
    const itemResponse = await db
      .collection("Item")
      .where({ id: materialId })
      .get();
    itemData = itemResponse.data?.[0];
  } catch (error) {
    console.error("Error fetching item data:", error);
    return;
  }
  if (!itemData) return;

  const altUoms =
    itemData.table_uom_conversion?.map((data) => data.alt_uom_id) || [];
  const uomOptions = await fetchUomData(altUoms);

  this.setOptionData([`sm_item_balance.material_uom`], uomOptions);
  this.setData({
    sm_item_balance: {
      material_id: itemData.material_code,
      material_name: itemData.material_name,
      row_index: rowIndex,
      material_uom: quantityUOM,
    },
  });

  const isBatchManaged = itemData.item_batch_management === 1;
  const isSerial = itemData.serial_number_management === 1;

  // Active GD reservations for this material. Used to:
  //   (a) Hide whole HUs that have any item reserved (full HU exclusion).
  //   (b) Subtract loose-stock reservations (no handling_unit_id) from the
  //       item_balance display so LOT doesn't pick stock already committed to GD.
  let activeReservations = [];
  try {
    const reservationRes = await db
      .collection("on_reserved_gd")
      .where({
        plant_id: plant_id,
        organization_id: organizationId,
        material_id: materialId,
        is_deleted: 0,
      })
      .get();
    activeReservations = (reservationRes.data || []).filter(
      (r) => parseFloat(r.open_qty || 0) > 0 && r.status !== "Cancelled",
    );
  } catch (error) {
    console.error("Error fetching on_reserved_gd:", error);
  }

  const convertReservedToBase = (qty, item_uom) => {
    if (!item_uom || item_uom === itemData.based_uom) return qty;
    const conv = itemData.table_uom_conversion?.find(
      (c) => c.alt_uom_id === item_uom,
    );
    if (conv && conv.base_qty) return qty * conv.base_qty;
    return qty;
  };

  const reservedHuIds = new Set();
  const looseReservedMap = new Map();
  for (const r of activeReservations) {
    if (r.handling_unit_id) {
      reservedHuIds.add(r.handling_unit_id);
    } else {
      const locId = r.bin_location;
      if (!locId) continue;
      const key = isBatchManaged
        ? `${locId}-${r.batch_id || "no_batch"}`
        : `${locId}`;
      const qtyBase = convertReservedToBase(
        parseFloat(r.open_qty || 0),
        r.item_uom,
      );
      looseReservedMap.set(key, (looseReservedMap.get(key) || 0) + qtyBase);
    }
  }

  let looseRowCount = 0;

  // Filter out HU-bound records from temp_qty_data — those belong to table_hu.
  // Final filter drops rows with no transferable stock: only rows with
  // unrestricted_qty > 0 OR block_qty > 0 are kept (Reserved / QI / InTransit
  // categories aren't transferable via LOT).
  const processBalanceData = (itemBalanceData, itemDataLocal) => {
    const mappedData = mapBalanceData(itemBalanceData);
    let finalData = mappedData;

    if (tempQtyData) {
      try {
        const tempArr = JSON.parse(tempQtyData).filter(
          (it) => !it.handling_unit_id,
        );
        finalData = mergeWithTempData(mappedData, tempArr, itemDataLocal);
      } catch (error) {
        console.error("Error parsing temp_qty_data:", error);
      }
    }

    return filterZeroQuantityRecords(finalData, itemDataLocal).filter(
      (r) =>
        (parseFloat(r.unrestricted_qty) || 0) > 0 ||
        (parseFloat(r.block_qty) || 0) > 0,
    );
  };

  // item_balance includes stock physically inside HUs and stock reserved by other
  // GDs — deduct both so loose display reflects what's actually available to LOT.
  // Skip serialized items: HU items don't carry serial_number.
  const applyLooseDeduction = async (freshDbData) => {
    if (isSerial) return freshDbData;
    const huQtyMap = await fetchHuQtyByLocation(
      materialId,
      plant_id,
      organizationId,
      isBatchManaged,
    );
    for (const row of freshDbData) {
      const key = isBatchManaged
        ? `${row.location_id}-${row.batch_id || "no_batch"}`
        : `${row.location_id}`;
      const huQty = huQtyMap.get(key) || 0;
      const reservedQty = looseReservedMap.get(key) || 0;
      const totalDeduct = huQty + reservedQty;
      if (totalDeduct > 0) {
        row.unrestricted_qty = Math.max(
          0,
          (row.unrestricted_qty || 0) - totalDeduct,
        );
        row.balance_quantity = Math.max(
          0,
          (row.balance_quantity || 0) - totalDeduct,
        );
      }
    }
    return freshDbData;
  };

  if (isSerial) {
    this.display([
      "sm_item_balance.table_item_balance.serial_number",
      "sm_item_balance.search_serial_number",
      "sm_item_balance.confirm_search",
      "sm_item_balance.reset_search",
    ]);

    if (isBatchManaged) {
      this.display([
        "sm_item_balance.table_item_balance.batch_id",
        "sm_item_balance.table_item_balance.dialog_expired_date",
        "sm_item_balance.table_item_balance.dialog_manufacturing_date",
      ]);
    } else {
      this.hide([
        "sm_item_balance.table_item_balance.batch_id",
        "sm_item_balance.table_item_balance.dialog_expired_date",
        "sm_item_balance.table_item_balance.dialog_manufacturing_date",
      ]);
    }

    try {
      const response = await db
        .collection("item_serial_balance")
        .where({ material_id: materialId, plant_id: plant_id })
        .get();
      const filteredData = processBalanceData(response.data || [], itemData);
      looseRowCount = filteredData.length;

      this.setData({
        [`sm_item_balance.table_item_balance`]: filteredData,
        [`sm_item_balance.table_item_balance_raw`]:
          JSON.stringify(filteredData),
      });
    } catch (error) {
      console.error("Error fetching item serial balance data:", error);
    }
  } else if (isBatchManaged) {
    this.display([
      "sm_item_balance.table_item_balance.batch_id",
      "sm_item_balance.table_item_balance.dialog_expired_date",
      "sm_item_balance.table_item_balance.dialog_manufacturing_date",
    ]);
    this.hide("sm_item_balance.table_item_balance.serial_number");

    try {
      const response = await db
        .collection("item_batch_balance")
        .where({ material_id: materialId, plant_id: plant_id })
        .get();
      const itemBalanceData = response.data || [];
      const mappedData = Array.isArray(itemBalanceData)
        ? itemBalanceData.map((item) => {
            const { id, ...itemWithoutId } = item;
            return {
              ...itemWithoutId,
              balance_id: id,
              dialog_expired_date: item.expired_date,
              dialog_manufacturing_date: item.manufacturing_date,
            };
          })
        : (() => {
            const { id, ...itemWithoutId } = itemBalanceData;
            return {
              ...itemWithoutId,
              balance_id: id,
              dialog_expired_date: itemBalanceData.expired_date,
              dialog_manufacturing_date: itemBalanceData.manufacturing_date,
            };
          })();

      const deducted = await applyLooseDeduction(mappedData);
      const filteredData = processBalanceData(deducted, itemData);
      looseRowCount = filteredData.length;

      this.setData({
        [`sm_item_balance.table_item_balance`]: filteredData,
      });
    } catch (error) {
      console.error("Error fetching item batch balance data:", error);
    }
  } else {
    this.hide([
      "sm_item_balance.table_item_balance.batch_id",
      "sm_item_balance.table_item_balance.dialog_expired_date",
      "sm_item_balance.table_item_balance.dialog_manufacturing_date",
      "sm_item_balance.table_item_balance.serial_number",
    ]);

    try {
      const response = await db
        .collection("item_balance")
        .where({ material_id: materialId, plant_id: plant_id })
        .get();
      const dbData = response.data || [];
      const deducted = await applyLooseDeduction(dbData);
      const filteredData = processBalanceData(deducted, itemData);
      looseRowCount = filteredData.length;

      this.setData({
        [`sm_item_balance.table_item_balance`]: filteredData,
        [`sm_item_balance.table_item_balance.unit_price`]:
          itemData.purchase_unit_price,
      });
    } catch (error) {
      console.error("Error fetching item balance data:", error);
    }
  }

  // ============= HU TABLE =============

  // Other stock_movement lines' HU allocations for same material — to deduct
  const otherLinesHuAllocations = [];
  if (Array.isArray(allData.stock_movement)) {
    allData.stock_movement.forEach((line, idx) => {
      if (idx === rowIndex) return;
      if (line.item_selection !== materialId) return;
      const huStr = line.temp_hu_data;
      if (!huStr || huStr === "[]") return;
      try {
        const parsed = JSON.parse(huStr);
        if (Array.isArray(parsed)) {
          parsed.forEach((alloc) => {
            if (
              alloc.row_type === "item" &&
              parseFloat(alloc.sm_quantity) > 0
            ) {
              otherLinesHuAllocations.push(alloc);
            }
          });
        }
      } catch (e) {
        console.warn(
          `Failed to parse temp_hu_data for stock_movement row ${idx}`,
        );
      }
    });
  }

  const huTableData = await fetchHandlingUnits(
    plant_id,
    organizationId,
    materialId,
    tempHuData,
    itemData,
    quantityUOM,
    otherLinesHuAllocations,
    reservedHuIds,
  );

  // Reset both tabs to visible — clears any stale hide from a previous open
  showTab("handling_unit");
  showTab("loose");

  const hasHu = huTableData.length > 0;
  const hasLoose = looseRowCount > 0;

  if (hasHu) {
    await this.setData({ "sm_item_balance.table_hu": huTableData });

    // NO_SPLIT UI: sm_quantity is auto-driven by hu_select on the header,
    // never user-editable on any row. hu_select is only clickable on headers.
    huTableData.forEach((row, idx) => {
      this.disabled([`sm_item_balance.table_hu.${idx}.sm_quantity`], true);
      if (row.row_type === "item") {
        this.disabled([`sm_item_balance.table_hu.${idx}.hu_select`], true);
      }
    });
  }

  if (!hasHu) hideTab("handling_unit");
  if (!hasLoose) hideTab("loose");

  if (hasHu && hasLoose) {
    activateTab("loose");
  } else if (hasHu) {
    activateTab("handling_unit");
  } else if (hasLoose) {
    activateTab("loose");
  }
  } catch (error) {
    console.error("Error in LOT inventory dialog:", error);
  } finally {
    this.hideLoading();
  }
})();
```

### File 2 — `Stock Movement/Location Transfer/LOTconfirmDialog.js`

```js
(async () => {
  const allData = this.getValues();
  const temporaryData = allData.sm_item_balance.table_item_balance;
  const huData = allData.sm_item_balance.table_hu || [];
  const rowIndex = allData.sm_item_balance.row_index;
  const quantityUOM = allData.stock_movement[rowIndex].quantity_uom;
  const selectedUOM = allData.sm_item_balance.material_uom;

  let isValid = true;

  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: quantityUOM })
    .get()
    .then((res) => res.data[0]?.uom_name || "");

  const materialId = allData.stock_movement[rowIndex].item_selection;
  let itemData = null;
  try {
    const itemResponse = await db
      .collection("Item")
      .where({ id: materialId })
      .get();
    itemData = itemResponse.data[0];
  } catch (error) {
    console.error("Error fetching item data:", error);
  }

  let processedTemporaryData = temporaryData;
  let processedHuData = huData;

  if (selectedUOM !== quantityUOM && itemData) {
    const tableUOMConversion = itemData.table_uom_conversion;
    const baseUOM = itemData.based_uom;

    const convertQuantityFromTo = (
      value,
      table_uom_conversion,
      fromUOM,
      toUOM,
      baseUOM,
    ) => {
      if (!value || fromUOM === toUOM) return value;

      let baseQty = value;
      if (fromUOM !== baseUOM) {
        const fromConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === fromUOM,
        );
        if (fromConversion && fromConversion.base_qty) {
          baseQty = value * fromConversion.base_qty;
        }
      }

      if (toUOM !== baseUOM) {
        const toConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === toUOM,
        );
        if (toConversion && toConversion.base_qty) {
          return Math.round((baseQty / toConversion.base_qty) * 1000) / 1000;
        }
      }

      return baseQty;
    };

    const balanceFields = [
      "block_qty",
      "reserved_qty",
      "unrestricted_qty",
      "qualityinsp_qty",
      "intransit_qty",
      "balance_quantity",
      "sm_quantity",
    ];

    processedTemporaryData = temporaryData.map((record) => {
      const convertedRecord = { ...record };
      balanceFields.forEach((field) => {
        if (convertedRecord[field]) {
          convertedRecord[field] = convertQuantityFromTo(
            convertedRecord[field],
            tableUOMConversion,
            selectedUOM,
            quantityUOM,
            baseUOM,
          );
        }
      });
      return convertedRecord;
    });

    processedHuData = huData.map((record) => {
      if (record.row_type !== "item") return { ...record };
      const convertedRecord = { ...record };
      ["item_quantity", "sm_quantity"].forEach((field) => {
        if (convertedRecord[field]) {
          convertedRecord[field] = convertQuantityFromTo(
            convertedRecord[field],
            tableUOMConversion,
            selectedUOM,
            quantityUOM,
            baseUOM,
          );
        }
      });
      return convertedRecord;
    });
  }

  // HU items the user actually wants to sm
  const filteredHuData = processedHuData.filter(
    (item) => item.row_type === "item" && parseFloat(item.sm_quantity || 0) > 0,
  );

  // Validate HU rows: sm_quantity must not exceed available item_quantity.
  // HU items are always treated as Unrestricted, so no category check applies.
  for (const huItem of filteredHuData) {
    const smQty = parseFloat(huItem.sm_quantity || 0);
    const availableQty = parseFloat(huItem.item_quantity || 0);
    if (smQty > availableQty) {
      const huHeader = huData.find(
        (row) =>
          row.row_type === "header" &&
          row.handling_unit_id === huItem.handling_unit_id,
      );
      const huName = huHeader?.handling_no || huItem.handling_unit_id;
      this.setData({
        error_message: `HU ${huName}: sm quantity (${smQty}) exceeds available (${availableQty}).`,
      });
      isValid = false;
      break;
    }
  }
  if (!isValid) return;

  const totalSmQuantity = processedTemporaryData
    .filter((item) => (item.sm_quantity || 0) > 0)
    .reduce((sum, item) => {
      const category_type = item.category ?? item.category_from;
      const quantity = item.sm_quantity || 0;

      if (quantity > 0) {
        let selectedField;

        switch (category_type) {
          case "Unrestricted":
            selectedField = item.unrestricted_qty;
            break;
          case "Reserved":
            selectedField = item.reserved_qty;
            break;
          case "Quality Inspection":
            selectedField = item.qualityinsp_qty;
            break;
          case "Blocked":
            selectedField = item.block_qty;
            break;
          case "In Transit":
            selectedField = item.intransit_qty;
            break;
          default:
            this.setData({ error_message: "Invalid category type" });
            isValid = false;
            return sum;
        }

        if (selectedField < quantity) {
          this.setData({
            error_message: `Quantity in ${category_type} is not enough.`,
          });
          isValid = false;
          return sum;
        }
      }

      return sum + quantity;
    }, 0);

  if (!isValid) return;

  const totalHuQuantity = filteredHuData.reduce(
    (sum, item) => sum + parseFloat(item.sm_quantity || 0),
    0,
  );
  const totalCombined = totalSmQuantity + totalHuQuantity;

  this.setData({
    [`stock_movement.${rowIndex}.total_quantity`]: totalCombined,
  });

  const rowsToUpdate = processedTemporaryData.filter(
    (item) => (item.sm_quantity || 0) > 0,
  );

  // HU items in balance-shape; category always "Unrestricted" for HU items.
  const huAsBalanceRowsBase = filteredHuData.map((huItem) => ({
    material_id: huItem.material_id,
    location_id: huItem.location_id,
    storage_location_id: huItem.storage_location_id || null,
    batch_id: huItem.batch_id || null,
    balance_id: huItem.balance_id || "",
    sm_quantity: parseFloat(huItem.sm_quantity) || 0,
    category: "Unrestricted",
    handling_unit_id: huItem.handling_unit_id,
    plant_id: allData.issuing_operation_faci,
    organization_id: allData.organization_id,
    is_deleted: 0,
    expired_date: huItem.expired_date || null,
    manufacturing_date: huItem.manufacturing_date || null,
  }));

  // Cross-line serial dup check: scan other rows' persisted temp_qty_data,
  // plus this row's new loose + HU entries.
  const otherRowEntries = [];
  (allData.stock_movement || []).forEach((line, idx) => {
    if (String(idx) === String(rowIndex)) return;
    if (!line.temp_qty_data) return;
    try {
      const parsed = JSON.parse(line.temp_qty_data);
      if (Array.isArray(parsed)) otherRowEntries.push(...parsed);
    } catch (e) {}
  });

  const serialLocationBatchMap = new Map();

  [...otherRowEntries, ...rowsToUpdate, ...huAsBalanceRowsBase].forEach((entry) => {
    if (entry.serial_number && entry.serial_number.trim() !== "") {
      const serialNumber = entry.serial_number.trim();
      const locationId = entry.location_id || "no-location";
      const batchId = entry.batch_id || "no-batch";

      const combinationKey = `${serialNumber}|${locationId}|${batchId}`;

      if (!serialLocationBatchMap.has(combinationKey)) {
        serialLocationBatchMap.set(combinationKey, []);
      }

      serialLocationBatchMap.get(combinationKey).push({
        serialNumber: serialNumber,
        locationId: locationId,
        batchId: batchId,
      });
    }
  });

  const duplicates = [];
  for (const [combinationKey, entries] of serialLocationBatchMap.entries()) {
    if (entries.length > 1) {
      duplicates.push({
        combinationKey: combinationKey,
        serialNumber: entries[0].serialNumber,
      });
    }
  }

  if (duplicates.length > 0) {
    const duplicateMessages = duplicates
      .map((dup) => `• Serial Number "${dup.serialNumber}".`)
      .join("\n");

    this.$message.error(
      `Duplicate serial numbers detected in the same location/batch combination:\n\n${duplicateMessages}\n\nThe same serial number cannot be allocated multiple times to the same location and batch. Please remove the duplicates and try again.`,
    );
    return;
  }

  const formatLooseDetails = async (filteredData) => {
    const locationIds = [
      ...new Set(filteredData.map((item) => item.location_id)),
    ];

    const batchIds = [
      ...new Set(
        filteredData
          .map((item) => item.batch_id)
          .filter((batchId) => batchId != null && batchId !== ""),
      ),
    ];

    const locationPromises = locationIds.map(async (locationId) => {
      try {
        const resBinLocation = await db
          .collection("bin_location")
          .where({ id: locationId })
          .get();
        return {
          id: locationId,
          name:
            resBinLocation.data?.[0]?.bin_location_combine ||
            `Location ID: ${locationId}`,
        };
      } catch (error) {
        console.error(`Error fetching location ${locationId}:`, error);
        return { id: locationId, name: `${locationId} (Error)` };
      }
    });

    const batchPromises = batchIds.map(async (batchId) => {
      try {
        const resBatch = await db
          .collection("batch")
          .where({ id: batchId })
          .get();
        return {
          id: batchId,
          name: resBatch.data?.[0]?.batch_number || `Batch ID: ${batchId}`,
        };
      } catch (error) {
        console.error(`Error fetching batch ${batchId}:`, error);
        return { id: batchId, name: `${batchId} (Error)` };
      }
    });

    const [locations, batches] = await Promise.all([
      Promise.all(locationPromises),
      Promise.all(batchPromises),
    ]);

    const categoryMap = {
      Blocked: "BLK",
      Reserved: "RES",
      Unrestricted: "UNR",
      "Quality Inspection": "QIP",
      "In Transit": "INT",
    };

    const locationMap = locations.reduce((map, loc) => {
      map[loc.id] = loc.name;
      return map;
    }, {});

    const batchMap = batches.reduce((map, batch) => {
      map[batch.id] = batch.name;
      return map;
    }, {});

    return filteredData
      .map((item, index) => {
        const locationName = locationMap[item.location_id] || item.location_id;
        const qty = item.sm_quantity || 0;
        const category = item.category;
        const categoryAbbr = categoryMap[category] || category || "UNR";

        let itemDetail = `${
          index + 1
        }. ${locationName}: ${qty} ${gdUOM} (${categoryAbbr})`;

        if (itemData?.serial_number_management === 1 && item.serial_number) {
          itemDetail += `\nSerial: ${item.serial_number}`;
        }

        if (item.batch_id) {
          const batchName = batchMap[item.batch_id] || item.batch_id;
          itemDetail += `\n${
            itemData?.serial_number_management === 1 ? "Batch: " : "["
          }${batchName}${itemData?.serial_number_management === 1 ? "" : "]"}`;
        }

        if (item.remarks && item.remarks.trim() !== "") {
          itemDetail += `\nRemarks: ${item.remarks}`;
        }

        return itemDetail;
      })
      .join("\n");
  };

  const formatHuDetails = (filteredHuList) =>
    filteredHuList
      .map((item, index) => {
        const huHeader = huData.find(
          (row) =>
            row.row_type === "header" &&
            row.handling_unit_id === item.handling_unit_id,
        );
        const huName = huHeader?.handling_no || item.handling_unit_id;
        let detail = `${index + 1}. ${huName}: ${item.sm_quantity} ${gdUOM}`;
        if (item.batch_id) {
          detail += `\n   [Batch: ${item.batch_id}]`;
        }
        return detail;
      })
      .join("\n");

  const filteredLoose = processedTemporaryData.filter(
    (item) => (item.sm_quantity || 0) > 0,
  );
  const looseDetails = await formatLooseDetails(filteredLoose);
  const hasHu = filteredHuData.length > 0;
  const hasLoose = filteredLoose.length > 0;

  let formattedString;
  if (hasHu && hasLoose) {
    formattedString = `Total: ${totalCombined} ${gdUOM}\n\nLOOSE STOCK:\n${looseDetails}\n\nHANDLING UNIT:\n${formatHuDetails(
      filteredHuData,
    )}`;
  } else if (hasHu) {
    formattedString = `Total: ${totalHuQuantity} ${gdUOM}\n\nHANDLING UNIT:\n${formatHuDetails(
      filteredHuData,
    )}`;
  } else {
    formattedString = `Total: ${totalSmQuantity} ${gdUOM}\n\nDETAILS:\n${looseDetails}`;
  }

  // temp_qty_data carries loose + HU rows in balance shape; HU rows are
  // distinguishable via handling_unit_id. temp_hu_data carries the raw HU table
  // rows so the dialog can re-hydrate sm_quantity on next open.
  const cleanedLooseTempData = processedTemporaryData
    .filter((tempData) => tempData.sm_quantity > 0)
    .map((item) => {
      const cleaned = { ...item };
      if (cleaned.dialog_manufacturing_date !== undefined) {
        cleaned.manufacturing_date = cleaned.dialog_manufacturing_date;
        delete cleaned.dialog_manufacturing_date;
      }
      if (cleaned.dialog_expired_date !== undefined) {
        cleaned.expired_date = cleaned.dialog_expired_date;
        delete cleaned.dialog_expired_date;
      }
      return cleaned;
    });

  const combinedTempQty = [...cleanedLooseTempData, ...huAsBalanceRowsBase];

  this.setData({
    [`stock_movement.${rowIndex}.temp_qty_data`]:
      JSON.stringify(combinedTempQty),
    [`stock_movement.${rowIndex}.temp_hu_data`]: JSON.stringify(filteredHuData),
    [`stock_movement.${rowIndex}.stock_summary`]: formattedString,
  });

  this.models["previous_material_uom"] = undefined;
  this.setData({ error_message: "" });
  this.closeDialog("sm_item_balance");
})();
```
