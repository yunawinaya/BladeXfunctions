// ============================================================================
// GD DELIVERED STATUS LOGIC (Enhanced for Re-allocation)
// Handles inventory subtraction and reserved table updates when GD is delivered
// Supports four scenarios:
// 1. Normal flow: GD Created → Delivered (allocated qty matches delivery qty)
//    - Updates Allocated → Delivered, subtracts from Reserved
// 2. Re-allocation flow: GD Created (edited) → Delivered (qty decreased)
//    - Releases surplus allocations to Pending
//    - Updates remaining Allocated → Delivered, subtracts from Reserved
// 3. Re-allocation flow: GD Created (edited) → Delivered (qty increased)
//    - Updates all Allocated → Delivered
//    - Allocates additional from Pending or Unrestricted, marks as Delivered
// 4. Direct flow: GD straight to Delivered without Allocated records
//    - Uses Pending → Delivered or Unrestricted directly
// ============================================================================

// Extract workflow parameters
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
const batchId = {{workflowparams:batch_id}};
const locationId = {{workflowparams:location_id}};
const materialUom = {{workflowparams:material_uom}};
const docDate = {{workflowparams:doc_date}};
const index = {{workflowparams:index}};
const plantId = {{workflowparams:plant_id}};
const organizationId = {{workflowparams:organization_id}};
const remark = {{workflowparams:remark}};

// ============================================================================
// STEP 1: Find Matching Allocated Records
// ============================================================================

const matchedAllocatedRecords = existingAllocatedData.filter(
  (record) =>
    record.doc_line_id === docLineId &&
    record.material_id === materialId &&
    (record.batch_id || null) === (batchId || null) &&
    record.bin_location === locationId &&
    record.status === "Allocated" &&
    record.target_gd_id === docId,
);

// ============================================================================
// SCENARIO 1, 2, 3: HAS ALLOCATED RECORDS (GD Created → Delivered)
// ============================================================================

if (matchedAllocatedRecords.length > 0) {
  // Calculate total allocated quantity
  const totalAllocatedQty = matchedAllocatedRecords.reduce(
    (sum, r) => sum + (r.open_qty || 0),
    0,
  );

  const recordsToUpdate = [];
  let recordToCreate = null;
  let reservedQtyToSubtract = 0;

  // -------------------------------------------------------------------------
  // CASE A: Delivery qty <= Allocated qty (Normal or Decreased)
  // -------------------------------------------------------------------------
  if (quantity <= totalAllocatedQty) {
    let remainingQtyToDeliver = quantity;
    let remainingQtyToRelease = totalAllocatedQty - quantity;
    let unrestrictedQtyToAdd = 0; // Track qty to return to Unrestricted (for Cancelled records)

    // Sort records for processing: Release SO first, keep PR for delivery
    // Priority: SO=1 (release first), PR=2, GD=3 (release last)
    const releaseOrderPriority = {
      "Sales Order": 1,
      "Production Receipt": 2,
      "Good Delivery": 3,
    };
    const sortedAllocatedRecords = [...matchedAllocatedRecords].sort(
      (a, b) =>
        (releaseOrderPriority[a.doc_type] || 99) -
        (releaseOrderPriority[b.doc_type] || 99),
    );

    // Helper: Find existing Pending record to merge with (for SO/PR doc_types)
    const findExistingPendingToMerge = (docType, parentLineId) => {
      return existingPendingData.find(
        (record) =>
          record.status === "Pending" &&
          record.doc_type === docType &&
          record.parent_line_id === parentLineId &&
          record.material_id === materialId &&
          (record.batch_id || null) === (batchId || null) &&
          record.bin_location === locationId,
      );
    };

    // Process allocated records in release priority order (SO first, PR second, GD last)
    for (const allocatedRecord of sortedAllocatedRecords) {
      if (remainingQtyToDeliver <= 0 && remainingQtyToRelease <= 0) break;

      const recordQty = allocatedRecord.open_qty || 0;

      // Determine if this record came from Unrestricted inventory
      // - "Good Delivery" = came from Unrestricted → always Cancelled
      // - "Sales Order" / "Production Receipt" = came from Pending → merge or Pending
      const isFromUnrestricted = allocatedRecord.doc_type === "Good Delivery";

      if (remainingQtyToDeliver > 0) {
        // Deliver from this record
        const deliverFromThisRecord = Math.min(recordQty, remainingQtyToDeliver);

        if (deliverFromThisRecord === recordQty) {
          // Fully deliver this record
          recordsToUpdate.push({
            ...allocatedRecord,
            status: "Delivered",
            delivered_qty: (allocatedRecord.delivered_qty || 0) + deliverFromThisRecord,
            open_qty: 0,
          });
        } else {
          // Partial deliver - need to split
          // Update original to Delivered with delivered portion
          recordsToUpdate.push({
            ...allocatedRecord,
            reserved_qty: deliverFromThisRecord,
            open_qty: 0,
            delivered_qty: deliverFromThisRecord,
            status: "Delivered",
          });

          // Handle remaining portion based on doc_type
          const remainderQty = recordQty - deliverFromThisRecord;

          if (isFromUnrestricted) {
            // For Unrestricted: Create Cancelled record
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
            // For SO/PR: Check if existing Pending exists to merge with
            const existingPending = findExistingPendingToMerge(
              allocatedRecord.doc_type,
              allocatedRecord.parent_line_id,
            );

            if (existingPending) {
              // Merge: Add quantity to existing Pending record
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: existingPending.reserved_qty + remainderQty,
                open_qty: existingPending.open_qty + remainderQty,
                status: "Pending",
              });
            } else {
              // Create new Pending record
              const { _id, id, ...recordWithoutId } = allocatedRecord;
              recordToCreate = {
                ...recordWithoutId,
                reserved_qty: remainderQty,
                open_qty: remainderQty,
                delivered_qty: 0,
                status: "Pending",
                source_reserved_id: allocatedRecord.id,
                target_gd_id: null,
              };
            }
          }
        }

        remainingQtyToDeliver -= deliverFromThisRecord;
        reservedQtyToSubtract += deliverFromThisRecord;
      } else if (remainingQtyToRelease > 0) {
        // Release this record (user decreased qty)
        const releaseFromThisRecord = Math.min(recordQty, remainingQtyToRelease);

        if (releaseFromThisRecord === recordQty) {
          // Fully release this record
          if (isFromUnrestricted) {
            // For Unrestricted: Mark as Cancelled
            recordsToUpdate.push({
              ...allocatedRecord,
              status: "Cancelled",
              open_qty: 0,
              target_gd_id: null,
            });
            unrestrictedQtyToAdd += releaseFromThisRecord;
          } else {
            // For SO/PR: Check if existing Pending exists to merge with
            const existingPending = findExistingPendingToMerge(
              allocatedRecord.doc_type,
              allocatedRecord.parent_line_id,
            );

            if (existingPending) {
              // Merge: Add quantity to existing Pending, mark this record as Cancelled
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: existingPending.reserved_qty + releaseFromThisRecord,
                open_qty: existingPending.open_qty + releaseFromThisRecord,
                status: "Pending",
              });
              // Mark the released record as Cancelled (absorbed into existing Pending)
              recordsToUpdate.push({
                ...allocatedRecord,
                status: "Cancelled",
                open_qty: 0,
                target_gd_id: null,
              });
            } else {
              // No existing Pending - just change status to Pending
              recordsToUpdate.push({
                ...allocatedRecord,
                status: "Pending",
                target_gd_id: null,
              });
            }
          }
        } else {
          // Partial release - keep allocated portion, release remainder
          recordsToUpdate.push({
            ...allocatedRecord,
            reserved_qty: recordQty - releaseFromThisRecord,
            open_qty: recordQty - releaseFromThisRecord,
            status: "Allocated",
          });

          if (isFromUnrestricted) {
            // For Unrestricted: Create Cancelled record
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
            // For SO/PR: Check if existing Pending exists to merge with
            const existingPending = findExistingPendingToMerge(
              allocatedRecord.doc_type,
              allocatedRecord.parent_line_id,
            );

            if (existingPending) {
              // Merge: Add quantity to existing Pending record
              recordsToUpdate.push({
                ...existingPending,
                reserved_qty: existingPending.reserved_qty + releaseFromThisRecord,
                open_qty: existingPending.open_qty + releaseFromThisRecord,
                status: "Pending",
              });
            } else {
              // Create new Pending record
              const { _id, id, ...recordWithoutId } = allocatedRecord;
              recordToCreate = {
                ...recordWithoutId,
                reserved_qty: releaseFromThisRecord,
                open_qty: releaseFromThisRecord,
                delivered_qty: 0,
                status: "Pending",
                source_reserved_id: allocatedRecord.id,
                target_gd_id: null,
              };
            }
          }
        }

        remainingQtyToRelease -= releaseFromThisRecord;
      }
    }

    // Build inventory movements (aggregated by type)
    // 1. Delivery subtraction: subtract from Reserved (for goods leaving warehouse)
    // 2. Cancellation: transfer Reserved → Unrestricted (releasing allocation)
    const inventoryMovements = [];

    // Delivery: subtract from Reserved
    if (reservedQtyToSubtract > 0) {
      inventoryMovements.push({
        source: "Reserved",
        quantity: reservedQtyToSubtract,
        operation: "subtract",
        movement_type: "DELIVERY",
      });
    }

    // Cancellation: Reserved → Unrestricted (aggregated into one object)
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
      message:
        quantity < totalAllocatedQty
          ? "Delivery processed with re-allocation (decreased qty)"
          : "Delivery processed from allocated inventory (Reserved)",
    };
  }

  // -------------------------------------------------------------------------
  // CASE B: Delivery qty > Allocated qty (Increased - need more allocation)
  // -------------------------------------------------------------------------
  if (quantity > totalAllocatedQty) {
    // First, deliver all allocated records
    for (const allocatedRecord of matchedAllocatedRecords) {
      recordsToUpdate.push({
        ...allocatedRecord,
        status: "Delivered",
        delivered_qty: (allocatedRecord.delivered_qty || 0) + allocatedRecord.open_qty,
        open_qty: 0,
      });
    }
    reservedQtyToSubtract = totalAllocatedQty;

    // Now allocate+deliver additional quantity from Pending or Unrestricted
    let additionalQtyNeeded = quantity - totalAllocatedQty;

    // Filter pending records matching this temp_data item
    const matchedPendingRecords = existingPendingData.filter(
      (record) =>
        record.material_id === materialId &&
        (record.batch_id || null) === (batchId || null) &&
        record.bin_location === locationId &&
        record.status === "Pending",
    );

    // Separate by source type for priority handling
    const pendingProdReceiptData = matchedPendingRecords.filter(
      (item) => item.doc_type === "Production Receipt",
    );
    const pendingSOData = matchedPendingRecords.filter(
      (item) => item.doc_type === "Sales Order",
    );

    // Validate: Only one pending record per source type allowed
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

    // PRIORITY 1: Deliver from Production Receipt Pending
    if (pendingProdReceiptData.length > 0 && additionalQtyNeeded > 0) {
      const prodReceiptQty = pendingProdReceiptData[0].open_qty || 0;
      const deliverQty = Math.min(prodReceiptQty, additionalQtyNeeded);

      if (deliverQty === prodReceiptQty) {
        // Fully consume and deliver
        recordsToUpdate.push({
          ...pendingProdReceiptData[0],
          status: "Delivered",
          delivered_qty: deliverQty,
          open_qty: 0,
          target_gd_id: docId,
        });
      } else {
        // Partial - deliver portion, keep remainder as Pending
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
          reserved_qty: prodReceiptQty - deliverQty,
          open_qty: prodReceiptQty - deliverQty,
          delivered_qty: 0,
          status: "Pending",
          source_reserved_id: pendingProdReceiptData[0].id,
          target_gd_id: null,
        };
      }

      reservedQtyToSubtract += deliverQty;
      additionalQtyNeeded -= deliverQty;
    }

    // PRIORITY 2: Deliver from Sales Order Pending
    if (pendingSOData.length > 0 && additionalQtyNeeded > 0) {
      const soQty = pendingSOData[0].open_qty || 0;
      const deliverQty = Math.min(soQty, additionalQtyNeeded);

      if (deliverQty === soQty) {
        // Fully consume and deliver
        recordsToUpdate.push({
          ...pendingSOData[0],
          status: "Delivered",
          delivered_qty: deliverQty,
          open_qty: 0,
          target_gd_id: docId,
        });
      } else {
        // Partial - deliver portion, keep remainder as Pending
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
          reserved_qty: soQty - deliverQty,
          open_qty: soQty - deliverQty,
          delivered_qty: 0,
          status: "Pending",
          source_reserved_id: pendingSOData[0].id,
          target_gd_id: null,
        };
      }

      reservedQtyToSubtract += deliverQty;
      additionalQtyNeeded -= deliverQty;
    }

    // FALLBACK: Allocate from Unrestricted then deliver (consistent with Location Transfer)
    // First move to Reserved, then deliver from Reserved
    let unrestrictedQtyToAllocate = 0;
    if (additionalQtyNeeded > 0) {
      unrestrictedQtyToAllocate = additionalQtyNeeded;

      // Create reserved_table record for Unrestricted allocation (immediately Delivered)
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

    // Build inventory movements (order matters: allocation FIRST, delivery LAST)
    const inventoryMovements = [];

    // 1. FIRST: Allocate from Unrestricted → Reserved (if needed)
    if (unrestrictedQtyToAllocate > 0) {
      inventoryMovements.push({
        quantity: unrestrictedQtyToAllocate,
        movement_type: "UNRESTRICTED_TO_RESERVED",
      });
    }

    // 2. LAST: Deliver ALL from Reserved (includes newly allocated qty)
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
      inventoryMovements,
      inventoryMovementsLength: inventoryMovements.length,
      message: "Delivery processed with re-allocation (increased qty)",
    };
  }
}

// ============================================================================
// SCENARIO 4: NO ALLOCATED RECORDS (Direct to Delivered)
// Check if Pending records are available
// ============================================================================

// Filter pending records matching this temp_data item
const matchedPendingRecords = existingPendingData.filter(
  (record) =>
    record.material_id === materialId &&
    (record.batch_id || null) === (batchId || null) &&
    record.bin_location === locationId &&
    record.status === "Pending",
);

// Separate by source type for priority handling
const pendingSOData = matchedPendingRecords.filter(
  (item) => item.doc_type === "Sales Order",
);

const pendingProdReceiptData = matchedPendingRecords.filter(
  (item) => item.doc_type === "Production Receipt",
);

// Validate: Only one pending record per source type allowed
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
let reservedQty = 0; // Track how much comes from Reserved (Pending)

// -------------------------------------------------------------------------
// PRIORITY 1: Deliver from Production Receipt Pending
// -------------------------------------------------------------------------
if (pendingProdReceiptData.length > 0 && remainingQtyToDeliver > 0) {
  const deliverQty = Math.min(productionReceiptOpenQty, remainingQtyToDeliver);

  if (deliverQty === productionReceiptOpenQty) {
    // Fully consume pending - mark as Delivered
    recordsToUpdate.push({
      ...pendingProdReceiptData[0],
      status: "Delivered",
      delivered_qty: deliverQty,
      open_qty: 0,
      target_gd_id: docId,
    });
  } else {
    // Partial delivery - split the record
    // Update original to Delivered with delivered quantity
    recordsToUpdate.push({
      ...pendingProdReceiptData[0],
      reserved_qty: deliverQty,
      open_qty: 0,
      delivered_qty: deliverQty,
      status: "Delivered",
      target_gd_id: docId,
    });

    // Create new Pending record for remaining quantity
    const { _id, id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
    recordToCreate = {
      ...prodReceiptWithoutId,
      reserved_qty: productionReceiptOpenQty - deliverQty,
      open_qty: productionReceiptOpenQty - deliverQty,
      delivered_qty: 0,
      status: "Pending",
      source_reserved_id: pendingProdReceiptData[0].id,
      target_gd_id: null,
    };
  }

  reservedQty += deliverQty;
  remainingQtyToDeliver -= deliverQty;
}

// -------------------------------------------------------------------------
// PRIORITY 2: Deliver from Sales Order Pending
// -------------------------------------------------------------------------
if (pendingSOData.length > 0 && remainingQtyToDeliver > 0) {
  const deliverQty = Math.min(salesOrderOpenQty, remainingQtyToDeliver);

  if (deliverQty === salesOrderOpenQty) {
    // Fully consume pending - mark as Delivered
    recordsToUpdate.push({
      ...pendingSOData[0],
      status: "Delivered",
      delivered_qty: deliverQty,
      open_qty: 0,
      target_gd_id: docId,
    });
  } else {
    // Partial delivery - split the record
    // Update original to Delivered with delivered quantity
    recordsToUpdate.push({
      ...pendingSOData[0],
      reserved_qty: deliverQty,
      open_qty: 0,
      delivered_qty: deliverQty,
      status: "Delivered",
      target_gd_id: docId,
    });

    // Create new Pending record for remaining quantity
    const { _id, id, ...soWithoutId } = pendingSOData[0];
    recordToCreate = {
      ...soWithoutId,
      reserved_qty: salesOrderOpenQty - deliverQty,
      open_qty: salesOrderOpenQty - deliverQty,
      delivered_qty: 0,
      status: "Pending",
      source_reserved_id: pendingSOData[0].id,
      target_gd_id: null,
    };
  }

  reservedQty += deliverQty;
  remainingQtyToDeliver -= deliverQty;
}

// -------------------------------------------------------------------------
// FALLBACK: Allocate from Unrestricted then deliver (consistent with Location Transfer)
// First move to Reserved, then deliver from Reserved
// -------------------------------------------------------------------------
let unrestrictedQtyToAllocate = 0;
if (remainingQtyToDeliver > 0) {
  unrestrictedQtyToAllocate = remainingQtyToDeliver;

  // Create reserved_table record for Unrestricted allocation (immediately Delivered)
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

// ============================================================================
// RETURN RESULTS
// ============================================================================

// Build inventory movements (order matters: allocation FIRST, delivery LAST)
const inventoryMovements = [];

// 1. FIRST: Allocate from Unrestricted → Reserved (if needed)
if (unrestrictedQtyToAllocate > 0) {
  inventoryMovements.push({
    quantity: unrestrictedQtyToAllocate,
    movement_type: "UNRESTRICTED_TO_RESERVED",
  });
}

// 2. LAST: Deliver ALL from Reserved (includes newly allocated qty)
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
  inventoryMovements,
  inventoryMovementsLength: inventoryMovements.length,
  message: "Delivery processed successfully",
};
