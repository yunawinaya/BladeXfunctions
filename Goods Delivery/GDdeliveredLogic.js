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
    record.batch_id === batchId &&
    record.bin_location === locationId &&
    record.status === "Allocated" &&
    record.target_reserved_id === docId,
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
  let unrestrictedQtyToSubtract = 0;

  // -------------------------------------------------------------------------
  // CASE A: Delivery qty <= Allocated qty (Normal or Decreased)
  // -------------------------------------------------------------------------
  if (quantity <= totalAllocatedQty) {
    let remainingQtyToDeliver = quantity;
    let remainingQtyToRelease = totalAllocatedQty - quantity;

    // Process allocated records in order (FIFO)
    for (const allocatedRecord of matchedAllocatedRecords) {
      if (remainingQtyToDeliver <= 0 && remainingQtyToRelease <= 0) break;

      const recordQty = allocatedRecord.open_qty || 0;

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

          // Create Pending record for remaining portion (to be released)
          const { _id, id, ...recordWithoutId } = allocatedRecord;
          recordToCreate = {
            ...recordWithoutId,
            reserved_qty: recordQty - deliverFromThisRecord,
            open_qty: recordQty - deliverFromThisRecord,
            delivered_qty: 0,
            status: "Pending",
            target_reserved_id: null,
          };
        }

        remainingQtyToDeliver -= deliverFromThisRecord;
        reservedQtyToSubtract += deliverFromThisRecord;
      } else if (remainingQtyToRelease > 0) {
        // Release this record back to Pending (user decreased qty)
        const releaseFromThisRecord = Math.min(recordQty, remainingQtyToRelease);

        if (releaseFromThisRecord === recordQty) {
          // Fully release to Pending
          recordsToUpdate.push({
            ...allocatedRecord,
            status: "Pending",
            target_reserved_id: null,
          });
        } else {
          // Partial release - keep allocated portion, release remainder
          recordsToUpdate.push({
            ...allocatedRecord,
            reserved_qty: recordQty - releaseFromThisRecord,
            open_qty: recordQty - releaseFromThisRecord,
            status: "Allocated",
          });

          const { _id, id, ...recordWithoutId } = allocatedRecord;
          recordToCreate = {
            ...recordWithoutId,
            reserved_qty: releaseFromThisRecord,
            open_qty: releaseFromThisRecord,
            delivered_qty: 0,
            status: "Pending",
            target_reserved_id: null,
          };
        }

        remainingQtyToRelease -= releaseFromThisRecord;
        // No inventory movement for released qty - stays in Reserved category
      }
    }

    return {
      code: "200",
      recordsToUpdate,
      recordToCreate,
      inventoryMovements: [
        {
          source: "Reserved",
          quantity: reservedQtyToSubtract,
          operation: "subtract",
        },
      ],
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
        record.batch_id === batchId &&
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
          target_reserved_id: docId,
        });
      } else {
        // Partial - deliver portion, keep remainder as Pending
        recordsToUpdate.push({
          ...pendingProdReceiptData[0],
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          status: "Delivered",
          target_reserved_id: docId,
        });

        const { _id, id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
        recordToCreate = {
          ...prodReceiptWithoutId,
          reserved_qty: prodReceiptQty - deliverQty,
          open_qty: prodReceiptQty - deliverQty,
          delivered_qty: 0,
          status: "Pending",
          target_reserved_id: null,
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
          target_reserved_id: docId,
        });
      } else {
        // Partial - deliver portion, keep remainder as Pending
        recordsToUpdate.push({
          ...pendingSOData[0],
          reserved_qty: deliverQty,
          open_qty: 0,
          delivered_qty: deliverQty,
          status: "Delivered",
          target_reserved_id: docId,
        });

        const { _id, id, ...soWithoutId } = pendingSOData[0];
        recordToCreate = {
          ...soWithoutId,
          reserved_qty: soQty - deliverQty,
          open_qty: soQty - deliverQty,
          delivered_qty: 0,
          status: "Pending",
          target_reserved_id: null,
        };
      }

      reservedQtyToSubtract += deliverQty;
      additionalQtyNeeded -= deliverQty;
    }

    // FALLBACK: Deliver from Unrestricted (no reserved_table record created)
    if (additionalQtyNeeded > 0) {
      unrestrictedQtyToSubtract = additionalQtyNeeded;
      additionalQtyNeeded = 0;
    }

    return {
      code: "200",
      recordsToUpdate,
      recordToCreate,
      inventoryMovements: [
        ...(reservedQtyToSubtract > 0
          ? [
              {
                source: "Reserved",
                quantity: reservedQtyToSubtract,
                operation: "subtract",
              },
            ]
          : []),
        ...(unrestrictedQtyToSubtract > 0
          ? [
              {
                source: "Unrestricted",
                quantity: unrestrictedQtyToSubtract,
                operation: "subtract",
              },
            ]
          : []),
      ],
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
    const { _id, id, ...prodReceiptWithoutId } = pendingProdReceiptData[0];
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
    const { _id, id, ...soWithoutId } = pendingSOData[0];
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
  // NO reserved_table record created - inventory was never reserved
  // Just track the quantity for inventory movement (Unrestricted → Out)
  // Traceability is maintained through:
  // - The GD document itself (has all line/temp_data details)
  // - Inventory transaction history (plant_stock_balance movements)
  const deliverQty = remainingQtyToDeliver;

  unrestrictedQty += deliverQty;
  remainingQtyToDeliver -= deliverQty;

  // recordToCreate stays as-is (null or previous Pending split record)
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
