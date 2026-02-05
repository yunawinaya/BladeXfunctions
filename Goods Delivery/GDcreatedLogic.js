const existingPendingData = {{node:search_node_IJAcucMA.data.data}};
const oldAllocatedData = {{workflowparams:oldAllocatedData}} || [];
const quantity = {{workflowparams:quantity}};
const parentId = {{workflowparams:parent_id}};
const parentLineId = {{workflowparams:parent_line_id}};
const parentNo = {{workflowparams:parent_no}};
const docId = {{workflowparams:doc_id}};
const docLineId = {{workflowparams:doc_line_id}};
const docNo = {{workflowparams:doc_no}};
const materialId = {{workflowparams:material_id}};
const itemData = {{workflowparams:itemData}};
const batchId = {{workflowparams:batch_id}};
const locationId = {{workflowparams:location_id}};
const materialUom = {{workflowparams:material_uom}};
const docDate = {{workflowparams:doc_date}};
const index = {{workflowparams:index}};
const plantId = {{workflowparams:plant_id}};
const organizationId = {{workflowparams:organization_id}};
const remark = {{workflowparams:remark}};

const matchedOldRecords = oldAllocatedData.filter(
  (record) =>
    String(record.doc_line_id) === String(docLineId) &&
    String(record.material_id) === String(materialId) &&
    String(record.batch_id || "") === String(batchId || "") &&
    String(record.bin_location || "") === String(locationId || "") &&
    record.status === "Allocated" &&
    String(record.target_gd_id) === String(docId),
);

if (matchedOldRecords.length > 0) {
  const oldQty = matchedOldRecords.reduce(
    (sum, r) => sum + (r.reserved_qty || 0),
    0,
  );
  const newQty = quantity;
  const netChange = newQty - oldQty;

  if (netChange === 0) {
    return {
      code: "200",
      recordsToUpdate: [],
      recordsToUpdateLength: 0,
      recordToCreate: null,
      inventoryMovements: [],
      inventoryMovementsLength: 0,
      message: "No change - quantities match",
    };
  }

  if (netChange < 0) {
    const qtyToRelease = Math.abs(netChange);
    let remainingQtyToRelease = qtyToRelease;
    const recordsToUpdate = [];
    let recordToCreate = null;
    let unrestrictedQtyToAdd = 0;

    const releaseOrderPriority = {
      "Sales Order": 1,
      "Production Receipt": 2,
      "Good Delivery": 3,
    };
    const sortedRecordsForRelease = [...matchedOldRecords].sort(
      (a, b) =>
        (releaseOrderPriority[a.doc_type] || 99) -
        (releaseOrderPriority[b.doc_type] || 99),
    );

    const findExistingPendingToMerge = (docType) => {
      return existingPendingData.find(
        (record) =>
          record.status === "Pending" &&
          record.doc_type === docType &&
          String(record.parent_line_id) === String(parentLineId) &&
          String(record.material_id) === String(materialId) &&
          String(record.batch_id || "") === String(batchId || "") &&
          String(record.bin_location || "") === String(locationId || ""),
      );
    };

    for (const oldRecord of sortedRecordsForRelease) {
      if (remainingQtyToRelease <= 0) break;

      const releaseFromThisRecord = Math.min(
        oldRecord.reserved_qty,
        remainingQtyToRelease,
      );

      const isFromUnrestricted = oldRecord.doc_type === "Good Delivery";

      if (releaseFromThisRecord === oldRecord.reserved_qty) {
        if (isFromUnrestricted) {
          recordsToUpdate.push({
            ...oldRecord,
            reserved_qty: oldRecord.reserved_qty,
            open_qty: 0,
            status: "Cancelled",
            target_gd_id: null,
          });
          unrestrictedQtyToAdd += releaseFromThisRecord;
        } else {
          const existingPending = findExistingPendingToMerge(oldRecord.doc_type);

          if (existingPending) {
            recordsToUpdate.push({
              ...existingPending,
              reserved_qty: existingPending.reserved_qty + releaseFromThisRecord,
              open_qty: existingPending.open_qty + releaseFromThisRecord,
              status: "Pending",
            });
            recordsToUpdate.push({
              ...oldRecord,
              reserved_qty: oldRecord.reserved_qty,
              open_qty: 0,
              status: "Cancelled",
              target_gd_id: null,
            });
          } else {
            recordsToUpdate.push({
              ...oldRecord,
              reserved_qty: oldRecord.reserved_qty,
              open_qty: oldRecord.reserved_qty,
              status: "Pending",
              target_gd_id: null,
            });
          }
        }
      } else {
        recordsToUpdate.push({
          ...oldRecord,
          reserved_qty: oldRecord.reserved_qty - releaseFromThisRecord,
          open_qty: oldRecord.reserved_qty - releaseFromThisRecord,
          status: "Allocated",
          target_gd_id: docId,
        });

        if (isFromUnrestricted) {
          const { _id, id, ...recordWithoutId } = oldRecord;
          recordToCreate = {
            ...recordWithoutId,
            reserved_qty: releaseFromThisRecord,
            open_qty: 0,
            status: "Cancelled",
            source_reserved_id: oldRecord.id,
            target_gd_id: null,
          };
          unrestrictedQtyToAdd += releaseFromThisRecord;
        } else {
          const existingPending = findExistingPendingToMerge(oldRecord.doc_type);

          if (existingPending) {
            recordsToUpdate.push({
              ...existingPending,
              reserved_qty: existingPending.reserved_qty + releaseFromThisRecord,
              open_qty: existingPending.open_qty + releaseFromThisRecord,
              status: "Pending",
            });
          } else {
            const { _id, id, ...recordWithoutId } = oldRecord;
            recordToCreate = {
              ...recordWithoutId,
              reserved_qty: releaseFromThisRecord,
              open_qty: releaseFromThisRecord,
              status: "Pending",
              source_reserved_id: oldRecord.id,
              target_gd_id: null,
            };
          }
        }
      }

      remainingQtyToRelease -= releaseFromThisRecord;
    }

    const inventoryMovements = [];
    if (unrestrictedQtyToAdd > 0) {
      inventoryMovements.push({
        quantity: unrestrictedQtyToAdd,
        movement_type: "RESERVED_TO_UNRESTRICTED",
      });
    }

    return {
      code: "200",
      recordsToUpdate,
      recordsToUpdateLength: recordsToUpdate.length,
      recordToCreate,
      inventoryMovements,
      inventoryMovementsLength: inventoryMovements.length,
      message: "Allocation released (decreased quantity)",
    };
  }

  if (netChange > 0) {
    const additionalQty = netChange;

    const pendingSOData =
      existingPendingData.filter(
        (item) => item.status === "Pending" && item.doc_type === "Sales Order",
      ) || [];

    const pendingProdReceiptData =
      existingPendingData.filter(
        (item) =>
          item.status === "Pending" && item.doc_type === "Production Receipt",
      ) || [];

    if (pendingSOData.length > 1) {
      return {
        code: "400",
        message: "Multiple pending sales orders found",
      };
    }

    if (pendingProdReceiptData.length > 1) {
      return {
        code: "400",
        message: "Multiple pending production receipts found",
      };
    }

    const salesOrderOpenQty =
      pendingSOData.length > 0 ? pendingSOData[0].open_qty : 0;
    const productionReceiptOpenQty =
      pendingProdReceiptData.length > 0
        ? pendingProdReceiptData[0].open_qty
        : 0;

    let remainingQtyToAllocate = additionalQty;
    const recordsToUpdate = [];
    let recordToCreate = null;

    if (pendingProdReceiptData.length > 0 && remainingQtyToAllocate > 0) {
      const allocateQty = Math.min(
        productionReceiptOpenQty,
        remainingQtyToAllocate,
      );

      if (allocateQty === productionReceiptOpenQty) {
        recordsToUpdate.push({
          ...pendingProdReceiptData[0],
          reserved_qty: pendingProdReceiptData[0].reserved_qty,
          open_qty: pendingProdReceiptData[0].open_qty,
          status: "Allocated",
          target_gd_id: docId,
        });
      } else {
        recordsToUpdate.push({
          ...pendingProdReceiptData[0],
          reserved_qty: allocateQty,
          open_qty: allocateQty,
          status: "Allocated",
          target_gd_id: docId,
        });

        const { _id, id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
        recordToCreate = {
          ...prodReceiptWithoutId,
          reserved_qty: productionReceiptOpenQty - allocateQty,
          open_qty: productionReceiptOpenQty - allocateQty,
          status: "Pending",
          source_reserved_id: pendingProdReceiptData[0].id,
          target_gd_id: null,
        };
      }

      remainingQtyToAllocate -= allocateQty;
    }

    if (pendingSOData.length > 0 && remainingQtyToAllocate > 0) {
      const allocateQty = Math.min(salesOrderOpenQty, remainingQtyToAllocate);

      if (allocateQty === salesOrderOpenQty) {
        recordsToUpdate.push({
          ...pendingSOData[0],
          reserved_qty: pendingSOData[0].reserved_qty,
          open_qty: pendingSOData[0].open_qty,
          status: "Allocated",
          target_gd_id: docId,
        });
      } else {
        recordsToUpdate.push({
          ...pendingSOData[0],
          reserved_qty: allocateQty,
          open_qty: allocateQty,
          status: "Allocated",
          target_gd_id: docId,
        });

        const { _id, id, ...soWithoutId } = pendingSOData[0];
        recordToCreate = {
          ...soWithoutId,
          reserved_qty: salesOrderOpenQty - allocateQty,
          open_qty: salesOrderOpenQty - allocateQty,
          status: "Pending",
          source_reserved_id: pendingSOData[0].id,
          target_gd_id: null,
        };
      }

      remainingQtyToAllocate -= allocateQty;
    }

    let shortfallQty = 0;
    if (remainingQtyToAllocate > 0) {
      shortfallQty = remainingQtyToAllocate;
      recordToCreate = {
        doc_type: "Good Delivery",
        status: "Allocated",
        source_reserved_id: null,
        parent_id: parentId,
        parent_line_id: parentLineId,
        parent_no: parentNo,
        doc_no: docNo,
        doc_id: docId,
        doc_line_id: docLineId,
        material_id: materialId,
        item_code: itemData.material_code,
        item_name: itemData.material_name,
        item_desc: itemData.material_desc,
        batch_id: batchId,
        bin_location: locationId,
        item_uom: materialUom,
        reserved_qty: remainingQtyToAllocate,
        delivered_qty: 0,
        open_qty: remainingQtyToAllocate,
        reserved_date: docDate,
        line_no: index,
        plant_id: plantId,
        organization_id: organizationId,
        remark: remark,
        target_gd_id: docId,
      };
    }

    const inventoryMovements = [];
    if (shortfallQty > 0) {
      inventoryMovements.push({
        quantity: shortfallQty,
        movement_type: "UNRESTRICTED_TO_RESERVED",
      });
    }

    return {
      code: "200",
      recordsToUpdate,
      recordsToUpdateLength: recordsToUpdate.length,
      recordToCreate,
      inventoryMovements,
      inventoryMovementsLength: inventoryMovements.length,
      message: "Additional allocation successful (increased quantity)",
    };
  }
}

const pendingSOData =
  existingPendingData.filter(
    (item) => item.status === "Pending" && item.doc_type === "Sales Order",
  ) || [];

const pendingProdReceiptData =
  existingPendingData.filter(
    (item) =>
      item.status === "Pending" && item.doc_type === "Production Receipt",
  ) || [];

if (pendingSOData.length > 1) {
  return {
    code: "400",
    message: "Multiple pending sales orders found",
  };
}

if (pendingProdReceiptData.length > 1) {
  return {
    code: "400",
    message: "Multiple pending production receipts found",
  };
}

const salesOrderOpenQty =
  pendingSOData.length > 0 ? pendingSOData[0].open_qty : 0;
const productionReceiptOpenQty =
  pendingProdReceiptData.length > 0 ? pendingProdReceiptData[0].open_qty : 0;

let remainingQtyToAllocate = quantity;
const recordsToUpdate = [];
let recordToCreate = null;

if (pendingProdReceiptData.length > 0 && remainingQtyToAllocate > 0) {
  const allocateQty = Math.min(
    productionReceiptOpenQty,
    remainingQtyToAllocate,
  );

  if (allocateQty === productionReceiptOpenQty) {
    recordsToUpdate.push({
      ...pendingProdReceiptData[0],
      reserved_qty: pendingProdReceiptData[0].reserved_qty,
      open_qty: pendingProdReceiptData[0].open_qty,
      status: "Allocated",
      target_gd_id: docId,
    });
  } else {
    recordsToUpdate.push({
      ...pendingProdReceiptData[0],
      reserved_qty: allocateQty,
      open_qty: allocateQty,
      status: "Allocated",
      target_gd_id: docId,
    });

    const { _id, id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
    recordToCreate = {
      ...prodReceiptWithoutId,
      reserved_qty: productionReceiptOpenQty - allocateQty,
      open_qty: productionReceiptOpenQty - allocateQty,
      status: "Pending",
      source_reserved_id: pendingProdReceiptData[0].id,
      target_gd_id: null,
    };
  }

  remainingQtyToAllocate -= allocateQty;
}

if (pendingSOData.length > 0 && remainingQtyToAllocate > 0) {
  const allocateQty = Math.min(salesOrderOpenQty, remainingQtyToAllocate);

  if (allocateQty === salesOrderOpenQty) {
    recordsToUpdate.push({
      ...pendingSOData[0],
      reserved_qty: pendingSOData[0].reserved_qty,
      open_qty: pendingSOData[0].open_qty,
      status: "Allocated",
      target_gd_id: docId,
    });
  } else {
    recordsToUpdate.push({
      ...pendingSOData[0],
      reserved_qty: allocateQty,
      open_qty: allocateQty,
      status: "Allocated",
      target_gd_id: docId,
    });

    const { _id, id, ...soWithoutId } = pendingSOData[0];
    recordToCreate = {
      ...soWithoutId,
      reserved_qty: salesOrderOpenQty - allocateQty,
      open_qty: salesOrderOpenQty - allocateQty,
      status: "Pending",
      source_reserved_id: pendingSOData[0].id,
      target_gd_id: null,
    };
  }

  remainingQtyToAllocate -= allocateQty;
}

let shortfallQty = 0;
if (remainingQtyToAllocate > 0) {
  shortfallQty = remainingQtyToAllocate;
  recordToCreate = {
    doc_type: "Good Delivery",
    status: "Allocated",
    source_reserved_id: null,
    parent_id: parentId,
    parent_line_id: parentLineId,
    parent_no: parentNo,
    doc_no: docNo,
    doc_id: docId,
    doc_line_id: docLineId,
    material_id: materialId,
    item_code: itemData.material_code,
    item_name: itemData.material_name,
    item_desc: itemData.material_desc,
    batch_id: batchId,
    bin_location: locationId,
    item_uom: materialUom,
    reserved_qty: remainingQtyToAllocate,
    delivered_qty: 0,
    open_qty: remainingQtyToAllocate,
    reserved_date: docDate,
    line_no: index,
    plant_id: plantId,
    organization_id: organizationId,
    remark: remark,
    target_gd_id: docId,
  };
}

const inventoryMovements = [];
if (shortfallQty > 0) {
  inventoryMovements.push({
    quantity: shortfallQty,
    movement_type: "UNRESTRICTED_TO_RESERVED",
  });
}

return {
  code: "200",
  recordsToUpdate: recordsToUpdate,
  recordsToUpdateLength: recordsToUpdate.length,
  recordToCreate: recordToCreate,
  recordToCreateExists: recordToCreate ? 1 : 0,
  inventoryMovements: inventoryMovements,
  inventoryMovementsLength: inventoryMovements.length,
  message: "Initial allocation successful",
};
