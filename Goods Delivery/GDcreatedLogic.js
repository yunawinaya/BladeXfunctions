// ============================================================================
// RESERVED TABLE ALLOCATION LOGIC
// Handles both initial allocation (GD Created) and re-allocation (GD Edit)
// ============================================================================

// Extract workflow parameters
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

// ============================================================================
// STEP 1: Determine if this is new allocation or re-allocation
// ============================================================================

// Find old allocated records matching this specific temp_data item
// Note: Use (value || null) to normalize undefined/null for comparison
const matchedOldRecords = oldAllocatedData.filter(
  (record) =>
    record.doc_line_id === docLineId &&
    record.material_id === materialId &&
    (record.batch_id || null) === (batchId || null) &&
    record.bin_location === locationId &&
    record.status === "Allocated" &&
    record.target_gd_id === docId,
);

// ============================================================================
// BRANCH: RE-ALLOCATION PATH (Edit existing GD Created)
// ============================================================================

if (matchedOldRecords.length > 0) {
  // Calculate old allocated quantity
  const oldQty = matchedOldRecords.reduce(
    (sum, r) => sum + (r.reserved_qty || 0),
    0,
  );
  const newQty = quantity;
  const netChange = newQty - oldQty;

  // -------------------------------------------------------------------------
  // Case 1: No change needed
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Case 2: Quantity decreased - Release allocation
  // -------------------------------------------------------------------------
  if (netChange < 0) {
    const qtyToRelease = Math.abs(netChange);
    let remainingQtyToRelease = qtyToRelease;
    const recordsToUpdate = [];
    let recordToCreate = null;
    let unrestrictedQtyToAdd = 0; // Track qty to return to Unrestricted

    // Sort records for release priority: SO first, PR second, GD last
    // This ensures we release lower priority sources first
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

    // Helper: Find existing Pending record to merge with (for SO/PR doc_types)
    const findExistingPendingToMerge = (docType) => {
      return existingPendingData.find(
        (record) =>
          record.status === "Pending" &&
          record.doc_type === docType &&
          record.parent_line_id === parentLineId &&
          record.material_id === materialId &&
          record.batch_id === batchId &&
          record.bin_location === locationId,
      );
    };

    // Release from sorted records (SO first, PR second, GD last)
    for (const oldRecord of sortedRecordsForRelease) {
      if (remainingQtyToRelease <= 0) break;

      const releaseFromThisRecord = Math.min(
        oldRecord.reserved_qty,
        remainingQtyToRelease,
      );

      // Determine if this record came from Unrestricted inventory
      // - "Good Delivery" = came from Unrestricted → always Cancelled
      // - "Sales Order" / "Production Receipt" = came from Pending → merge or Pending
      const isFromUnrestricted = oldRecord.doc_type === "Good Delivery";

      if (releaseFromThisRecord === oldRecord.reserved_qty) {
        // Fully release this record
        if (isFromUnrestricted) {
          // For Unrestricted: Mark as Cancelled
          recordsToUpdate.push({
            ...oldRecord,
            reserved_qty: oldRecord.reserved_qty,
            open_qty: 0,
            status: "Cancelled",
            target_gd_id: null,
          });
          unrestrictedQtyToAdd += releaseFromThisRecord;
        } else {
          // For SO/PR: Check if existing Pending exists to merge with
          const existingPending = findExistingPendingToMerge(oldRecord.doc_type);

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
              ...oldRecord,
              reserved_qty: oldRecord.reserved_qty,
              open_qty: 0,
              status: "Cancelled",
              target_gd_id: null,
            });
          } else {
            // No existing Pending - just change status to Pending
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
        // Partial release - split the record
        // Keep allocated portion (update existing record)
        recordsToUpdate.push({
          ...oldRecord,
          reserved_qty: oldRecord.reserved_qty - releaseFromThisRecord,
          open_qty: oldRecord.reserved_qty - releaseFromThisRecord,
          status: "Allocated",
          target_gd_id: docId,
        });

        if (isFromUnrestricted) {
          // For Unrestricted: Always create new Cancelled record
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
          // For SO/PR: Check if existing Pending record exists to merge with
          const existingPending = findExistingPendingToMerge(oldRecord.doc_type);

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

    // Build inventory movements (aggregated)
    // Cancellation: Reserved → Unrestricted (one object)
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

  // -------------------------------------------------------------------------
  // Case 3: Quantity increased - Allocate additional
  // -------------------------------------------------------------------------
  if (netChange > 0) {
    // Use the same allocation logic as new allocation, but for the ADDITIONAL quantity
    const additionalQty = netChange;

    // Filter existing pending data (exclude already allocated)
    const pendingSOData =
      existingPendingData.filter(
        (item) => item.status === "Pending" && item.doc_type === "Sales Order",
      ) || [];

    const pendingProdReceiptData =
      existingPendingData.filter(
        (item) =>
          item.status === "Pending" && item.doc_type === "Production Receipt",
      ) || [];

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
      pendingProdReceiptData.length > 0
        ? pendingProdReceiptData[0].open_qty
        : 0;

    let remainingQtyToAllocate = additionalQty;
    const recordsToUpdate = [];
    let recordToCreate = null;

    // PRIORITY 1: Allocate from Production Receipt
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

    // PRIORITY 2: Allocate from Sales Order
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

    // Shortfall: Direct allocation
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

    // Build inventory movements
    // Shortfall allocation: Unrestricted → Reserved
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

// ============================================================================
// BRANCH: NEW ALLOCATION PATH (Initial GD Created)
// ============================================================================

// Filter existing pending data
const pendingSOData =
  existingPendingData.filter(
    (item) => item.status === "Pending" && item.doc_type === "Sales Order",
  ) || [];

const pendingProdReceiptData =
  existingPendingData.filter(
    (item) =>
      item.status === "Pending" && item.doc_type === "Production Receipt",
  ) || [];

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

// Safe extraction of open quantities
const salesOrderOpenQty =
  pendingSOData.length > 0 ? pendingSOData[0].open_qty : 0;
const productionReceiptOpenQty =
  pendingProdReceiptData.length > 0 ? pendingProdReceiptData[0].open_qty : 0;

let remainingQtyToAllocate = quantity;
const recordsToUpdate = [];
let recordToCreate = null;

// PRIORITY 1: Allocate from Production Receipt
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

// PRIORITY 2: Allocate from Sales Order
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

// Shortfall: Direct allocation from unrestricted inventory
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

// Build inventory movements
// Shortfall allocation: Unrestricted → Reserved
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
  inventoryMovements: inventoryMovements,
  inventoryMovementsLength: inventoryMovements.length,
  message: "Initial allocation successful",
};
