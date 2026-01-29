# Complete Implementation Guide: GR Created Status
## For Mobile App Development Team

This document provides a complete guide for implementing the GR Created status feature, including all affected modules, database changes, business logic, and integration points.

---

## Table of Contents
1. [Overview & Philosophy](#1-overview--philosophy)
2. [Database Schema Changes](#2-database-schema-changes)
3. [Module-by-Module Implementation](#3-module-by-module-implementation)
4. [Affected Modules & Files](#4-affected-modules--files)
5. [Integration Points](#5-integration-points)
6. [Testing Strategy](#6-testing-strategy)
7. [Migration & Rollout Plan](#7-migration--rollout-plan)

---

## 1. Overview & Philosophy

### 1.1 What is Created Status?

**Core Concept:** "Intent to Receive" - A reservation of goods without physical receipt

```
Traditional Flow:
PO Created → GR Received → Inventory Created

New Flow with Created Status:
PO Created → GR Created (Intent) → GR Received → Inventory Created
                ↓
            Can Cancel/Edit
```

**Key Principles:**
1. Created = Reservation only, no inventory impact
2. Received = Physical receipt, creates inventory
3. Created can be edited/cancelled freely
4. Must transition Created → Received to create inventory

### 1.2 Benefits

- **Flexibility:** Plan receipts in advance without committing inventory
- **Correctness:** Avoid orphaned batch numbers from cancelled receipts
- **Traceability:** Track intent vs actual receipt
- **Multi-user:** Prevent over-allocation when multiple users create GRs

---

## 2. Database Schema Changes

### 2.1 Collections to Modify

#### A. `purchase_order` Collection

**Add to line items in `table_po` array:**

```javascript
{
  id: "po_line_item_id",
  item_id: "item_123",
  quantity: 100,                      // Original ordered quantity
  received_qty: 50,                   // Actual received (Completed GRs)
  created_received_qty: 20,           // ⭐ NEW: Reserved (Created GRs)
  line_status: "Processing",          // "Issued", "Processing", "Completed"
  // ... existing fields
}
```

**Add to document header:**

```javascript
{
  purchase_order_no: "PO-001",
  po_status: "Processing",
  gr_status: "Created",               // ⭐ NEW: GR receiving status
  // Values: null, "Created", "Partially Received", "Fully Received", "Cancelled"
  table_po: [...],                   // Line items array
  // ... existing fields
}
```

**Migration Script:**
```javascript
// Add new fields to existing PO documents
db.collection("purchase_order").update({
  // For all documents, add these fields if missing
  $setOnInsert: {
    gr_status: null,
  },
  // For all line items in table_po array
  $set: {
    "table_po.$[].created_received_qty": 0
  }
});
```

#### B. `goods_receiving` Collection

**Modified status field values:**

```javascript
{
  gr_no: "GR-001",
  gr_status: "Created",  // ⭐ NEW STATUS OPTION
  // Possible values: "Draft", "Created", "Received", "Completed", "Cancelled"
  po_id: ["po_id_123"],
  table_gr: [...],
  // ... existing fields
}
```

**No schema changes needed** - just new status value.

#### C. `item_batch_balance` Collection

**No changes** - Created GRs do NOT create records here.
Only Received/Completed GRs create inventory records.

#### D. `item_balance` Collection

**No changes** - Created GRs do NOT update aggregated balances.
Only Received/Completed GRs update these.

### 2.2 Index Requirements

Add indexes for performance:

```javascript
// goods_receiving collection
db.goods_receiving.createIndex({ "gr_status": 1, "po_id": 1 });

// purchase_order collection
db.purchase_order.createIndex({ "gr_status": 1 });
db.purchase_order.createIndex({ "table_po.created_received_qty": 1 });
```

---

## 3. Module-by-Module Implementation

### MODULE 1: Goods Receiving - Create/Edit Functions

#### File: `GRsaveAsCreated.js`

**Purpose:** Handle saving GR as Created status (new GR or editing existing Created GR)

**Key Functions:**

##### A. `updatePurchaseOrderStatus()` - Update PO quantities

```javascript
const updatePurchaseOrderStatus = async (
  purchaseOrderIds,
  tableGR,
  isEditMode = false  // ⭐ CRITICAL: True when editing
) => {
  // For each PO
  for (const poId of poIds) {
    const poDoc = await db.collection("purchase_order").where({ id: poId }).get();
    const filteredGR = tableGR.filter(item => item.line_po_id === poId);

    let updatedPoItems = [...poDoc.table_po];

    // Update each line item
    for (const grItem of filteredGR) {
      const poLineIndex = updatedPoItems.findIndex(po => po.id === grItem.po_line_item_id);

      // ⭐ CRITICAL: Use quantity_delta in edit mode, received_qty in add mode
      const qtyChange = isEditMode
        ? parseFloat(grItem.quantity_delta || 0)  // Can be negative!
        : parseFloat(grItem.received_qty || 0);   // Always positive

      // Update created_received_qty (NOT received_qty!)
      const currentCreatedQty = parseFloat(updatedPoItems[poLineIndex].created_received_qty || 0);
      updatedPoItems[poLineIndex].created_received_qty = currentCreatedQty + qtyChange;
    }

    // Update PO
    await db.collection("purchase_order").doc(poDoc.id).update({
      table_po: updatedPoItems,
      gr_status: "Created"  // Set PO gr_status to Created
    });
  }
};
```

##### B. `saveGoodsReceiving()` - Main save function with delta calculation

```javascript
const saveGoodsReceiving = async (entry, putAwaySetupData, originalTableGR = []) => {
  const pageStatus = this.getValue("page_status");
  let grID = "";

  if (pageStatus === "Add") {
    // Normal add flow
    const grResponse = await db.collection("goods_receiving").add(entry);
    grID = grResponse.data[0].id;

    await updatePurchaseOrderStatus(entry.po_id, entry.table_gr, false);
  }
  else if (pageStatus === "Edit") {
    grID = entry.id;

    // ⭐ CRITICAL: Calculate deltas for edit mode
    const tableGRWithDeltas = entry.table_gr.map((newItem) => {
      const originalItem = originalTableGR.find(
        orig => orig.po_line_item_id === newItem.po_line_item_id
      );

      if (originalItem) {
        // Existing line - calculate delta
        return {
          ...newItem,
          quantity_delta: newItem.received_qty - originalItem.received_qty
        };
      } else {
        // New line - full quantity is delta
        return {
          ...newItem,
          quantity_delta: newItem.received_qty
        };
      }
    });

    // Add deleted lines with negative deltas
    originalTableGR.forEach((originalItem) => {
      const stillExists = entry.table_gr.find(
        item => item.po_line_item_id === originalItem.po_line_item_id
      );
      if (!stillExists) {
        tableGRWithDeltas.push({
          ...originalItem,
          received_qty: 0,
          quantity_delta: -(originalItem.received_qty || 0)  // Negative!
        });
      }
    });

    await db.collection("goods_receiving").doc(grID).update(entry);
    await updatePurchaseOrderStatus(entry.po_id, tableGRWithDeltas, true);  // isEditMode = true
  }

  // ⭐ DO NOT:
  // - Generate batch numbers
  // - Create inventory records
  // - Create putaway records
};
```

##### C. `checkOverCommitmentWarning()` - Soft validation

```javascript
const checkOverCommitmentWarning = async (originalTableGR = []) => {
  const tableGR = this.getValue("table_gr") || [];
  const pageStatus = this.getValue("page_status");

  // Fetch PO line data
  const poLineItemData = await fetchPOLineItems(tableGR);
  const itemData = await fetchItemData(tableGR);

  const overCommittedItems = [];

  for (const [index, item] of tableGR.entries()) {
    const poLine = poLineItemData.find(po => po.id === item.po_line_item_id);
    const itemInfo = itemData.find(data => data.id === item.item_id);

    const tolerance = itemInfo?.over_receive_tolerance || 0;
    const receivedQty = poLine.received_qty || 0;
    let createdQty = poLine.created_received_qty || 0;

    // ⭐ CRITICAL: In edit mode, exclude current GR's original quantity
    if (pageStatus === "Edit" && originalTableGR.length > 0) {
      const originalItem = originalTableGR.find(
        orig => orig.po_line_item_id === item.po_line_item_id
      );
      if (originalItem) {
        createdQty = Math.max(0, createdQty - (originalItem.received_qty || 0));
      }
    }

    const totalAlreadyAllocated = receivedQty + createdQty;
    const newGRQty = item.received_qty || 0;
    const totalAfterThisGR = totalAlreadyAllocated + newGRQty;
    const maxAllowed = (poLine.quantity * (100 + tolerance)) / 100;

    if (totalAfterThisGR > maxAllowed) {
      overCommittedItems.push({
        lineNumber: index + 1,
        itemName: item.item_name,
        orderedQty: poLine.quantity,
        receivedQty: receivedQty,
        createdQty: createdQty,
        newGRQty: newGRQty,
        totalAfter: totalAfterThisGR,
        maxAllowed: maxAllowed,
        overBy: totalAfterThisGR - maxAllowed,
      });
    }
  }

  if (overCommittedItems.length > 0) {
    // ⭐ Show warning (NOT error - allow to proceed)
    const warningMessages = overCommittedItems.map(item =>
      `<strong>Line ${item.lineNumber}:</strong> ${item.itemName}<br>` +
      `• PO Quantity: ${item.orderedQty.toFixed(3)}<br>` +
      `• Already Received: ${item.receivedQty.toFixed(3)}<br>` +
      `• In Created GRs: ${item.createdQty.toFixed(3)}<br>` +
      `• This GR: ${item.newGRQty.toFixed(3)}<br>` +
      `• Total would be: ${item.totalAfter.toFixed(3)} (Exceeds by ${item.overBy.toFixed(3)})`
    );

    await this.$confirm(
      `⚠️ <strong>Over-Commitment Warning</strong><br><br>` +
      `The following line(s) would exceed the PO quantity when combined with other Created GRs:<br><br>` +
      `${warningMessages.join("<br><br>")}<br><br>` +
      `This GR can be saved as Created, but it may fail when you try to receive it if other Created GRs are received first.<br><br>` +
      `Do you want to proceed?`,
      "Over-Commitment Detected",
      {
        confirmButtonText: "Yes, Save as Created",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      }
    );
  }
};
```

##### D. Main Execution Flow - Optimization

```javascript
(async () => {
  const data = this.getValues();
  const page_status = this.getValue("page_status");

  // ⭐ OPTIMIZATION: Fetch original GR data once for edit mode
  let originalTableGR = [];
  if (page_status === "Edit" && data.id) {
    const originalGR = await db.collection("goods_receiving").doc(data.id).get();
    originalTableGR = originalGR.data[0]?.table_gr || [];
  }

  let entry = data;
  entry.gr_status = "Created";

  // Process and validate
  const latestGR = await processGRLineItem(entry);
  await validateSerialNumberAllocation(latestGR.table_gr);
  await fetchReceivedQuantity();

  // ⭐ Pass original data to avoid refetch
  await checkOverCommitmentWarning(originalTableGR);

  await fillbackHeaderFields(latestGR);

  // ⭐ Pass original data to save function
  await saveGoodsReceiving(latestGR, putAwaySetupData, originalTableGR);

  this.$message.success(page_status === "Add" ? "Add successfully" : "Update successfully");
})();
```

**Key Points:**
- ✅ Calculate deltas in edit mode
- ✅ Fetch original GR once, pass to functions
- ✅ Exclude self from over-commitment check in edit mode
- ✅ Use soft validation (warning, not error)
- ❌ Do NOT generate batch numbers
- ❌ Do NOT create inventory

---

#### File: `GRsaveAsComplete.js`

**Purpose:** Handle transitioning Created → Received and direct Draft → Received

**Key Functions:**

##### A. `migratePOQuantitiesOnTransition()` - Move quantities from created to received

```javascript
const migratePOQuantitiesOnTransition = async (purchaseOrderId, tableGR, currentGRStatus) => {
  const resPO = await db.collection("purchase_order").where({ id: purchaseOrderId }).get();
  const poDoc = resPO.data[0];

  let updatedPoItems = [...poDoc.table_po];

  for (const grItem of tableGR) {
    const poLineIndex = updatedPoItems.findIndex(po => po.id === grItem.po_line_item_id);
    const poItem = updatedPoItems[poLineIndex];
    const grQty = parseFloat(grItem.received_qty || 0);

    // ⭐ If transitioning from Created → Received
    if (currentGRStatus === "Created") {
      // Subtract from created_received_qty
      const currentCreatedQty = parseFloat(poItem.created_received_qty || 0);
      updatedPoItems[poLineIndex].created_received_qty = Math.max(0, currentCreatedQty - grQty);
    }

    // Add to received_qty (for both Created→Received and Draft→Received)
    const currentReceivedQty = parseFloat(poItem.received_qty || 0);
    updatedPoItems[poLineIndex].received_qty = currentReceivedQty + grQty;

    // Update line status
    const tolerance = grItem.tolerance || 0;
    const maxAllowed = (poItem.quantity * (100 + tolerance)) / 100;

    if (updatedPoItems[poLineIndex].received_qty >= maxAllowed) {
      updatedPoItems[poLineIndex].line_status = "Completed";
    } else if (updatedPoItems[poLineIndex].received_qty > 0) {
      updatedPoItems[poLineIndex].line_status = "Processing";
    }
  }

  // ⭐ Calculate new PO gr_status
  const allCompleted = updatedPoItems.every(item => item.line_status === "Completed");
  const anyProcessing = updatedPoItems.some(item => item.line_status === "Processing");

  let newGRStatus = poDoc.gr_status;
  if (allCompleted) {
    newGRStatus = "Fully Received";
  } else if (anyProcessing) {
    newGRStatus = "Partially Received";
  }

  // Update PO
  await db.collection("purchase_order").doc(poDoc.id).update({
    table_po: updatedPoItems,
    po_status: calculatePOStatus(updatedPoItems),
    gr_status: newGRStatus
  });
};
```

##### B. `validateCompletionQuantities()` - Strict validation for receiving

```javascript
const validateCompletionQuantities = async (tableGR) => {
  const validationErrors = [];

  for (const [index, grItem] of tableGR.entries()) {
    const resPOLine = await db.collection("purchase_order_2ukyuanr_sub")
      .doc(grItem.po_line_item_id)
      .get();
    const poLine = resPOLine.data[0];

    const itemRes = await db.collection("Item").doc(grItem.item_id).get();
    const item = itemRes.data[0];
    const tolerance = item?.over_receive_tolerance || 0;

    // ⭐ Check against received_qty only (not created_received_qty)
    const alreadyReceived = parseFloat(poLine.received_qty || 0);
    const attemptingToReceive = parseFloat(grItem.received_qty || 0);
    const totalWouldBe = alreadyReceived + attemptingToReceive;
    const maxAllowed = (parseFloat(poLine.quantity || 0) * (100 + tolerance)) / 100;

    if (totalWouldBe > maxAllowed) {
      validationErrors.push({
        lineNumber: index + 1,
        itemName: grItem.item_name,
        alreadyReceived: alreadyReceived.toFixed(3),
        attemptingToReceive: attemptingToReceive.toFixed(3),
        totalWouldBe: totalWouldBe.toFixed(3),
        maxAllowed: maxAllowed.toFixed(3),
        tolerance: tolerance
      });
    }
  }

  if (validationErrors.length > 0) {
    const errorMessages = validationErrors.map(err =>
      `<strong>Line ${err.lineNumber}:</strong> Item "${err.itemName}"<br>` +
      `• Already received: ${err.alreadyReceived}<br>` +
      `• Attempting to receive: ${err.attemptingToReceive}<br>` +
      `• Total would be: ${err.totalWouldBe}<br>` +
      `• Max allowed (with ${err.tolerance}% tolerance): ${err.maxAllowed}`
    );

    // ⭐ HARD BLOCK: Throw error, don't allow to proceed
    await this.$alert(
      `Cannot receive GR - the following line(s) would exceed PO quantity:<br><br>` +
      `${errorMessages.join("<br><br>")}<br><br>` +
      `Please reduce the received quantities or cancel/edit conflicting Created GRs.`,
      "Invalid Received Quantity",
      {
        confirmButtonText: "OK",
        type: "error",
        dangerouslyUseHTMLString: true,
      }
    );

    throw new Error("Validation failed");
  }
};
```

**Key Points:**
- ✅ Migrate quantities: `created_received_qty` → `received_qty`
- ✅ Strict validation when receiving (hard block)
- ✅ Update PO line status and gr_status
- ✅ NOW create inventory records
- ✅ Generate batch numbers

---

#### File: `GRaddBatchLineItem.js`

**Purpose:** Auto-fill and filter logic when adding PO line items to GR

**Key Changes:**

##### Auto-fill Logic

```javascript
// When adding line from PO to GR form
const newTableGrRecord = {
  // ... other fields

  // ⭐ Auto-fill: Subtract BOTH received_qty AND created_received_qty
  received_qty: parseFloat(
    (
      poItem.ordered_qty -
      (poItem.received_qty || 0) -           // Actual received
      (poItem.created_received_qty || 0)      // Reserved in Created GRs
    ).toFixed(3)
  ),

  initial_received_qty: parseFloat((poItem.received_qty || 0).toFixed(3)),

  // ... other fields
};
```

##### Filter Logic

```javascript
// Filter out ONLY fully received line items
// Do NOT filter out lines with Created GRs
tableGR = tableGR.filter(gr =>
  (gr.initial_received_qty || 0) < (gr.ordered_qty || 0) &&  // Not fully received
  !existingGR.find(grItem => grItem.po_line_item_id === gr.po_line_item_id)  // Not already in current GR
);
```

**Key Points:**
- ✅ Auto-fill considers Created GRs
- ✅ Do NOT filter out lines with Created GRs (allow multiple Created GRs per line)
- ✅ Only filter out FULLY received lines

---

#### File: `GRhandleConvertGR.js`

**Purpose:** Convert PO to GR (bulk action)

**Key Changes:**

```javascript
const mapLineItem = async (item, record) => {
  return {
    // ... other fields

    // ⭐ Auto-fill: Account for Created GRs
    received_qty: parseFloat(
      (
        item.quantity -
        (item.received_qty || 0) -
        (item.created_received_qty || 0)
      ).toFixed(3)
    ),

    initial_received_qty: parseFloat((item.received_qty || 0).toFixed(3)),

    // ... other fields
  };
};

const handleMultipleGR = async (selectedRecords, plantID) => {
  for (const record of data) {
    const lineItem = record.table_po || [];

    for (const item of lineItem) {
      // ⭐ Filter out fully received lines
      if ((item.received_qty || 0) >= (item.quantity || 0)) {
        console.log(`Skipping fully received line item: ${item.item_name}`);
        continue;
      }

      const lineItemPromise = await mapLineItem(item, record);
      lineItemPromises.push(lineItemPromise);
    }

    // Skip PO if no line items to receive
    if (lineItemPromises.length === 0) {
      console.log(`Skipping PO ${record.purchase_order_no} - all items fully received`);
      continue;
    }

    // ... create GR
  }
};
```

**Key Points:**
- ✅ Auto-fill considers Created GRs
- ✅ Filter out fully received lines
- ✅ Validate before creating GRs

---

### MODULE 2: Bulk Actions - Cancel Created GRs

#### File: `Bulk Actions/Procurement/Goods Receiving/Cancel.js`

**Purpose:** Bulk cancel Created GRs and reverse PO quantities

**Complete Implementation:**

```javascript
(async () => {
  this.showLoading();

  // 1. Get selected records
  const listID = "custom_fnns00ze";
  let selectedRecords = this.getComponent(listID)?.$refs.crud.tableSelect;

  if (!selectedRecords || selectedRecords.length === 0) {
    this.hideLoading();
    this.$message.error("Please select at least one record.");
    return;
  }

  // 2. Filter for Created status only
  const createdGRs = selectedRecords.filter(item => item.gr_status === "Created");

  if (createdGRs.length === 0) {
    this.hideLoading();
    this.$message.error("Please select at least one Created goods receiving.");
    return;
  }

  // 3. Show confirmation
  const grNumbers = createdGRs.map(item => item.gr_no);
  await this.$confirm(
    `You've selected ${grNumbers.length} goods receiving(s) to cancel.<br><br>` +
    `<strong>Goods Receiving Numbers:</strong><br>${grNumbers.join(", ")}<br><br>` +
    `This will reverse the PO quantity reservations. Do you want to proceed?`,
    "Cancel Created Goods Receiving",
    {
      confirmButtonText: "Yes, Cancel GRs",
      cancelButtonText: "No, Go Back",
      type: "warning",
      dangerouslyUseHTMLString: true,
    }
  ).catch(() => {
    this.hideLoading();
    throw new Error();
  });

  // 4. Fetch full GR documents (list view doesn't include all data)
  const fullGRDocs = await Promise.all(
    createdGRs.map(async (gr) => {
      const resGR = await db.collection("goods_receiving").doc(gr.id).get();
      return resGR.data[0];
    })
  );

  // 5. Group GRs by PO for efficient processing
  const grsByPO = new Map();
  for (const gr of fullGRDocs) {
    const poIds = Array.isArray(gr.po_id) ? gr.po_id : [gr.po_id];
    for (const poId of poIds) {
      if (!grsByPO.has(poId)) {
        grsByPO.set(poId, []);
      }
      grsByPO.get(poId).push(gr);
    }
  }

  // 6. Reverse PO quantities
  const reversePOQuantities = async (poId, grs) => {
    const resPO = await db.collection("purchase_order").where({ id: poId }).get();
    const poDoc = resPO.data[0];
    let updatedPoItems = [...poDoc.table_po];

    // Calculate total quantities to reverse per line item
    const quantityReversals = new Map();
    for (const gr of grs) {
      for (const grLine of gr.table_gr) {
        const lineId = grLine.po_line_item_id;
        const qty = parseFloat(grLine.received_qty || 0);
        quantityReversals.set(lineId, (quantityReversals.get(lineId) || 0) + qty);
      }
    }

    // Apply reversals
    for (let i = 0; i < updatedPoItems.length; i++) {
      const poLine = updatedPoItems[i];
      const reversalQty = quantityReversals.get(poLine.id) || 0;

      if (reversalQty > 0) {
        const currentCreatedQty = parseFloat(poLine.created_received_qty || 0);
        const newCreatedQty = Math.max(0, currentCreatedQty - reversalQty);
        updatedPoItems[i] = {
          ...poLine,
          created_received_qty: newCreatedQty
        };
      }
    }

    // ⭐ Determine new gr_status (OPTIMIZED - no extra DB query)
    const hasRemainingCreatedGRs = updatedPoItems.some(
      item => (item.created_received_qty || 0) > 0
    );
    const allCompleted = updatedPoItems.every(
      item => (item.received_qty || 0) >= (item.quantity || 0)
    );
    const anyProcessing = updatedPoItems.some(
      item => (item.received_qty || 0) > 0 &&
              (item.received_qty || 0) < (item.quantity || 0)
    );

    let newGRStatus;
    if (hasRemainingCreatedGRs) {
      newGRStatus = "Created";
    } else if (allCompleted) {
      newGRStatus = "Fully Received";
    } else if (anyProcessing) {
      newGRStatus = "Partially Received";
    } else {
      newGRStatus = "Cancelled";  // All GRs cancelled, nothing received
    }

    // Update PO
    await db.collection("purchase_order").doc(poDoc.id).update({
      table_po: updatedPoItems,
      gr_status: newGRStatus
    });
  };

  // 7. Process each PO group
  for (const [poId, grs] of grsByPO) {
    try {
      await reversePOQuantities(poId, grs);
    } catch (error) {
      console.error(`Failed to reverse PO ${poId}:`, error);
    }
  }

  // 8. Update all GR statuses to Cancelled
  let successCount = 0;
  let failCount = 0;
  const failedGRs = [];

  for (const gr of fullGRDocs) {
    try {
      // ⭐ Only cancel if status is still "Created"
      if (gr.gr_status === "Created") {
        await db.collection("goods_receiving").doc(gr.id).update({
          gr_status: "Cancelled"
        });
        successCount++;
      }
    } catch (error) {
      failCount++;
      failedGRs.push(gr.gr_no);
      console.error(`Failed to cancel ${gr.gr_no}:`, error);
    }
  }

  // 9. Refresh and notify
  this.refresh();
  this.hideLoading();

  if (failCount > 0) {
    this.$message.warning(
      `Cancelled ${successCount} GR(s). Failed: ${failCount} (${failedGRs.join(", ")})`
    );
  } else {
    this.$message.success(
      `Successfully cancelled ${successCount} goods receiving(s).`
    );
  }
})();
```

**Key Points:**
- ✅ Only process Created GRs
- ✅ Fetch full GR documents (list view incomplete)
- ✅ Group by PO for efficiency
- ✅ Reverse `created_received_qty` on PO
- ✅ Update PO `gr_status` based on remaining quantities
- ✅ Optimization: Check `created_received_qty > 0` instead of querying GRs
- ✅ Verify status before cancelling

---

### MODULE 3: Purchase Order - Prevent Operations on POs with Created GRs

#### File: `Bulk Actions/Procurement/Purchase Order/Cancel.js`

**Purpose:** Prevent PO cancellation if Created GRs exist

**Key Addition:**

```javascript
// ⭐ Check for Created GRs BEFORE allowing cancellation
const purchaseOrderWithCreatedGR = [];
const createdGrDataMap = new Map();

for (const poItem of purchaseOrderData) {
  const createdGRResults = await db.collection("goods_receiving")
    .filter([{
      type: "branch",
      operator: "all",
      children: [
        { prop: "po_id", operator: "in", value: poItem.id },
        { prop: "gr_status", operator: "equal", value: "Created" }
      ]
    }])
    .get();

  if (createdGRResults.data && createdGRResults.data.length > 0) {
    createdGrDataMap.set(poItem.id, createdGRResults.data);
    purchaseOrderWithCreatedGR.push(poItem);
  }
}

if (purchaseOrderWithCreatedGR.length > 0) {
  const createdGrInfo = purchaseOrderWithCreatedGR.map(poItem => {
    const grList = createdGrDataMap.get(poItem.id) || [];
    const grNumbers = grList.map(gr => gr.gr_no).join(", ");
    return `PO: ${poItem.purchase_order_no} → GR: ${grNumbers}`;
  });

  await this.$alert(
    `These purchase orders have created goods receiving.<br>` +
    `<strong>Purchase Order → Goods Receiving:</strong><br>` +
    `${createdGrInfo.join("<br>")}<br><br>` +
    `Please cancel the goods receiving first.`,
    "Purchase Order with Created Goods Receiving",
    {
      confirmButtonText: "OK",
      type: "warning",
      dangerouslyUseHTMLString: true
    }
  );

  // Remove POs with Created GRs from processing list
  const createdGrPOIds = purchaseOrderWithCreatedGR.map(item => item.id);
  purchaseOrderData = purchaseOrderData.filter(
    item => !createdGrPOIds.includes(item.id)
  );

  if (purchaseOrderData.length === 0) {
    return;  // All POs blocked
  }
}

// Continue with remaining POs...
```

**Key Points:**
- ✅ Query for Created GRs before allowing cancel
- ✅ Show clear message with PO → GR mapping
- ✅ Block cancellation, require user to cancel GRs first
- ✅ Continue processing remaining POs

---

#### File: `Bulk Actions/Procurement/Purchase Order/ForceCompleted.js`

**Purpose:** Prevent PO force completion if Created GRs exist

**Same logic as Cancel.js** - check for Created GRs and block operation.

**Key Points:**
- ✅ Same validation as PO Cancel
- ✅ Prevent force completion if Created GRs exist
- ✅ User must cancel Created GRs first

---

#### File: `Bulk Actions/Procurement/Purchase Order/ConvertToGR.js`

**Purpose:** Convert PO to GR in bulk (NEW FILE - not previously created)

**This file should exist but wasn't in our changes. Here's what it needs:**

```javascript
// When converting PO to GR, consider created_received_qty
const availableQty = poLine.quantity
                    - (poLine.received_qty || 0)
                    - (poLine.created_received_qty || 0);

if (availableQty <= 0) {
  // Skip this line - nothing left to receive
  continue;
}

// Create GR with available quantity
grLine.received_qty = availableQty;
```

---

## 4. Affected Modules & Files

### 4.1 Core GR Module (7 files)

| File | Purpose | Changes Required |
|------|---------|------------------|
| **GRsaveAsCreated.js** | Save GR as Created | ✅ Implemented - Delta calc, PO update, validation |
| **GRsaveAsComplete.js** | Transition Created→Received | ✅ Implemented - Migrate quantities, strict validation |
| **GRaddBatchLineItem.js** | Auto-fill line items | ✅ Implemented - Consider created_received_qty |
| **GRhandleConvertGR.js** | Convert PO to GR | ✅ Implemented - Filter & auto-fill logic |
| **GRonMounted.js** | Form initialization | ⚠️ Check status display logic |
| **GRquantityValidation.js** | Quantity validation | ⚠️ Update validation rules |
| **status.html** | Status indicators | ⚠️ Add "Created" status styling |

### 4.2 PO Bulk Actions (3 files)

| File | Purpose | Changes Required |
|------|---------|------------------|
| **Cancel.js** | Bulk cancel POs | ✅ Implemented - Check Created GRs |
| **ForceCompleted.js** | Force complete POs | ✅ Implemented - Check Created GRs |
| **ConvertToGR.js** | Convert PO to GR | ⚠️ Needs update - Consider created_received_qty |

### 4.3 GR Bulk Actions (1 file)

| File | Purpose | Changes Required |
|------|---------|------------------|
| **Cancel.js** | Bulk cancel Created GRs | ✅ Implemented - Full implementation |

### 4.4 Database Schema (2 collections)

| Collection | Changes |
|------------|---------|
| **purchase_order** | Add `created_received_qty` to line items, `gr_status` to header |
| **goods_receiving** | Add "Created" as valid status value |

### 4.5 UI Components (Need Mobile Implementation)

| Component | Changes |
|-----------|---------|
| **GR Form** | Add "Save as Created" button |
| **GR List** | Show Created status with styling |
| **PO Form** | Display created_received_qty |
| **Status Badges** | Add Created status badge |

---

## 5. Integration Points

### 5.1 Inventory Module

**No Changes Required for Created Status**

When GR is in Created status:
- ❌ Do NOT create item_batch_balance records
- ❌ Do NOT update item_balance aggregated records
- ❌ Do NOT update plant_stock_balance

When transitioning Created → Received:
- ✅ NOW create all inventory records (same as Draft → Received)

### 5.2 Putaway Module

**No Changes Required for Created Status**

When GR is in Created status:
- ❌ Do NOT create putaway records

When transitioning Created → Received:
- ✅ NOW create putaway records (if putaway_required = 1)

### 5.3 Accounting Module

**No Impact**

Created GRs do not trigger accounting entries.
Only Received/Completed GRs trigger accounting (existing behavior).

### 5.4 Purchase Invoice Module

**Check for Created GRs when validating PI**

When creating Purchase Invoice:
- ⚠️ Should only allow invoicing for Received quantities
- ⚠️ Should NOT allow invoicing for Created quantities

**Validation needed:**
```javascript
// When creating PI from PO
const availableToInvoice = poLine.received_qty;  // Only actual received
// NOT: poLine.received_qty + poLine.created_received_qty
```

### 5.5 Reporting Module

**Update Reports to Consider Created GRs**

Reports that need updates:
- ⚠️ **PO Outstanding Report**: Should show `quantity - received_qty - created_received_qty` as truly outstanding
- ⚠️ **GR Status Report**: Add "Created" status as a category
- ⚠️ **Receiving Performance**: Distinguish between Created and Received

---

## 6. Testing Strategy

### 6.1 Unit Test Cases

#### Test Case 1: Create GR as Created
```
Given: PO with 100 qty
When: Create GR with 30 qty as "Created"
Then:
  ✓ GR status = "Created"
  ✓ PO created_received_qty = 30
  ✓ PO received_qty = 0
  ✓ PO gr_status = "Created"
  ✗ No inventory created
  ✗ No batch numbers generated
```

#### Test Case 2: Edit Created GR (Increase Quantity)
```
Given: PO with 100 qty, GR1 Created with 30 qty
When: Edit GR1 to 50 qty
Then:
  ✓ Delta = +20
  ✓ PO created_received_qty = 50
  ✓ No double-counting
```

#### Test Case 3: Edit Created GR (Decrease Quantity)
```
Given: PO with 100 qty, GR1 Created with 30 qty
When: Edit GR1 to 10 qty
Then:
  ✓ Delta = -20
  ✓ PO created_received_qty = 10
```

#### Test Case 4: Edit Created GR (Delete Line)
```
Given: GR1 Created with 2 lines (30 qty each)
When: Edit GR1, delete line 2
Then:
  ✓ Delta for line 2 = -30
  ✓ PO created_received_qty reduced by 30
```

#### Test Case 5: Edit Created GR (Add Line)
```
Given: GR1 Created with 1 line (30 qty)
When: Edit GR1, add line 2 (20 qty)
Then:
  ✓ Delta for line 2 = +20
  ✓ PO created_received_qty increased by 20
```

#### Test Case 6: Transition Created → Received
```
Given: PO with 100 qty, GR1 Created with 30 qty
When: Save GR1 as "Received"
Then:
  ✓ PO created_received_qty = 0
  ✓ PO received_qty = 30
  ✓ PO gr_status = "Partially Received"
  ✓ Inventory created
  ✓ Batch numbers generated
```

#### Test Case 7: Over-Commitment Warning (Soft)
```
Given: PO with 100 qty (10% tolerance = 110 max)
When: Create GR1 with 70 qty as Created, then GR2 with 50 qty as Created
Then:
  ✓ GR1: No warning
  ✓ GR2: Warning shown (total 120 > 110)
  ✓ Allow user to proceed
  ✓ Both GRs created successfully
```

#### Test Case 8: Validation Error When Receiving (Hard Block)
```
Given: PO with 100 qty (10% tolerance), GR1 Created 70 qty, GR2 Created 50 qty
When: Receive GR1 (70 qty) ✓, then try to receive GR2 (50 qty)
Then:
  ✓ GR1 received successfully
  ✗ GR2 blocked with error (would exceed 110)
```

#### Test Case 9: Cancel Single Created GR
```
Given: PO with 100 qty, GR1 Created with 30 qty
When: Cancel GR1
Then:
  ✓ GR1 status = "Cancelled"
  ✓ PO created_received_qty = 0
  ✓ PO gr_status = "Cancelled"
```

#### Test Case 10: Cancel One of Multiple Created GRs
```
Given: PO with 100 qty, GR1 Created 30 qty, GR2 Created 20 qty
When: Cancel GR1
Then:
  ✓ GR1 status = "Cancelled"
  ✓ PO created_received_qty = 20 (from GR2)
  ✓ PO gr_status = "Created" (GR2 still exists)
```

#### Test Case 11: Edit Created GR - No False Over-Commitment Warning
```
Given: PO with 100 qty, GR1 Created with 100 qty
When: Edit GR1, reduce to 80 qty
Then:
  ✗ No over-commitment warning
  ✓ (GR1's original 100 is excluded from check)
  ✓ PO created_received_qty = 80
```

#### Test Case 12: Auto-fill Considers Created GRs
```
Given: PO 100 qty, Received 20 qty, Created 30 qty
When: Add line item to new GR
Then:
  ✓ Auto-fill received_qty = 50 (100 - 20 - 30)
```

#### Test Case 13: Filter Shows Available Lines
```
Given: PO with 2 lines: Line1 100% received, Line2 50% received
When: Open GR form, add from PO
Then:
  ✗ Line1 not shown (fully received)
  ✓ Line2 shown (partially received)
```

#### Test Case 14: Multiple Created GRs for Same Line
```
Given: PO line with 100 qty
When: Create GR1 with 30 qty Created, then create GR2 for same line with 20 qty Created
Then:
  ✓ Both GRs created successfully
  ✓ PO created_received_qty = 50
```

#### Test Case 15: Prevent PO Cancel with Created GRs
```
Given: PO with GR in Created status
When: Try to cancel PO
Then:
  ✗ Blocked with message "Please cancel the goods receiving first"
```

#### Test Case 16: Prevent PO Force Complete with Created GRs
```
Given: PO with GR in Created status
When: Try to force complete PO
Then:
  ✗ Blocked with message "Please cancel the goods receiving first"
```

### 6.2 Integration Test Cases

#### Test Case 17: End-to-End Created → Received Flow
```
1. Create PO: 100 qty
2. Create GR1: 30 qty as Created
   ✓ PO shows 70 qty available
3. Create GR2: 40 qty as Created
   ✓ PO shows 30 qty available
4. Edit GR1: Change to 20 qty
   ✓ PO shows 40 qty available
5. Cancel GR2
   ✓ PO shows 80 qty available
6. Receive GR1 (20 qty)
   ✓ Inventory created: 20 qty
   ✓ PO shows 80 qty available
7. Create GR3: 80 qty, receive immediately
   ✓ Inventory created: 80 qty
   ✓ PO fully received
```

#### Test Case 18: Multiple POs in Single GR
```
1. Create PO1: 100 qty
2. Create PO2: 50 qty
3. Create GR1: 30 qty from PO1 + 20 qty from PO2, save as Created
   ✓ PO1 created_received_qty = 30
   ✓ PO2 created_received_qty = 20
4. Receive GR1
   ✓ PO1 received_qty = 30, created_received_qty = 0
   ✓ PO2 received_qty = 20, created_received_qty = 0
```

### 6.3 Performance Test Cases

#### Test Case 19: Bulk Cancel 100 Created GRs
```
When: Select and cancel 100 Created GRs across 10 POs
Then:
  ✓ All reversed within 30 seconds
  ✓ No database timeout errors
  ✓ Correct final quantities on all POs
```

#### Test Case 20: Edit GR with 50 Line Items
```
When: Edit Created GR with 50 line items, change 10 lines
Then:
  ✓ Delta calculation completes within 5 seconds
  ✓ Only 10 deltas applied to PO
  ✓ No performance degradation
```

---

## 7. Migration & Rollout Plan

### 7.1 Database Migration

**Phase 1: Add New Fields (Before Code Deployment)**

```javascript
// Migration script
db.collection("purchase_order").find({}).forEach(function(po) {
  // Add gr_status if missing
  if (!po.gr_status) {
    db.collection("purchase_order").update(
      { _id: po._id },
      { $set: { gr_status: null } }
    );
  }

  // Add created_received_qty to all line items
  if (po.table_po && po.table_po.length > 0) {
    let updated = false;
    const updatedLines = po.table_po.map(line => {
      if (!line.hasOwnProperty('created_received_qty')) {
        updated = true;
        return { ...line, created_received_qty: 0 };
      }
      return line;
    });

    if (updated) {
      db.collection("purchase_order").update(
        { _id: po._id },
        { $set: { table_po: updatedLines } }
      );
    }
  }
});

print("Migration complete!");
```

**Phase 2: Data Validation**

```javascript
// Verify migration
const totalPOs = db.collection("purchase_order").count();
const poisWithGRStatus = db.collection("purchase_order").count({ gr_status: { $exists: true } });
const poisWithCreatedQty = db.collection("purchase_order").count({
  "table_po.created_received_qty": { $exists: true }
});

print(`Total POs: ${totalPOs}`);
print(`POs with gr_status: ${poisWithGRStatus}`);
print(`POs with created_received_qty: ${poisWithCreatedQty}`);

// Should all be equal
if (totalPOs === poisWithGRStatus && totalPOs === poisWithCreatedQty) {
  print("✓ Migration successful!");
} else {
  print("✗ Migration incomplete - rerun script");
}
```

### 7.2 Code Deployment Sequence

**Step 1: Deploy Backend Changes**
1. Deploy database migration script
2. Verify migration success
3. Deploy updated API endpoints
4. Test API endpoints with Postman/Insomnia

**Step 2: Deploy Web App Changes**
1. Deploy all GR module files
2. Deploy bulk action files
3. Deploy status HTML/CSS
4. Test in staging environment

**Step 3: Deploy Mobile App**
1. Implement all mobile screens
2. Test offline sync
3. Deploy to TestFlight/Beta
4. Gather user feedback

**Step 4: Training & Documentation**
1. Update user manuals
2. Conduct training sessions
3. Create video tutorials

### 7.3 Rollback Plan

**If Issues Found:**

1. **Emergency Rollback (Code Only)**
   - Revert to previous code version
   - Created GRs remain in database (won't break anything)
   - Can still be cancelled manually

2. **Full Rollback (Code + Data)**
   ```javascript
   // Reset all Created GRs to Draft
   db.collection("goods_receiving").update(
     { gr_status: "Created" },
     { $set: { gr_status: "Draft" } }
   );

   // Reset all PO created_received_qty to 0
   db.collection("purchase_order").find({}).forEach(function(po) {
     const updatedLines = po.table_po.map(line => ({
       ...line,
       created_received_qty: 0
     }));

     db.collection("purchase_order").update(
       { _id: po._id },
       { $set: {
         table_po: updatedLines,
         gr_status: null
       } }
     );
   });
   ```

### 7.4 Monitoring & Alerts

**Key Metrics to Monitor:**

1. **Created GR Count**
   - Track number of Created GRs over time
   - Alert if count grows too large (indicates users not receiving)

2. **Over-Commitment Rate**
   - Track how often over-commitment warning is shown
   - Alert if rate is too high (indicates poor planning)

3. **Failed Receives**
   - Track how often Created → Received fails due to quantity limits
   - Alert if rate is too high

4. **Average Time in Created Status**
   - Track how long GRs stay in Created status
   - Alert if average time > 7 days (indicates stale data)

**Dashboard Queries:**

```javascript
// Count Created GRs
db.goods_receiving.count({ gr_status: "Created" });

// Created GRs older than 7 days
db.goods_receiving.count({
  gr_status: "Created",
  gr_date: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
});

// POs with Created GRs
db.purchase_order.count({ gr_status: "Created" });
```

---

## 8. Mobile App Specific Implementation Guide

### 8.1 Screen Requirements

#### Screen 1: GR List
- **Add Filter:** "Created" status option
- **Visual:** Blue badge for Created status
- **Actions:** Allow edit/cancel for Created GRs

#### Screen 2: GR Form (Add Mode)
- **Add Button:** "Save as Created" (alongside existing buttons)
- **Validation:** Show over-commitment warning (soft)
- **Auto-fill:** Consider `created_received_qty` when calculating remaining qty

#### Screen 3: GR Form (Edit Mode - Created)
- **Show Button:** "Save as Created", "Save as Received"
- **Hide Button:** "Save as Draft" (can't go backwards)
- **Fetch:** Original GR data on screen load (for delta calc)
- **Validation:** Exclude self from over-commitment check

#### Screen 4: PO Details
- **Display:** Show `created_received_qty` for each line
- **Calculate:** Available = `quantity - received_qty - created_received_qty`
- **Badge:** Show if PO has Created GRs

### 8.2 Offline Sync Strategy

**Challenge:** How to handle Created GRs when offline?

**Approach 1: Optimistic (Recommended)**
```
User creates GR as Created offline:
1. Store locally with pending_sync = true
2. Immediately update local PO copy
3. Show as "Pending Sync" in UI
4. When online, sync to server
5. If conflict (PO was updated), show conflict resolution screen
```

**Approach 2: Conservative**
```
User creates GR as Created offline:
1. Block action, show "Created GRs require internet connection"
2. Allow Draft GRs offline (existing behavior)
```

**Recommended:** Approach 1 for better UX, with robust conflict resolution.

### 8.3 API Endpoints

**Mobile app should call these endpoints:**

#### Create GR as Created
```
POST /api/goods_receiving
Body: {
  gr_status: "Created",
  // ... other fields
}
```

#### Update Created GR
```
PUT /api/goods_receiving/:id
Body: {
  table_gr: [...],  // Backend calculates deltas
  // ... other fields
}
```

#### Transition Created → Received
```
PUT /api/goods_receiving/:id/receive
Body: {
  gr_status: "Received"
  // Backend handles migration
}
```

#### Bulk Cancel Created GRs
```
POST /api/goods_receiving/bulk_cancel
Body: {
  gr_ids: ["id1", "id2", ...]
}
```

### 8.4 Error Handling

**Common Errors:**

1. **Over-Commitment Error (When Receiving)**
   ```json
   {
     "error": "QUANTITY_EXCEEDED",
     "message": "Line 1 would exceed PO quantity",
     "details": [
       {
         "line": 1,
         "item": "Product A",
         "max_allowed": 110,
         "attempting": 120
       }
     ]
   }
   ```

   **Mobile UI:** Show detailed error with line numbers, suggest editing GR.

2. **Conflict Error (When Syncing Offline Created GR)**
   ```json
   {
     "error": "CONFLICT",
     "message": "PO was updated since offline GR was created",
     "current_available": 30,
     "gr_requested": 50
   }
   ```

   **Mobile UI:** Show conflict screen, allow user to adjust quantities or cancel.

3. **Status Change Error (When Cancelling)**
   ```json
   {
     "error": "INVALID_STATUS",
     "message": "GR status is 'Received', cannot cancel",
     "current_status": "Received"
   }
   ```

   **Mobile UI:** Show "GR was already received, cannot cancel" message.

### 8.5 UI/UX Best Practices

#### Status Colors
```
Draft:      #9E9E9E (Gray)
Created:    #2196F3 (Blue)  ← NEW
Received:   #4CAF50 (Green)
Completed:  #4CAF50 (Green)
Cancelled:  #F44336 (Red)
```

#### Button States
```
Draft GR:
  [Save as Draft] [Save as Created] [Save as Received]

Created GR (Edit):
  [Save as Created] [Save as Received]

Received GR (Edit):
  [Save as Received]
```

#### Warning Dialog
```
⚠️ Over-Commitment Warning

Line 1: Product A
PO Qty: 100
Already Received: 30
In Created GRs: 40
This GR: 50
Total: 120 (exceeds limit of 110)

This GR can be saved as Created, but may fail
when receiving if other GRs are received first.

[Cancel] [Save Anyway]
```

---

## 9. Summary Checklist for Mobile Team

### Database
- [ ] Add `created_received_qty` to PO line items (migration script)
- [ ] Add `gr_status` to PO header (migration script)
- [ ] Add indexes for performance
- [ ] Test migration on staging database

### API Endpoints
- [ ] Create GR as Created endpoint
- [ ] Update Created GR with delta calculation
- [ ] Transition Created → Received endpoint
- [ ] Bulk cancel Created GRs endpoint
- [ ] Update PO cancel endpoint (check for Created GRs)
- [ ] Update PO force complete endpoint (check for Created GRs)

### Mobile UI
- [ ] Add "Created" status badge/color
- [ ] Add "Save as Created" button to GR form
- [ ] Update GR list to show Created status
- [ ] Update PO details to show `created_received_qty`
- [ ] Implement over-commitment warning dialog
- [ ] Implement strict validation dialog (when receiving)
- [ ] Update button visibility based on status

### Business Logic
- [ ] Implement delta calculation for editing Created GRs
- [ ] Fetch original GR data before editing (optimization)
- [ ] Exclude self from over-commitment check in edit mode
- [ ] Auto-fill logic considers `created_received_qty`
- [ ] Filter logic does NOT exclude lines with Created GRs
- [ ] Transition Created → Received migrates quantities
- [ ] Cancel Created GR reverses PO quantities
- [ ] Do NOT generate batch numbers for Created status
- [ ] Do NOT create inventory for Created status

### Testing
- [ ] Unit tests for all 20 test cases
- [ ] Integration tests for end-to-end flows
- [ ] Performance tests for bulk operations
- [ ] Offline sync tests
- [ ] Conflict resolution tests

### Documentation
- [ ] Update API documentation
- [ ] Update user manual
- [ ] Create video tutorials
- [ ] Update mobile app help screens

### Deployment
- [ ] Run migration script on staging
- [ ] Deploy backend changes to staging
- [ ] Deploy mobile app to TestFlight/Beta
- [ ] Conduct UAT with key users
- [ ] Deploy to production
- [ ] Monitor metrics for 1 week

---

## 10. Contact & Support

**For Technical Questions:**
- Reference web implementation files in `/BladeXfunctions/Goods Receiving/`
- Check this document for detailed specifications

**For Business Logic Clarification:**
- Review test cases in Section 6
- Check integration points in Section 5

**For Mobile-Specific Guidance:**
- Review Section 8 for mobile app specifics
- Check API endpoints and error handling

---

**Document Version:** 2.0
**Last Updated:** 2026-01-16
**Status:** Ready for Mobile Implementation
**Estimated Implementation Time:** 3-4 weeks for mobile app
