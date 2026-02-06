// executeAllocation - Updated with pendingReservedData priority (Production first)
// ============================================================================
// INPUTS
// ============================================================================
const currentRow = {{node:code_node_aay7z3VT.data.currentRow}};
const itemData = {{node:get_node_URWeTqPt.data.data}};
const isBatchManaged = itemData.item_batch_management === 1;
const pickingSetup = {{node:get_node_iFPuvJX2.data.data}};
const rawTracker = {{node:get_cache_node_QGhmYUxQ.data}};
let allocationTracker = {};

// 🔧 NEW: Pending reserved data (fetched from search node)
const pendingReservedData = {{node:search_node_PendingReserved.data.data}} || [];

if (rawTracker) {
  if (typeof rawTracker === 'string') {
    try {
      allocationTracker = JSON.parse(rawTracker);
    } catch (e) {
      console.log('Failed to parse allocation tracker, using empty object');
      allocationTracker = {};
    }
  } else if (typeof rawTracker === 'object') {
    allocationTracker = rawTracker;
  }
}

// Pre-fetched data
const allUOMs = {{node:search_node_pltmkkw3.data.data}} || [];
const allBinLocations = {{node:search_node_nbpWEAFx.data.data}} || [];

// Get balance data based on batch management
let balances = [];
let batchMasterData = [];

if (isBatchManaged) {
  batchMasterData = {{node:search_node_9fEXFXTX.data.data}} || [];
  balances = {{node:search_node_Osh9qIRX.data.data}} || [];
} else {
  balances = {{node:search_node_l1dv5zjL.data.data}} || [];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Get default bin for this item and plant
const getDefaultBin = (itemData, plantId) => {
  if (!itemData.table_default_bin?.length) return null;
  const entry = itemData.table_default_bin.find(bin => bin.plant_id === plantId);
  return entry?.bin_location || null;
};

// Get allocations from other rows of the same material (deduplication)
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

// Apply cross-row deduplication to balances
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

// Find batch master data by batch_id
const findBatchData = (batchId) => {
  if (!isBatchManaged || !batchMasterData.length) return null;
  return batchMasterData.find(b => b.id === batchId) || null;
};

// Lookup bin location from pre-fetched data
const getBinLocationDetails = (locationId) => {
  const binLocation = allBinLocations.find(bin => bin.id === locationId);
  return binLocation ? binLocation.bin_location_combine : locationId;
};

// Lookup UOM name from pre-fetched data
const getUOMName = (uomId) => {
  const uom = allUOMs.find(u => u.id === uomId);
  return uom ? uom.uom_name : "";
};

// ============================================================================
// DEDUPLICATION
// ============================================================================
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

// ============================================================================
// ALLOCATION ENGINE - STEP 0: PRIORITIZE PENDING RESERVED DATA
// ============================================================================
let allAllocations = [];
let remainingQty = currentRow.quantity;

// 🔧 NEW: Sort pending reserved data to prioritize Production over Sales Order
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

    // Find matching balance by bin_location and batch_id (if batch-managed)
    const matchingBalance = adjustedBalances.find((b) => {
      const binMatch = b.location_id === reservation.bin_location;
      if (isBatchManaged) {
        return binMatch && b.batch_id === reservation.batch_id;
      }
      return binMatch;
    });

    if (matchingBalance) {
      const availableQty = matchingBalance.unrestricted_qty || 0;
      // Allocate min of: remaining qty, reserved qty, available balance
      const allocatedQty = Math.min(remainingQty, reservedQty, availableQty);

      if (allocatedQty > 0) {
        const binLocationName = getBinLocationDetails(matchingBalance.location_id);
        const batchData = isBatchManaged ? findBatchData(matchingBalance.batch_id) : null;

        // Check if already allocated to this location
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
            source: `Reserved (${reservation.doc_type})`  // For debugging
          });
        }

        remainingQty -= allocatedQty;
        // Reduce balance for next iteration
        matchingBalance.unrestricted_qty = Math.max(0, matchingBalance.unrestricted_qty - allocatedQty);
      }
    }
  }
}

// ============================================================================
// ALLOCATION ENGINE - STEP 1: APPLY STRATEGY FOR REMAINING QTY
// ============================================================================
if (remainingQty > 0) {
  const defaultBin = getDefaultBin(itemData, currentRow.plantId);
  const defaultStrategy = pickingSetup.default_strategy_id;
  const fallbackStrategy = pickingSetup.fallback_strategy_id;

  // Helper: Sort by FIFO (expiry date)
  const sortByFIFO = (balanceArray) => {
    if (!isBatchManaged) return balanceArray;

    return balanceArray.sort((a, b) => {
      const batchA = findBatchData(a.batch_id);
      const batchB = findBatchData(b.batch_id);

      if (batchA?.expiry_date && batchB?.expiry_date) {
        return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
      }

      return (batchA?.batch_number || "").localeCompare(batchB?.batch_number || "");
    });
  };

  // Helper: Allocate from a list of balances
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
        source: "Strategy"  // For debugging
      });

      remainingQty -= allocatedQty;
    }

    return allocated;
  };

  // Get already allocated location keys to exclude
  const allocatedKeys = new Set(
    allAllocations.map((a) =>
      isBatchManaged
        ? `${a.balance.location_id}-${a.batchData?.id || "no_batch"}`
        : `${a.balance.location_id}`
    )
  );

  // Filter out already allocated balances
  const remainingBalances = adjustedBalances.filter((b) => {
    const key = isBatchManaged
      ? `${b.location_id}-${b.batch_id || "no_batch"}`
      : `${b.location_id}`;
    return !allocatedKeys.has(key) && (b.unrestricted_qty || 0) > 0;
  });

  // STRATEGY: FIXED BIN
  if (defaultStrategy === "FIXED BIN") {
    // Step 1: Try default bin first (only if configured)
    if (defaultBin) {
      const defaultBinBalances = remainingBalances.filter(
        b => b.location_id === defaultBin
      );

      const sortedDefaultBalances = sortByFIFO(defaultBinBalances);
      const defaultAllocations = allocateFromBalances(sortedDefaultBalances);
      allAllocations.push(...defaultAllocations);
    }

    // Step 2: Fallback to RANDOM for remainder (or if no default bin configured)
    if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
      const otherBalances = remainingBalances.filter(
        b => !defaultBin || b.location_id !== defaultBin
      );

      const sortedOtherBalances = sortByFIFO(otherBalances);
      const fallbackAllocations = allocateFromBalances(sortedOtherBalances);
      allAllocations.push(...fallbackAllocations);
    }
  }
  // STRATEGY: RANDOM
  else if (defaultStrategy === "RANDOM") {
    const sortedBalances = sortByFIFO(remainingBalances);
    const randomAllocations = allocateFromBalances(sortedBalances);
    allAllocations.push(...randomAllocations);
  }
}

// ============================================================================
// BUILD RESULTS
// ============================================================================

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

// Get UOM name from pre-fetched data
const uomName = getUOMName(currentRow.uomId);

// Build view_stock summary
const summaryLines = allAllocations.map((alloc, idx) => {
  let line = `${idx + 1}. ${alloc.binLocation}: ${alloc.quantity} ${uomName}`;
  if (alloc.batchData) {
    line += `\n[${alloc.batchData.batch_number}]`;
  }
  return line;
});

const totalAllocated = allAllocations.reduce((sum, alloc) => sum + alloc.quantity, 0);
const viewStock = totalAllocated > 0
  ? `Total: ${totalAllocated} ${uomName}\n\nDETAILS:\n${summaryLines.join("\n")}`
  : "";

// Update allocation tracker
const updatedTracker = { ...allocationTracker };
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

// ============================================================================
// RETURN RESULTS
// ============================================================================
return {
  temp_qty_data: JSON.stringify(tempQtyData),
  view_stock: viewStock,
  total_allocated: totalAllocated,
  rowIndex: currentRow.rowIndex,
  updatedTracker: updatedTracker
};
