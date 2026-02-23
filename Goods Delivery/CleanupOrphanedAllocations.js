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

const orphanedRecords = currentAllocatedRecords.data.filter(
  (allocated) =>
    !currentTempDataKeys.some(
      (current) =>
        String(allocated.doc_line_id) === String(current.doc_line_id) &&
        String(allocated.material_id) === String(current.material_id) &&
        String(allocated.batch_id || "") === String(current.batch_id || "") &&
        String(allocated.bin_location || "") === String(current.bin_location || ""),
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

const releaseOrderPriority = {
  "Good Delivery": 1,
  "Picking Plan": 1,
  "Sales Order": 2,
  "Production": 3,
};
const sortedOrphanedRecords = [...orphanedRecords].sort(
  (a, b) =>
    (releaseOrderPriority[a.doc_type] || 99) -
    (releaseOrderPriority[b.doc_type] || 99),
);

const findExistingPendingToMerge = (docType, parentLineId, materialId, batchId, binLocation) => {
  const pendingData = existingPendingRecords?.data || [];
  return pendingData.find(
    (record) =>
      record.status === "Pending" &&
      record.doc_type === docType &&
      String(record.parent_line_id) === String(parentLineId) &&
      String(record.material_id) === String(materialId) &&
      String(record.batch_id || "") === String(batchId || "") &&
      String(record.bin_location || "") === String(binLocation || ""),
  );
};

const pendingMergeAccumulator = new Map();
const recordsToUpdate = [];
const inventoryMovementMap = new Map();

for (const orphanedRecord of sortedOrphanedRecords) {
  const releaseQty = orphanedRecord.reserved_qty || 0;

  if (orphanedRecord.doc_type === "Good Delivery" || orphanedRecord.doc_type === "Picking Plan") {
    recordsToUpdate.push({
      id: orphanedRecord.id,
      reserved_qty: orphanedRecord.reserved_qty,
      open_qty: 0,
      status: "Cancelled",
      target_gd_id: null,
    });

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
    const existingPending = findExistingPendingToMerge(
      orphanedRecord.doc_type,
      orphanedRecord.parent_line_id,
      orphanedRecord.material_id,
      orphanedRecord.batch_id,
      orphanedRecord.bin_location,
    );

    if (existingPending) {
      const accumulatedQty = pendingMergeAccumulator.get(existingPending.id) || 0;
      const newAccumulatedQty = accumulatedQty + releaseQty;
      pendingMergeAccumulator.set(existingPending.id, newAccumulatedQty);

      recordsToUpdate.push({
        id: orphanedRecord.id,
        reserved_qty: orphanedRecord.reserved_qty,
        open_qty: 0,
        status: "Cancelled",
        target_gd_id: null,
      });
    } else {
      recordsToUpdate.push({
        ...orphanedRecord,
        doc_id: "",
        doc_no: "",
        doc_line_id: "",
        status: "Pending",
        target_gd_id: null,
      });
    }
  }
}

for (const [pendingId, accumulatedQty] of pendingMergeAccumulator.entries()) {
  const existingPending = (existingPendingRecords?.data || []).find(
    (r) => String(r.id) === String(pendingId),
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

const inventoryMovements = Array.from(inventoryMovementMap.values());

return {
  code: "200",
  recordsToUpdate: recordsToUpdate,
  recordsToUpdateLength: recordsToUpdate.length,
  inventoryMovements: inventoryMovements,
  inventoryMovementsLength: inventoryMovements.length,
  message: `Found ${orphanedRecords.length} orphaned allocations to process`,
};
