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
const matchedOldRecords = oldAllocatedData.filter(
  (record) =>
    record.doc_line_id === docLineId &&
    record.material_id === materialId &&
    record.batch_id === batchId &&
    record.bin_location === locationId &&
    record.status === "Allocated" &&
    record.target_reserved_id === docId,
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
      recordToCreate: null,
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

    // Release from matched old records (FIFO order)
    for (const oldRecord of matchedOldRecords) {
      if (remainingQtyToRelease <= 0) break;

      const releaseFromThisRecord = Math.min(
        oldRecord.reserved_qty,
        remainingQtyToRelease,
      );

      if (releaseFromThisRecord === oldRecord.reserved_qty) {
        // Fully release this record - convert to Pending
        recordsToUpdate.push({
          ...oldRecord,
          status: "Pending",
          target_reserved_id: null,
        });
      } else {
        // Partial release - split the record
        // Keep allocated portion (update existing record)
        recordsToUpdate.push({
          ...oldRecord,
          reserved_qty: oldRecord.reserved_qty - releaseFromThisRecord,
          open_qty: oldRecord.reserved_qty - releaseFromThisRecord,
          status: "Allocated",
          target_reserved_id: docId,
        });

        // Create pending for released portion
        const { _id, ...recordWithoutId } = oldRecord;
        recordToCreate = {
          ...recordWithoutId,
          reserved_qty: releaseFromThisRecord,
          open_qty: releaseFromThisRecord,
          status: "Pending",
          target_reserved_id: null,
        };
      }

      remainingQtyToRelease -= releaseFromThisRecord;
    }

    return {
      code: "200",
      recordsToUpdate,
      recordToCreate,
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
          status: "Allocated",
          target_reserved_id: docId,
        });
      } else {
        recordsToUpdate.push({
          ...pendingProdReceiptData[0],
          reserved_qty: allocateQty,
          open_qty: allocateQty,
          status: "Allocated",
          target_reserved_id: docId,
        });

        const { _id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
        recordToCreate = {
          ...prodReceiptWithoutId,
          reserved_qty: productionReceiptOpenQty - allocateQty,
          open_qty: productionReceiptOpenQty - allocateQty,
          status: "Pending",
          source_reserved_id: docId,
          target_reserved_id: null,
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
          status: "Allocated",
          target_reserved_id: docId,
        });
      } else {
        recordsToUpdate.push({
          ...pendingSOData[0],
          reserved_qty: allocateQty,
          open_qty: allocateQty,
          status: "Allocated",
          target_reserved_id: docId,
        });

        const { _id, ...soWithoutId } = pendingSOData[0];
        recordToCreate = {
          ...soWithoutId,
          reserved_qty: salesOrderOpenQty - allocateQty,
          open_qty: salesOrderOpenQty - allocateQty,
          status: "Pending",
          source_reserved_id: docId,
          target_reserved_id: null,
        };
      }

      remainingQtyToAllocate -= allocateQty;
    }

    // Shortfall: Direct allocation
    if (remainingQtyToAllocate > 0) {
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
        target_reserved_id: docId,
      };
    }

    return {
      code: "200",
      recordsToUpdate,
      recordToCreate,
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
      status: "Allocated",
      target_reserved_id: docId,
    });
  } else {
    recordsToUpdate.push({
      ...pendingProdReceiptData[0],
      reserved_qty: allocateQty,
      open_qty: allocateQty,
      status: "Allocated",
      target_reserved_id: docId,
    });

    const { _id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
    recordToCreate = {
      ...prodReceiptWithoutId,
      reserved_qty: productionReceiptOpenQty - allocateQty,
      open_qty: productionReceiptOpenQty - allocateQty,
      status: "Pending",
      source_reserved_id: docId,
      target_reserved_id: null,
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
      status: "Allocated",
      target_reserved_id: docId,
    });
  } else {
    recordsToUpdate.push({
      ...pendingSOData[0],
      reserved_qty: allocateQty,
      open_qty: allocateQty,
      status: "Allocated",
      target_reserved_id: docId,
    });

    const { _id, ...soWithoutId } = pendingSOData[0];
    recordToCreate = {
      ...soWithoutId,
      reserved_qty: salesOrderOpenQty - allocateQty,
      open_qty: salesOrderOpenQty - allocateQty,
      status: "Pending",
      source_reserved_id: docId,
      target_reserved_id: null,
    };
  }

  remainingQtyToAllocate -= allocateQty;
}

// Shortfall: Direct allocation from unrestricted inventory
if (remainingQtyToAllocate > 0) {
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
    target_reserved_id: docId,
  };
}

return {
  code: "200",
  recordsToUpdate: recordsToUpdate,
  recordToCreate: recordToCreate,
  message: "Initial allocation successful",
};
