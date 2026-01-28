// ============================================================================
// GD DELIVERED STATUS LOGIC
// Handles inventory subtraction and reserved table updates when GD is delivered
// Supports three scenarios:
// 1. Normal flow: GD Created → Delivered (has Allocated records)
// 2. Direct flow: GD straight to Delivered with Pending available
// 3. Direct flow: GD straight to Delivered without Pending (from Unrestricted)
// ============================================================================

// Extract workflow parameters
const existingAllocatedData = {{node:search_allocated_records.data.data}} || [];
const existingPendingData = {{node:search_pending_records.data.data}} || [];
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
// STEP 1: Determine Delivery Source - Check Allocated Records
// ============================================================================

// Find allocated records for this specific GD line/temp_data
const matchedAllocatedRecords = existingAllocatedData.filter(
  (record) =>
    record.doc_line_id === docLineId &&
    record.material_id === materialId &&
    record.batch_id === batchId &&
    record.bin_location === locationId &&
    record.status === "Allocated" &&
    record.target_reserved_id === docId,
);

// ============================================================================
// SCENARIO 1: HAS ALLOCATED RECORDS (Normal Flow: GD Created → Delivered)
// ============================================================================

if (matchedAllocatedRecords.length > 0) {
  // Calculate total allocated quantity
  const totalAllocatedQty = matchedAllocatedRecords.reduce(
    (sum, r) => sum + (r.open_qty || 0),
    0,
  );

  // Validate: Delivered quantity should not exceed allocated quantity
  if (quantity > totalAllocatedQty) {
    return {
      code: "400",
      message: `Cannot deliver ${quantity} units. Only ${totalAllocatedQty} units are allocated for this item.`,
    };
  }

  let remainingQtyToDeliver = quantity;
  const recordsToUpdate = [];
  let inventorySource = "Reserved"; // Allocated records mean inventory is in Reserved

  // Process allocated records in order (FIFO)
  for (const allocatedRecord of matchedAllocatedRecords) {
    if (remainingQtyToDeliver <= 0) break;

    const deliverFromThisRecord = Math.min(
      allocatedRecord.open_qty,
      remainingQtyToDeliver,
    );

    // Update record to Delivered status
    recordsToUpdate.push({
      ...allocatedRecord,
      status: "Delivered",
      delivered_qty: (allocatedRecord.delivered_qty || 0) + deliverFromThisRecord,
      open_qty: allocatedRecord.open_qty - deliverFromThisRecord,
    });

    remainingQtyToDeliver -= deliverFromThisRecord;
  }

  return {
    code: "200",
    recordsToUpdate,
    recordToCreate: null,
    inventorySource: "Reserved",
    inventoryQty: quantity,
    message: "Delivery processed from allocated inventory (Reserved)",
  };
}

// ============================================================================
// SCENARIO 2 & 3: NO ALLOCATED RECORDS (Direct to Delivered)
// Check if Pending records are available
// ============================================================================

// Filter pending records matching this temp_data item
const matchedPendingRecords = existingPendingData.filter(
  (record) =>
    record.material_id === materialId &&
    record.batch_id === batchId &&
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
let unrestrictedQty = 0; // Track how much comes from Unrestricted

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
      target_reserved_id: docId,
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
      target_reserved_id: docId,
    });

    // Create new Pending record for remaining quantity
    const { _id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
    recordToCreate = {
      ...prodReceiptWithoutId,
      reserved_qty: productionReceiptOpenQty - deliverQty,
      open_qty: productionReceiptOpenQty - deliverQty,
      delivered_qty: 0,
      status: "Pending",
      target_reserved_id: null,
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
      target_reserved_id: docId,
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
      target_reserved_id: docId,
    });

    // Create new Pending record for remaining quantity
    const { _id, ...soWithoutId } = pendingSOData[0];
    recordToCreate = {
      ...soWithoutId,
      reserved_qty: salesOrderOpenQty - deliverQty,
      open_qty: salesOrderOpenQty - deliverQty,
      delivered_qty: 0,
      status: "Pending",
      target_reserved_id: null,
    };
  }

  reservedQty += deliverQty;
  remainingQtyToDeliver -= deliverQty;
}

// -------------------------------------------------------------------------
// FALLBACK: Deliver from Unrestricted Inventory (No Pending Available)
// -------------------------------------------------------------------------
if (remainingQtyToDeliver > 0) {
  // Create new Reserved Table record with status = Delivered
  // This represents direct delivery from unrestricted inventory without prior allocation
  const deliverQty = remainingQtyToDeliver;

  recordToCreate = {
    doc_type: "Good Delivery",
    status: "Delivered",
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
    reserved_qty: deliverQty,
    delivered_qty: deliverQty,
    open_qty: 0,
    reserved_date: docDate,
    line_no: index,
    plant_id: plantId,
    organization_id: organizationId,
    remark: remark,
    target_reserved_id: docId,
  };

  unrestrictedQty += deliverQty;
  remainingQtyToDeliver -= deliverQty;
}

// ============================================================================
// RETURN RESULTS
// ============================================================================

return {
  code: "200",
  recordsToUpdate,
  recordToCreate,
  inventoryMovements: [
    ...(reservedQty > 0
      ? [
          {
            source: "Reserved",
            quantity: reservedQty,
            operation: "subtract",
          },
        ]
      : []),
    ...(unrestrictedQty > 0
      ? [
          {
            source: "Unrestricted",
            quantity: unrestrictedQty,
            operation: "subtract",
          },
        ]
      : []),
  ],
  message: "Delivery processed successfully",
};
