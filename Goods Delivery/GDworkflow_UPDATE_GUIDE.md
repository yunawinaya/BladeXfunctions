# Goods Delivery Workflow Update Guide

## Overview
Add support for `pendingReservedData` allocation with Production priority.

---

## Changes Required

### 1. Update `prepareAllocationData` Node

**Location:** First code node in workflow

**File:** [GDworkflow_prepareAllocationData.js](GDworkflow_prepareAllocationData.js)

**Change:** Add `soLineItemId: row.so_line_item_id || null` to the `rowsNeedingAllocation` object

**Why:** We need the SO line item ID to fetch pending reserved data

---

### 2. Add New Search Node: "Get Pending Reserved"

**Location:** Inside the loop, **BEFORE** `executeAllocation` node

**Node Type:** Search Node

**Node Name:** `search_node_PendingReserved`

**Title:** "Get Pending Reserved"

**Collection:** `on_reserved_gd`

**Filter Rules:**
```javascript
{
  "list": [
    {
      "type": "branch",
      "operator": "all",
      "children": [
        {
          "prop": "plant_id",
          "operator": "numberEqual",
          "valueType": "field",
          "value": "{{node:code_node_aay7z3VT.data.currentRow.plantId}}",
          "propLabel": "Plant ID",
          "operatorLabel": "Equal"
        },
        {
          "prop": "material_id",
          "operator": "numberEqual",
          "valueType": "field",
          "value": "{{node:code_node_aay7z3VT.data.currentRow.materialId}}",
          "propLabel": "Material ID",
          "operatorLabel": "Equal"
        },
        {
          "prop": "parent_line_id",
          "operator": "equal",
          "valueType": "field",
          "value": "{{node:code_node_aay7z3VT.data.currentRow.soLineItemId}}",
          "propLabel": "Parent Line ID",
          "operatorLabel": "Equal"
        },
        {
          "prop": "status",
          "operator": "equal",
          "valueType": "value",
          "value": "Pending",
          "propLabel": "Status",
          "operatorLabel": "Equal"
        }
      ]
    }
  ]
}
```

**Limit:** 100

**Purpose:** Fetches pending reserved allocations for the current row (max 2: Production and Sales Order)

---

### 3. Update `executeAllocation` Node

**Location:** Inside the loop, code node that performs allocation

**File:** [GDworkflow_executeAllocation.js](GDworkflow_executeAllocation.js)

**Changes:**
1. Add input: `const pendingReservedData = {{node:search_node_PendingReserved.data.data}} || [];`
2. Add STEP 0: Prioritize pending reserved data (Production first)
3. Keep STEP 1: Apply strategy for remaining qty (only if remainingQty > 0)

**Key Logic:**
- Sort `pendingReservedData` to prioritize "Production" doc_type over "Sales Order"
- Allocate from reserved bins/batches first
- Reduce `remainingQty` as reserved allocations are made
- Apply FIXED BIN/RANDOM strategy only if `remainingQty > 0`

---

## Workflow Node Order (Inside Loop)

```
Loop rowsNeedingAllocation
├── Get tableGD (cache)
├── Get allocationTracker (cache)
├── Get allocationIndex (cache)
├── getCurrentRowData (code)
├── Get Item (search)
├── IF Batch (conditional)
│   ├── TRUE: Get Batch, Get Item Batch Balance
│   └── FALSE: Get Item Balance
├── 🆕 Get Pending Reserved (search) ⬅️ ADD THIS
├── executeAllocation (code) ⬅️ UPDATE THIS
├── updateRowInTableGd (code)
├── Set tableGD (cache)
├── Set allocationTracker (cache)
└── Set allocationIndex (cache)
```

---

## Testing Scenarios

### Scenario 1: Production + Sales Order Reservations
- Pending Production: 50 qty at location B
- Pending Sales Order: 50 qty at location A
- Requested gd_qty: 80

**Expected Result:**
- Location B: 50 qty (from Production reservation)
- Location A: 30 qty (from Sales Order reservation)
- Strategy step: SKIPPED (remainingQty = 0)

### Scenario 2: Partial Reserved + Strategy
- Pending Production: 30 qty at location B
- Requested gd_qty: 80

**Expected Result:**
- Location B: 30 qty (from Production reservation)
- Other locations: 50 qty (from FIXED BIN/RANDOM strategy)

### Scenario 3: No Reservations
- No pending reservations
- Requested gd_qty: 80

**Expected Result:**
- Allocation purely from FIXED BIN/RANDOM strategy (existing behavior)

---

## Rollback Plan

If issues occur:
1. Remove the "Get Pending Reserved" search node
2. Revert `executeAllocation` to previous version (without STEP 0)
3. Revert `prepareAllocationData` (remove `soLineItemId` extraction)

---

## Files Reference

- `GDworkflow_prepareAllocationData.js` - Updated prepareAllocationData code
- `GDworkflow_executeAllocation.js` - Updated executeAllocation code with pending reserved priority
- `GDinventoryDialog.js` - Frontend inventory dialog (already updated)
- `GDaddBatchLineItem_OPTIMIZED.js` - Frontend SO item processing (already updated)

---

## Notes

- The `pendingReservedData` will have max 2 records: one for Production and one for Sales Order
- Production is always prioritized first
- If all qty is fulfilled from reservations, strategy step is automatically skipped
- Cross-row deduplication still applies (using allocationTracker)
