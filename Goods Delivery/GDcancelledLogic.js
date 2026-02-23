const existingAllocatedData = {{workflowparams:oldAllocatedData}} || [];
const existingPendingData = {{node:search_node_LD2gXBgY.data.data}} || [];
const docId = {{workflowparams:doc_id}};
const docLineId = {{workflowparams:doc_line_id}};
const materialId = {{workflowparams:material_id}};
const batchId = {{node:code_node_pzzFHqbD.data.batchID}};
const locationId = {{workflowparams:location_id}};
const organizationId = {{workflowparams:organization_id}};
const plantId = {{workflowparams:plant_id}};

const matchedAllocatedRecords = existingAllocatedData.filter(
  (record) =>
    String(record.doc_line_id) === String(docLineId) &&
    String(record.material_id) === String(materialId) &&
    String(record.batch_id || "") === String(batchId || "") &&
    String(record.bin_location || "") === String(locationId || "") &&
    record.status === "Allocated" &&
    String(record.target_gd_id) === String(docId),
);

if (!matchedAllocatedRecords || matchedAllocatedRecords.length === 0) {
  return {
    code: "200",
    recordsToUpdate: [],
    recordsToUpdateLength: 0,
    inventoryMovements: [],
    inventoryMovementsLength: 0,
    message: "No allocations to release for this line item",
  };
}

const releaseOrderPriority = {
  "Good Delivery": 1,
  "Picking Plan": 1,
  "Sales Order": 2,
  "Production": 3,
};

const sortedAllocations = [...matchedAllocatedRecords].sort(
  (a, b) =>
    (releaseOrderPriority[a.doc_type] || 99) -
    (releaseOrderPriority[b.doc_type] || 99),
);

const findExistingPendingToMerge = (docType, recordParentLineId) => {
  return existingPendingData.find(
    (record) =>
      record.status === "Pending" &&
      record.doc_type === docType &&
      String(record.parent_line_id) === String(recordParentLineId) &&
      String(record.material_id) === String(materialId) &&
      String(record.batch_id || "") === String(batchId || "") &&
      String(record.bin_location || "") === String(locationId || ""),
  );
};

const recordsToUpdate = [];
const pendingMergeAccumulator = new Map();
const inventoryMovementMap = new Map();

for (const allocation of sortedAllocations) {
  const releaseQty = allocation.reserved_qty || 0;

  if (allocation.doc_type === "Good Delivery" || allocation.doc_type === "Picking Plan") {
    recordsToUpdate.push({
      id: allocation.id,
      reserved_qty: allocation.reserved_qty,
      open_qty: 0,
      status: "Cancelled",
      target_gd_id: null,
    });

    const invKey = `${allocation.material_id}|${allocation.batch_id || ""}|${allocation.bin_location || ""}`;
    const existingMovement = inventoryMovementMap.get(invKey);

    if (existingMovement) {
      existingMovement.quantity += releaseQty;
    } else {
      inventoryMovementMap.set(invKey, {
        material_id: allocation.material_id,
        batch_id: allocation.batch_id,
        bin_location: allocation.bin_location,
        material_uom: allocation.item_uom,
        quantity: releaseQty,
        movement_type: "RESERVED_TO_UNRESTRICTED",
      });
    }
  } else {
    const existingPending = findExistingPendingToMerge(
      allocation.doc_type,
      allocation.parent_line_id,
    );

    if (existingPending) {
      const accumulatedQty = pendingMergeAccumulator.get(existingPending.id) || 0;
      const newAccumulatedQty = accumulatedQty + releaseQty;
      pendingMergeAccumulator.set(existingPending.id, newAccumulatedQty);

      recordsToUpdate.push({
        id: allocation.id,
        reserved_qty: allocation.reserved_qty,
        open_qty: 0,
        status: "Cancelled",
        target_gd_id: null,
      });
    } else {
      recordsToUpdate.push({
        ...allocation,
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
  const existingPending = existingPendingData.find(
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
  message: `Released ${matchedAllocatedRecords.length} allocation(s) for line item`,
};
