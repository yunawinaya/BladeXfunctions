const currentAllocatedRecords = {{node:search_node_ndtbikhX.data}};
const existingPendingRecords = {{node:search_node_9I7tIzli.data}};
const tableData = {{workflowparams:tableData}};

if (!currentAllocatedRecords.data || currentAllocatedRecords.data.length === 0) {
  return {
    code: "200",
    recordsToUpdate: [],
    recordsToUpdateLength: 0,
    inventoryMovements: [],
    inventoryMovementsLength: 0,
    message: "No cleanup needed - no allocated records found",
  };
}

// Build list of all current temp_qty_data combinations
// This represents what SHOULD exist after the user's edits
const currentTempDataKeys = tableData.flatMap((line) => {
  const tempData =
    typeof line.temp_qty_data === "string"
      ? JSON.parse(line.temp_qty_data || "[]")
      : line.temp_qty_data || [];

  return tempData.map((td) => ({
    doc_line_id: line.id,
    material_id: td.material_id,
    batch_id: td.batch_id,
    bin_location: td.location_id,
  }));
});

// Find orphaned records (exist in allocated but not in current temp_qty_data)
// These are allocations that were removed by the user's edits
const orphanedRecords = currentAllocatedRecords.data.filter(
  (allocated) =>
    !currentTempDataKeys.some(
      (current) =>
        allocated.doc_line_id === current.doc_line_id &&
        allocated.material_id === current.material_id &&
        allocated.batch_id === current.batch_id &&
        allocated.bin_location === current.bin_location,
    ),
);

if (orphanedRecords.length === 0) {
  return {
    code: "200",
    recordsToUpdate: [],
    recordsToUpdateLength: 0,
    inventoryMovements: [],
    inventoryMovementsLength: 0,
    message: "No orphaned allocations found",
  };
}

// Sort orphaned records by release priority: SO first, PR second, GD last
const releaseOrderPriority = {
  "Sales Order": 1,
  "Production Receipt": 2,
  "Good Delivery": 3,
};
const sortedOrphanedRecords = [...orphanedRecords].sort(
  (a, b) =>
    (releaseOrderPriority[a.doc_type] || 99) -
    (releaseOrderPriority[b.doc_type] || 99),
);

// Helper: Find existing Pending record to merge with (for SO/PR doc_types)
const findExistingPendingToMerge = (docType, parentLineId, materialId, batchId, binLocation) => {
  const pendingData = existingPendingRecords?.data || [];
  return pendingData.find(
    (record) =>
      record.status === "Pending" &&
      record.doc_type === docType &&
      record.parent_line_id === parentLineId &&
      record.material_id === materialId &&
      record.batch_id === batchId &&
      record.bin_location === binLocation,
  );
};

// Track which pending records have already been updated (to accumulate merges)
const pendingMergeAccumulator = new Map();

// Build recordsToUpdate array with proper merge logic
const recordsToUpdate = [];

// Aggregate inventory movements by (material_id, batch_id, bin_location)
// Key format: "material_id|batch_id|bin_location"
const inventoryMovementMap = new Map();

for (const orphanedRecord of sortedOrphanedRecords) {
  const releaseQty = orphanedRecord.reserved_qty || 0;

  if (orphanedRecord.doc_type === "Good Delivery") {
    // GD/Unrestricted: Set to Cancelled, needs inventory movement Reserved → Unrestricted
    recordsToUpdate.push({
      id: orphanedRecord.id,
      reserved_qty: orphanedRecord.reserved_qty,
      open_qty: 0,
      status: "Cancelled",
      target_gd_id: null,
    });

    // Aggregate inventory movement: Reserved → Unrestricted
    const invKey = `${orphanedRecord.material_id}|${orphanedRecord.batch_id || ""}|${orphanedRecord.bin_location || ""}`;
    const existingMovement = inventoryMovementMap.get(invKey);
    if (existingMovement) {
      existingMovement.quantity += releaseQty;
    } else {
      inventoryMovementMap.set(invKey, {
        material_id: orphanedRecord.material_id,
        batch_id: orphanedRecord.batch_id,
        bin_location: orphanedRecord.bin_location,
        material_uom: orphanedRecord.item_uom,
        quantity: releaseQty,
        movement_type: "RESERVED_TO_UNRESTRICTED",
      });
    }
  } else {
    // SO/PR: Check for existing Pending to merge with
    const existingPending = findExistingPendingToMerge(
      orphanedRecord.doc_type,
      orphanedRecord.parent_line_id,
      orphanedRecord.material_id,
      orphanedRecord.batch_id,
      orphanedRecord.bin_location,
    );

    if (existingPending) {
      // Check if we've already accumulated updates to this pending record
      const accumulatedQty = pendingMergeAccumulator.get(existingPending.id) || 0;
      const newAccumulatedQty = accumulatedQty + releaseQty;
      pendingMergeAccumulator.set(existingPending.id, newAccumulatedQty);

      // Merge: Add quantity to existing Pending, mark orphaned as Cancelled
      // Note: We'll add the pending record update after processing all orphaned records
      recordsToUpdate.push({
        id: orphanedRecord.id,
        reserved_qty: orphanedRecord.reserved_qty,
        open_qty: 0,
        status: "Cancelled",
        target_gd_id: null,
      });
    } else {
      // No existing Pending to merge with - convert to Pending
      recordsToUpdate.push({
        id: orphanedRecord.id,
        reserved_qty: orphanedRecord.reserved_qty,
        open_qty: orphanedRecord.reserved_qty,
        status: "Pending",
        target_gd_id: null,
      });
    }
  }
}

// Add accumulated pending record updates
for (const [pendingId, accumulatedQty] of pendingMergeAccumulator.entries()) {
  const existingPending = (existingPendingRecords?.data || []).find(
    (r) => r.id === pendingId,
  );
  if (existingPending) {
    recordsToUpdate.push({
      id: pendingId,
      reserved_qty: existingPending.reserved_qty + accumulatedQty,
      open_qty: existingPending.open_qty + accumulatedQty,
      status: "Pending",
    });
  }
}

// Convert inventory movement map to array
const inventoryMovements = Array.from(inventoryMovementMap.values());

return {
  code: "200",
  recordsToUpdate: recordsToUpdate,
  recordsToUpdateLength: recordsToUpdate.length,
  inventoryMovements: inventoryMovements,
  inventoryMovementsLength: inventoryMovements.length,
  message: `Found ${orphanedRecords.length} orphaned allocations to process`,
};