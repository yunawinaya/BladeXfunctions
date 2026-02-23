const existingAllocatedData = {{workflowparams:oldAllocatedData}} || [];
const existingPendingData = {{node:search_node_vNmMP0vu.data.data}} || [];
const quantity = {{workflowparams:quantity}};
const parentId = {{workflowparams:parent_id}};
const parentLineId = {{workflowparams:parent_line_id}};
const parentNo = {{workflowparams:parent_no}};
const docId = {{workflowparams:doc_id}};
const docLineId = {{workflowparams:doc_line_id}};
const docNo = {{workflowparams:doc_no}};
const materialId = {{workflowparams:material_id}};
const itemData = {{workflowparams:itemData}};
const batchId = {{node:code_node_pzzFHqbD.data.batchID}};
const locationId = {{workflowparams:location_id}};
const materialUom = {{workflowparams:material_uom}};
const docDate = {{workflowparams:doc_date}};
const index = {{workflowparams:index}};
const plantId = {{workflowparams:plant_id}};
const organizationId = {{workflowparams:organization_id}};
const remark = {{workflowparams:remark}};

const matchedAllocatedRecords = existingAllocatedData.filter(
  (record) =>
    String(record.doc_line_id) === String(docLineId) &&
    String(record.material_id) === String(materialId) &&
    String(record.batch_id || "") === String(batchId || "") &&
    String(record.bin_location || "") === String(locationId || "") &&
    record.status === "Allocated" &&
    String(record.target_gd_id) === String(docId),
);

if (matchedAllocatedRecords.length > 0) {
  const totalAllocatedQty = matchedAllocatedRecords.reduce(
    (sum, r) => sum + (r.open_qty || 0),
    0,
  );

  const recordsToUpdate = [];
  let recordToCreate = null;
  let reservedQtyToSubtract = 0;

  if (quantity <= totalAllocatedQty) {
    let remainingQtyToDeliver = quantity;
    let remainingQtyToRelease = totalAllocatedQty - quantity;
    let unrestrictedQtyToAdd = 0;
    const releaseOrderPriority = {
      "Good Delivery": 1,
      "Picking Plan": 1,
      "Sales Order": 2,
      "Production": 3,
    };
    const sortedAllocatedRecords = [...matchedAllocatedRecords].sort(
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

    for (const allocatedRecord of sortedAllocatedRecords) {
      if (remainingQtyToDeliver <= 0 && remainingQtyToRelease <= 0) break;

      const recordQty = allocatedRecord.open_qty || 0;
      const isFromUnrestricted = allocatedRecord.doc_type === "Good Delivery" || allocatedRecord.doc_type === "Picking Plan";

      if (remainingQtyToDeliver > 0) {
        const deliverFromThisRecord = Math.min(recordQty, remainingQtyToDeliver);

        if (deliverFromThisRecord === recordQty) {
          recordsToUpdate.push({
            ...allocatedRecord,
            reserved_qty: allocatedRecord.reserved_qty,
            open_qty: 0,
            delivered_qty: (allocatedRecord.delivered_qty || 0) + deliverFromThisRecord,
            status: "Delivered",
          });
        } else {
          recordsToUpdate.push({
            ...allocatedRecord,
            reserved_qty: deliverFromThisRecord,
            open_qty: 0,
            delivered_qty: deliverFromThisRecord,
            status: "Delivered",
          });

          const remainderQty = recordQty - deliverFromThisRecord;

          if (isFromUnrestricted) {
            const { _id, id, ...recordWithoutId } = allocatedRecord;
            recordToCreate = {
              ...recordWithoutId,
              reserved_qty: remainderQty,
              open_qty: 0,
              delivered_qty: 0,
              status: "Cancelled",
              source_reserved_id: allocatedRecord.id,
              target_gd_id: null,
            };
            unrestrictedQtyToAdd += remainderQty;
          } else {
            const existingPending = findExistingPendingToMerge(
              allocatedRecord.doc_type,
              allocatedRecord.parent_line_id,
            );

            if (existingPending) {
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: existingPending.reserved_qty + remainderQty,
                open_qty: existingPending.open_qty + remainderQty,
                status: "Pending",
              });
            } else {
              const { _id, id, ...recordWithoutId } = allocatedRecord;
              recordToCreate = {
                ...recordWithoutId,
                doc_id: "",
                doc_no: "",
                doc_line_id: "",
                reserved_qty: remainderQty,
                open_qty: remainderQty,
                delivered_qty: 0,
                status: "Pending",
                source_reserved_id: allocatedRecord.source_reserved_id || allocatedRecord.id,
                target_gd_id: null,
              };
            }
          }
        }

        remainingQtyToDeliver -= deliverFromThisRecord;
        reservedQtyToSubtract += deliverFromThisRecord;
      } else if (remainingQtyToRelease > 0) {
        const releaseFromThisRecord = Math.min(recordQty, remainingQtyToRelease);

        if (releaseFromThisRecord === recordQty) {
          if (isFromUnrestricted) {
            recordsToUpdate.push({
              ...allocatedRecord,
              reserved_qty: allocatedRecord.reserved_qty,
              open_qty: 0,
              status: "Cancelled",
              target_gd_id: null,
            });
            unrestrictedQtyToAdd += releaseFromThisRecord;
          } else {
            const existingPending = findExistingPendingToMerge(
              allocatedRecord.doc_type,
              allocatedRecord.parent_line_id,
            );

            if (existingPending) {
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: existingPending.reserved_qty + releaseFromThisRecord,
                open_qty: existingPending.open_qty + releaseFromThisRecord,
                status: "Pending",
              });
              recordsToUpdate.push({
                ...allocatedRecord,
                reserved_qty: allocatedRecord.reserved_qty,
                open_qty: 0,
                status: "Cancelled",
                target_gd_id: null,
              });
            } else {
              recordsToUpdate.push({
                ...allocatedRecord,
                doc_id: "",
                doc_no: "",
                doc_line_id: "",
                status: "Pending",
                target_gd_id: null,
              });
            }
          }
        } else {
          recordsToUpdate.push({
            ...allocatedRecord,
            reserved_qty: recordQty - releaseFromThisRecord,
            open_qty: recordQty - releaseFromThisRecord,
            status: "Allocated",
          });

          if (isFromUnrestricted) {
            const { _id, id, ...recordWithoutId } = allocatedRecord;
            recordToCreate = {
              ...recordWithoutId,
              reserved_qty: releaseFromThisRecord,
              open_qty: 0,
              delivered_qty: 0,
              status: "Cancelled",
              source_reserved_id: allocatedRecord.id,
              target_gd_id: null,
            };
            unrestrictedQtyToAdd += releaseFromThisRecord;
          } else {
            const existingPending = findExistingPendingToMerge(
              allocatedRecord.doc_type,
              allocatedRecord.parent_line_id,
            );

            if (existingPending) {
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: existingPending.reserved_qty + releaseFromThisRecord,
                open_qty: existingPending.open_qty + releaseFromThisRecord,
                status: "Pending",
              });
            } else {
              const { _id, id, ...recordWithoutId } = allocatedRecord;
              recordToCreate = {
                ...recordWithoutId,
                doc_id: "",
                doc_no: "",
                doc_line_id: "",
                reserved_qty: releaseFromThisRecord,
                open_qty: releaseFromThisRecord,
                delivered_qty: 0,
                status: "Pending",
                source_reserved_id: allocatedRecord.source_reserved_id || allocatedRecord.id,
                target_gd_id: null,
              };
            }
          }
        }

        remainingQtyToRelease -= releaseFromThisRecord;
      }
    }

    const inventoryMovements = [];

    if (reservedQtyToSubtract > 0) {
      inventoryMovements.push({
        source: "Reserved",
        quantity: reservedQtyToSubtract,
        operation: "subtract",
        movement_type: "DELIVERY",
      });
    }

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
      recordToCreateExists: recordToCreate ? 1 : 0,
      inventoryMovements,
      inventoryMovementsLength: inventoryMovements.length,
      message:
        quantity < totalAllocatedQty
          ? "Delivery processed with re-allocation (decreased qty)"
          : "Delivery processed from allocated inventory (Reserved)",
    };
  }

  if (quantity > totalAllocatedQty) {
    for (const allocatedRecord of matchedAllocatedRecords) {
      recordsToUpdate.push({
        ...allocatedRecord,
        reserved_qty: allocatedRecord.reserved_qty,
        open_qty: 0,
        delivered_qty: (allocatedRecord.delivered_qty || 0) + allocatedRecord.open_qty,
        status: "Delivered",
      });
    }
    reservedQtyToSubtract = totalAllocatedQty;

    let additionalQtyNeeded = quantity - totalAllocatedQty;

    const matchedPendingRecords = existingPendingData.filter(
      (record) =>
        String(record.material_id) === String(materialId) &&
        String(record.batch_id || "") === String(batchId || "") &&
        String(record.bin_location || "") === String(locationId || "") &&
        record.status === "Pending",
    );

    const pendingProdReceiptData = matchedPendingRecords.filter(
      (item) => item.doc_type === "Production",
    );
    const pendingSOData = matchedPendingRecords.filter(
      (item) => item.doc_type === "Sales Order",
    );

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

    if (pendingProdReceiptData.length > 0 && additionalQtyNeeded > 0) {
      const prodReceiptQty = pendingProdReceiptData[0].open_qty || 0;
      const deliverQty = Math.min(prodReceiptQty, additionalQtyNeeded);

      if (deliverQty === prodReceiptQty) {
        recordsToUpdate.push({
          ...pendingProdReceiptData[0],
          reserved_qty: pendingProdReceiptData[0].reserved_qty,
          open_qty: 0,
          delivered_qty: deliverQty,
          status: "Delivered",
          target_gd_id: docId,
        });
      } else {
        recordsToUpdate.push({
          ...pendingProdReceiptData[0],
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          status: "Delivered",
          target_gd_id: docId,
        });

        const { _id, id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
        recordToCreate = {
          ...prodReceiptWithoutId,
          doc_id: "",
          doc_no: "",
          doc_line_id: "",
          reserved_qty: prodReceiptQty - deliverQty,
          open_qty: prodReceiptQty - deliverQty,
          delivered_qty: 0,
          status: "Pending",
          source_reserved_id: pendingProdReceiptData[0].source_reserved_id || pendingProdReceiptData[0].id,
          target_gd_id: null,
        };
      }

      reservedQtyToSubtract += deliverQty;
      additionalQtyNeeded -= deliverQty;
    }

    if (pendingSOData.length > 0 && additionalQtyNeeded > 0) {
      const soQty = pendingSOData[0].open_qty || 0;
      const deliverQty = Math.min(soQty, additionalQtyNeeded);

      if (deliverQty === soQty) {
        recordsToUpdate.push({
          ...pendingSOData[0],
          reserved_qty: pendingSOData[0].reserved_qty,
          open_qty: 0,
          delivered_qty: deliverQty,
          status: "Delivered",
          target_gd_id: docId,
        });
      } else {
        recordsToUpdate.push({
          ...pendingSOData[0],
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          status: "Delivered",
          target_gd_id: docId,
        });

        const { _id, id, ...soWithoutId } = pendingSOData[0];
        recordToCreate = {
          ...soWithoutId,
          doc_id: "",
          doc_no: "",
          doc_line_id: "",
          reserved_qty: soQty - deliverQty,
          open_qty: soQty - deliverQty,
          delivered_qty: 0,
          status: "Pending",
          source_reserved_id: pendingSOData[0].source_reserved_id || pendingSOData[0].id,
          target_gd_id: null,
        };
      }

      reservedQtyToSubtract += deliverQty;
      additionalQtyNeeded -= deliverQty;
    }

    let unrestrictedQtyToAllocate = 0;
    if (additionalQtyNeeded > 0) {
      unrestrictedQtyToAllocate = additionalQtyNeeded;

      recordToCreate = {
        plant_id: plantId,
        organization_id: organizationId,
        material_id: materialId,
        batch_id: batchId,
        bin_location: locationId,
        item_uom: materialUom,
        doc_type: "Good Delivery",
        parent_id: parentId,
        parent_no: parentNo,
        parent_line_id: parentLineId,
        target_gd_id: docId,
        target_gd_no: docNo,
        doc_line_id: docLineId,
        reserved_qty: unrestrictedQtyToAllocate,
        open_qty: 0,
        delivered_qty: unrestrictedQtyToAllocate,
        status: "Delivered",
        remark: remark,
        reserved_date: docDate,
      };

      additionalQtyNeeded = 0;
    }

    const inventoryMovements = [];

    if (unrestrictedQtyToAllocate > 0) {
      inventoryMovements.push({
        quantity: unrestrictedQtyToAllocate,
        movement_type: "UNRESTRICTED_TO_RESERVED",
      });
    }

    const totalDeliveryQty = reservedQtyToSubtract + unrestrictedQtyToAllocate;
    if (totalDeliveryQty > 0) {
      inventoryMovements.push({
        source: "Reserved",
        quantity: totalDeliveryQty,
        operation: "subtract",
        movement_type: "DELIVERY",
      });
    }

    return {
      code: "200",
      recordsToUpdate,
      recordsToUpdateLength: recordsToUpdate.length,
      recordToCreate,
      recordToCreateExists: recordToCreate ? 1 : 0,
      inventoryMovements,
      inventoryMovementsLength: inventoryMovements.length,
      message: "Delivery processed with re-allocation (increased qty)",
    };
  }
}

const matchedPendingRecords = existingPendingData.filter(
  (record) =>
    String(record.material_id) === String(materialId) &&
    String(record.batch_id || "") === String(batchId || "") &&
    String(record.bin_location || "") === String(locationId || "") &&
    record.status === "Pending",
);

const pendingSOData = matchedPendingRecords.filter(
  (item) => item.doc_type === "Sales Order",
);

const pendingProdReceiptData = matchedPendingRecords.filter(
  (item) => item.doc_type === "Production",
);

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

let remainingQtyToDeliver = quantity;
const recordsToUpdate = [];
let recordToCreate = null;
let reservedQty = 0;

if (pendingProdReceiptData.length > 0 && remainingQtyToDeliver > 0) {
  const deliverQty = Math.min(productionReceiptOpenQty, remainingQtyToDeliver);

  if (deliverQty === productionReceiptOpenQty) {
    recordsToUpdate.push({
      ...pendingProdReceiptData[0],
      reserved_qty: pendingProdReceiptData[0].reserved_qty,
      open_qty: 0,
      delivered_qty: deliverQty,
      status: "Delivered",
      target_gd_id: docId,
    });
  } else {
    recordsToUpdate.push({
      ...pendingProdReceiptData[0],
      reserved_qty: deliverQty,
      open_qty: 0,
      delivered_qty: deliverQty,
      status: "Delivered",
      target_gd_id: docId,
    });

    const { _id, id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
    recordToCreate = {
      ...prodReceiptWithoutId,
      doc_id: "",
      doc_no: "",
      doc_line_id: "",
      reserved_qty: productionReceiptOpenQty - deliverQty,
      open_qty: productionReceiptOpenQty - deliverQty,
      delivered_qty: 0,
      status: "Pending",
      source_reserved_id: pendingProdReceiptData[0].source_reserved_id || pendingProdReceiptData[0].id,
      target_gd_id: null,
    };
  }

  reservedQty += deliverQty;
  remainingQtyToDeliver -= deliverQty;
}

if (pendingSOData.length > 0 && remainingQtyToDeliver > 0) {
  const deliverQty = Math.min(salesOrderOpenQty, remainingQtyToDeliver);

  if (deliverQty === salesOrderOpenQty) {
    recordsToUpdate.push({
      ...pendingSOData[0],
      reserved_qty: pendingSOData[0].reserved_qty,
      open_qty: 0,
      delivered_qty: deliverQty,
      status: "Delivered",
      target_gd_id: docId,
    });
  } else {
    recordsToUpdate.push({
      ...pendingSOData[0],
      reserved_qty: deliverQty,
      open_qty: 0,
      delivered_qty: deliverQty,
      status: "Delivered",
      target_gd_id: docId,
    });

    const { _id, id, ...soWithoutId } = pendingSOData[0];
    recordToCreate = {
      ...soWithoutId,
      doc_id: "",
      doc_no: "",
      doc_line_id: "",
      reserved_qty: salesOrderOpenQty - deliverQty,
      open_qty: salesOrderOpenQty - deliverQty,
      delivered_qty: 0,
      status: "Pending",
      source_reserved_id: pendingSOData[0].source_reserved_id || pendingSOData[0].id,
      target_gd_id: null,
    };
  }

  reservedQty += deliverQty;
  remainingQtyToDeliver -= deliverQty;
}

let unrestrictedQtyToAllocate = 0;
if (remainingQtyToDeliver > 0) {
  unrestrictedQtyToAllocate = remainingQtyToDeliver;

  recordToCreate = {
    plant_id: plantId,
    organization_id: organizationId,
    material_id: materialId,
    batch_id: batchId,
    bin_location: locationId,
    item_uom: materialUom,
    doc_type: "Good Delivery",
    parent_id: parentId,
    parent_no: parentNo,
    parent_line_id: parentLineId,
    target_gd_id: docId,
    target_gd_no: docNo,
    doc_line_id: docLineId,
    reserved_qty: unrestrictedQtyToAllocate,
    open_qty: 0,
    delivered_qty: unrestrictedQtyToAllocate,
    status: "Delivered",
    remark: remark,
    reserved_date: docDate,
  };

  remainingQtyToDeliver = 0;
}

const inventoryMovements = [];

if (unrestrictedQtyToAllocate > 0) {
  inventoryMovements.push({
    quantity: unrestrictedQtyToAllocate,
    movement_type: "UNRESTRICTED_TO_RESERVED",
  });
}

const totalDeliveryQty = reservedQty + unrestrictedQtyToAllocate;
if (totalDeliveryQty > 0) {
  inventoryMovements.push({
    source: "Reserved",
    quantity: totalDeliveryQty,
    operation: "subtract",
    movement_type: "DELIVERY",
  });
}

return {
  code: "200",
  recordsToUpdate,
  recordsToUpdateLength: recordsToUpdate.length,
  recordToCreate,
  recordToCreateExists: recordToCreate ? 1 : 0,
  inventoryMovements,
  inventoryMovementsLength: inventoryMovements.length,
  message: "Delivery processed successfully",
};
