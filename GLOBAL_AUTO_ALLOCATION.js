// Global Auto Allocation Workflow

const existingAllocationData = {{workflowparams:existingAllocationData}} || [];
const material_id = {{workflowparams:material_id}};
const quantity = {{workflowparams:quantity}};
const plant_id = {{workflowparams:plant_id}};
const allocationStrategy = {{workflowparams:allocationStrategy}} || "RANDOM";
const isPending = {{workflowparams:isPending}} || 0;
const itemData = {{node:get_node_xgWUnZRj.data.data}};
const allocationType = {{workflowparams:allocationType}} || ""

let balanceData;
if (itemData.item_batch_management === 1) {
  balanceData = {{node:search_node_ARAmvXyd.data.data}} || [];
} else {
  balanceData = {{node:search_node_mb8Vv8fZ.data.data}} || [];
}

let pendingData = [];
if (isPending === 1) {
  pendingData = {{node:search_node_BOywHct7.data.data}} || [];
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

const generateKey = (locationId, batchId) => {
  if (isBatchManaged) {
    return `${locationId}-${batchId || "no_batch"}`;
  }
  return `${locationId}`;
};

const buildExistingAllocationMap = (existingData) => {
  const map = {};
  if (Array.isArray(existingData)) {
    for (const existing of existingData) {
      const key = generateKey(existing.location_id, existing.batch_id);
      const qty = parseFloat(existing.quantity) || 0;
      map[key] = (map[key] || 0) + qty;
    }
  }
  return map;
};

const adjustBalancesForExisting = (balances, existingMap) => {
  return balances.map((balance) => {
    const key = generateKey(balance.location_id, balance.batch_id);
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

const sortByFEFO = (balanceArray) => {
  return [...balanceArray].sort((a, b) => {
    if (isBatchManaged && a.expired_date && b.expired_date) {
      return new Date(a.expired_date) - new Date(b.expired_date);
    }
    return new Date(a.create_time) - new Date(b.create_time);
  });
};

const sortByFIFO = (balanceArray) => {
  return [...balanceArray].sort((a, b) => {
    const dateA = isBatchManaged ? (a.manufacturing_date || a.create_time) : a.create_time;
    const dateB = isBatchManaged ? (b.manufacturing_date || b.create_time) : b.create_time;
    return new Date(dateA) - new Date(dateB);
  });
};

const sortByLIFO = (balanceArray) => {
  return [...balanceArray].sort((a, b) => {
    const dateA = isBatchManaged ? (a.manufacturing_date || a.create_time) : a.create_time;
    const dateB = isBatchManaged ? (b.manufacturing_date || b.create_time) : b.create_time;
    return new Date(dateB) - new Date(dateA);
  });
};

const sortByLEFO = (balanceArray) => {
  return [...balanceArray].sort((a, b) => {
    if (isBatchManaged && a.expired_date && b.expired_date) {
      return new Date(b.expired_date) - new Date(a.expired_date);
    }
    return new Date(b.create_time) - new Date(a.create_time);
  });
};

const sortByLargestQty = (balanceArray) => {
  return [...balanceArray].sort((a, b) => {
    return (b.unrestricted_qty || 0) - (a.unrestricted_qty || 0);
  });
};

const sortBySmallestQty = (balanceArray) => {
  return [...balanceArray].sort((a, b) => {
    return (a.unrestricted_qty || 0) - (b.unrestricted_qty || 0);
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
      unrestricted_qty:
        balance.original_unrestricted_qty || balance.unrestricted_qty,
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

const filterAvailableBalances = (balances) => {
  return balances.filter((b) => (b.unrestricted_qty || 0) > 0);
};

// PENDING ALLOCATION FUNCTION
const allocateFromPending = (pendingRecords, balances, requestedQty) => {
  let allAllocations = [];
  let remainingQty = requestedQty;
  const usedBalanceKeys = new Set();

  // Sort pending: Production first, then Sales Order
  const sortedPending = [...pendingRecords].sort((a, b) => {
    if (a.doc_type === "Production" && b.doc_type !== "Production") return -1;
    if (a.doc_type !== "Production" && b.doc_type === "Production") return 1;
    return 0;
  });

  for (const pending of sortedPending) {
    if (remainingQty <= 0) break;

    const pendingQty = parseFloat(pending.open_qty) || 0;
    if (pendingQty <= 0) continue;

    // Find matching balance (pending uses bin_location, balance uses location_id)
    const matchingBalance = balances.find((b) => {
      const locationMatch = b.location_id === pending.bin_location;
      if (isBatchManaged) {
        return locationMatch && b.batch_id === pending.batch_id;
      }
      return locationMatch;
    });

    if (matchingBalance) {
      const availableQty = matchingBalance.unrestricted_qty || 0;
      const allocatedQty = Math.min(remainingQty, pendingQty, availableQty);

      if (allocatedQty > 0) {
        const key = generateKey(matchingBalance.location_id, matchingBalance.batch_id);

        // Check if already allocated to this location/batch
        const existingIdx = allAllocations.findIndex((a) => {
          return generateKey(a.location_id, a.batch_id) === key;
        });

        if (existingIdx >= 0) {
          allAllocations[existingIdx][qtyField] += allocatedQty;
        } else {
          const allocationRecord = {
            ...matchingBalance,
            [qtyField]: allocatedQty,
            unrestricted_qty:
              matchingBalance.original_unrestricted_qty || matchingBalance.unrestricted_qty,
          };

          // For MR, rename location_id to bin_location_id
          if (allocationType === "MR") {
            allocationRecord.bin_location_id = matchingBalance.location_id;
          }

          allAllocations.push(allocationRecord);
        }

        usedBalanceKeys.add(key);
        remainingQty -= allocatedQty;

        // Reduce available qty for next iteration
        matchingBalance.unrestricted_qty = Math.max(
          0,
          matchingBalance.unrestricted_qty - allocatedQty
        );
      }
    }
  }

  return { allocated: allAllocations, remainingQty, usedBalanceKeys };
};

// ALLOCATION STRATEGIES

const strategyRandom = (availableBalances, requestedQty) => {
  const sortedBalances = sortByFEFO(availableBalances);
  return allocateFromBalances(sortedBalances, requestedQty);
};

const strategyFixedBin = (availableBalances, requestedQty) => {
  const defaultBin = getDefaultBin();
  let allAllocations = [];
  let remainingQty = requestedQty;

  if (defaultBin) {
    const defaultBinBalances = availableBalances.filter(
      (b) => b.location_id === defaultBin
    );
    const sortedDefaultBalances = sortByFEFO(defaultBinBalances);
    const result1 = allocateFromBalances(sortedDefaultBalances, remainingQty);
    allAllocations.push(...result1.allocated);
    remainingQty = result1.remainingQty;
  }

  if (remainingQty > 0) {
    const otherBalances = availableBalances.filter(
      (b) => !defaultBin || b.location_id !== defaultBin
    );
    const sortedOtherBalances = sortByFEFO(otherBalances);
    const result2 = allocateFromBalances(sortedOtherBalances, remainingQty);
    allAllocations.push(...result2.allocated);
    remainingQty = result2.remainingQty;
  }

  return { allocated: allAllocations, remainingQty };
};

const strategyFEFO = (availableBalances, requestedQty) => {
  const sortedBalances = sortByFEFO(availableBalances);
  return allocateFromBalances(sortedBalances, requestedQty);
};

const strategyFIFO = (availableBalances, requestedQty) => {
  const sortedBalances = sortByFIFO(availableBalances);
  return allocateFromBalances(sortedBalances, requestedQty);
};

const strategyLIFO = (availableBalances, requestedQty) => {
  const sortedBalances = sortByLIFO(availableBalances);
  return allocateFromBalances(sortedBalances, requestedQty);
};

const strategyLEFO = (availableBalances, requestedQty) => {
  const sortedBalances = sortByLEFO(availableBalances);
  return allocateFromBalances(sortedBalances, requestedQty);
};

const strategyLargestQty = (availableBalances, requestedQty) => {
  const sortedBalances = sortByLargestQty(availableBalances);
  return allocateFromBalances(sortedBalances, requestedQty);
};

const strategySmallestQty = (availableBalances, requestedQty) => {
  const sortedBalances = sortBySmallestQty(availableBalances);
  return allocateFromBalances(sortedBalances, requestedQty);
};

const strategyClearBin = (availableBalances, requestedQty) => {
  const sortedBalances = sortByClearBin(availableBalances, requestedQty);
  return allocateFromBalances(sortedBalances, requestedQty);
};

// STRATEGY REGISTRY
const STRATEGIES = {
  RANDOM: strategyRandom,
  "FIXED BIN": strategyFixedBin,
  FEFO: strategyFEFO,
  FIFO: strategyFIFO,
  LIFO: strategyLIFO,
  LEFO: strategyLEFO,
  "LARGEST QTY": strategyLargestQty,
  "SMALLEST QTY": strategySmallestQty,
  "CLEAR BIN": strategyClearBin,
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

// For MR, enforce strict insufficient stock check
if (allocationType === "MR" && totalAvailable < quantity) {
  return {
    code: "400",
    message: `Insufficient stock. Available: ${totalAvailable}, Requested: ${quantity}`,
    allocationData: [],
    totalAllocated: 0,
  };
}

let allAllocations = [];
let remainingQty = quantity;

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
  const strategyResult = strategyFn(remainingBalances, remainingQty);

  // Merge strategy allocations with pending allocations
  for (const strategyAlloc of strategyResult.allocated) {
    const key = generateKey(strategyAlloc.location_id, strategyAlloc.batch_id);
    const existingIdx = allAllocations.findIndex((a) => {
      return generateKey(a.location_id, a.batch_id) === key;
    });

    if (existingIdx >= 0) {
      allAllocations[existingIdx][qtyField] += strategyAlloc[qtyField];
    } else {
      allAllocations.push(strategyAlloc);
    }
  }

  remainingQty = strategyResult.remainingQty;
}

const totalAllocated = allAllocations.reduce(
  (sum, a) => sum + (a[qtyField] || 0),
  0
);

// For MR, enforce strict post-allocation check
if (allocationType === "MR" && totalAllocated < quantity) {
  return {
    code: "400",
    message: `Insufficient stock. Available: ${totalAllocated}, Requested: ${quantity}`,
    allocationData: [],
    totalAllocated: 0,
  };
}

return {
  code: totalAllocated >= quantity ? "200" : "206",
  message:
    totalAllocated >= quantity
      ? "Allocation successful"
      : `Partial allocation. Available: ${totalAllocated}, Requested: ${quantity}`,
  allocationData: allAllocations,
  totalAllocated: totalAllocated,
};
