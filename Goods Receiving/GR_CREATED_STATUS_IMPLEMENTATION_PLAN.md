# Goods Receiving (GR) Created Status - Implementation Plan

## Overview
This document provides a complete specification for implementing the GR "Created" status functionality in the mobile application. The Created status represents an "Intent to Receive" - it reserves quantities on the Purchase Order but does not create actual inventory records.

---

## 1. Core Concept

### What is "Created" Status?

**Created Status Philosophy**: "Intent to Receive"
- User indicates they plan to receive goods but hasn't physically received them yet
- Quantities are reserved on the PO (`created_received_qty`) but inventory is NOT created
- Allows editing and cancellation without wasting batch numbers or creating orphaned inventory records
- Can be promoted to "Received/Completed" status later when goods physically arrive

### Status Flow
```
Draft → Created → Received/Completed
   ↓       ↓
Cancel  Cancel
```

---

## 2. Database Schema Changes

### 2.1 Purchase Order Line Items (`table_po` in `purchase_order`)

Add new field to track Created GR quantities:

```javascript
{
  id: "po_line_item_id",
  quantity: 100,                    // Original ordered quantity
  received_qty: 50,                 // Actual received qty (from Completed GRs)
  created_received_qty: 20,         // Reserved qty (from Created GRs) - NEW FIELD
  // ... other fields
}
```

**Field Logic:**
- `created_received_qty`: Sum of quantities from all GRs in "Created" status
- `received_qty`: Sum of quantities from all GRs in "Received/Completed" status
- Available to receive: `quantity - received_qty - created_received_qty`

### 2.2 Purchase Order Header

Add field to track GR status:

```javascript
{
  purchase_order_no: "PO-001",
  gr_status: "Created",  // Values: "Created", "Partially Received", "Fully Received", "Cancelled"
  // ... other fields
}
```

**GR Status Values:**
- `"Created"`: Has GRs in Created status
- `"Partially Received"`: Some items received
- `"Fully Received"`: All items received
- `"Cancelled"`: GRs were created but cancelled
- Empty/null: No GRs created yet

---

## 3. Business Logic

### 3.1 Creating a GR with "Created" Status

**When user clicks "Save as Created":**

1. **Validate quantities:**
   ```javascript
   // For each line item
   const maxAllowed = (poLine.quantity * (100 + tolerance)) / 100;
   const totalReceived = poLine.received_qty + poLine.created_received_qty;

   if (totalReceived + newGRQty > maxAllowed) {
     // Show warning (soft validation - allow to proceed)
     showWarning("Over-commitment detected");
   }
   ```

2. **Save GR with status "Created":**
   ```javascript
   {
     gr_no: "GR-001",
     gr_status: "Created",
     gr_date: "2026-01-13",
     table_gr: [
       {
         item_id: "item_123",
         received_qty: 20,
         po_line_item_id: "po_line_123",
         // ... other fields
       }
     ]
   }
   ```

3. **Update PO line items - Add to `created_received_qty`:**
   ```javascript
   // For each GR line item
   const poLine = findPOLineItem(grLine.po_line_item_id);
   poLine.created_received_qty = (poLine.created_received_qty || 0) + grLine.received_qty;
   ```

4. **Update PO header `gr_status`:**
   ```javascript
   purchaseOrder.gr_status = "Created";
   ```

5. **DO NOT:**
   - Generate batch numbers
   - Create inventory records (item_batch_balance, item_balance)
   - Create putaway records
   - Update plant stock balance

### 3.2 Editing a GR in "Created" Status

**Delta-based Updates (Critical for avoiding double-counting):**

1. **Fetch original GR before updating:**
   ```javascript
   const originalGR = await db.collection("goods_receiving").doc(grId).get();
   const originalTableGR = originalGR.data[0]?.table_gr || [];
   ```

2. **Calculate quantity deltas:**
   ```javascript
   const tableGRWithDeltas = newTableGR.map((newItem) => {
     const originalItem = originalTableGR.find(
       (orig) => orig.po_line_item_id === newItem.po_line_item_id
     );

     if (originalItem) {
       // Existing line - calculate delta
       const quantityDelta = newItem.received_qty - originalItem.received_qty;
       return { ...newItem, quantity_delta: quantityDelta };
     } else {
       // New line - full quantity is delta
       return { ...newItem, quantity_delta: newItem.received_qty };
     }
   });

   // Handle deleted lines
   originalTableGR.forEach((originalItem) => {
     const stillExists = newTableGR.find(
       (item) => item.po_line_item_id === originalItem.po_line_item_id
     );
     if (!stillExists) {
       // Line was deleted - negative delta
       tableGRWithDeltas.push({
         ...originalItem,
         received_qty: 0,
         quantity_delta: -(originalItem.received_qty || 0)
       });
     }
   });
   ```

3. **Update PO using deltas:**
   ```javascript
   // For each line with delta
   const poLine = findPOLineItem(grLine.po_line_item_id);
   poLine.created_received_qty = (poLine.created_received_qty || 0) + grLine.quantity_delta;
   // quantity_delta can be positive (added qty) or negative (removed qty)
   ```

### 3.3 Transitioning from "Created" to "Received/Completed"

**When user clicks "Save as Received" on a Created GR:**

1. **Validate quantities don't exceed PO:**
   ```javascript
   for (const grLine of tableGR) {
     const poLine = findPOLineItem(grLine.po_line_item_id);
     const tolerance = item.over_receive_tolerance || 0;
     const maxAllowed = (poLine.quantity * (100 + tolerance)) / 100;

     // Check total INCLUDING other Created GRs
     const totalWouldBe = poLine.received_qty + grLine.received_qty;

     if (totalWouldBe > maxAllowed) {
       throw new Error("Quantity exceeds PO limit");
     }
   }
   ```

2. **Migrate quantities on PO:**
   ```javascript
   // For each GR line item
   const poLine = findPOLineItem(grLine.po_line_item_id);

   // Subtract from created_received_qty
   poLine.created_received_qty = (poLine.created_received_qty || 0) - grLine.received_qty;

   // Add to received_qty
   poLine.received_qty = (poLine.received_qty || 0) + grLine.received_qty;

   // Update line status
   if (poLine.received_qty >= poLine.quantity) {
     poLine.line_status = "Completed";
   } else if (poLine.received_qty > 0) {
     poLine.line_status = "Processing";
   }
   ```

3. **Update PO gr_status:**
   ```javascript
   const allCompleted = poLines.every(line => line.line_status === "Completed");
   const anyProcessing = poLines.some(line => line.line_status === "Processing");

   if (allCompleted) {
     po.gr_status = "Fully Received";
   } else if (anyProcessing) {
     po.gr_status = "Partially Received";
   }
   ```

4. **NOW create inventory:**
   - Generate batch numbers (if not manually entered)
   - Create item_batch_balance records
   - Update item_balance aggregated records
   - Create putaway records (if required)
   - Update plant stock balance

5. **Update GR status:**
   ```javascript
   gr.gr_status = "Received"; // or "Completed"
   ```

### 3.4 Cancelling a Created GR

**When user cancels a Created GR:**

1. **Verify GR status:**
   ```javascript
   if (gr.gr_status !== "Created") {
     throw new Error("Only Created GRs can be cancelled");
   }
   ```

2. **Reverse PO quantities:**
   ```javascript
   // For each GR line item
   const poLine = findPOLineItem(grLine.po_line_item_id);
   poLine.created_received_qty = Math.max(0,
     (poLine.created_received_qty || 0) - grLine.received_qty
   );
   ```

3. **Update PO gr_status:**
   ```javascript
   // Check if any Created GRs remain
   const hasRemainingCreatedGRs = poLines.some(
     line => (line.created_received_qty || 0) > 0
   );

   const allCompleted = poLines.every(
     line => (line.received_qty || 0) >= (line.quantity || 0)
   );
   const anyProcessing = poLines.some(
     line => (line.received_qty || 0) > 0 &&
             (line.received_qty || 0) < (line.quantity || 0)
   );

   if (hasRemainingCreatedGRs) {
     po.gr_status = "Created";
   } else if (allCompleted) {
     po.gr_status = "Fully Received";
   } else if (anyProcessing) {
     po.gr_status = "Partially Received";
   } else {
     po.gr_status = "Cancelled"; // All GRs were cancelled, nothing received
   }
   ```

4. **Update GR status:**
   ```javascript
   gr.gr_status = "Cancelled";
   ```

5. **DO NOT:**
   - Delete inventory records (there are none)
   - Reverse batch numbers (none were generated)

---

## 4. Form Behavior & Auto-fill Logic

### 4.1 Auto-fill "Received Quantity" Field

When adding a line item from PO to GR form:

```javascript
// Calculate remaining quantity to receive
const remainingQty = poLine.quantity
                     - (poLine.received_qty || 0)        // Actual received
                     - (poLine.created_received_qty || 0); // Reserved in Created GRs

grLine.received_qty = remainingQty;
```

**Example:**
- PO Quantity: 100
- Received Qty: 30 (from Completed GRs)
- Created Received Qty: 20 (from other Created GRs)
- Auto-fill: 100 - 30 - 20 = **50**

### 4.2 Filtering Line Items

When showing available PO line items to add:

```javascript
// Only show lines that are NOT fully received
const availableLines = poLines.filter(
  line => (line.received_qty || 0) < (line.quantity || 0)
);

// Do NOT filter out lines with Created GRs
// User should be able to create multiple Created GRs for same line
```

### 4.3 Over-Commitment Warning

Show warning (not blocking) when saving as Created:

```javascript
// For each line item
const totalAfterThisGR =
  (poLine.received_qty || 0) +           // Already received
  (poLine.created_received_qty || 0) +   // Other Created GRs
  grLine.received_qty;                   // This GR

const maxAllowed = (poLine.quantity * (100 + tolerance)) / 100;

if (totalAfterThisGR > maxAllowed) {
  showWarning(
    "Line exceeds PO quantity when combined with other Created GRs. " +
    "This GR can be saved as Created, but may fail when receiving " +
    "if other Created GRs are received first."
  );
}
```

**Allow user to proceed** - this is a soft warning, not a hard block.

### 4.4 Editing Created GR - Exclude Self from Over-Commitment Check

When editing a Created GR, exclude the current GR's original quantities:

```javascript
// Fetch original GR quantities BEFORE showing form
const originalGR = await db.collection("goods_receiving").doc(grId).get();
const originalTableGR = originalGR.data[0]?.table_gr || [];

// For each line in form, when checking over-commitment
const originalItem = originalTableGR.find(
  orig => orig.po_line_item_id === currentLine.po_line_item_id
);

// Exclude current GR's original quantity from created_received_qty
const otherCreatedQty = (poLine.created_received_qty || 0) -
                        (originalItem?.received_qty || 0);

const totalAfterEdit =
  (poLine.received_qty || 0) +     // Already received
  otherCreatedQty +                 // Other Created GRs (excluding this one)
  currentLine.received_qty;         // New quantity in this GR
```

---

## 5. UI/UX Guidelines

### 5.1 Status Indicators

**Visual Design:**
```
Draft:      Gray background, gray border
Created:    Blue background, blue border  (NEW)
Received:   Green background, green border
Cancelled:  Red background, red border
```

### 5.2 Button Visibility

**GR Form Buttons (based on status and mode):**

| Status    | Mode | Save as Draft | Save as Created | Save as Received |
|-----------|------|---------------|-----------------|------------------|
| Draft     | Add  | ✓             | ✓               | ✓                |
| Draft     | Edit | ✓             | ✓               | ✓                |
| Created   | Edit | ✗             | ✓               | ✓                |
| Received  | Edit | ✗             | ✗               | ✓                |

**Notes:**
- Created GRs cannot be saved back to Draft (one-way progression)
- Created GRs can be edited and saved as Created again
- Created GRs can be promoted to Received

### 5.3 Batch Number Fields

**Behavior based on status:**

```javascript
if (gr_status === "Draft" || gr_status === "Created") {
  // Batch number field is editable but optional
  // Can be left blank or filled manually
  // Do NOT auto-generate
} else if (gr_status === "Received" || gr_status === "Completed") {
  // Auto-generate batch numbers if not manually entered
  // Create inventory records
}
```

### 5.4 Warning Messages

**Over-Commitment Warning (when saving as Created):**
```
⚠️ Over-Commitment Warning

The following line(s) would exceed the PO quantity when combined
with other Created GRs:

Line 1: Item "Product A"
• PO Quantity: 100.000
• Already Received: 30.000
• In Created GRs: 40.000
• This GR: 50.000
• Total would be: 120.000 (Exceeds by 20.000)

This GR can be saved as Created, but it may fail when you try
to receive it if other Created GRs are received first.

Do you want to proceed?
```

**Validation Error (when receiving):**
```
❌ Cannot Receive GR

The following line(s) would exceed PO quantity:

Line 1: Item "Product A"
• Already received: 30.000
• Attempting to receive: 50.000
• Total would be: 80.000
• Max allowed (with 10% tolerance): 55.000

Please reduce the received quantities or cancel/edit conflicting
Created GRs.
```

---

## 6. API Endpoints & Database Operations

### 6.1 Create GR as Created

**Endpoint:** `POST /goods_receiving`

**Request Body:**
```javascript
{
  gr_no: "GR-001",
  gr_status: "Created",
  gr_date: "2026-01-13",
  po_id: ["po_id_123"],
  table_gr: [
    {
      item_id: "item_123",
      received_qty: 20,
      po_line_item_id: "po_line_123",
      // ... other fields
    }
  ]
}
```

**Backend Processing:**
1. Create GR document with `gr_status: "Created"`
2. Update PO line items:
   ```javascript
   UPDATE purchase_order
   SET table_po[i].created_received_qty = created_received_qty + received_qty
   WHERE id = po_id
   ```
3. Update PO header: `SET gr_status = "Created"`
4. **Do NOT** create inventory records

### 6.2 Update Created GR

**Endpoint:** `PUT /goods_receiving/:id`

**Request Body:**
```javascript
{
  // Updated GR data
  table_gr: [/* updated line items */]
}
```

**Backend Processing:**
1. Fetch original GR to calculate deltas
2. Calculate quantity_delta for each line
3. Update PO using deltas:
   ```javascript
   UPDATE purchase_order
   SET table_po[i].created_received_qty = created_received_qty + quantity_delta
   WHERE id = po_id
   ```
4. Update GR document

### 6.3 Promote Created GR to Received

**Endpoint:** `PUT /goods_receiving/:id/receive`

**Backend Processing:**
1. Validate quantities don't exceed PO limits
2. Migrate PO quantities:
   ```javascript
   UPDATE purchase_order
   SET
     table_po[i].created_received_qty = created_received_qty - received_qty,
     table_po[i].received_qty = received_qty + received_qty,
     table_po[i].line_status = calculateLineStatus()
   WHERE id = po_id
   ```
3. Generate batch numbers (if needed)
4. Create inventory records (item_batch_balance, item_balance)
5. Create putaway records (if required)
6. Update GR: `SET gr_status = "Received"`
7. Update PO: `SET gr_status = calculatePOGRStatus()`

### 6.4 Cancel Created GR

**Endpoint:** `POST /goods_receiving/bulk_cancel`

**Request Body:**
```javascript
{
  gr_ids: ["gr_id_1", "gr_id_2"]
}
```

**Backend Processing:**
1. Verify all GRs are in "Created" status
2. For each GR:
   - Reverse PO quantities
   - Update PO gr_status
   - Set GR status to "Cancelled"
3. Return success/failure counts

---

## 7. Testing Scenarios

### Test Case 1: Create and Complete Flow
```
1. Create PO with 100 qty
2. Create GR1 with 30 qty as "Created"
   ✓ PO created_received_qty = 30
   ✓ PO gr_status = "Created"
3. Save GR1 as "Received"
   ✓ PO created_received_qty = 0
   ✓ PO received_qty = 30
   ✓ PO gr_status = "Partially Received"
   ✓ Inventory created
```

### Test Case 2: Multiple Created GRs
```
1. Create PO with 100 qty
2. Create GR1 with 30 qty as "Created"
   ✓ PO created_received_qty = 30
3. Create GR2 with 40 qty as "Created"
   ✓ PO created_received_qty = 70
4. Auto-fill for GR3 should show 30 (100 - 70)
```

### Test Case 3: Edit Created GR
```
1. Create PO with 100 qty
2. Create GR1 with 30 qty as "Created"
   ✓ PO created_received_qty = 30
3. Edit GR1, change qty to 20
   ✓ Delta = -10
   ✓ PO created_received_qty = 20
4. Edit GR1, change qty to 50
   ✓ Delta = +30
   ✓ PO created_received_qty = 50
```

### Test Case 4: Cancel Created GR
```
1. Create PO with 100 qty
2. Create GR1 with 30 qty as "Created"
   ✓ PO created_received_qty = 30
3. Create GR2 with 20 qty as "Created"
   ✓ PO created_received_qty = 50
4. Cancel GR1
   ✓ PO created_received_qty = 20
   ✓ PO gr_status = "Created" (GR2 still exists)
5. Cancel GR2
   ✓ PO created_received_qty = 0
   ✓ PO gr_status = "Cancelled"
```

### Test Case 5: Over-Commitment Warning
```
1. Create PO with 100 qty (10% tolerance = 110 max)
2. Create GR1 with 60 qty as "Created"
   ✓ No warning
3. Create GR2 with 60 qty as "Created"
   ✓ Warning shown (total 120 > 110)
   ✓ Allow to proceed
4. Try to receive GR1 (60 qty)
   ✓ Success
   ✓ PO received_qty = 60
   ✓ PO created_received_qty = 60
5. Try to receive GR2 (60 qty)
   ✗ Error: Would exceed tolerance (120 > 110)
```

### Test Case 6: Edit Created GR - No False Warning
```
1. Create PO with 100 qty
2. Create GR1 with 100 qty as "Created"
   ✓ PO created_received_qty = 100
3. Edit GR1, change qty to 80
   ✓ Should NOT show over-commitment warning
   ✓ (Because GR1's original 100 is excluded from check)
   ✓ PO created_received_qty = 80
```

---

## 8. Common Pitfalls & Important Notes

### ⚠️ Critical: Delta-based Updates for Editing
**Problem:** When editing a Created GR, naively adding the new quantity will double-count.

**Wrong:**
```javascript
// This will add twice!
poLine.created_received_qty += grLine.received_qty;
```

**Correct:**
```javascript
// Calculate delta from original
const delta = newQty - originalQty;
poLine.created_received_qty += delta; // Can be negative
```

### ⚠️ Avoid Redundant Database Fetches
**Optimization:** When multiple functions need the original GR data (e.g., validation and save), fetch once and pass the data.

```javascript
// Fetch once at the beginning
const originalGR = await fetchOriginalGR(grId);

// Pass to multiple functions
await checkOverCommitment(newData, originalGR);
await saveGR(newData, originalGR);
```

### ⚠️ Exclude Self When Checking Over-Commitment in Edit Mode
Always subtract the current GR's original quantity from `created_received_qty` when checking over-commitment during edit.

### ⚠️ Do NOT Generate Batch Numbers for Created Status
Batch numbers should only be generated when transitioning to Received/Completed status.

### ⚠️ Do NOT Create Inventory Records for Created Status
- No item_batch_balance records
- No item_balance updates
- No putaway records
- No plant stock balance updates

### ⚠️ Single Source of Truth for Validation
When checking if line items are fully received, always check `received_qty` on PO line items (the source of truth), not denormalized copies elsewhere.

---

## 9. Mobile App Specific Considerations

### 9.1 Offline Support
If implementing offline mode:
- Store Created GRs locally with pending sync flag
- When syncing, ensure deltas are calculated correctly
- Handle conflicts if PO was updated on server

### 9.2 Performance
- Minimize database queries by batching PO updates
- Fetch original GR data once per edit session
- Use optimistic UI updates where possible

### 9.3 Error Handling
- Always validate quantities before sending to server
- Show clear error messages matching web app format
- Handle partial failures in bulk operations gracefully

### 9.4 User Permissions
Check user permissions for:
- Creating GRs as Created status
- Editing Created GRs
- Cancelling Created GRs
- Promoting Created to Received

---

## 10. Reference Implementation Files

For detailed code examples, refer to these web implementation files:

1. **GRsaveAsCreated.js** - Creating and editing Created GRs
2. **GRsaveAsComplete.js** - Transitioning Created to Received
3. **GRaddBatchLineItem.js** - Auto-fill and filtering logic
4. **GRhandleConvertGR.js** - Converting PO to GR with Created quantities
5. **Cancel.js** (Bulk Actions) - Cancelling Created GRs
6. **Cancel.js** (PO Bulk Actions) - Preventing PO cancellation with Created GRs
7. **ForceCompleted.js** (PO Bulk Actions) - Preventing PO force completion with Created GRs

---

## 11. Summary Checklist

- [ ] Add `created_received_qty` field to PO line items
- [ ] Add `gr_status` field to PO header
- [ ] Implement "Save as Created" button
- [ ] Implement delta-based updates for editing
- [ ] Auto-fill logic considers Created GRs
- [ ] Filter logic does NOT exclude lines with Created GRs
- [ ] Over-commitment warning (soft validation)
- [ ] Exclude self when checking over-commitment in edit mode
- [ ] Transition Created → Received migrates quantities correctly
- [ ] Cancel Created GR reverses PO quantities
- [ ] Do NOT generate batch numbers for Created status
- [ ] Do NOT create inventory for Created status
- [ ] PO operations check for Created GRs before cancellation/force completion
- [ ] UI shows Created status with appropriate styling
- [ ] All validation messages use HTML formatting

---

**Document Version:** 1.0
**Last Updated:** 2026-01-16
**For Questions:** Reference the web implementation files listed above
