# GD Split Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable `split_policy` field to `picking_setup` that governs HU picking behavior in GD — supporting partial picks (ALLOW_SPLIT), whole-HU picks with excess (FULL_HU_PICK), and whole-HU picks restricted to GD-matching items (NO_SPLIT).

**Architecture:** The split_policy is read from `picking_setup` at organization level and threaded through: (1) the manual inventory dialog (GDinventoryDialogWorkflow.js + GDconfirmDialog.js), (2) the auto-allocation engine (GLOBAL_AUTO_ALLOCATION.js + backend workflow nodes), and (3) the GD completion flow (GDProcessTable_batchProcess.js). Excess is tracked in a new `temp_excess_data` JSON field on GD lines.

**Tech Stack:** JavaScript (low-code platform functions), database via `db` collection API

**Spec:** `docs/superpowers/specs/2026-04-08-gd-split-policy-design.md`

**CRITICAL:** Before implementing ANY step, read the target file first. Do NOT assume field names, variable names, or logic flow. If something doesn't match what this plan describes, STOP and ask.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `Goods Delivery/GDonMounted.js` | Modify | Fetch `split_policy` from picking_setup, store for dialog use |
| `Goods Delivery/GDaddBatchLineItem_OPTIMIZED.js` | Modify | Extract `split_policy` from `fetchPickingSetup` |
| `Goods Delivery/GDinventoryDialogWorkflow.js` | Modify | HU tab: checkbox UX, field locking, NO_SPLIT disable logic, fetch ALL HU items for FULL_HU_PICK |
| `Goods Delivery/GDconfirmDialog.js` | Modify | Tolerance cap at confirm, cross-line distribution on confirm, build temp_excess_data |
| `GLOBAL_AUTO_ALLOCATION.js` | Modify | New `splitPolicy` param, whole-HU allocation logic |
| `Goods Delivery/GDsaveWorkflowAllocationResult.js` | Modify | Backend workflow node: cross-line distribution, temp_excess_data in auto-alloc results |
| `Goods Delivery/GDProcessTable_batchProcess.js` | Modify | Reserve full HU qty, auto-release excess at Completed |
| `Goods Delivery/GDgdQtyValidation.js` | Modify | Skip/relax per-row tolerance when whole-HU allocation exists |

---

## Task 1: Thread split_policy Through Picking Setup Fetches

**Files:**
- Modify: `Goods Delivery/GDonMounted.js:317-335`
- Modify: `Goods Delivery/GDaddBatchLineItem_OPTIMIZED.js:164-193`

**Context:** Currently `picking_setup` is fetched in multiple places but `split_policy` is never extracted. We need to add it everywhere picking_setup is read so downstream code can access it.

- [ ] **Step 1: Read GDonMounted.js and find `setPickingSetup` function**

Read the function at lines 317-335. Currently it queries `picking_setup` and only checks `picking_after`. We need to also store `split_policy`.

- [ ] **Step 2: Modify `setPickingSetup` in GDonMounted.js**

After the existing `picking_after` checks, add storage of `split_policy` so it's available to the inventory dialog later:

```javascript
// Inside setPickingSetup, after the existing if/else block for picking_after:
// Store split_policy for inventory dialog use
const splitPolicy = pickingSetupResponse.data[0].split_policy || "ALLOW_SPLIT";
this.setData({ split_policy: splitPolicy });
```

Note: Verify the exact variable names and setData pattern used in the file before applying. The `this.setData` pattern is used elsewhere in onMounted (check before assuming).

- [ ] **Step 3: Read GDaddBatchLineItem_OPTIMIZED.js `fetchPickingSetup` function**

Read lines 164-193. Currently returns `{ pickingMode, defaultStrategy, fallbackStrategy }`. Add `splitPolicy`.

- [ ] **Step 4: Modify `fetchPickingSetup` in GDaddBatchLineItem_OPTIMIZED.js**

Add `splitPolicy` to the return object:

```javascript
// In the success return (around line 180):
return {
  pickingMode: setup.picking_mode || "Manual",
  defaultStrategy: setup.default_strategy_id || "RANDOM",
  fallbackStrategy: setup.fallback_strategy_id || "RANDOM",
  splitPolicy: setup.split_policy || "ALLOW_SPLIT",
};

// In the default/error returns:
return {
  pickingMode: "Manual",
  defaultStrategy: "RANDOM",
  fallbackStrategy: "RANDOM",
  splitPolicy: "ALLOW_SPLIT",
};
```

- [ ] **Step 5: Verify `splitPolicy` is destructured where `pickingSetup` is used**

Search for where `pickingSetup` or `pickingMode` is destructured/used in GDaddBatchLineItem_OPTIMIZED.js (around line 428: `const { pickingMode } = pickingSetup;`). Verify that adding the field doesn't break anything — it shouldn't since JS destructuring ignores extra fields.

- [ ] **Step 6: Commit**

```
feat: thread split_policy through picking_setup fetches
```

---

## Task 2: Modify Inventory Dialog — HU Tab Behavior Per Policy

**Files:**
- Modify: `Goods Delivery/GDinventoryDialogWorkflow.js`

**Context:** The inventory dialog opens per GD line. The HU tab currently shows header+item rows filtered to the current material only. For FULL_HU_PICK/NO_SPLIT, we need:
1. A select checkbox on HU header rows (instead of editable deliver_quantity on item rows)
2. deliver_quantity locked/auto-filled on item rows
3. For FULL_HU_PICK: fetch ALL items in each HU (not just current material)
4. For NO_SPLIT: show all HUs but disable ones with foreign items
5. Already-allocated HUs (from other lines) shown as disabled

- [ ] **Step 1: Read GDinventoryDialogWorkflow.js fully**

Read the entire file to understand the current flow. Pay attention to:
- How `fetchHandlingUnits` builds `huTableData` (lines 469-629)
- How the dialog data is set (line 1047: `this.setData({ gd_item_balance.table_hu: huTableData })`)
- How header rows are disabled (lines 1050-1057)
- Where `tempHuData` (existing allocations) is parsed and merged

- [ ] **Step 2: Get split_policy in the dialog**

At the top of the function (around lines 5-20), the dialog reads form data via `this.getValues()`. Add split_policy:

```javascript
const splitPolicy = data.split_policy || "ALLOW_SPLIT";
```

Verify `split_policy` is available on the form data (it was set in Task 1 via `this.setData`). If not available through `getValues()`, it may need to be fetched from `picking_setup` directly within this function — check the existing pattern for how this dialog gets configuration.

- [ ] **Step 3: Collect already-allocated HU IDs from other GD lines**

Before calling `fetchHandlingUnits`, gather HU IDs that have already been confirmed/allocated from other lines (for the "disable already-allocated" rule). Look at how `otherLinesHuAllocations` is currently built (this already exists for cross-line deduction). The already-allocated HU IDs can be derived from other lines' `temp_hu_data`:

```javascript
// Build set of HU IDs already allocated from other lines
const allocatedHuIds = new Set();
if (splitPolicy !== "ALLOW_SPLIT") {
  const tableGd = data.table_gd || [];
  tableGd.forEach((line, idx) => {
    if (idx === rowIndex) return; // skip current line
    if (line.temp_hu_data && line.temp_hu_data !== "[]") {
      try {
        const lineHuData = JSON.parse(line.temp_hu_data);
        lineHuData.forEach((hu) => {
          if (hu.handling_unit_id) allocatedHuIds.add(hu.handling_unit_id);
        });
      } catch (e) { /* ignore parse errors */ }
    }
  });
}
```

- [ ] **Step 4: Modify `fetchHandlingUnits` for FULL_HU_PICK — include ALL items per HU**

Currently `fetchHandlingUnits` filters HU items to only the current material (line ~514: `item.material_id === materialId`). For FULL_HU_PICK, we need ALL items in the HU so the user can see what they're picking.

Add a parameter `splitPolicy` to `fetchHandlingUnits` and modify the item filtering:

```javascript
// Current code (around line 514):
const matchingItems = (hu.table_hu_items || []).filter(
  (item) => item.material_id === materialId && item.is_deleted !== 1,
);
if (matchingItems.length === 0) continue;

// New code:
const allActiveItems = (hu.table_hu_items || []).filter(
  (item) => item.is_deleted !== 1,
);
const hasCurrentMaterial = allActiveItems.some(
  (item) => item.material_id === materialId,
);
if (!hasCurrentMaterial) continue; // HU must contain the current material

// For ALLOW_SPLIT: only show current material's items (existing behavior)
// For FULL_HU_PICK/NO_SPLIT: show ALL items in the HU
const itemsToShow = splitPolicy === "ALLOW_SPLIT"
  ? allActiveItems.filter((item) => item.material_id === materialId)
  : allActiveItems;
```

Then use `itemsToShow` instead of `matchingItems` when building item rows.

- [ ] **Step 5: Add NO_SPLIT eligibility check — disable HUs with foreign items**

For NO_SPLIT, after building all HU rows, check if each HU has items not in any GD line. Add a `disabled` flag:

```javascript
// After building huTableData, if NO_SPLIT:
if (splitPolicy === "NO_SPLIT") {
  const gdMaterialIds = new Set(
    (data.table_gd || []).map((line) => line.material_id).filter(Boolean),
  );
  
  // Group items by HU
  const huItemsMap = {};
  for (const row of huTableData) {
    if (row.row_type === "item") {
      if (!huItemsMap[row.handling_unit_id]) huItemsMap[row.handling_unit_id] = [];
      huItemsMap[row.handling_unit_id].push(row);
    }
  }
  
  // Mark HUs with foreign items as disabled
  const disabledHuIds = new Set();
  for (const [huId, items] of Object.entries(huItemsMap)) {
    const hasForeignItem = items.some((item) => !gdMaterialIds.has(item.material_id));
    if (hasForeignItem) disabledHuIds.add(huId);
  }
  
  // Add disabled flag to header and item rows
  for (const row of huTableData) {
    if (disabledHuIds.has(row.handling_unit_id)) {
      row.hu_disabled = true;
      row.hu_disabled_reason = "Contains items not in this delivery";
    }
  }
}
```

- [ ] **Step 6: Mark already-allocated HUs as disabled**

```javascript
// After NO_SPLIT check, for both FULL_HU_PICK and NO_SPLIT:
if (splitPolicy !== "ALLOW_SPLIT") {
  for (const row of huTableData) {
    if (allocatedHuIds.has(row.handling_unit_id)) {
      row.hu_disabled = true;
      row.hu_disabled_reason = "Already allocated";
    }
  }
}
```

- [ ] **Step 7: Modify HU field enable/disable after setData**

Currently (lines 1050-1057), only header row `deliver_quantity` is disabled. For FULL_HU_PICK/NO_SPLIT, also disable ALL item row `deliver_quantity` fields and handle the checkbox/disabled state:

```javascript
// After setData for table_hu (around line 1050):
huTableData.forEach((row, idx) => {
  if (splitPolicy === "ALLOW_SPLIT") {
    // Existing behavior: disable header deliver_quantity only
    if (row.row_type === "header") {
      this.disabled([`gd_item_balance.table_hu.${idx}.deliver_quantity`], true);
    }
  } else {
    // FULL_HU_PICK or NO_SPLIT: disable all deliver_quantity fields
    this.disabled([`gd_item_balance.table_hu.${idx}.deliver_quantity`], true);
    
    // Disable entire row if HU is disabled (NO_SPLIT foreign items or already allocated)
    if (row.hu_disabled) {
      this.disabled([`gd_item_balance.table_hu.${idx}.hu_select`], true);
    }
  }
});
```

Note: The `hu_select` checkbox field needs to exist in the low-code platform's form configuration. Verify what field names are available on the `table_hu` component before using `hu_select`. This may require platform-side configuration.

- [ ] **Step 8: Handle checkbox toggle — auto-fill deliver_quantity for all items in HU**

When user checks an HU header's checkbox (FULL_HU_PICK/NO_SPLIT), auto-fill all item rows' `deliver_quantity` with their full `item_quantity`. When unchecked, reset to 0. This is a preview only — actual data is committed on Confirm (Task 3).

Note: This behavior may need to be implemented as an `onChange` handler for the `hu_select` field in the low-code platform. Verify the event binding mechanism before implementing.

- [ ] **Step 9: Commit**

```
feat: modify inventory dialog HU tab for split policy
```

---

## Task 3: Modify Confirm Dialog — Tolerance Validation, Cross-Line Distribution, Excess

**Files:**
- Modify: `Goods Delivery/GDconfirmDialog.js`

**Context:** When user clicks Confirm in the inventory dialog, this file validates and saves. For FULL_HU_PICK/NO_SPLIT, we need:
1. Tolerance cap validation (total picked across HUs must not exceed `order_qty * (1 + tolerance/100)`)
2. Cross-line distribution: loop through selected HUs' items, update other GD lines
3. Build temp_excess_data for foreign items (FULL_HU_PICK) and over-picks

- [ ] **Step 1: Read GDconfirmDialog.js fully**

Read the entire file. Key sections:
- Lines 1-12: Data extraction from dialog
- Lines 83-91: orderLimit calculation using `itemData.over_delivery_tolerance`
- Lines 94-109: Balance + HU total calculation
- Lines 100-102: `filteredHuData` — HU items with deliver_quantity > 0
- Lines 619-633: Building combined temp_qty_data
- Lines 635-641: Final setData saving temp_qty_data, temp_hu_data, view_stock

- [ ] **Step 2: Get split_policy in confirm dialog**

```javascript
const splitPolicy = data.split_policy || "ALLOW_SPLIT";
```

- [ ] **Step 3: Add tolerance validation for FULL_HU_PICK/NO_SPLIT**

After calculating `totalDialogQuantity` (line 109), add tolerance check for whole-HU policies:

```javascript
if (splitPolicy !== "ALLOW_SPLIT") {
  // For whole-HU policies, validate total picked against tolerance
  const gdOrderQty = parseFloat(data.table_gd[rowIndex].gd_order_quantity || 0);
  const tolerance = itemData?.over_delivery_tolerance || 0;
  const maxAllowed = roundQty(gdOrderQty * (1 + tolerance / 100));
  
  if (totalDialogQuantity > maxAllowed) {
    alert(
      `Total picked quantity (${totalDialogQuantity}) exceeds delivery limit (${maxAllowed}). ` +
      `Order: ${gdOrderQty}, Tolerance: ${tolerance}%`
    );
    return;
  }
}
```

Note: Verify `over_delivery_tolerance` field name on `itemData` — confirmed at GDconfirmDialog.js line 89: `resItem.data[0].over_delivery_tolerance`.

- [ ] **Step 4: Build temp_excess_data for over-pick**

After the existing `combinedQtyData` build (around line 633), calculate excess:

```javascript
const tempExcessData = [];

if (splitPolicy !== "ALLOW_SPLIT") {
  const gdQty = parseFloat(data.table_gd[rowIndex].gd_qty || 0) ||
                parseFloat(data.table_gd[rowIndex].gd_order_quantity || 0);
  
  // Check if total HU pick for current material exceeds need
  const currentMaterialHuTotal = filteredHuData
    .filter((item) => item.material_id === materialId)
    .reduce((sum, item) => sum + parseFloat(item.deliver_quantity || 0), 0);
  
  if (currentMaterialHuTotal > gdQty) {
    const excessQty = roundQty(currentMaterialHuTotal - gdQty);
    // Find the HU(s) contributing to excess
    filteredHuData
      .filter((item) => item.material_id === materialId)
      .forEach((item) => {
        tempExcessData.push({
          handling_unit_id: item.handling_unit_id,
          handling_no: item.handling_no || "",
          material_id: item.material_id,
          material_name: item.material_name || "",
          quantity: excessQty, // Will need smarter distribution if multiple HUs
          batch_id: item.batch_id || null,
          location_id: item.location_id,
          reason: "over_pick",
        });
      });
  }
  
  // For FULL_HU_PICK: check for foreign items (items not matching any GD line)
  if (splitPolicy === "FULL_HU_PICK") {
    const gdMaterialIds = new Set(
      (data.table_gd || []).map((line) => line.material_id).filter(Boolean),
    );
    
    filteredHuData
      .filter((item) => !gdMaterialIds.has(item.material_id))
      .forEach((item) => {
        tempExcessData.push({
          handling_unit_id: item.handling_unit_id,
          handling_no: item.handling_no || "",
          material_id: item.material_id,
          material_name: item.material_name || "",
          quantity: parseFloat(item.deliver_quantity || 0),
          batch_id: item.batch_id || null,
          location_id: item.location_id,
          reason: "no_gd_line",
        });
      });
  }
}
```

- [ ] **Step 5: Implement cross-line distribution on Confirm**

For FULL_HU_PICK/NO_SPLIT, when the user confirms, items from the selected HU(s) that match OTHER GD lines need to update those lines:

```javascript
if (splitPolicy !== "ALLOW_SPLIT") {
  const tableGd = data.table_gd || [];
  const gdMaterialMap = {}; // material_id -> [{ lineIndex, remainingNeed }]
  
  tableGd.forEach((line, idx) => {
    if (idx === rowIndex) return; // skip current line
    if (!line.material_id) return;
    
    const existingAllocated = line.temp_qty_data && line.temp_qty_data !== "[]"
      ? JSON.parse(line.temp_qty_data).reduce((sum, t) => sum + parseFloat(t.gd_quantity || 0), 0)
      : 0;
    const need = parseFloat(line.gd_qty || 0) - existingAllocated;
    
    if (need > 0) {
      if (!gdMaterialMap[line.material_id]) gdMaterialMap[line.material_id] = [];
      gdMaterialMap[line.material_id].push({ lineIndex: idx, remainingNeed: need });
    }
  });
  
  // Distribute HU items to matching lines
  for (const huItem of filteredHuData) {
    if (huItem.material_id === materialId) continue; // current line handled above
    
    const matchingLines = gdMaterialMap[huItem.material_id];
    if (!matchingLines || matchingLines.length === 0) continue; // foreign item, already in excess
    
    let remainingHuQty = parseFloat(huItem.deliver_quantity || 0);
    
    for (const lineInfo of matchingLines) {
      if (remainingHuQty <= 0) break;
      
      const allocQty = Math.min(remainingHuQty, lineInfo.remainingNeed);
      
      // Build allocation record for this line
      const allocRecord = {
        material_id: huItem.material_id,
        location_id: huItem.location_id,
        batch_id: huItem.batch_id || null,
        balance_id: huItem.balance_id || "",
        gd_quantity: allocQty,
        handling_unit_id: huItem.handling_unit_id,
        plant_id: data.plant_id,
        organization_id: data.organization_id,
        is_deleted: 0,
      };
      
      // Parse existing temp data for this line
      const existingTemp = tableGd[lineInfo.lineIndex].temp_qty_data &&
        tableGd[lineInfo.lineIndex].temp_qty_data !== "[]"
        ? JSON.parse(tableGd[lineInfo.lineIndex].temp_qty_data)
        : [];
      const existingHuTemp = tableGd[lineInfo.lineIndex].temp_hu_data &&
        tableGd[lineInfo.lineIndex].temp_hu_data !== "[]"
        ? JSON.parse(tableGd[lineInfo.lineIndex].temp_hu_data)
        : [];
      
      existingTemp.push(allocRecord);
      existingHuTemp.push({
        row_type: "item",
        handling_unit_id: huItem.handling_unit_id,
        material_id: huItem.material_id,
        location_id: huItem.location_id,
        batch_id: huItem.batch_id || null,
        balance_id: huItem.balance_id || "",
        deliver_quantity: allocQty,
        item_quantity: parseFloat(huItem.item_quantity || 0),
      });
      
      // Update via setData
      this.setData({
        [`table_gd.${lineInfo.lineIndex}.temp_qty_data`]: JSON.stringify(existingTemp),
        [`table_gd.${lineInfo.lineIndex}.temp_hu_data`]: JSON.stringify(existingHuTemp),
      });
      
      remainingHuQty -= allocQty;
      lineInfo.remainingNeed -= allocQty;
    }
    
    // Any remaining qty after distributing to lines = excess
    if (remainingHuQty > 0) {
      tempExcessData.push({
        handling_unit_id: huItem.handling_unit_id,
        handling_no: huItem.handling_no || "",
        material_id: huItem.material_id,
        material_name: huItem.material_name || "",
        quantity: remainingHuQty,
        batch_id: huItem.batch_id || null,
        location_id: huItem.location_id,
        reason: "over_pick",
      });
    }
  }
}
```

- [ ] **Step 6: Save temp_excess_data in the final setData**

Modify the existing setData call (around line 635) to also save temp_excess_data:

```javascript
// Add to the existing setData call:
this.setData({
  [`table_gd.${rowIndex}.temp_qty_data`]: textareaContent,
  [`table_gd.${rowIndex}.temp_hu_data`]: JSON.stringify(filteredHuData),
  [`table_gd.${rowIndex}.temp_excess_data`]: JSON.stringify(tempExcessData),
  [`table_gd.${rowIndex}.view_stock`]: formattedString,
  [`gd_item_balance.table_item_balance`]: [],
  [`gd_item_balance.table_hu`]: [],
});
```

For ALLOW_SPLIT, `tempExcessData` will be `[]` so this is safe for all policies.

- [ ] **Step 7: Commit**

```
feat: add tolerance validation, cross-line distribution, and excess tracking to confirm dialog
```

---

## Task 4: Modify GLOBAL_AUTO_ALLOCATION.js — Whole-HU Allocation

**Files:**
- Modify: `GLOBAL_AUTO_ALLOCATION.js`

**Context:** This is the central allocation engine. Currently it injects HU items as virtual balance records (lines 52-78) and `allocateFromBalances` takes partial quantities. For FULL_HU_PICK/NO_SPLIT, it must take the full `item_quantity` from each HU — never partial.

- [ ] **Step 1: Read GLOBAL_AUTO_ALLOCATION.js fully**

Key sections:
- Lines 1-16: Workflow params (need to add `splitPolicy`)
- Lines 52-78: HU items injected as virtual balance records with `source: "hu"`
- Lines 205-234: `allocateFromBalances` — takes `Math.min(remaining, availableQty)`
- Lines 406-450: HU vs loose priority-based allocation

- [ ] **Step 2: Add splitPolicy workflow param**

At the top (after line 12):

```javascript
const splitPolicy = {{workflowparams:splitPolicy}} || "ALLOW_SPLIT";
```

- [ ] **Step 3: Add NO_SPLIT HU filtering**

After the HU injection loop (after line 78), if NO_SPLIT, filter out HU balances from HUs with foreign items:

```javascript
// For NO_SPLIT: filter HU balances to only include HUs where ALL items exist in GD lines
// gdLineMaterials is passed as a workflow param for this purpose
if (splitPolicy === "NO_SPLIT") {
  const gdLineMaterials = {{workflowparams:gdLineMaterials}} || [];
  const gdMaterialSet = new Set(gdLineMaterials);
  
  // Group HU items by handling_unit_id to check eligibility
  const huItemsMap = {};
  for (const b of balanceData) {
    if (b.source !== "hu") continue;
    if (!huItemsMap[b.handling_unit_id]) huItemsMap[b.handling_unit_id] = [];
    huItemsMap[b.handling_unit_id].push(b);
  }
  
  // Find ineligible HUs (ones with items not in any GD line)
  const ineligibleHuIds = new Set();
  for (const [huId, items] of Object.entries(huItemsMap)) {
    const hasForeignItem = items.some((item) => !gdMaterialSet.has(item.material_id));
    if (hasForeignItem) ineligibleHuIds.add(huId);
  }
  
  // Remove ineligible HU balances
  balanceData = balanceData.filter(
    (b) => b.source !== "hu" || !ineligibleHuIds.has(b.handling_unit_id),
  );
}
```

- [ ] **Step 4: Add whole-HU allocation function**

Add a new function after `allocateFromBalances` (after line 234):

```javascript
// Whole-HU allocation: takes full item_quantity from each HU, never partial
const allocateWholeHU = (balanceList, remainingQty) => {
  const allocated = [];
  let remaining = remainingQty;

  for (const balance of balanceList) {
    if (balance.source !== "hu") continue;
    
    const availableQty = balance.unrestricted_qty || 0;
    if (availableQty <= 0) continue;

    // Take the FULL quantity — no Math.min with remaining
    const allocationRecord = {
      ...balance,
      [qtyField]: availableQty,
      unrestricted_qty: balance.original_unrestricted_qty || balance.unrestricted_qty,
    };

    allocated.push(allocationRecord);
    remaining -= availableQty; // remaining can go negative (excess)
  }

  return { allocated, remainingQty: Math.max(0, remaining) };
};
```

- [ ] **Step 5: Modify the HU allocation path for FULL_HU_PICK/NO_SPLIT**

In the main execution section (around lines 406-450), when `splitPolicy !== "ALLOW_SPLIT"`, use `allocateWholeHU` for HU balances instead of the regular `strategyFn`:

```javascript
if (splitPolicy !== "ALLOW_SPLIT" && huBalances.length > 0) {
  // Whole-HU allocation: take full qty from each HU
  const huResult = allocateWholeHU(huBalances, remainingQty);
  allAllocations.push(...huResult.allocated);
  remainingQty = huResult.remainingQty;

  // If still remaining, fall back to loose stock (partial allowed for loose)
  if (remainingQty > 0) {
    const looseResult = strategyFn(looseBalances, remainingQty);
    // Merge loose allocations
    for (const strategyAlloc of looseResult.allocated) {
      const key = generateKey(strategyAlloc.location_id, strategyAlloc.batch_id, strategyAlloc.handling_unit_id);
      const existingIdx = allAllocations.findIndex((a) =>
        generateKey(a.location_id, a.batch_id, a.handling_unit_id) === key
      );
      if (existingIdx >= 0) {
        allAllocations[existingIdx][qtyField] += strategyAlloc[qtyField];
      } else {
        allAllocations.push(strategyAlloc);
      }
    }
    remainingQty = looseResult.remainingQty;
  }
} else {
  // Existing ALLOW_SPLIT logic (unchanged)
  // ... keep existing code in this else block
}
```

**IMPORTANT:** Read the existing code at lines 406-450 carefully before making this change. The above is a structural guide — adapt to the exact variable names and flow in the file.

- [ ] **Step 6: Commit**

```
feat: add whole-HU allocation logic to GLOBAL_AUTO_ALLOCATION
```

---

## Task 5: Modify Backend Workflow Nodes — Pass splitPolicy and Handle Cross-Line

**Files:**
- Modify: `Goods Delivery/GDsaveWorkflowAllocationResult.js` (= backend workflow node `code_node_hifFKzmo`)

**Context:** The backend workflow's `Global Allocation Params` node (code_node_Htpcyp8t) builds HU data per material and passes it to GLOBAL_AUTO_ALLOCATION. For FULL_HU_PICK, it needs to include ALL items in matching HUs. The `process Allocation Result` node (GDsaveWorkflowAllocationResult.js) needs to handle cross-line distribution.

Note: The `Global Allocation Params` and `Run Global Allocation Workflow` nodes are configured in the low-code platform workflow editor. The code for `Global Allocation Params` is inline in the workflow JSON (saved at `Goods Delivery/GD_Backend_AutoAllocation_Workflow.json`). Changes to those nodes must be done in the platform UI. This task covers the code changes — the platform configuration (adding `splitPolicy` as a workflow param, adding it to body_params) must be done manually.

- [ ] **Step 1: Document changes needed for `Global Allocation Params` (code_node_Htpcyp8t)**

This node's code (in the workflow JSON) currently filters HU items by `currentRow.materialId` only. Changes needed:

1. Read `splitPolicy` from `pickingSetup`:
```javascript
const splitPolicy = pickingSetup.split_policy || "ALLOW_SPLIT";
```

2. For FULL_HU_PICK/NO_SPLIT, include ALL items per HU (not just current material):
```javascript
// Change the matchingItems filter:
const matchingItems = splitPolicy === "ALLOW_SPLIT"
  ? (hu.table_hu_items || []).filter(
      (item) => item.material_id === currentRow.materialId && item.is_deleted !== 1,
    )
  : (hu.table_hu_items || []).filter(
      (item) => item.is_deleted !== 1,
    );

// Still skip HUs that don't contain the current material:
const hasCurrentMaterial = (hu.table_hu_items || []).some(
  (item) => item.material_id === currentRow.materialId && item.is_deleted !== 1,
);
if (!hasCurrentMaterial) continue;
```

3. Add `splitPolicy` and `gdLineMaterials` to the return object:
```javascript
return {
  // ... existing fields ...
  splitPolicy: splitPolicy,
  gdLineMaterials: rowsNeedingAllocation.map((r) => r.materialId),
};
```

Note: `rowsNeedingAllocation` comes from `code_node_kJx9p9Nh`. Verify it's accessible in this node's scope — if not, pass it through the workflow params or build the list from `allData.table_gd`.

4. Add `splitPolicy` and `gdLineMaterials` to `body_params` in `Run Global Allocation Workflow` node (platform config change).

- [ ] **Step 2: Modify GDsaveWorkflowAllocationResult.js for cross-line distribution**

Read the file fully. Currently it builds `tempQtyData`, `tempHuData`, `viewStock` for the CURRENT row only. For FULL_HU_PICK/NO_SPLIT, allocations may include items for OTHER materials that need to go to other rows.

Add after the existing `tempQtyData` build:

```javascript
const splitPolicy = {{node:code_node_Htpcyp8t.data.splitPolicy}} || "ALLOW_SPLIT";

// Separate allocations: current material vs other materials
const currentMaterialAllocs = allocationData.filter(
  (a) => a.material_id === currentRow.materialId || !a.material_id,
);
const otherMaterialAllocs = allocationData.filter(
  (a) => a.material_id && a.material_id !== currentRow.materialId,
);
```

Then build temp_qty_data from `currentMaterialAllocs` only (instead of all `allocationData`).

For `otherMaterialAllocs`, build cross-line updates and temp_excess_data:

```javascript
// Cross-line distribution for other materials
const crossLineUpdates = {}; // rowIndex -> { tempQtyData: [], tempHuData: [] }
const tempExcessData = [];

if (splitPolicy !== "ALLOW_SPLIT" && otherMaterialAllocs.length > 0) {
  const rawTableGD = {{node:get_cache_node_6hmHAVwX.data}};
  let tableGD = typeof rawTableGD === "string" ? JSON.parse(rawTableGD) : rawTableGD || [];
  
  // Build material -> line index map
  const materialLineMap = {};
  tableGD.forEach((line, idx) => {
    if (idx === currentRow.rowIndex) return;
    if (line.material_id) {
      if (!materialLineMap[line.material_id]) materialLineMap[line.material_id] = [];
      materialLineMap[line.material_id].push(idx);
    }
  });
  
  for (const alloc of otherMaterialAllocs) {
    const targetLines = materialLineMap[alloc.material_id];
    if (!targetLines || targetLines.length === 0) {
      // Foreign item — no matching GD line
      tempExcessData.push({
        handling_unit_id: alloc.handling_unit_id,
        handling_no: getHandlingNo(alloc.handling_unit_id),
        material_id: alloc.material_id,
        material_name: alloc.material_name || "",
        quantity: alloc[qtyField] || alloc.gd_quantity || 0,
        batch_id: alloc.batch_id || null,
        location_id: alloc.location_id,
        reason: "no_gd_line",
      });
      continue;
    }
    
    // Distribute to first matching line (simplified — distribute to first with remaining need)
    const targetIdx = targetLines[0];
    if (!crossLineUpdates[targetIdx]) {
      crossLineUpdates[targetIdx] = { tempQtyData: [], tempHuData: [] };
    }
    
    crossLineUpdates[targetIdx].tempQtyData.push({
      material_id: alloc.material_id,
      location_id: alloc.location_id,
      batch_id: alloc.batch_id || null,
      unrestricted_qty: alloc.original_unrestricted_qty || alloc.unrestricted_qty,
      plant_id: currentRow.plantId,
      organization_id: currentRow.organizationId,
      is_deleted: 0,
      gd_quantity: alloc.gd_quantity || 0,
      balance_id: alloc.balance_id || "",
      handling_unit_id: alloc.handling_unit_id,
    });
    
    if (alloc.source === "hu") {
      crossLineUpdates[targetIdx].tempHuData.push({
        row_type: "item",
        handling_unit_id: alloc.handling_unit_id,
        material_id: alloc.material_id,
        location_id: alloc.location_id,
        batch_id: alloc.batch_id || null,
        balance_id: alloc.balance_id || "",
        deliver_quantity: alloc.gd_quantity || 0,
        item_quantity: alloc.original_unrestricted_qty || alloc.unrestricted_qty || 0,
      });
    }
  }
}
```

Add `crossLineUpdates` and `tempExcessData` to the return object so `updateRowInTableGd` (code_node_56IOJIBu) can apply them.

- [ ] **Step 3: Document changes needed for `updateRowInTableGd` (code_node_56IOJIBu)**

This node currently only updates the current row. It needs to also apply `crossLineUpdates` to other rows in tableGD and save `temp_excess_data`:

```javascript
// After updating the current row:
const crossLineUpdates = allocationResult.crossLineUpdates || {};
for (const [idx, updates] of Object.entries(crossLineUpdates)) {
  const lineIdx = parseInt(idx);
  if (tableGD[lineIdx]) {
    // Merge with existing temp data
    let existingQty = [];
    let existingHu = [];
    try {
      existingQty = tableGD[lineIdx].temp_qty_data ? JSON.parse(tableGD[lineIdx].temp_qty_data) : [];
      existingHu = tableGD[lineIdx].temp_hu_data ? JSON.parse(tableGD[lineIdx].temp_hu_data) : [];
    } catch (e) { /* ignore */ }
    
    tableGD[lineIdx].temp_qty_data = JSON.stringify([...existingQty, ...updates.tempQtyData]);
    tableGD[lineIdx].temp_hu_data = JSON.stringify([...existingHu, ...updates.tempHuData]);
  }
}

// Save temp_excess_data on current row
if (allocationResult.temp_excess_data) {
  tableGD[rowIndex].temp_excess_data = JSON.stringify(allocationResult.temp_excess_data);
}
```

- [ ] **Step 4: Commit**

```
feat: add cross-line distribution and excess tracking to backend allocation workflow
```

---

## Task 6: Modify GDProcessTable — Reserve Full HU Qty, Release Excess at Completed

**Files:**
- Modify: `Goods Delivery/GDProcessTable_batchProcess.js`

**Context:** This file processes all GD line allocations when saving. For FULL_HU_PICK/NO_SPLIT:
1. When creating `on_reserved_gd` records, reserve the full HU quantity (not just GD need)
2. At Completed status, auto-release excess from `on_reserved_gd`

- [ ] **Step 1: Read GDProcessTable_batchProcess.js**

Read the full file focusing on:
- Where `on_reserved_gd` records are created (the `processCreatedAllocation` function)
- Where Completed status processing happens (`processDeliveredAllocation`)
- How `temp_qty_data` is parsed to get allocation records
- Where `handling_unit_id` is used in record creation

- [ ] **Step 2: Identify where reservation quantity is set**

Find where `on_reserved_gd` records are created and the `open_qty` field is set. Currently it should use the `gd_quantity` from temp_qty_data. For FULL_HU_PICK/NO_SPLIT, when the record has a `handling_unit_id`, the `open_qty` should be the full HU item quantity (not the capped gd_quantity).

Note: This change means temp_qty_data needs to carry the original HU item quantity. Verify that the `unrestricted_qty` field in temp_qty_data records represents the full HU qty — check how it's built in GDconfirmDialog.js (line ~619-633) and GDsaveWorkflowAllocationResult.js.

- [ ] **Step 3: Add excess auto-release at Completed**

In the Completed processing path (`processDeliveredAllocation`), after normal processing, check for `temp_excess_data` and release those quantities:

```javascript
// After normal Completed processing for each line:
const tempExcessStr = lineData.temp_excess_data;
if (tempExcessStr && tempExcessStr !== "[]") {
  try {
    const excessData = JSON.parse(tempExcessStr);
    for (const excess of excessData) {
      // Find and reduce/delete the on_reserved_gd record for this excess
      // The excess.handling_unit_id + excess.material_id + excess.quantity
      // identifies what to release
      allRecordsToUpdate.push({
        collection: "on_reserved_gd",
        filter: {
          doc_id: docId,
          handling_unit_id: excess.handling_unit_id,
          material_id: excess.material_id,
          status: "Allocated",
        },
        action: "reduce_or_delete",
        reduce_qty: excess.quantity,
      });
    }
  } catch (e) {
    console.error("Error processing excess data:", e);
  }
}
```

**IMPORTANT:** The exact structure of `allRecordsToUpdate` and how records are created/updated varies by the existing code. Read the file first and adapt to the existing patterns for on_reserved_gd manipulation. Do NOT assume the structure above is correct — it's a conceptual guide.

- [ ] **Step 4: Commit**

```
feat: reserve full HU qty and auto-release excess at GD Completed
```

---

## Task 7: Modify GDgdQtyValidation — Account for Whole-HU Allocation

**Files:**
- Modify: `Goods Delivery/GDgdQtyValidation.js`

**Context:** This validation fires per-row when user changes `gd_qty`. Currently it checks `quantity > orderLimit` (line 145). For FULL_HU_PICK/NO_SPLIT, the user doesn't manually set gd_qty from the HU — the whole-HU allocation is in temp_qty_data. The `gd_qty` field represents the ORDER quantity, not the picked quantity. So this validation should remain as-is — it validates the order quantity against stock, not the HU pick.

However: if the user manually changes `gd_qty` after a whole-HU allocation exists, we need to verify this doesn't clear the `temp_qty_data`.

- [ ] **Step 1: Read GDgdQty.js lines 189-194 and GDgdQtyValidation.js**

Check if changing `gd_qty` clears `temp_qty_data`. In GDgdQty.js, search for any `temp_qty_data: "[]"` or similar reset.

- [ ] **Step 2: If temp_qty_data is cleared on gd_qty change, guard it**

If the code resets `temp_qty_data` when `gd_qty` changes, add a guard for whole-HU allocations:

```javascript
// Before clearing temp_qty_data, check if it contains HU allocations from whole-HU policy
const existingTemp = data.table_gd[rowIndex].temp_qty_data;
if (existingTemp && existingTemp !== "[]") {
  const tempArray = JSON.parse(existingTemp);
  const hasHuAllocation = tempArray.some((t) => t.handling_unit_id);
  if (hasHuAllocation) {
    // Don't clear — this was set by whole-HU pick, not manual allocation
    // Just update delivery qty calculations
    this.setData({
      [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
      [`table_gd.${rowIndex}.gd_undelivered_qty`]: roundQty(orderedQty - totalDeliveredQty),
    });
    return;
  }
}
```

- [ ] **Step 3: Commit**

```
fix: preserve whole-HU allocation data when gd_qty changes
```

---

## Verification Checklist

After all tasks are complete, verify in the low-code platform:

- [ ] **V1:** Set split_policy to empty/null → confirm ALLOW_SPLIT behavior (partial picks work as before)
- [ ] **V2:** Set split_policy to "FULL_HU_PICK" → open inventory dialog → verify deliver_quantity fields locked, checkbox on HU header
- [ ] **V3:** FULL_HU_PICK: select HU with mixed items → confirm → verify matching lines auto-populated, foreign items in temp_excess_data
- [ ] **V4:** FULL_HU_PICK: open another line's dialog → verify HU from V3 is disabled ("Already allocated")
- [ ] **V5:** FULL_HU_PICK auto-allocation → verify whole HUs selected, no partial
- [ ] **V6:** Set split_policy to "NO_SPLIT" → open dialog → verify HUs with foreign items are shown but disabled
- [ ] **V7:** NO_SPLIT: select multiple HUs exceeding GD qty → verify tolerance validation at confirm
- [ ] **V8:** NO_SPLIT auto-allocation → verify only eligible HUs considered
- [ ] **V9:** Save as Created → verify full HU qty in on_reserved_gd
- [ ] **V10:** Save as Completed with excess → verify excess released from on_reserved_gd
- [ ] **V11:** Loose stock tab → verify unchanged behavior for all policies
