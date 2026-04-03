/**
 * GDProcessTable_batchProcess.js
 *
 * PURPOSE: Process ALL allocations in a SINGLE code node execution
 * REPLACES: The nested loops + GLOBAL_RESERVED workflow calls
 *
 * This contains the same logic as:
 * - GDcreatedLogic.js (for saveAs === "Created")
 * - GDdeliveredLogic.js (for saveAs === "Completed")
 * - CleanupOrphanedAllocations.js (cleanup before processing)
 *
 * PERFORMANCE: Processes 100 items in ~1 second vs 60+ seconds with loops
 *
 * INPUT: Output from GDProcessTable_batchFetch.js
 * OUTPUT: All records to update/create and inventory movements
 */

// Get pre-fetched data from batch fetch node
const batchData = {{node:code_node_eOMvMZOj.data}};

const {
  allItemsData,
  allAllocatedData,
  allPendingData,
  processedTableData,
  isGDPP,
  docId,
  docNo,
  plantId,
  organizationId,
  saveAs,
  docDate,
  parentId,
  parentNo,
  pickingPlanId
} = batchData;

// Create item lookup Map from array (workflow platform can't pass object maps)
const itemDataMap = {};
for (const item of allItemsData) {
  itemDataMap[item.id] = item;
}

// Helper functions
const roundQty = (value) => parseFloat(parseFloat(value || 0).toFixed(3));

// Filter itemData to only include fields needed by inventory workflow
const filterItemData = (itemData) => {
  if (!itemData) return null;
  return {
    stock_control: itemData.stock_control,
    based_uom: itemData.based_uom,
    table_uom_conversion: itemData.table_uom_conversion,
    material_costing_method: itemData.material_costing_method,
    purchase_unit_price: itemData.purchase_unit_price,
    item_batch_management: itemData.item_batch_management,
    material_code: itemData.material_code,
    material_name: itemData.material_name,
    material_desc: itemData.material_desc,
  };
};

// Priority order for allocation and release
const releaseOrderPriority = {
  "Good Delivery": 1,
  "Picking Plan": 1,
  "Sales Order": 2,
  "Production": 3,
};

const allocateOrderPriority = {
  "Production": 1,
  "Sales Order": 2,
  "Good Delivery": 3,
  "Picking Plan": 3,
};

// ============ STEP 1: CLEANUP ORPHANED ALLOCATIONS ============
const cleanupOrphanedAllocations = () => {
  if (!allAllocatedData || allAllocatedData.length === 0) {
    return { recordsToUpdate: [], inventoryMovements: [] };
  }

  // Build current temp data keys from ALL table items
  const currentTempDataKeys = [];
  for (const processed of processedTableData) {
    if (processed.skipProcessing) continue;

    for (const groupKey of processed.groupKeys) {
      const group = processed.groupedTempData[groupKey];
      currentTempDataKeys.push({
        doc_line_id: isGDPP === 1 ? (processed.picking_plan_line_id || processed.doc_line_id) : processed.doc_line_id,
        material_id: processed.material_id,
        batch_id: group.batch_id,
        bin_location: group.location_id,
        handling_unit_id: group.handling_unit_id || null,
      });
    }
  }

  // Find orphaned records (allocated but not in current temp data)
  const orphanedRecords = allAllocatedData.filter(
    (allocated) =>
      !currentTempDataKeys.some(
        (current) =>
          String(allocated.doc_line_id) === String(current.doc_line_id) &&
          String(allocated.material_id) === String(current.material_id) &&
          String(allocated.batch_id || "") === String(current.batch_id || "") &&
          String(allocated.bin_location || "") === String(current.bin_location || "") &&
          String(allocated.handling_unit_id || "") === String(current.handling_unit_id || "")
      )
  );

  if (orphanedRecords.length === 0) {
    return { recordsToUpdate: [], inventoryMovements: [] };
  }

  const sortedOrphanedRecords = [...orphanedRecords].sort(
    (a, b) =>
      (releaseOrderPriority[a.doc_type] || 99) -
      (releaseOrderPriority[b.doc_type] || 99)
  );

  const findExistingPendingToMerge = (docType, parentLineId, materialId, batchId, binLocation) => {
    return allPendingData.find(
      (record) =>
        record.status === "Pending" &&
        record.doc_type === docType &&
        String(record.parent_line_id) === String(parentLineId) &&
        String(record.material_id) === String(materialId) &&
        String(record.batch_id || "") === String(batchId || "") &&
        String(record.bin_location || "") === String(binLocation || "")
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

      const invKey = `${orphanedRecord.material_id}|${orphanedRecord.batch_id || ""}|${orphanedRecord.bin_location || ""}|${orphanedRecord.doc_line_id || ""}`;
      const existingMovement = inventoryMovementMap.get(invKey);
      if (existingMovement) {
        existingMovement.quantity = roundQty(existingMovement.quantity + releaseQty);
      } else {
        inventoryMovementMap.set(invKey, {
          material_id: orphanedRecord.material_id,
          material_code: orphanedRecord.item_code || "",
          material_name: orphanedRecord.item_name || "",
          material_uom: orphanedRecord.item_uom,
          batch_id: orphanedRecord.batch_id,
          bin_location: orphanedRecord.bin_location,
          quantity: releaseQty,
          movement_type: "RESERVED_TO_UNRESTRICTED",
          line_so_no: orphanedRecord.parent_no || "",
          doc_line_id: orphanedRecord.doc_line_id || "",
        });
      }
    } else {
      const existingPending = findExistingPendingToMerge(
        orphanedRecord.doc_type,
        orphanedRecord.parent_line_id,
        orphanedRecord.material_id,
        orphanedRecord.batch_id,
        orphanedRecord.bin_location
      );

      if (existingPending) {
        const accumulatedQty = pendingMergeAccumulator.get(existingPending.id) || 0;
        pendingMergeAccumulator.set(existingPending.id, roundQty(accumulatedQty + releaseQty));

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

  // Apply accumulated pending merges
  for (const [pendingId, accumulatedQty] of pendingMergeAccumulator.entries()) {
    const existingPending = allPendingData.find((r) => String(r.id) === String(pendingId));
    if (existingPending) {
      recordsToUpdate.push({
        id: pendingId,
        reserved_qty: roundQty(existingPending.reserved_qty + accumulatedQty),
        open_qty: roundQty(existingPending.open_qty + accumulatedQty),
        status: "Pending",
      });
    }
  }

  return {
    recordsToUpdate,
    inventoryMovements: Array.from(inventoryMovementMap.values()),
  };
};

// ============ STEP 2: PROCESS CREATED ALLOCATIONS ============
const processCreatedAllocation = (params) => {
  const {
    quantity,
    parentId,
    parentLineId,
    docLineId,
    materialId,
    itemData,
    batchId,
    locationId,
    materialUom,
    index,
    remark,
    isPP,
    lineSoNo,
    materialCode,
    materialName,
  } = params;

  const allocDocType = isPP ? "Picking Plan" : "Good Delivery";

  // Find matched allocated records for this specific item/location/batch/HU
  const handlingUnitId = params.handlingUnitId || null;
  const matchedOldRecords = allAllocatedData.filter(
    (record) =>
      String(record.doc_line_id) === String(docLineId) &&
      String(record.material_id) === String(materialId) &&
      String(record.batch_id || "") === String(batchId || "") &&
      String(record.bin_location || "") === String(locationId || "") &&
      String(record.handling_unit_id || "") === String(handlingUnitId || "") &&
      record.status === "Allocated" &&
      String(record.target_gd_id) === String(docId)
  );

  // Find relevant pending records for this material/location/batch
  const relevantPendingData = allPendingData.filter(
    (record) =>
      String(record.material_id) === String(materialId) &&
      String(record.batch_id || "") === String(batchId || "") &&
      String(record.bin_location || "") === String(locationId || "") &&
      record.status === "Pending"
  );

  // If we have existing allocated records, handle updates
  if (matchedOldRecords.length > 0) {
    const oldQty = matchedOldRecords.reduce((sum, r) => sum + (r.reserved_qty || 0), 0);
    const netChange = roundQty(quantity - oldQty);

    if (netChange === 0) {
      return {
        recordsToUpdate: [],
        recordToCreate: null,
        inventoryMovements: [],
      };
    }

    if (netChange < 0) {
      // Quantity decreased - release allocation
      const qtyToRelease = Math.abs(netChange);
      let remainingQtyToRelease = qtyToRelease;
      const recordsToUpdate = [];
      let recordToCreate = null;
      let unrestrictedQtyToAdd = 0;

      const sortedRecordsForRelease = [...matchedOldRecords].sort(
        (a, b) =>
          (releaseOrderPriority[a.doc_type] || 99) -
          (releaseOrderPriority[b.doc_type] || 99)
      );

      const findExistingPendingToMerge = (docType) => {
        return relevantPendingData.find(
          (record) =>
            record.status === "Pending" &&
            record.doc_type === docType &&
            String(record.parent_line_id) === String(parentLineId)
        );
      };

      for (const oldRecord of sortedRecordsForRelease) {
        if (remainingQtyToRelease <= 0) break;

        const releaseFromThisRecord = Math.min(oldRecord.reserved_qty, remainingQtyToRelease);
        const isFromUnrestricted = oldRecord.doc_type === "Good Delivery" || oldRecord.doc_type === "Picking Plan";

        if (releaseFromThisRecord === oldRecord.reserved_qty) {
          if (isFromUnrestricted) {
            recordsToUpdate.push({
              ...oldRecord,
              reserved_qty: oldRecord.reserved_qty,
              open_qty: 0,
              status: "Cancelled",
              target_gd_id: null,
            });
            unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + releaseFromThisRecord);
          } else {
            const existingPending = findExistingPendingToMerge(oldRecord.doc_type);
            if (existingPending) {
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThisRecord),
                open_qty: roundQty(existingPending.open_qty + releaseFromThisRecord),
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
                doc_id: "",
                doc_no: "",
                doc_line_id: "",
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
            reserved_qty: roundQty(oldRecord.reserved_qty - releaseFromThisRecord),
            open_qty: roundQty(oldRecord.reserved_qty - releaseFromThisRecord),
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
            unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + releaseFromThisRecord);
          } else {
            const existingPending = findExistingPendingToMerge(oldRecord.doc_type);
            if (existingPending) {
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThisRecord),
                open_qty: roundQty(existingPending.open_qty + releaseFromThisRecord),
                status: "Pending",
              });
            } else {
              const { _id, id, ...recordWithoutId } = oldRecord;
              recordToCreate = {
                ...recordWithoutId,
                doc_id: "",
                doc_no: "",
                doc_line_id: "",
                reserved_qty: releaseFromThisRecord,
                open_qty: releaseFromThisRecord,
                status: "Pending",
                source_reserved_id: oldRecord.id,
                target_gd_id: null,
              };
            }
          }
        }

        remainingQtyToRelease = roundQty(remainingQtyToRelease - releaseFromThisRecord);
      }

      const inventoryMovements = [];
      if (unrestrictedQtyToAdd > 0) {
        inventoryMovements.push({
          material_id: materialId,
          material_code: materialCode,
          material_name: materialName,
          material_uom: materialUom,
          batch_id: batchId,
          bin_location: locationId,
          quantity: unrestrictedQtyToAdd,
          movement_type: "RESERVED_TO_UNRESTRICTED",
          line_so_no: lineSoNo,
          doc_line_id: docLineId,
          itemData: filterItemData(itemData),
        });
      }

      return { recordsToUpdate, recordToCreate, inventoryMovements };
    }

    if (netChange > 0) {
      // Quantity increased - allocate more
      const additionalQty = netChange;
      return allocateFromPending(additionalQty, relevantPendingData, params, allocDocType);
    }
  }

  // No existing allocated records - fresh allocation
  return allocateFromPending(quantity, relevantPendingData, params, allocDocType);
};

// Helper: Allocate from pending records following priority
const allocateFromPending = (qtyToAllocate, pendingData, params, allocDocType) => {
  const {
    parentId: lineParentId,
    parentLineId,
    docLineId,
    materialId,
    itemData,
    batchId,
    locationId,
    materialUom,
    index,
    remark,
    lineSoNo,
    materialCode,
    materialName,
  } = params;

  // When GD line is linked to a specific SO (parentLineId is set), only consume
  // that SO's pending record - prevents cross-SO contamination
  const pendingSOData = pendingData.filter((item) => {
    if (item.doc_type !== "Sales Order") return false;
    if (parentLineId) {
      return String(item.parent_line_id) === String(parentLineId);
    }
    return true;
  });
  const pendingProdData = pendingData.filter((item) => {
    if (item.doc_type !== "Production") return false;
    if (parentLineId) {
      return String(item.parent_line_id) === String(parentLineId);
    }
    return true;
  });

  let remainingQtyToAllocate = qtyToAllocate;
  const recordsToUpdate = [];
  let recordToCreate = null;

  // Allocate from Production first (priority 1)
  if (pendingProdData.length > 0 && remainingQtyToAllocate > 0) {
    const prodRecord = pendingProdData[0];
    const allocateQty = Math.min(prodRecord.open_qty, remainingQtyToAllocate);

    if (allocateQty === prodRecord.open_qty) {
      recordsToUpdate.push({
        ...prodRecord,
        doc_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        status: "Allocated",
        target_gd_id: docId,
      });
    } else {
      recordsToUpdate.push({
        ...prodRecord,
        doc_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        reserved_qty: allocateQty,
        open_qty: allocateQty,
        status: "Allocated",
        target_gd_id: docId,
      });

      const { _id, id, ...prodWithoutId } = prodRecord;
      recordToCreate = {
        ...prodWithoutId,
        doc_id: "",
        doc_no: "",
        doc_line_id: "",
        reserved_qty: roundQty(prodRecord.open_qty - allocateQty),
        open_qty: roundQty(prodRecord.open_qty - allocateQty),
        status: "Pending",
        source_reserved_id: prodRecord.source_reserved_id || prodRecord.id,
        target_gd_id: null,
      };
    }
    remainingQtyToAllocate = roundQty(remainingQtyToAllocate - allocateQty);
  }

  // Allocate from Sales Order (priority 2)
  if (pendingSOData.length > 0 && remainingQtyToAllocate > 0) {
    const soRecord = pendingSOData[0];
    const allocateQty = Math.min(soRecord.open_qty, remainingQtyToAllocate);

    if (allocateQty === soRecord.open_qty) {
      recordsToUpdate.push({
        ...soRecord,
        doc_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        status: "Allocated",
        target_gd_id: docId,
      });
    } else {
      recordsToUpdate.push({
        ...soRecord,
        doc_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        reserved_qty: allocateQty,
        open_qty: allocateQty,
        status: "Allocated",
        target_gd_id: docId,
      });

      const { _id, id, ...soWithoutId } = soRecord;
      recordToCreate = {
        ...soWithoutId,
        doc_id: "",
        doc_no: "",
        doc_line_id: "",
        reserved_qty: roundQty(soRecord.open_qty - allocateQty),
        open_qty: roundQty(soRecord.open_qty - allocateQty),
        status: "Pending",
        source_reserved_id: soRecord.source_reserved_id || soRecord.id,
        target_gd_id: null,
      };
    }
    remainingQtyToAllocate = roundQty(remainingQtyToAllocate - allocateQty);
  }

  // Allocate from unrestricted (priority 3) - create new GD record
  const inventoryMovements = [];
  if (remainingQtyToAllocate > 0) {
    recordToCreate = {
      doc_type: allocDocType,
      status: "Allocated",
      source_reserved_id: null,
      parent_id: lineParentId,
      parent_line_id: parentLineId,
      parent_no: lineSoNo,
      doc_no: docNo,
      doc_id: docId,
      doc_line_id: docLineId,
      material_id: materialId,
      item_code: itemData?.material_code || "",
      item_name: itemData?.material_name || "",
      item_desc: itemData?.material_desc || "",
      batch_id: batchId,
      bin_location: locationId,
      handling_unit_id: params.handlingUnitId || null,
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

    inventoryMovements.push({
      material_id: materialId,
      material_code: materialCode,
      material_name: materialName,
      material_uom: materialUom,
      batch_id: batchId,
      bin_location: locationId,
      quantity: remainingQtyToAllocate,
      movement_type: "UNRESTRICTED_TO_RESERVED",
      line_so_no: lineSoNo,
      doc_line_id: docLineId,
      itemData: filterItemData(itemData),
    });
  }

  return { recordsToUpdate, recordToCreate, inventoryMovements };
};

// ============ STEP 3: PROCESS COMPLETED/DELIVERED ALLOCATIONS ============
const processDeliveredAllocation = (params) => {
  const {
    quantity,
    parentId: lineParentId,
    parentLineId,
    docLineId,
    materialId,
    itemData,
    batchId,
    locationId,
    materialUom,
    index,
    remark,
    isPP,
    pickingPlanLineId,
    linePpId,
    lineSoNo,
    materialCode,
    materialName,
  } = params;

  // Match allocated records based on isGDPP
  const handlingUnitId = params.handlingUnitId || null;
  let matchedAllocatedRecords;
  if (isGDPP === 1) {
    matchedAllocatedRecords = allAllocatedData.filter(
      (record) =>
        String(record.doc_line_id) === String(pickingPlanLineId) &&
        String(record.material_id) === String(materialId) &&
        String(record.batch_id || "") === String(batchId || "") &&
        String(record.bin_location || "") === String(locationId || "") &&
        String(record.handling_unit_id || "") === String(handlingUnitId || "") &&
        record.status === "Allocated" &&
        String(record.target_gd_id) === String(linePpId)
    );
  } else {
    matchedAllocatedRecords = allAllocatedData.filter(
      (record) =>
        String(record.doc_line_id) === String(docLineId) &&
        String(record.material_id) === String(materialId) &&
        String(record.batch_id || "") === String(batchId || "") &&
        String(record.bin_location || "") === String(locationId || "") &&
        String(record.handling_unit_id || "") === String(handlingUnitId || "") &&
        record.status === "Allocated" &&
        String(record.target_gd_id) === String(docId)
    );
  }

  const relevantPendingData = allPendingData.filter(
    (record) =>
      String(record.material_id) === String(materialId) &&
      String(record.batch_id || "") === String(batchId || "") &&
      String(record.bin_location || "") === String(locationId || "") &&
      record.status === "Pending"
  );

  const recordsToUpdate = [];
  let recordToCreate = null;
  const inventoryMovements = [];
  let reservedQtyToSubtract = 0;

  if (matchedAllocatedRecords.length > 0) {
    const totalAllocatedQty = matchedAllocatedRecords.reduce(
      (sum, r) => sum + (r.open_qty || 0),
      0
    );

    if (quantity <= totalAllocatedQty) {
      // Delivery from allocated - may need to release excess
      let remainingQtyToDeliver = quantity;
      let remainingQtyToRelease = roundQty(totalAllocatedQty - quantity);
      let unrestrictedQtyToAdd = 0;

      const sortedAllocatedRecords = [...matchedAllocatedRecords].sort(
        (a, b) =>
          (releaseOrderPriority[a.doc_type] || 99) -
          (releaseOrderPriority[b.doc_type] || 99)
      );

      const findExistingPendingToMerge = (docType, recordParentLineId) => {
        return relevantPendingData.find(
          (record) =>
            record.status === "Pending" &&
            record.doc_type === docType &&
            String(record.parent_line_id) === String(recordParentLineId)
        );
      };

      for (const allocatedRecord of sortedAllocatedRecords) {
        if (remainingQtyToDeliver <= 0 && remainingQtyToRelease <= 0) break;

        const recordQty = allocatedRecord.open_qty || 0;
        const isFromUnrestricted = allocatedRecord.doc_type === "Good Delivery";
        const isFromPP = allocatedRecord.doc_type === "Picking Plan";

        if (remainingQtyToDeliver > 0) {
          const deliverFromThisRecord = Math.min(recordQty, remainingQtyToDeliver);

          if (deliverFromThisRecord === recordQty) {
            recordsToUpdate.push({
              ...allocatedRecord,
              reserved_qty: allocatedRecord.reserved_qty,
              open_qty: 0,
              delivered_qty: roundQty((allocatedRecord.delivered_qty || 0) + deliverFromThisRecord),
              status: "Delivered",
              doc_id: isFromPP ? docId : allocatedRecord.doc_id,
              doc_no: isFromPP ? docNo : allocatedRecord.doc_no,
              doc_line_id: isFromPP ? docLineId : allocatedRecord.doc_line_id,
              doc_type: isFromPP ? "Good Delivery" : allocatedRecord.doc_type,
              target_gd_id: isFromPP ? docId : allocatedRecord.target_gd_id,
            });
          } else {
            recordsToUpdate.push({
              ...allocatedRecord,
              reserved_qty: deliverFromThisRecord,
              open_qty: 0,
              delivered_qty: deliverFromThisRecord,
              status: "Delivered",
              doc_id: isFromPP ? docId : allocatedRecord.doc_id,
              doc_no: isFromPP ? docNo : allocatedRecord.doc_no,
              doc_line_id: isFromPP ? docLineId : allocatedRecord.doc_line_id,
              doc_type: isFromPP ? "Good Delivery" : allocatedRecord.doc_type,
              target_gd_id: isFromPP ? docId : allocatedRecord.target_gd_id,
            });

            const remainderQty = roundQty(recordQty - deliverFromThisRecord);
            if (isFromPP) {
              const { _id, id, ...recordWithoutId } = allocatedRecord;
              recordToCreate = {
                ...recordWithoutId,
                reserved_qty: remainderQty,
                open_qty: remainderQty,
                delivered_qty: 0,
                status: "Allocated",
                source_reserved_id: allocatedRecord.id,
              };
            } else if (isFromUnrestricted) {
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
              unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + remainderQty);
            } else {
              const existingPending = findExistingPendingToMerge(
                allocatedRecord.doc_type,
                allocatedRecord.parent_line_id
              );
              if (existingPending) {
                recordsToUpdate.push({
                  ...existingPending,
                  reserved_qty: roundQty(existingPending.reserved_qty + remainderQty),
                  open_qty: roundQty(existingPending.open_qty + remainderQty),
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

          remainingQtyToDeliver = roundQty(remainingQtyToDeliver - deliverFromThisRecord);
          reservedQtyToSubtract = roundQty(reservedQtyToSubtract + deliverFromThisRecord);
        } else if (remainingQtyToRelease > 0) {
          // Release excess allocation
          const releaseFromThisRecord = Math.min(recordQty, remainingQtyToRelease);

          if (releaseFromThisRecord === recordQty) {
            if (isFromPP) {
              recordsToUpdate.push({
                ...allocatedRecord,
                status: "Allocated",
              });
            } else if (isFromUnrestricted) {
              recordsToUpdate.push({
                ...allocatedRecord,
                open_qty: 0,
                status: "Cancelled",
                target_gd_id: null,
              });
              unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + releaseFromThisRecord);
            } else {
              const existingPending = findExistingPendingToMerge(
                allocatedRecord.doc_type,
                allocatedRecord.parent_line_id
              );
              if (existingPending) {
                recordsToUpdate.push({
                  ...existingPending,
                  reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThisRecord),
                  open_qty: roundQty(existingPending.open_qty + releaseFromThisRecord),
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
            // Partial release
            if (isFromPP) {
              // PP: Keep as Allocated, no partial release - don't reduce the record
              remainingQtyToRelease = 0;
            } else if (isFromUnrestricted) {
              recordsToUpdate.push({
                ...allocatedRecord,
                reserved_qty: roundQty(recordQty - releaseFromThisRecord),
                open_qty: roundQty(recordQty - releaseFromThisRecord),
                status: "Allocated",
              });

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
              unrestrictedQtyToAdd = roundQty(unrestrictedQtyToAdd + releaseFromThisRecord);
            } else {
              // SO/Production: Reduce record and create pending
              recordsToUpdate.push({
                ...allocatedRecord,
                reserved_qty: roundQty(recordQty - releaseFromThisRecord),
                open_qty: roundQty(recordQty - releaseFromThisRecord),
                status: "Allocated",
              });

              const existingPending = findExistingPendingToMerge(
                allocatedRecord.doc_type,
                allocatedRecord.parent_line_id
              );

              if (existingPending) {
                recordsToUpdate.push({
                  ...existingPending,
                  reserved_qty: roundQty(existingPending.reserved_qty + releaseFromThisRecord),
                  open_qty: roundQty(existingPending.open_qty + releaseFromThisRecord),
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
          remainingQtyToRelease = roundQty(remainingQtyToRelease - releaseFromThisRecord);
        }
      }

      if (reservedQtyToSubtract > 0) {
        inventoryMovements.push({
          material_id: materialId,
          material_code: materialCode,
          material_name: materialName,
          material_uom: materialUom,
          batch_id: batchId,
          bin_location: locationId,
          source: "Reserved",
          quantity: reservedQtyToSubtract,
          operation: "subtract",
          movement_type: "DELIVERY",
          line_so_no: lineSoNo,
          doc_line_id: docLineId,
          itemData: filterItemData(itemData),
        });
      }

      if (unrestrictedQtyToAdd > 0) {
        inventoryMovements.push({
          material_id: materialId,
          material_code: materialCode,
          material_name: materialName,
          material_uom: materialUom,
          batch_id: batchId,
          bin_location: locationId,
          quantity: unrestrictedQtyToAdd,
          movement_type: "RESERVED_TO_UNRESTRICTED",
          line_so_no: lineSoNo,
          doc_line_id: docLineId,
          itemData: filterItemData(itemData),
        });
      }

      return { recordsToUpdate, recordToCreate, inventoryMovements };
    }

    // quantity > totalAllocatedQty - need to deliver all allocated + get more
    for (const allocatedRecord of matchedAllocatedRecords) {
      const isFromPP = allocatedRecord.doc_type === "Picking Plan";
      recordsToUpdate.push({
        ...allocatedRecord,
        open_qty: 0,
        delivered_qty: roundQty((allocatedRecord.delivered_qty || 0) + allocatedRecord.open_qty),
        status: "Delivered",
        doc_id: isFromPP ? docId : allocatedRecord.doc_id,
        doc_no: isFromPP ? docNo : allocatedRecord.doc_no,
        doc_line_id: isFromPP ? docLineId : allocatedRecord.doc_line_id,
        doc_type: isFromPP ? "Good Delivery" : allocatedRecord.doc_type,
        target_gd_id: isFromPP ? docId : allocatedRecord.target_gd_id,
      });
    }
    reservedQtyToSubtract = totalAllocatedQty;

    // Allocate additional from pending
    let additionalQtyNeeded = roundQty(quantity - totalAllocatedQty);
    const pendingProdData = relevantPendingData.filter((item) => {
      if (item.doc_type !== "Production") return false;
      if (parentLineId) {
        return String(item.parent_line_id) === String(parentLineId);
      }
      return true;
    });
    const pendingSOData = relevantPendingData.filter((item) => {
      if (item.doc_type !== "Sales Order") return false;
      if (parentLineId) {
        return String(item.parent_line_id) === String(parentLineId);
      }
      return true;
    });

    if (pendingProdData.length > 0 && additionalQtyNeeded > 0) {
      const prodRecord = pendingProdData[0];
      const deliverQty = Math.min(prodRecord.open_qty, additionalQtyNeeded);

      if (deliverQty === prodRecord.open_qty) {
        recordsToUpdate.push({
          ...prodRecord,
          open_qty: 0,
          delivered_qty: deliverQty,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          status: "Delivered",
          target_gd_id: docId,
        });
      } else {
        recordsToUpdate.push({
          ...prodRecord,
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          status: "Delivered",
          target_gd_id: docId,
        });

        const { _id, id, ...prodWithoutId } = prodRecord;
        recordToCreate = {
          ...prodWithoutId,
          doc_id: "",
          doc_no: "",
          doc_line_id: "",
          reserved_qty: roundQty(prodRecord.open_qty - deliverQty),
          open_qty: roundQty(prodRecord.open_qty - deliverQty),
          delivered_qty: 0,
          status: "Pending",
          source_reserved_id: prodRecord.source_reserved_id || prodRecord.id,
          target_gd_id: null,
        };
      }
      reservedQtyToSubtract = roundQty(reservedQtyToSubtract + deliverQty);
      additionalQtyNeeded = roundQty(additionalQtyNeeded - deliverQty);
    }

    if (pendingSOData.length > 0 && additionalQtyNeeded > 0) {
      const soRecord = pendingSOData[0];
      const deliverQty = Math.min(soRecord.open_qty, additionalQtyNeeded);

      if (deliverQty === soRecord.open_qty) {
        recordsToUpdate.push({
          ...soRecord,
          open_qty: 0,
          delivered_qty: deliverQty,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          status: "Delivered",
          target_gd_id: docId,
        });
      } else {
        recordsToUpdate.push({
          ...soRecord,
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          doc_id: docId,
          doc_no: docNo,
          doc_line_id: docLineId,
          status: "Delivered",
          target_gd_id: docId,
        });

        const { _id, id, ...soWithoutId } = soRecord;
        recordToCreate = {
          ...soWithoutId,
          doc_id: "",
          doc_no: "",
          doc_line_id: "",
          reserved_qty: roundQty(soRecord.open_qty - deliverQty),
          open_qty: roundQty(soRecord.open_qty - deliverQty),
          delivered_qty: 0,
          status: "Pending",
          source_reserved_id: soRecord.source_reserved_id || soRecord.id,
          target_gd_id: null,
        };
      }
      reservedQtyToSubtract = roundQty(reservedQtyToSubtract + deliverQty);
      additionalQtyNeeded = roundQty(additionalQtyNeeded - deliverQty);
    }

    // Allocate from unrestricted for remaining
    let unrestrictedQtyToAllocate = 0;
    if (additionalQtyNeeded > 0) {
      unrestrictedQtyToAllocate = additionalQtyNeeded;
      recordToCreate = {
        plant_id: plantId,
        organization_id: organizationId,
        material_id: materialId,
        item_code: itemData?.material_code || "",
        item_name: itemData?.material_name || "",
        item_desc: itemData?.material_desc || "",
        batch_id: batchId,
        bin_location: locationId,
        handling_unit_id: params.handlingUnitId || null,
        item_uom: materialUom,
        doc_type: "Good Delivery",
        parent_id: lineParentId,
        parent_no: lineSoNo,
        parent_line_id: parentLineId,
        doc_id: docId,
        target_gd_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        reserved_qty: unrestrictedQtyToAllocate,
        open_qty: 0,
        delivered_qty: unrestrictedQtyToAllocate,
        status: "Delivered",
        remark: remark,
        reserved_date: docDate,
      };
    }

    if (unrestrictedQtyToAllocate > 0) {
      inventoryMovements.push({
        material_id: materialId,
        material_code: materialCode,
        material_name: materialName,
        material_uom: materialUom,
        batch_id: batchId,
        bin_location: locationId,
        quantity: unrestrictedQtyToAllocate,
        movement_type: "UNRESTRICTED_TO_RESERVED",
        line_so_no: lineSoNo,
        doc_line_id: docLineId,
        itemData: filterItemData(itemData),
      });
    }

    const totalDeliveryQty = roundQty(reservedQtyToSubtract + unrestrictedQtyToAllocate);
    if (totalDeliveryQty > 0) {
      inventoryMovements.push({
        material_id: materialId,
        material_code: materialCode,
        material_name: materialName,
        material_uom: materialUom,
        batch_id: batchId,
        bin_location: locationId,
        source: "Reserved",
        quantity: totalDeliveryQty,
        operation: "subtract",
        movement_type: "DELIVERY",
        line_so_no: lineSoNo,
        doc_line_id: docLineId,
        itemData: filterItemData(itemData),
      });
    }

    return { recordsToUpdate, recordToCreate, inventoryMovements };
  }

  // No existing allocated records - direct delivery from pending/unrestricted
  const pendingSOData = relevantPendingData.filter((item) => {
    if (item.doc_type !== "Sales Order") return false;
    if (parentLineId) {
      return String(item.parent_line_id) === String(parentLineId);
    }
    return true;
  });
  const pendingProdData = relevantPendingData.filter((item) => {
    if (item.doc_type !== "Production") return false;
    if (parentLineId) {
      return String(item.parent_line_id) === String(parentLineId);
    }
    return true;
  });

  let remainingQtyToDeliver = quantity;
  let reservedQty = 0;

  if (pendingProdData.length > 0 && remainingQtyToDeliver > 0) {
    const prodRecord = pendingProdData[0];
    const deliverQty = Math.min(prodRecord.open_qty, remainingQtyToDeliver);

    if (deliverQty === prodRecord.open_qty) {
      recordsToUpdate.push({
        ...prodRecord,
        open_qty: 0,
        delivered_qty: deliverQty,
        doc_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        status: "Delivered",
        target_gd_id: docId,
      });
    } else {
      recordsToUpdate.push({
        ...prodRecord,
        reserved_qty: deliverQty,
        open_qty: 0,
        delivered_qty: deliverQty,
        doc_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        status: "Delivered",
        target_gd_id: docId,
      });

      const { _id, id, ...prodWithoutId } = prodRecord;
      recordToCreate = {
        ...prodWithoutId,
        doc_id: "",
        doc_no: "",
        doc_line_id: "",
        reserved_qty: roundQty(prodRecord.open_qty - deliverQty),
        open_qty: roundQty(prodRecord.open_qty - deliverQty),
        delivered_qty: 0,
        status: "Pending",
        source_reserved_id: prodRecord.source_reserved_id || prodRecord.id,
        target_gd_id: null,
      };
    }
    reservedQty = roundQty(reservedQty + deliverQty);
    remainingQtyToDeliver = roundQty(remainingQtyToDeliver - deliverQty);
  }

  if (pendingSOData.length > 0 && remainingQtyToDeliver > 0) {
    const soRecord = pendingSOData[0];
    const deliverQty = Math.min(soRecord.open_qty, remainingQtyToDeliver);

    if (deliverQty === soRecord.open_qty) {
      recordsToUpdate.push({
        ...soRecord,
        open_qty: 0,
        delivered_qty: deliverQty,
        doc_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        status: "Delivered",
        target_gd_id: docId,
      });
    } else {
      recordsToUpdate.push({
        ...soRecord,
        reserved_qty: deliverQty,
        open_qty: 0,
        delivered_qty: deliverQty,
        doc_id: docId,
        doc_no: docNo,
        doc_line_id: docLineId,
        status: "Delivered",
        target_gd_id: docId,
      });

      const { _id, id, ...soWithoutId } = soRecord;
      recordToCreate = {
        ...soWithoutId,
        doc_id: "",
        doc_no: "",
        doc_line_id: "",
        reserved_qty: roundQty(soRecord.open_qty - deliverQty),
        open_qty: roundQty(soRecord.open_qty - deliverQty),
        delivered_qty: 0,
        status: "Pending",
        source_reserved_id: soRecord.source_reserved_id || soRecord.id,
        target_gd_id: null,
      };
    }
    reservedQty = roundQty(reservedQty + deliverQty);
    remainingQtyToDeliver = roundQty(remainingQtyToDeliver - deliverQty);
  }

  let unrestrictedQtyToAllocate = 0;
  if (remainingQtyToDeliver > 0) {
    unrestrictedQtyToAllocate = remainingQtyToDeliver;
    recordToCreate = {
      plant_id: plantId,
      organization_id: organizationId,
      material_id: materialId,
      item_code: itemData?.material_code || "",
      item_name: itemData?.material_name || "",
      item_desc: itemData?.material_desc || "",
      batch_id: batchId,
      bin_location: locationId,
      handling_unit_id: params.handlingUnitId || null,
      item_uom: materialUom,
      doc_type: "Good Delivery",
      parent_id: lineParentId,
      parent_no: lineSoNo,
      parent_line_id: parentLineId,
      doc_id: docId,
      target_gd_id: docId,
      doc_no: docNo,
      doc_line_id: docLineId,
      reserved_qty: unrestrictedQtyToAllocate,
      open_qty: 0,
      delivered_qty: unrestrictedQtyToAllocate,
      status: "Delivered",
      remark: remark,
      reserved_date: docDate,
    };
  }

  if (unrestrictedQtyToAllocate > 0) {
    inventoryMovements.push({
      material_id: materialId,
      material_code: materialCode,
      material_name: materialName,
      material_uom: materialUom,
      batch_id: batchId,
      bin_location: locationId,
      quantity: unrestrictedQtyToAllocate,
      movement_type: "UNRESTRICTED_TO_RESERVED",
      line_so_no: lineSoNo,
      doc_line_id: docLineId,
      itemData: filterItemData(itemData),
    });
  }

  const totalDeliveryQty = roundQty(reservedQty + unrestrictedQtyToAllocate);
  if (totalDeliveryQty > 0) {
    inventoryMovements.push({
      material_id: materialId,
      material_code: materialCode,
      material_name: materialName,
      material_uom: materialUom,
      batch_id: batchId,
      bin_location: locationId,
      source: "Reserved",
      quantity: totalDeliveryQty,
      operation: "subtract",
      movement_type: "DELIVERY",
      line_so_no: lineSoNo,
      doc_line_id: docLineId,
      itemData: filterItemData(itemData),
    });
  }

  return { recordsToUpdate, recordToCreate, inventoryMovements };
};

// ============ MAIN PROCESSING LOOP ============
// Collect all results
const allRecordsToUpdate = [];
const allRecordsToCreate = [];
const allInventoryMovements = [];
const allHuUpdates = [];

// Step 1: Cleanup orphaned allocations (if saveAs !== "Cancelled")
if (saveAs !== "Cancelled") {
  const cleanupResult = cleanupOrphanedAllocations();
  allRecordsToUpdate.push(...cleanupResult.recordsToUpdate);
  allInventoryMovements.push(...cleanupResult.inventoryMovements);
}

// Step 2: Process each table item and its groups
for (const processed of processedTableData) {
  if (processed.skipProcessing) continue;

  const { item, itemData, groupedTempData, groupKeys } = processed;
  const isPP = isGDPP === 1;

  for (const groupKey of groupKeys) {
    const group = groupedTempData[groupKey];
    const quantity = roundQty(group.totalQty);

    const params = {
      quantity,
      parentId: processed.parent_id,
      parentLineId: processed.parent_line_id,
      docLineId: processed.doc_line_id,
      materialId: processed.material_id,
      itemData,
      batchId: group.batch_id,
      locationId: group.location_id,
      handlingUnitId: group.handling_unit_id || null,
      materialUom: processed.material_uom,
      index: processed.tableIndex,
      remark: processed.remark,
      isPP,
      pickingPlanLineId: processed.picking_plan_line_id,
      linePpId: processed.line_pp_id,
      // Additional fields for inventory movement records
      lineSoNo: processed.line_so_no,
      materialCode: processed.material_code || itemData?.material_code || "",
      materialName: processed.material_name || itemData?.material_name || "",
    };

    let result;
    if (saveAs === "Created") {
      result = processCreatedAllocation(params);
    } else if (saveAs === "Completed") {
      result = processDeliveredAllocation(params);
    } else if (saveAs === "Cancelled") {
      // For cancelled, use release logic (similar to decreasing qty to 0)
      params.quantity = 0;
      result = processCreatedAllocation(params);
    } else {
      continue;
    }

    if (result.recordsToUpdate) {
      allRecordsToUpdate.push(...result.recordsToUpdate);
    }
    if (result.recordToCreate) {
      allRecordsToCreate.push(result.recordToCreate);
    }
    if (result.inventoryMovements) {
      allInventoryMovements.push(...result.inventoryMovements);
    }
    // Collect HU updates for Completed status
    if (saveAs === "Completed" && params.handlingUnitId && quantity > 0) {
      allHuUpdates.push({
        handling_unit_id: params.handlingUnitId,
        material_id: params.materialId,
        batch_id: params.batchId || null,
        deliver_quantity: quantity,
      });
    }
  }
}

// Deduplicate records by ID (keep last update for each ID)
const recordUpdateMap = new Map();
for (const record of allRecordsToUpdate) {
  if (record.id) {
    recordUpdateMap.set(record.id, record);
  }
}
const deduplicatedRecordsToUpdate = Array.from(recordUpdateMap.values());

return {
  code: "200",
  recordsToUpdate: deduplicatedRecordsToUpdate,
  recordsToUpdateLength: deduplicatedRecordsToUpdate.length,
  recordsToCreate: allRecordsToCreate,
  recordsToCreateLength: allRecordsToCreate.length,
  inventoryMovements: allInventoryMovements,
  inventoryMovementsLength: allInventoryMovements.length,
  huUpdates: allHuUpdates,
  huUpdatesLength: allHuUpdates.length,
  message: `Batch processing complete: ${deduplicatedRecordsToUpdate.length} updates, ${allRecordsToCreate.length} creates, ${allInventoryMovements.length} movements, ${allHuUpdates.length} HU updates`
};
