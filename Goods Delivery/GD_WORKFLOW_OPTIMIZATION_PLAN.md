# GD Workflow Optimization: Combining Two Loops

## Executive Summary

**Goal:** Combine the Auto Allocation loop and the Quantity Validation/SO Update loop into a single optimized loop to reduce database calls and improve performance.

**Verdict:** Yes, it is possible to combine these loops, but requires careful restructuring due to their different trigger conditions and data dependencies.

---

## Step-by-Step Implementation Guide

### Phase 1: Preparation (Before Making Changes)

**Step 1.1: Backup**
- [ ] Export/save your current `GOODS_DELIVERY_WORKFLOW.json` as backup

**Step 1.2: Identify the key nodes in your workflow**
- [ ] Find `loop_jK0Md0dS` (Loop rowsNeedingAllocation) - this will be **DELETED**
- [ ] Find `loop_ZVa7Cxf6` (Loop TableGD) - this will be **MODIFIED**
- [ ] Find `code_node_IyJHrBst` (fillbackHeaderFields) - this will be **MODIFIED**
- [ ] Find `code_node_ymugKpln` (mergeTableGd) - this will be **DELETED**

---

### Phase 2: Add Cache Initialization (BEFORE the combined loop)

**Step 2.1: Add these Set Cache nodes BEFORE the Loop TableGD starts:**

| Order | Cache Key | Initial Value | Purpose |
|-------|-----------|---------------|---------|
| 1 | `tableGD_{unique}` | `{{workflowparams:allData.table_gd}}` | Store tableGD for updates |
| 2 | `allocationTracker_{unique}` | `{}` | Track allocations across rows |
| 3 | `loopIndex_{unique}` | `0` | Track current row index |
| 4 | `updatedSOTable_{unique}` | `[]` | Accumulate SO updates |

**Step 2.2: Move UOM and BinLocation fetches BEFORE the loop**
- [ ] Move `search_node_pltmkkw3` (Get UOMs) before the loop
- [ ] Move `search_node_nbpWEAFx` (Get BinLocations) before the loop

---

### Phase 3: Modify Loop TableGD (The Combined Loop)

**Step 3.1: At the START of each loop iteration, add Get Cache nodes:**
```
get_cache_node_tableGD         → retrieves tableGD
get_cache_node_loopIndex       → retrieves current index
get_cache_node_allocationTracker → retrieves tracker
get_cache_node_updatedSOTable  → retrieves SO updates
```

**Step 3.2: Replace `gdItem Preparation` node with `combinedRowPreparation`**
- [ ] Use the code from "Node 1: combinedRowPreparation" section below
- [ ] This node now checks `needsAllocation` flag

**Step 3.3: Add conditional data fetches (IF needsAllocation === 1)**
```
IF {{node:combinedRowPreparation.data.needsAllocation}} === 1:
├── IF Batch Managed → Get Batch, Search Item Batch Balance
├── ELSE → Search Item Balance
└── Search Pending Reserved
```

**Step 3.4: Add `executeAllocationIfNeeded` node**
- [ ] Use the code from "Node 2: executeAllocationIfNeeded" section below
- [ ] Place AFTER the conditional data fetches

**Step 3.5: Modify `Validate Quantity & Update SO Table` node**
- [ ] Use the code from "Node 3: validateAndUpdateSO" section below
- [ ] Key change: Use `prepData.gd_status` instead of `code_node_IyJHrBst.data.gd_status`

**Step 3.6: Add `updateTableGDRow` node**
- [ ] Use the code from "Node 4: updateTableGDRow" section below
- [ ] Place AFTER validation

**Step 3.7: At the END of each loop iteration, add Set Cache nodes:**
```
set_cache_node_tableGD         → saves {{node:updateTableGDRow.data.tableGD}}
set_cache_node_loopIndex       → saves {{node:combinedRowPreparation.data.nextIndex}}
set_cache_node_allocationTracker → saves {{node:updateTableGDRow.data.updatedTracker}}
set_cache_node_updatedSOTable  → saves {{node:validateAndUpdateSO.data.updatedSOTable}}
```

---

### Phase 4: Update fillbackHeaderFields

**Step 4.1: Add a Get Cache node BEFORE fillbackHeaderFields**
- [ ] Node name: `get_cache_node_finalTableGD`
- [ ] Cache key: `tableGD_{unique}` (same key as the loop uses)

**Step 4.2: Modify fillbackHeaderFields to use cache**
- [ ] Change from: `{{node:code_node_ymugKpln.data.table_gd}}`
- [ ] Change to: Use the cached tableGD (see "fillbackHeaderFields Modification" section below)

---

### Phase 5: Delete Old Nodes

**Delete these nodes (they're no longer needed):**
- [ ] `loop_jK0Md0dS` (entire Loop rowsNeedingAllocation block)
- [ ] `code_node_kJx9p9Nh` (prepareAllocationData)
- [ ] `code_node_SqL4Tv8v` (collectIdsForBatchFetch)
- [ ] `code_node_aay7z3VT` (getCurrentRowData)
- [ ] `code_node_Zlv6p9K8` (executeAllocation)
- [ ] `code_node_56IOJIBu` (updateRowInTableGd)
- [ ] `code_node_ymugKpln` (mergeTableGd)
- [ ] All cache nodes that were specific to the old allocation loop

---

### Phase 6: Test

**Test these scenarios:**
- [ ] Draft save (loop should not run)
- [ ] Auto Picking Mode + new GD (should allocate + validate)
- [ ] Manual bin selection (should skip allocation, still validate)
- [ ] Mixed rows (some auto, some manual)
- [ ] Created status → Completed (quantity change calculation)
- [ ] Cancellation

---

### Visual Summary

```
BEFORE:                              AFTER:
═══════                              ═════

┌─────────────────┐                  ┌─────────────────┐
│ IF Auto Mode    │                  │ Set Caches      │
│ ┌─────────────┐ │                  │ (tableGD,       │
│ │ Loop 1      │ │  ──DELETE──►     │  tracker, etc)  │
│ │ (Allocation)│ │                  └────────┬────────┘
│ └─────────────┘ │                           │
│ mergeTableGd    │                           ▼
└────────┬────────┘                  ┌─────────────────┐
         │                           │ Combined Loop   │
         ▼                           │ ┌─────────────┐ │
┌─────────────────┐                  │ │ Prep        │ │
│ fillbackHeader  │                  │ │ Allocate?   │ │
└────────┬────────┘                  │ │ Validate    │ │
         │                           │ │ Update      │ │
         ▼                           │ └─────────────┘ │
┌─────────────────┐                  └────────┬────────┘
│ IF !Draft       │                           │
│ ┌─────────────┐ │                           ▼
│ │ Loop 2      │ │  ──MODIFY──►     ┌─────────────────┐
│ │ (Validate)  │ │                  │ Get final cache │
│ └─────────────┘ │                  └────────┬────────┘
└─────────────────┘                           │
                                              ▼
                                     ┌─────────────────┐
                                     │ fillbackHeader  │
                                     │ (reads cache)   │
                                     └─────────────────┘
```

---

## Current Workflow Analysis

### Loop 1: Auto Allocation (loop_jK0Md0dS)
- **Trigger:** Auto Picking Mode enabled AND rows need allocation
- **Iterates over:** `rowsNeedingAllocation` (rows with gd_qty > 0, no temp_qty_data)
- **Purpose:** Assign inventory allocations (creates temp_qty_data, view_stock)
- **Key Operations:**
  1. Get Item (per row)
  2. Get Batch / Item Balance (conditional on batch management)
  3. Get Pending Reserved (on_reserved_gd)
  4. Execute allocation logic
  5. Update tableGD in cache

### Loop 2: Quantity Validation & SO Update (loop_ZVa7Cxf6)
- **Trigger:** saveAs !== "Draft"
- **Iterates over:** ALL rows in tableGD
- **Purpose:** Validate quantities, prepare SO line updates
- **Key Operations:**
  1. Get Item (per row) - **DUPLICATE!**
  2. Get SO Line (per row)
  3. Validate quantity against order limits
  4. **Nested Loop (tempData):**
     - Get Item Batch Balance / Item Balance (per bin location)
     - Get Pending Reserved (on_reserved_gd)
     - Validate inventory availability

### Critical Data Flow
```
Loop 1 (Allocation)
      ↓
mergeTableGd + fillbackHeaderFields
      ↓
Loop 2 (Validation) ← depends on temp_qty_data from Loop 1
```

---

## Identified Redundancies

| Operation | Loop 1 | Loop 2 | Potential Savings |
|-----------|--------|--------|-------------------|
| Get Item | 1x per row | 1x per row | 50% reduction |
| Batch check logic | Yes | Yes | Consolidate |
| Get Pending Reserved | 1x per row | 1x per tempData item | Partial reuse |
| Cache get/set | 6 per iteration | 4 per iteration | Reduce overhead |

---

## Proposed Optimization Plan

### New Combined Loop Structure

Replace the two separate loops with a single loop that processes all tableGD rows:

```
Combined Loop: ALL tableGD rows
├── Step 1: Check if row needs allocation (gd_qty > 0, no temp_qty_data)
├── Step 2: Fetch shared data (Item, SO Line, Balances, Pending Reserved)
├── Step 3: IF needs allocation → Execute allocation logic
├── Step 4: Validate quantity against order limits
├── Step 5: Validate inventory availability (nested tempData loop)
├── Step 6: Build updatedSOTable entry
└── Step 7: Update cache with all results
```

### Workflow Structure Changes

#### Nodes to DELETE:
1. `loop_jK0Md0dS` (Loop rowsNeedingAllocation) - entire loop block
2. `code_node_kJx9p9Nh` (prepareAllocationData)
3. `code_node_SqL4Tv8v` (collectIdsForBatchFetch)
4. `code_node_aay7z3VT` (getCurrentRowData) - inside Loop 1
5. `code_node_56IOJIBu` (updateRowInTableGd)
6. `code_node_ymugKpln` (mergeTableGd)
7. `get_cache_node_wiBIs4cB` (Get allocated tableGD)
8. Multiple cache set/get nodes for allocation tracking

#### Nodes to MODIFY:
1. `code_node_hb8ZWe9c` (TableGD Data) - enhance to include allocation preparation
2. `code_node_SOBNriDH` (gdItem Preparation) - add allocation need detection
3. `code_node_muzjP26e` (Validate Quantity & Update SO Table) - integrate allocation logic

#### Nodes to ADD:
1. New combined preparation node that:
   - Checks if row needs allocation
   - Includes all data needed for both allocation and validation
2. New combined execution node that:
   - Performs allocation if needed
   - Validates quantities
   - Updates SO table data

---

## Node-by-Node Change Summary

### Nodes to Delete
| Node ID | Name | Reason |
|---------|------|--------|
| loop_jK0Md0dS | Loop rowsNeedingAllocation | Replaced by combined loop |
| code_node_kJx9p9Nh | prepareAllocationData | Merged into new prep node |
| code_node_SqL4Tv8v | collectIdsForBatchFetch | No longer needed |
| code_node_aay7z3VT | getCurrentRowData | Merged into new prep node |
| code_node_Zlv6p9K8 | executeAllocation | Merged into combined node |
| code_node_56IOJIBu | updateRowInTableGd | Merged into combined node |
| code_node_ymugKpln | mergeTableGd | No longer needed |
| set_cache_node_qbPyqWAt | Set tableGD (Loop 1) | No longer needed |
| set_cache_node_zI6dkbWZ | Set allocationTracker | Simplified |
| set_cache_node_cysmSDlD | Set allocationIndex | No longer needed |
| get_cache_node_6hmHAVwX | Get tableGD (Loop 1) | No longer needed |
| get_cache_node_QGhmYUxQ | Get allocationTracker | Simplified |
| get_cache_node_ih80ef3f | Get allocationIndex | No longer needed |

### Nodes to Modify
| Node ID | Name | Changes |
|---------|------|---------|
| code_node_hb8ZWe9c | TableGD Data | Add allocation tracking initialization |
| code_node_SOBNriDH | gdItem Preparation | Add needsAllocation flag, merge with getCurrentRowData |
| code_node_muzjP26e | Validate Quantity & Update SO Table | Integrate allocation execution |
| code_node_IyJHrBst | fillbackHeaderFields | **CRITICAL:** Change table_gd source from `mergeTableGd` to cache |

### fillbackHeaderFields Modification

Since `mergeTableGd` is deleted and the combined loop now populates tableGD with `temp_qty_data` before `fillbackHeaderFields` runs, you must update `fillbackHeaderFields` to get tableGD from cache:

**Before:**
```javascript
// Inside fillbackHeaderFields
const tableGD = {{node:code_node_ymugKpln.data.table_gd}}; // from mergeTableGd
```

**After:**
```javascript
// Inside fillbackHeaderFields
// Get tableGD from cache (populated by combined loop with temp_qty_data)
const rawTableGD = {{node:get_cache_node_finalTableGD.data}};
let tableGD = [];
if (rawTableGD) {
  if (typeof rawTableGD === 'string') {
    try {
      tableGD = JSON.parse(rawTableGD);
    } catch (e) {
      tableGD = {{workflowparams:allData.table_gd}} || [];
    }
  } else if (Array.isArray(rawTableGD)) {
    tableGD = rawTableGD;
  }
} else {
  tableGD = {{workflowparams:allData.table_gd}} || [];
}
```

**Note:** You need to add a `get_cache_node_finalTableGD` node before `fillbackHeaderFields` that retrieves the final tableGD from cache after the combined loop completes.

### Nodes to Add
| Name | Purpose |
|------|---------|
| combinedPreparation | Merge prep logic from both loops |
| executeAllocationIfNeeded | Conditional allocation within combined flow |

---

## Expected Benefits

1. **Database Call Reduction:**
   - Eliminates duplicate Item fetches per row
   - Consolidates balance queries where possible
   - ~30-50% reduction in total database calls

2. **Cache Operation Reduction:**
   - Fewer cache get/set operations per iteration
   - Single loop means single set of cache tracking variables

3. **Code Maintainability:**
   - Single loop is easier to understand and debug
   - Allocation and validation logic co-located
   - Clearer data flow

4. **Processing Time:**
   - Fewer loop iterations overall
   - Reduced workflow node hops

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Complex merge may introduce bugs | Thorough testing with all scenarios |
| Different trigger conditions | Clear conditional logic within combined loop |
| Data dependency on allocation results | Ensure allocation completes before validation |
| Rollback complexity | Keep backup of original workflow |

---

## Testing Plan

1. **Scenario: Auto Picking Mode + New GD**
   - Rows needing allocation → should allocate then validate

2. **Scenario: Auto Picking Mode + Existing GD**
   - Some rows with allocation, some without → mixed processing

3. **Scenario: Manual Picking Mode**
   - No allocation needed → validation only

4. **Scenario: Draft Save**
   - Neither loop should run for validation

5. **Scenario: Cancellation**
   - Proper handling of cancelled status

6. **Scenario: Mixed Allocation Sources**
   - Some rows auto-allocated, some manually selected → validation for all

---

## Verification

After implementation:
1. Test all save scenarios (Draft, Created, Completed, Cancelled)
2. Verify allocation data is correctly populated
3. Verify SO line updates are accurate
4. Monitor workflow execution time improvement
5. Check for any edge cases with batch-managed items

---

## Implementation Code

### Node 1: Combined Preparation Node (Replace `gdItem Preparation`)

**Node Name:** `combinedRowPreparation`
**Purpose:** Prepare row data and determine if allocation is needed

```javascript
// combinedRowPreparation
// ============================================================================
// IMPORTANT: This node runs BEFORE fillbackHeaderFields, so we use:
// - workflowparams for allData, saveAs, gd_status
// - get_node_xTRvHWB8 for original GD data (fetched before this loop)
// - cache for tableGD (initialized before loop starts)
// ============================================================================

// Helper function to safely parse JSON
const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

// Get allData from workflowparams (NOT from fillbackHeaderFields)
const allData = {{workflowparams:allData}};

// Get tableGD from cache (updated during loop iterations)
const rawTableGD = {{node:get_cache_node_tableGD.data}};
let tableGD = [];
if (rawTableGD) {
  if (typeof rawTableGD === 'string') {
    try {
      tableGD = JSON.parse(rawTableGD);
    } catch (e) {
      tableGD = allData.table_gd || [];
    }
  } else if (Array.isArray(rawTableGD)) {
    tableGD = rawTableGD;
  } else {
    tableGD = allData.table_gd || [];
  }
} else {
  tableGD = allData.table_gd || [];
}

const pickingSetup = {{node:get_node_iFPuvJX2.data.data}};
const isAutoPickingMode = pickingSetup?.picking_mode === "Auto";

const currentIndexRaw = {{node:get_cache_node_loopIndex.data}};
const index = currentIndexRaw ? parseInt(currentIndexRaw, 10) : 0;

const gdItem = tableGD[index];
const material_id = gdItem.material_id;
const parentLineId = gdItem.so_line_item_id;
const gdQty = parseFloat(gdItem.gd_qty) || 0;

// Parse existing temp_qty_data
const tempDataRaw = gdItem.temp_qty_data;
const hasTempData = tempDataRaw &&
                    tempDataRaw !== "[]" &&
                    tempDataRaw.trim() !== "";
const tempData = parseJsonSafely(tempDataRaw);

// Determine if this row needs auto-allocation
// Conditions: Auto Picking Mode enabled + has quantity + no existing allocation + has material
const needsAllocation = isAutoPickingMode &&
                        gdQty > 0 &&
                        !hasTempData &&
                        material_id;

// Get gd_status from workflowparams (NOT from fillbackHeaderFields)
// gd_status is set from the original GD record's status field
const saveAs = {{workflowparams:saveAs}};
const originalGD = {{node:get_node_xTRvHWB8.data.data}};
const gd_status = originalGD ? originalGD.status : "Draft";

// For Created status, get original GD item for comparison
let originalGdItem = null;
if (gd_status === "Created" && originalGD) {
  const originalTableGD = originalGD.table_gd || [];
  originalGdItem = originalTableGD.find(item => item.so_line_item_id === gdItem.so_line_item_id) || null;
}

return {
  gdItem: gdItem,
  material_id: material_id,
  parentLineId: parentLineId,
  gdQty: gdQty,
  index: index,
  nextIndex: index + 1,
  tempData: tempData,
  hasTempData: hasTempData,
  needsAllocation: needsAllocation ? 1 : 0,
  originalGdItem: originalGdItem,
  plantId: allData.plant_id,
  organizationId: allData.organization_id,
  uomId: gdItem.gd_order_uom_id,
  isAutoPickingMode: isAutoPickingMode ? 1 : 0,
  gd_status: gd_status,
  saveAs: saveAs
};
```

### Node 2: Execute Allocation If Needed

**Node Name:** `executeAllocationIfNeeded`
**Purpose:** Run allocation logic only for rows that need it, then pass through to validation

**Note:** This node should be placed AFTER the data fetches (Get Item, Get Batch/Item Balance, Get Pending Reserved) and should run conditionally when `needsAllocation === 1`.

```javascript
// executeAllocationIfNeeded
// ============================================================================
// This node combines allocation execution with validation preparation
// ============================================================================

const prepData = {{node:combinedRowPreparation.data}};
const itemData = {{node:get_node_DDcDRdMe.data.data}};
const pickingSetup = {{node:get_node_iFPuvJX2.data.data}};
const isBatchManaged = itemData.item_batch_management === 1;

// Get pre-fetched data
const allUOMs = {{node:search_node_pltmkkw3.data.data}} || [];
const allBinLocations = {{node:search_node_nbpWEAFx.data.data}} || [];
const pendingReservedData = {{node:search_node_1KCBFU3W.data.data}} || [];

// Get balance data based on batch management
let balances = [];
let batchMasterData = [];

if (isBatchManaged) {
  batchMasterData = {{node:search_node_9fEXFXTX.data.data}} || [];
  balances = {{node:search_node_Osh9qIRX.data.data}} || [];
} else {
  balances = {{node:search_node_l1dv5zjL.data.data}} || [];
}

// Get allocation tracker from cache
const rawTracker = {{node:get_cache_node_allocationTracker.data}};
let allocationTracker = {};

if (rawTracker) {
  if (typeof rawTracker === 'string') {
    try {
      allocationTracker = JSON.parse(rawTracker);
    } catch (e) {
      allocationTracker = {};
    }
  } else if (typeof rawTracker === 'object') {
    allocationTracker = rawTracker;
  }
}

// ============================================================================
// HELPER FUNCTIONS (same as original executeAllocation)
// ============================================================================

const getDefaultBin = (itemData, plantId) => {
  if (!itemData.table_default_bin?.length) return null;
  const entry = itemData.table_default_bin.find(bin => bin.plant_id === plantId);
  return entry?.bin_location || null;
};

const getCurrentAllocations = (materialId, currentRowIndex, tracker) => {
  const materialAllocations = tracker[materialId] || {};
  const allocatedQuantities = {};

  Object.entries(materialAllocations).forEach(([rIdx, rowAllocs]) => {
    if (parseInt(rIdx) !== currentRowIndex) {
      Object.entries(rowAllocs).forEach(([locationKey, qty]) => {
        allocatedQuantities[locationKey] = (allocatedQuantities[locationKey] || 0) + qty;
      });
    }
  });

  return allocatedQuantities;
};

const applyAllocationsToBalances = (balances, allocatedQuantities, isBatchManaged) => {
  return balances.map(balance => {
    const key = isBatchManaged
      ? `${balance.location_id}-${balance.batch_id || "no_batch"}`
      : `${balance.location_id}`;

    const allocatedFromOthers = allocatedQuantities[key] || 0;
    const originalQty = balance.unrestricted_qty || 0;
    const adjustedQty = Math.max(0, originalQty - allocatedFromOthers);

    return {
      ...balance,
      unrestricted_qty: adjustedQty,
      original_unrestricted_qty: originalQty
    };
  });
};

const findBatchData = (batchId) => {
  if (!isBatchManaged || !batchMasterData.length) return null;
  return batchMasterData.find(b => b.id === batchId) || null;
};

const getBinLocationDetails = (locationId) => {
  const binLocation = allBinLocations.find(bin => bin.id === locationId);
  return binLocation ? binLocation.bin_location_combine : locationId;
};

const getUOMName = (uomId) => {
  const uom = allUOMs.find(u => u.id === uomId);
  return uom ? uom.uom_name : "";
};

// ============================================================================
// MAIN LOGIC: Allocate if needed, otherwise pass through existing data
// ============================================================================

let finalTempQtyData = prepData.tempData;
let finalViewStock = prepData.gdItem.view_stock || "";
let updatedTracker = allocationTracker;

if (prepData.needsAllocation === 1) {
  // ============================================================================
  // ALLOCATION LOGIC (from original executeAllocation)
  // ============================================================================

  const currentRow = {
    rowIndex: prepData.index,
    materialId: prepData.material_id,
    quantity: prepData.gdQty,
    uomId: prepData.uomId,
    plantId: prepData.plantId,
    organizationId: prepData.organizationId,
    soLineItemId: prepData.parentLineId
  };

  const allocatedFromOtherRows = getCurrentAllocations(
    currentRow.materialId,
    currentRow.rowIndex,
    allocationTracker
  );

  const adjustedBalances = applyAllocationsToBalances(
    balances,
    allocatedFromOtherRows,
    isBatchManaged
  );

  let allAllocations = [];
  let remainingQty = currentRow.quantity;

  // STEP 0: Prioritize pending reserved data (Production first)
  if (pendingReservedData.length > 0 && currentRow.soLineItemId) {
    const sortedReservedData = [...pendingReservedData].sort((a, b) => {
      if (a.doc_type === "Production" && b.doc_type !== "Production") return -1;
      if (a.doc_type !== "Production" && b.doc_type === "Production") return 1;
      return 0;
    });

    for (const reservation of sortedReservedData) {
      if (remainingQty <= 0) break;

      const reservedQty = parseFloat(reservation.open_qty || 0);
      if (reservedQty <= 0) continue;

      const matchingBalance = adjustedBalances.find((b) => {
        const binMatch = b.location_id === reservation.bin_location;
        if (isBatchManaged) {
          return binMatch && b.batch_id === reservation.batch_id;
        }
        return binMatch;
      });

      if (matchingBalance) {
        const availableQty = matchingBalance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, reservedQty, availableQty);

        if (allocatedQty > 0) {
          const binLocationName = getBinLocationDetails(matchingBalance.location_id);
          const batchData = isBatchManaged ? findBatchData(matchingBalance.batch_id) : null;

          const existingAllocIndex = allAllocations.findIndex((a) => {
            const locMatch = a.balance.location_id === matchingBalance.location_id;
            if (isBatchManaged) {
              return locMatch && a.batchData?.id === matchingBalance.batch_id;
            }
            return locMatch;
          });

          if (existingAllocIndex >= 0) {
            allAllocations[existingAllocIndex].quantity += allocatedQty;
          } else {
            allAllocations.push({
              balance: matchingBalance,
              quantity: allocatedQty,
              binLocation: binLocationName,
              batchData: batchData,
              source: `Reserved (${reservation.doc_type})`
            });
          }

          remainingQty -= allocatedQty;
          matchingBalance.unrestricted_qty = Math.max(0, matchingBalance.unrestricted_qty - allocatedQty);
        }
      }
    }
  }

  // STEP 1: Apply strategy for remaining qty
  if (remainingQty > 0) {
    const defaultBin = getDefaultBin(itemData, currentRow.plantId);
    const defaultStrategy = pickingSetup.default_strategy_id;
    const fallbackStrategy = pickingSetup.fallback_strategy_id;

    const sortByFIFO = (balanceArray) => {
      if (!isBatchManaged) return balanceArray;
      return balanceArray.sort((a, b) => {
        const batchA = findBatchData(a.batch_id);
        const batchB = findBatchData(b.batch_id);
        if (batchA?.expired_date && batchB?.expired_date) {
          return new Date(batchA.expired_date) - new Date(batchB.expired_date);
        }
        return (batchA?.batch_number || "").localeCompare(batchB?.batch_number || "");
      });
    };

    const allocateFromBalances = (balanceList) => {
      const allocated = [];
      for (const balance of balanceList) {
        if (remainingQty <= 0) break;
        const availableQty = balance.unrestricted_qty || 0;
        if (availableQty <= 0) continue;

        const allocatedQty = Math.min(remainingQty, availableQty);
        const binLocationName = getBinLocationDetails(balance.location_id);
        const batchData = isBatchManaged ? findBatchData(balance.batch_id) : null;

        allocated.push({
          balance: balance,
          quantity: allocatedQty,
          binLocation: binLocationName,
          batchData: batchData,
          source: "Strategy"
        });
        remainingQty -= allocatedQty;
      }
      return allocated;
    };

    const allocatedKeys = new Set(
      allAllocations.map((a) =>
        isBatchManaged
          ? `${a.balance.location_id}-${a.batchData?.id || "no_batch"}`
          : `${a.balance.location_id}`
      )
    );

    const remainingBalances = adjustedBalances.filter((b) => {
      const key = isBatchManaged
        ? `${b.location_id}-${b.batch_id || "no_batch"}`
        : `${b.location_id}`;
      return !allocatedKeys.has(key) && (b.unrestricted_qty || 0) > 0;
    });

    if (defaultStrategy === "FIXED BIN") {
      if (defaultBin) {
        const defaultBinBalances = remainingBalances.filter(b => b.location_id === defaultBin);
        const sortedDefaultBalances = sortByFIFO(defaultBinBalances);
        allAllocations.push(...allocateFromBalances(sortedDefaultBalances));
      }

      if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
        const otherBalances = remainingBalances.filter(b => !defaultBin || b.location_id !== defaultBin);
        const sortedOtherBalances = sortByFIFO(otherBalances);
        allAllocations.push(...allocateFromBalances(sortedOtherBalances));
      }
    } else if (defaultStrategy === "RANDOM") {
      const sortedBalances = sortByFIFO(remainingBalances);
      allAllocations.push(...allocateFromBalances(sortedBalances));
    }
  }

  // Build temp_qty_data array
  const tempQtyData = allAllocations.map(alloc => ({
    material_id: currentRow.materialId,
    location_id: alloc.balance.location_id,
    block_qty: alloc.balance.block_qty,
    reserved_qty: alloc.balance.reserved_qty,
    unrestricted_qty: alloc.balance.original_unrestricted_qty || alloc.balance.unrestricted_qty,
    qualityinsp_qty: alloc.balance.qualityinsp_qty,
    intransit_qty: alloc.balance.intransit_qty,
    balance_quantity: alloc.balance.balance_quantity,
    plant_id: currentRow.plantId,
    organization_id: alloc.balance.organization_id,
    is_deleted: 0,
    gd_quantity: alloc.quantity,
    ...(alloc.batchData && { batch_id: alloc.batchData.id })
  }));

  // Build view_stock summary
  const uomName = getUOMName(currentRow.uomId);
  const summaryLines = allAllocations.map((alloc, idx) => {
    let line = `${idx + 1}. ${alloc.binLocation}: ${alloc.quantity} ${uomName}`;
    if (alloc.batchData) {
      line += `\n[${alloc.batchData.batch_number}]`;
    }
    return line;
  });

  const totalAllocated = allAllocations.reduce((sum, alloc) => sum + alloc.quantity, 0);
  finalViewStock = totalAllocated > 0
    ? `Total: ${totalAllocated} ${uomName}\n\nDETAILS:\n${summaryLines.join("\n")}`
    : "";

  finalTempQtyData = tempQtyData;

  // Update allocation tracker
  updatedTracker = { ...allocationTracker };
  if (!updatedTracker[currentRow.materialId]) {
    updatedTracker[currentRow.materialId] = {};
  }

  const rowAllocations = {};
  allAllocations.forEach(alloc => {
    const key = alloc.batchData
      ? `${alloc.balance.location_id}-${alloc.batchData.id}`
      : `${alloc.balance.location_id}`;
    rowAllocations[key] = alloc.quantity;
  });

  updatedTracker[currentRow.materialId][currentRow.rowIndex] = rowAllocations;
}

return {
  tempQtyData: JSON.stringify(finalTempQtyData),
  tempDataArray: finalTempQtyData,
  viewStock: finalViewStock,
  rowIndex: prepData.index,
  updatedTracker: updatedTracker,
  wasAllocated: prepData.needsAllocation
};
```

### Node 3: Combined Validate & Update SO (Modify existing `code_node_muzjP26e`)

**Node Name:** `validateAndUpdateSO`
**Purpose:** Validate quantities and build SO update, using allocation results

```javascript
// validateAndUpdateSO
// ============================================================================
// Combined validation and SO update preparation
// IMPORTANT: This node runs BEFORE fillbackHeaderFields, so we use:
// - prepData.gd_status and prepData.saveAs (from combinedRowPreparation)
// - workflowparams for allData.is_select_picking
// ============================================================================

const prepData = {{node:combinedRowPreparation.data}};
const allocationResult = {{node:executeAllocationIfNeeded.data}};
const itemData = {{node:get_node_DDcDRdMe.data.data}};
const soItem = {{node:get_node_YMto3jtl.data.data}};

// Get gd_status and saveAs from prepData (NOT from fillbackHeaderFields)
const gd_status = prepData.gd_status;
const saveAs = prepData.saveAs;
const isGDPP = {{workflowparams:allData.is_select_picking}} || 0;

// Use allocation result for temp data (either newly allocated or existing)
const tempData = allocationResult.tempDataArray || [];

const orderLimit = (prepData.gdItem.gd_order_quantity * (100 + (itemData.over_delivery_tolerance || 0))) / 100;
const deliveredQty = soItem.delivered_qty || 0;
const plannedQty = soItem.planned_qty || 0;

const formatNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  return parseFloat(value).toFixed(3);
};

const currentGdQty = parseFloat(prepData.gdQty) || 0;

let gdQtyChange = currentGdQty;
if (prepData.originalGdItem) {
  gdQtyChange = currentGdQty - (parseFloat(prepData.originalGdItem.gd_qty) || 0);
}

let totalCommitted;
if (isGDPP === 1) {
  totalCommitted = deliveredQty + currentGdQty;
} else {
  totalCommitted = deliveredQty + plannedQty + gdQtyChange;
}

let validationMessage = null;
if (totalCommitted > orderLimit && saveAs !== "Cancelled") {
  validationMessage = `Row ${prepData.nextIndex} with Item ${itemData.material_code} validation failed: quantity is exceeding the maximum deliverable quantity.`;
}

// Build updated SO item
let updatedSOTable = {{node:get_cache_node_pLyxuBie.data}};
if (typeof updatedSOTable === 'string') {
  try {
    updatedSOTable = JSON.parse(updatedSOTable);
  } catch (e) {
    updatedSOTable = [];
  }
}
if (!Array.isArray(updatedSOTable)) {
  updatedSOTable = [];
}

let updatedSOItem = { ...soItem };

if (isGDPP === 1) {
  if (saveAs === "Completed") {
    updatedSOItem.delivered_qty = formatNumber(deliveredQty + currentGdQty);
    updatedSOItem.planned_qty = formatNumber(plannedQty - currentGdQty);
    updatedSOItem.outstanding_quantity = formatNumber(updatedSOItem.so_quantity - updatedSOItem.delivered_qty);
  }
} else {
  if (gd_status === "Draft" && saveAs === "Completed") {
    updatedSOItem.delivered_qty = formatNumber(deliveredQty + currentGdQty);
    updatedSOItem.outstanding_quantity = formatNumber(updatedSOItem.so_quantity - updatedSOItem.delivered_qty);
  } else if (gd_status === "Draft" && saveAs === "Created") {
    updatedSOItem.planned_qty = formatNumber(plannedQty + currentGdQty);
  } else if (gd_status === "Created" && saveAs === "Completed") {
    const origQty = parseFloat(prepData.originalGdItem?.gd_qty) || 0;
    updatedSOItem.planned_qty = formatNumber(plannedQty - origQty);
    updatedSOItem.delivered_qty = formatNumber(deliveredQty + currentGdQty);
    updatedSOItem.outstanding_quantity = formatNumber(updatedSOItem.so_quantity - updatedSOItem.delivered_qty);
  } else if (gd_status === "Created" && saveAs === "Created") {
    const origQty = parseFloat(prepData.originalGdItem?.gd_qty) || 0;
    updatedSOItem.planned_qty = formatNumber(plannedQty - origQty + currentGdQty);
  } else if (saveAs === "Cancelled" && gd_status === "Created") {
    updatedSOItem.planned_qty = formatNumber(plannedQty - currentGdQty);
  }
}

if (saveAs === "Completed") {
  if (updatedSOItem.outstanding_quantity > 0) {
    updatedSOItem.line_status = "Processing";
  } else {
    updatedSOItem.line_status = "Completed";
  }
}

updatedSOTable.push(updatedSOItem);

return {
  validationMessage: validationMessage,
  updatedSOTable: updatedSOTable,
  tempData: tempData,
  tempQtyDataString: allocationResult.tempQtyData,
  viewStock: allocationResult.viewStock,
  updatedTracker: allocationResult.updatedTracker
};
```

### Node 4: Update TableGD Row (New node to update the row after combined processing)

**Node Name:** `updateTableGDRow`
**Purpose:** Update the tableGD row with allocation results and prepare for next iteration

```javascript
// updateTableGDRow
// ============================================================================
// Update the current row in tableGD with allocation and validation results
// ============================================================================

const rawTableGD = {{node:get_cache_node_tableGD.data}};
let tableGD = [];

if (rawTableGD) {
  if (typeof rawTableGD === 'string') {
    tableGD = JSON.parse(rawTableGD);
  } else {
    tableGD = rawTableGD;
  }
}

const prepData = {{node:combinedRowPreparation.data}};
const validationResult = {{node:validateAndUpdateSO.data}};
const rowIndex = prepData.index;

// Update specific row with allocation results
if (tableGD[rowIndex]) {
  // Only update if allocation was performed
  if (validationResult.tempQtyDataString) {
    tableGD[rowIndex].temp_qty_data = validationResult.tempQtyDataString;
  }
  if (validationResult.viewStock) {
    tableGD[rowIndex].view_stock = validationResult.viewStock;
  }

  // Update delivered/undelivered quantities
  const gdQty = parseFloat(tableGD[rowIndex].gd_qty) || 0;
  const initialDeliveredQty = parseFloat(tableGD[rowIndex].gd_initial_delivered_qty) || 0;
  const orderedQty = parseFloat(tableGD[rowIndex].gd_order_quantity) || 0;

  tableGD[rowIndex].gd_delivered_qty = initialDeliveredQty + gdQty;
  tableGD[rowIndex].gd_undelivered_qty = orderedQty - (initialDeliveredQty + gdQty);
}

return {
  tableGD: tableGD,
  updatedTracker: validationResult.updatedTracker
};
```

---

## Workflow Structure Changes Summary

### Before (Current Structure):
```
IF Auto PickingMode
├── prepareAllocationData
├── IF has Row to Allocate
│   ├── collectIdsForBatchFetch
│   ├── Get UOMs
│   ├── Get BinLocations
│   ├── Set tableGD (cache)
│   ├── Set allocationTracker (cache)
│   ├── Set allocationIndex (cache)
│   └── Loop rowsNeedingAllocation ← DELETE THIS LOOP
│       ├── Get tableGD/tracker/index from cache
│       ├── getCurrentRowData
│       ├── Get Item
│       ├── IF Batch → Get Batch, Get Item Batch Balance
│       ├── Get Pending Reserved
│       ├── executeAllocation
│       ├── updateRowInTableGd
│       └── Set caches
│   └── Get allocated tableGD
└── mergeTableGd

fillbackHeaderFields ← central node, many references

IF !Draft
├── TableGD Data
├── Set initial quantityCheckIndex
├── Set updatedSOTable
└── Loop TableGD ← DELETE/SIMPLIFY THIS LOOP
    ├── Get quantityCheckIndex/updatedSOTable from cache
    ├── gdItem Preparation
    ├── Get Item
    ├── Get SO Line
    ├── Validate Quantity & Update SO Table
    └── ... (nested inventory validation loop)
```

### After (Combined Structure - Loop BEFORE fillbackHeaderFields):
```
Get Picking Setup
IF gd_status === "Created" → Get Original GD  ← MUST happen before combined loop
Get UOMs (batch fetch)
Get BinLocations (batch fetch)
Set initial caches (tableGD, allocationTracker, loopIndex, updatedSOTable)

Combined Loop: tableGD rows (BEFORE fillbackHeaderFields)
├── Get caches (loopIndex, allocationTracker, tableGD, updatedSOTable)
├── combinedRowPreparation (NEW - check if needs allocation)
├── Get Item (single fetch per row)
├── IF needsAllocation:
│   ├── IF Batch → Get Batch, Search Item Batch Balance
│   ├── ELSE → Search Item Balance
│   └── Search Pending Reserved
├── Get SO Line
├── executeAllocationIfNeeded (NEW - creates temp_qty_data if needed)
├── validateQuantity (SO order limit check)
├── IF validationMessage → Return error
├── IF !Cancelled:
│   └── Loop tempData (inventory availability validation)
├── updateTableGDRow (NEW - update row with allocation + delivered qty)
└── Set caches (loopIndex, allocationTracker, tableGD, updatedSOTable)

Get final tableGD from cache

fillbackHeaderFields ← receives table_gd WITH temp_qty_data already populated
                     ← no rows skipped (allocation done before)
                     ← UPDATE: get tableGD from cache instead of mergeTableGd

(All downstream nodes unchanged - still reference fillbackHeaderFields)
```

### Key Benefits of This Approach:
1. **fillbackHeaderFields won't skip any rows** - temp_qty_data is populated before it runs
2. **No need to change downstream node references** - they still use fillbackHeaderFields output
3. **Single loop for both allocation and validation** - eliminates duplicate Item fetches
4. **Proper error handling** - validation errors return before any data is saved

---

## Cache Variables Needed

| Cache Key | Purpose | Get Node Name (example) | Set Node Name (example) |
|-----------|---------|-------------------------|-------------------------|
| `loopIndex_{unique}` | Track current loop iteration | `get_cache_node_loopIndex` | `set_cache_node_loopIndex` |
| `updatedSOTable_{unique}` | Accumulate SO line updates | `get_cache_node_updatedSOTable` | `set_cache_node_updatedSOTable` |
| `allocationTracker_{unique}` | Track cross-row allocations (prevent double-allocating same inventory) | `get_cache_node_allocationTracker` | `set_cache_node_allocationTracker` |
| `tableGD_{unique}` | Store updated tableGD with temp_qty_data | `get_cache_node_tableGD` | `set_cache_node_tableGD` |
| `finalTableGD_{unique}` | Final tableGD after loop completes (for fillbackHeaderFields) | `get_cache_node_finalTableGD` | (same as tableGD, retrieved after loop) |

**Note:** The `{unique}` suffix should be a unique identifier (e.g., workflow instance ID) to prevent cache collisions between concurrent workflow executions.

---

## Conditional Logic for Data Fetches

The key optimization is making balance/batch fetches conditional:

```
IF needsAllocation === 1:
  - Fetch Batch (if batch managed)
  - Fetch Item Batch Balance OR Item Balance (search)
  - Fetch Pending Reserved
ELSE:
  - Skip these fetches (data already in temp_qty_data)
```

This is achieved through workflow IF conditions checking `{{node:combinedRowPreparation.data.needsAllocation}}`.
