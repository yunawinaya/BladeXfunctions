// Global Auto Allocation Workflow

const existingAllocationData = {{workflowparams:existingAllocationData}} || [];
const material_id = {{workflowparams:material_id}};
const quantity = {{workflowparams:quantity}};
const plant_id = {{workflowparams:plant_id}};
const allocationStrategy = {{workflowparams:allocationStrategy}} || "RANDOM";
const isPending = {{workflowparams:isPending}} || 0;
const itemData = {{node:get_node_xgWUnZRj.data.data}};
const allocationType = {{workflowparams:allocationType}} || ""
const huData = {{workflowparams:huData}} || [];
const huPriority = {{workflowparams:huPriority}} || "HU First";
const currentDocId = {{workflowparams:currentDocId}} || "";
const enforceStockCheck = {{workflowparams:enforceStockCheck}} || 0;
const includeReservedQty = {{workflowparams:includeReservedQty}} || 0;
const orderUomId = {{workflowparams:orderUomId}} || "";
const splitPolicy = {{workflowparams:splitPolicy}} || "ALLOW_SPLIT";
const lineMaterials = {{workflowparams:lineMaterials}} || [];

// UOM conversion: convert requested quantity to base UOM for comparison against balances
let conversionFactor = 1;
if (orderUomId && Array.isArray(itemData.table_uom_conversion)) {
  const uomConversion = itemData.table_uom_conversion.find(
    (conv) => conv.alt_uom_id === orderUomId
  );
  if (uomConversion && uomConversion.base_qty) {
    conversionFactor = parseFloat(uomConversion.base_qty);
  }
}
const baseQuantity = parseFloat((quantity * conversionFactor).toFixed(3));

let balanceData;
if (itemData.item_batch_management === 1) {
  balanceData = {{node:search_node_ARAmvXyd.data.data}} || [];
} else {
  balanceData = {{node:search_node_mb8Vv8fZ.data.data}} || [];
}

// Fetch HU reserved data from search node (on_reserved_gd with handling_unit_id)
const huReservedData = {{node:search_node_WGl1NGSu.data.data}} || [];

// Build HU reservation map: handling_unit_id|batch_id -> total reserved open_qty (in base UOM)
// Exclude current GD's own records to avoid double deduction with existingAllocationData
const huReservedMap = {};
for (const r of huReservedData) {
  if (!r.handling_unit_id || parseFloat(r.open_qty) <= 0) continue;
  if (currentDocId && r.doc_id === currentDocId) continue;

  // Convert open_qty from order UOM to base UOM (GD follows SO UOM)
  const key = `${r.handling_unit_id}|${r.batch_id || ""}`;
  huReservedMap[key] = (huReservedMap[key] || 0) + parseFloat(r.open_qty) * conversionFactor;
}

// Inject HU items into balance pool as virtual balance records
// Deduct already-reserved quantities from on_reserved_gd
if (Array.isArray(huData) && huData.length > 0) {
  for (const huItem of huData) {
    if (huItem.row_type !== "item") continue;
    let available = parseFloat(huItem.item_quantity) || 0;

    // Deduct existing HU reservations from other GDs
    const reservedKey = `${huItem.handling_unit_id}|${huItem.batch_id || ""}`;
    const reservedQty = huReservedMap[reservedKey] || 0;
    if (reservedQty > 0) {
      available = Math.max(0, available - reservedQty);
    }

    if (available <= 0) continue;
    balanceData.push({
      location_id: huItem.location_id,
      batch_id: huItem.batch_id || null,
      material_id: huItem.material_id,
      unrestricted_qty: available,
      expired_date: huItem.expired_date || null,
      manufacturing_date: huItem.manufacturing_date || null,
      create_time: huItem.create_time || null,
      balance_id: huItem.balance_id || "",
      handling_unit_id: huItem.handling_unit_id,
      source: "hu",
    });
  }
}

// For NO_SPLIT: filter out HU balances from HUs with foreign items
if (splitPolicy === "NO_SPLIT" && lineMaterials.length > 0) {
  const gdMaterialSet = new Set(lineMaterials);

  // Group HU balance records by handling_unit_id
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
  if (ineligibleHuIds.size > 0) {
    balanceData = balanceData.filter(
      (b) => b.source !== "hu" || !ineligibleHuIds.has(b.handling_unit_id),
    );
  }
}

let pendingData = [];
if (isPending === 1) {
  pendingData = {{node:search_node_BOywHct7.data.data}} || [];
}

// Preserve the real unrestricted_qty before any inflation for display purposes
for (let i = 0; i < balanceData.length; i++) {
  if (balanceData[i].source === "hu") continue;
  balanceData[i].real_unrestricted_qty = parseFloat(balanceData[i].unrestricted_qty) || 0;
}

// Include reserved_qty in available stock when:
// 1. Explicitly requested (gd_status=Created or isGDPP), OR
// 2. Pending reserved data exists (reserved stock backs those pending records)
if (includeReservedQty === 1 || (isPending === 1 && pendingData.length > 0)) {
  for (let i = 0; i < balanceData.length; i++) {
    if (balanceData[i].source === "hu") continue;
    const reservedQty = parseFloat(balanceData[i].reserved_qty) || 0;
    if (reservedQty > 0) {
      balanceData[i].unrestricted_qty =
        (parseFloat(balanceData[i].unrestricted_qty) || 0) + reservedQty;
    }
  }
}

const isBatchManaged = itemData.item_batch_management === 1;

// FIELD MAPPING BY ALLOCATION TYPE
const getFieldNames = () => {
  switch (allocationType) {
    case "GD":
      return { qtyField: "gd_quantity", locationField: "location_id" };
    case "PP":
      return { qtyField: "to_quantity", locationField: "location_id" };
    case "MR":
      return { qtyField: "issue_qty", locationField: "bin_location_id" };
    default:
      return { qtyField: "quantity", locationField: "location_id" };
  }
};

const { qtyField, locationField } = getFieldNames();

// HELPER FUNCTIONS

const generateKey = (locationId, batchId, handlingUnitId) => {
  let key;
  if (isBatchManaged) {
    key = `${locationId}-${batchId || "no_batch"}`;
  } else {
    key = `${locationId}`;
  }
  if (handlingUnitId) {
    key += `-hu-${handlingUnitId}`;
  }
  return key;
};

const buildExistingAllocationMap = (existingData) => {
  const map = {};
  if (Array.isArray(existingData)) {
    for (const existing of existingData) {
      const key = generateKey(existing.location_id, existing.batch_id, existing.handling_unit_id);
      // Convert existing allocation qty to base UOM for correct deduction against base UOM balances
      const qty = parseFloat((parseFloat(existing.quantity) || 0) * conversionFactor).toFixed(3);
      map[key] = (map[key] || 0) + parseFloat(qty);
    }
  }
  return map;
};

const adjustBalancesForExisting = (balances, existingMap) => {
  return balances.map((balance) => {
    const key = generateKey(balance.location_id, balance.batch_id, balance.handling_unit_id);
    const existingQty = existingMap[key] || 0;
    const originalQty = parseFloat(balance.unrestricted_qty) || 0;
    const adjustedQty = Math.max(0, originalQty - existingQty);

    return {
      ...balance,
      unrestricted_qty: adjustedQty,
      original_unrestricted_qty: originalQty,
    };
  });
};

// SORTING FUNCTIONS

// direction: 1 = ascending (first/earliest), -1 = descending (last/latest)
const sortByExpiry = (balanceArray, direction) => {
  return [...balanceArray].sort((a, b) => {
    if (isBatchManaged && a.expired_date && b.expired_date) {
      return (new Date(a.expired_date) - new Date(b.expired_date)) * direction;
    }
    return (new Date(a.create_time) - new Date(b.create_time)) * direction;
  });
};

const sortByCreateTime = (balanceArray, direction) => {
  return [...balanceArray].sort((a, b) => {
    return (new Date(a.create_time) - new Date(b.create_time)) * direction;
  });
};

const sortByQty = (balanceArray, direction) => {
  return [...balanceArray].sort((a, b) => {
    return ((a.unrestricted_qty || 0) - (b.unrestricted_qty || 0)) * direction;
  });
};

const sortByClearBin = (balanceArray, requestedQty) => {
  return [...balanceArray].sort((a, b) => {
    const qtyA = a.unrestricted_qty || 0;
    const qtyB = b.unrestricted_qty || 0;
    const canClearA = qtyA <= requestedQty;
    const canClearB = qtyB <= requestedQty;

    if (canClearA && !canClearB) return -1;
    if (!canClearA && canClearB) return 1;
    return qtyA - qtyB;
  });
};

const getDefaultBin = () => {
  if (!itemData.table_default_bin?.length) return null;
  const entry = itemData.table_default_bin.find(
    (bin) => bin.plant_id === plant_id
  );
  return entry?.bin_location || null;
};

const allocateFromBalances = (balanceList, remainingQty) => {
  const allocated = [];
  let remaining = remainingQty;

  for (const balance of balanceList) {
    if (remaining <= 0) break;

    const availableQty = balance.unrestricted_qty || 0;
    if (availableQty <= 0) continue;

    const allocatedQty = Math.min(remaining, availableQty);

    const allocationRecord = {
      ...balance,
      [qtyField]: allocatedQty,
      // Use real_unrestricted_qty (before reserved inflation) for display
      unrestricted_qty:
        balance.real_unrestricted_qty != null
          ? balance.real_unrestricted_qty
          : balance.original_unrestricted_qty || balance.unrestricted_qty,
    };

    // For MR, rename location_id to bin_location_id
    if (allocationType === "MR") {
      allocationRecord.bin_location_id = balance.location_id;
    }

    allocated.push(allocationRecord);
    remaining -= allocatedQty;
  }

  return { allocated, remainingQty: remaining };
};

// Whole-HU allocation: takes full item_quantity from each HU balance, never partial
// Stops picking once remaining need is fulfilled (don't over-allocate beyond what's needed)
const allocateWholeHU = (balanceList, remainingQty) => {
  const allocated = [];
  let remaining = remainingQty;

  for (const balance of balanceList) {
    if (remaining <= 0) break; // Need fulfilled — stop picking more HUs
    if (balance.source !== "hu") continue;

    const availableQty = balance.unrestricted_qty || 0;
    if (availableQty <= 0) continue;

    // Take the FULL quantity — no Math.min with remaining
    const allocationRecord = {
      ...balance,
      [qtyField]: availableQty,
      unrestricted_qty:
        balance.real_unrestricted_qty != null
          ? balance.real_unrestricted_qty
          : balance.original_unrestricted_qty || balance.unrestricted_qty,
    };

    if (allocationType === "MR") {
      allocationRecord.bin_location_id = balance.location_id;
    }

    allocated.push(allocationRecord);
    remaining -= availableQty; // Can go negative (excess)
  }

  return { allocated, remainingQty: Math.max(0, remaining) };
};

// NO_SPLIT whole-HU allocation: takes full HU qty but SKIPS HUs that would exceed remaining need
// Falls back to loose stock for the remainder
const allocateWholeHUWithLimit = (balanceList, remainingQty) => {
  const allocated = [];
  let remaining = remainingQty;

  for (const balance of balanceList) {
    if (remaining <= 0) break;
    if (balance.source !== "hu") continue;

    const availableQty = balance.unrestricted_qty || 0;
    if (availableQty <= 0) continue;

    // Skip this HU if it would exceed remaining need (no over-pick for NO_SPLIT)
    if (availableQty > remaining) continue;

    const allocationRecord = {
      ...balance,
      [qtyField]: availableQty,
      unrestricted_qty:
        balance.real_unrestricted_qty != null
          ? balance.real_unrestricted_qty
          : balance.original_unrestricted_qty || balance.unrestricted_qty,
    };

    if (allocationType === "MR") {
      allocationRecord.bin_location_id = balance.location_id;
    }

    allocated.push(allocationRecord);
    remaining -= availableQty;
  }

  return { allocated, remainingQty: Math.max(0, remaining) };
};

const filterAvailableBalances = (balances) => {
  return balances.filter((b) => (b.unrestricted_qty || 0) > 0);
};

// PENDING ALLOCATION FUNCTION
const allocateFromPending = (pendingRecords, balances, requestedQty) => {
  const allAllocations = [];
  let remainingQty = requestedQty;

  // Sort pending: Production first, then Sales Order
  const sortedPending = [...pendingRecords].sort((a, b) => {
    if (a.doc_type === "Production" && b.doc_type !== "Production") return -1;
    if (a.doc_type !== "Production" && b.doc_type === "Production") return 1;
    return 0;
  });

  for (const pending of sortedPending) {
    if (remainingQty <= 0) break;

    // Convert pending open_qty from order UOM to base UOM (all reserved records follow SO UOM)
    const pendingQtyRaw = parseFloat(pending.open_qty) || 0;
    if (pendingQtyRaw <= 0) continue;
    const pendingQty = parseFloat((pendingQtyRaw * conversionFactor).toFixed(3));

    // Find matching balance (pending uses bin_location, balance uses location_id)
    // Only match loose balances (no HU) since SO/Production pending doesn't reserve at HU level
    const matchingBalance = balances.find((b) => {
      const locationMatch = b.location_id === pending.bin_location;
      const huMatch = !b.handling_unit_id;
      if (isBatchManaged) {
        return locationMatch && b.batch_id === pending.batch_id && huMatch;
      }
      return locationMatch && huMatch;
    });

    if (matchingBalance) {
      const availableQty = matchingBalance.unrestricted_qty || 0;
      const allocatedQty = Math.min(remainingQty, pendingQty, availableQty);

      if (allocatedQty > 0) {
        const key = generateKey(matchingBalance.location_id, matchingBalance.batch_id, matchingBalance.handling_unit_id);

        // Check if already allocated to this location/batch
        const existingIdx = allAllocations.findIndex((a) => {
          return generateKey(a.location_id, a.batch_id, a.handling_unit_id) === key;
        });

        if (existingIdx >= 0) {
          allAllocations[existingIdx][qtyField] += allocatedQty;
        } else {
          const allocationRecord = {
            ...matchingBalance,
            [qtyField]: allocatedQty,
            unrestricted_qty:
              matchingBalance.real_unrestricted_qty != null
                ? matchingBalance.real_unrestricted_qty
                : matchingBalance.original_unrestricted_qty || matchingBalance.unrestricted_qty,
          };

          // For MR, rename location_id to bin_location_id
          if (allocationType === "MR") {
            allocationRecord.bin_location_id = matchingBalance.location_id;
          }

          allAllocations.push(allocationRecord);
        }

        remainingQty -= allocatedQty;

        // Reduce available qty for next iteration
        matchingBalance.unrestricted_qty = Math.max(
          0,
          matchingBalance.unrestricted_qty - allocatedQty
        );
      }
    }
  }

  return { allocated: allAllocations, remainingQty };
};

// ALLOCATION STRATEGIES

// Simple strategies: sort then allocate
const sortAndAllocate = (sortFn) => (availableBalances, requestedQty) => {
  return allocateFromBalances(sortFn(availableBalances), requestedQty);
};

const strategyFixedBin = (availableBalances, requestedQty) => {
  const defaultBin = getDefaultBin();
  const allAllocations = [];
  let remainingQty = requestedQty;

  if (defaultBin) {
    const defaultBinBalances = availableBalances.filter(
      (b) => b.location_id === defaultBin
    );
    const result1 = allocateFromBalances(sortByExpiry(defaultBinBalances, 1), remainingQty);
    allAllocations.push(...result1.allocated);
    remainingQty = result1.remainingQty;
  }

  if (remainingQty > 0) {
    const otherBalances = availableBalances.filter(
      (b) => !defaultBin || b.location_id !== defaultBin
    );
    const result2 = allocateFromBalances(sortByExpiry(otherBalances, 1), remainingQty);
    allAllocations.push(...result2.allocated);
    remainingQty = result2.remainingQty;
  }

  return { allocated: allAllocations, remainingQty };
};

// STRATEGY REGISTRY
const STRATEGIES = {
  RANDOM: sortAndAllocate((b) => sortByExpiry(b, 1)),
  "FIXED BIN": strategyFixedBin,
  FEFO: sortAndAllocate((b) => sortByExpiry(b, 1)),
  FIFO: sortAndAllocate((b) => sortByCreateTime(b, 1)),
  LIFO: sortAndAllocate((b) => sortByCreateTime(b, -1)),
  LEFO: sortAndAllocate((b) => sortByExpiry(b, -1)),
  "LARGEST QTY": sortAndAllocate((b) => sortByQty(b, -1)),
  "SMALLEST QTY": sortAndAllocate((b) => sortByQty(b, 1)),
  "CLEAR BIN": (availableBalances, requestedQty) => {
    return allocateFromBalances(sortByClearBin(availableBalances, requestedQty), requestedQty);
  },
};

// MAIN EXECUTION

const existingAllocationMap = buildExistingAllocationMap(existingAllocationData);

const adjustedBalances = adjustBalancesForExisting(
  balanceData,
  existingAllocationMap
);

const availableBalances = filterAvailableBalances(adjustedBalances);

const totalAvailable = availableBalances.reduce(
  (sum, b) => sum + (b.unrestricted_qty || 0),
  0
);

// Enforce strict insufficient stock check when required
const shouldEnforceStock =
  allocationType === "MR" ||
  (enforceStockCheck === 1 && itemData.stock_control !== 0);

if (shouldEnforceStock && totalAvailable < baseQuantity) {
  return {
    code: "400",
    message: `Insufficient stock for item ${itemData.material_code || material_id}. Available: ${totalAvailable}, Requested: ${baseQuantity}`,
    allocationData: [],
    totalAllocated: 0,
  };
}

let allAllocations = [];
let remainingQty = baseQuantity;

// Step 1: If isPending, allocate from pending data first
if (isPending === 1 && pendingData.length > 0) {
  const pendingResult = allocateFromPending(pendingData, availableBalances, remainingQty);
  allAllocations.push(...pendingResult.allocated);
  remainingQty = pendingResult.remainingQty;
}

// Step 2: Apply strategy for remaining quantity
if (remainingQty > 0) {
  const remainingBalances = filterAvailableBalances(availableBalances);
  const strategyFn = STRATEGIES[allocationStrategy] || STRATEGIES["RANDOM"];

  // Separate HU and loose balances for priority-based allocation
  const huBalances = remainingBalances.filter((b) => b.source === "hu");
  const looseBalances = remainingBalances.filter((b) => b.source !== "hu");

  if (splitPolicy === "FULL_HU_PICK" && huBalances.length > 0) {
    // FULL_HU_PICK: take full qty from each HU, excess allowed
    const sortedHu = sortByExpiry(huBalances, 1);
    const huResult = allocateWholeHU(sortedHu, remainingQty);
    allAllocations.push(...huResult.allocated);
    remainingQty = huResult.remainingQty;

    // Fall back to loose stock for remaining (partial allowed for loose)
    if (remainingQty > 0) {
      const looseStrategyFn = STRATEGIES[allocationStrategy] || STRATEGIES["RANDOM"];
      const looseResult = looseStrategyFn(looseBalances, remainingQty);

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
  } else if (splitPolicy === "NO_SPLIT" && huBalances.length > 0) {
    // NO_SPLIT: take whole HUs but only if they fit within remaining need (no over-pick)
    const sortedHu = sortByExpiry(huBalances, 1);
    const huResult = allocateWholeHUWithLimit(sortedHu, remainingQty);
    allAllocations.push(...huResult.allocated);
    remainingQty = huResult.remainingQty;

    // Fall back to loose stock for remaining
    if (remainingQty > 0) {
      const looseStrategyFn = STRATEGIES[allocationStrategy] || STRATEGIES["RANDOM"];
      const looseResult = looseStrategyFn(looseBalances, remainingQty);

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
    // ALLOW_SPLIT: existing priority-based allocation logic
    let strategyResult;

    // Determine allocation order based on HU priority
    const hasPriority =
      (huPriority === "HU First" && huBalances.length > 0) ||
      (huPriority === "Loose First" && looseBalances.length > 0);

    if (hasPriority) {
      // Allocate from primary group first, then secondary for remainder
      const primaryBalances = huPriority === "HU First" ? huBalances : looseBalances;
      const secondaryBalances = huPriority === "HU First" ? looseBalances : huBalances;

      const primaryResult = strategyFn(primaryBalances, remainingQty);
      allAllocations.push(...primaryResult.allocated);
      remainingQty = primaryResult.remainingQty;

      if (remainingQty > 0) {
        strategyResult = strategyFn(secondaryBalances, remainingQty);
      } else {
        strategyResult = { allocated: [], remainingQty: 0 };
      }
    } else {
      // "Strategy" mode or no HU: pure strategy sorting across all
      strategyResult = strategyFn(remainingBalances, remainingQty);
    }

    // Merge strategy allocations with pending allocations
    for (const strategyAlloc of strategyResult.allocated) {
      const key = generateKey(strategyAlloc.location_id, strategyAlloc.batch_id, strategyAlloc.handling_unit_id);
      const existingIdx = allAllocations.findIndex((a) => {
        return generateKey(a.location_id, a.batch_id, a.handling_unit_id) === key;
      });

      if (existingIdx >= 0) {
        allAllocations[existingIdx][qtyField] += strategyAlloc[qtyField];
      } else {
        allAllocations.push(strategyAlloc);
      }
    }

    remainingQty = strategyResult.remainingQty;
  }
}

const totalAllocated = allAllocations.reduce(
  (sum, a) => sum + (a[qtyField] || 0),
  0
);

// Enforce strict post-allocation check
if (shouldEnforceStock && totalAllocated < baseQuantity) {
  return {
    code: "400",
    message: `Insufficient stock for item ${itemData.material_code || material_id}. Available: ${totalAllocated}, Requested: ${baseQuantity}`,
    allocationData: [],
    totalAllocated: 0,
  };
}

// Convert allocated quantities back from base UOM to order UOM for the consumer
if (conversionFactor !== 1) {
  const reverseFactor = 1 / conversionFactor;
  for (const alloc of allAllocations) {
    alloc[qtyField] = parseFloat((alloc[qtyField] * reverseFactor).toFixed(3));
  }
}

const totalAllocatedFinal = allAllocations.reduce(
  (sum, a) => sum + (a[qtyField] || 0),
  0
);

return {
  code: totalAllocated >= baseQuantity ? "200" : "206",
  message:
    totalAllocated >= baseQuantity
      ? "Allocation successful"
      : `Partial allocation. Available: ${totalAllocated}, Requested: ${baseQuantity}`,
  allocationData: allAllocations,
  totalAllocated: totalAllocatedFinal,
};
