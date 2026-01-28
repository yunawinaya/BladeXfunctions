# GD Delivered Status Implementation Guide

## Overview

This guide covers the logic for handling GD Delivered/Completed status, including inventory subtraction from the correct source (Reserved vs Unrestricted) and reserved table updates.

---

## Three Delivery Scenarios

### Scenario 1: Normal Flow (GD Created → Delivered)
**Situation**: GD was previously saved as "Created" status
- Reserved table has **Allocated** records (target_reserved_id = GD._id, status = "Allocated")
- Inventory is already in **Reserved** category

**Process**:
1. Find Allocated records for this GD
2. Update them: status = "Delivered", delivered_qty = quantity, open_qty = open_qty - quantity
3. Subtract inventory from **Reserved** category

**Example**:
```
Before:
- Reserved Table: 100 qty, status = "Allocated", open_qty = 100
- Inventory: 100 units in Reserved

After (deliver 100):
- Reserved Table: 100 qty, status = "Delivered", delivered_qty = 100, open_qty = 0
- Inventory: 100 units subtracted from Reserved → Out of system (shipped)
```

---

### Scenario 2: Direct Flow with Pending (GD → Delivered, skip Created)
**Situation**: GD goes straight to Delivered without Created status
- No Allocated records exist
- **Pending** records are available in reserved table

**Process**:
1. Find Pending records (priority: Production Receipt → Sales Order)
2. Update them: status = "Delivered", delivered_qty = quantity, open_qty = open_qty - quantity
3. Subtract inventory from **Reserved** category (Pending records mean inventory is in Reserved)

**Example**:
```
Before:
- Reserved Table: 100 qty, status = "Pending" (from SO), open_qty = 100
- Inventory: 100 units in Reserved

After (deliver 50):
- Reserved Table Record 1: 50 qty, status = "Delivered", delivered_qty = 50, open_qty = 0, target_reserved_id = GD._id
- Reserved Table Record 2: 50 qty, status = "Pending", open_qty = 50, target_reserved_id = null (split record)
- Inventory: 50 units subtracted from Reserved → Out of system
```

---

### Scenario 3: Direct Flow without Pending (GD → Delivered, no prior allocation)
**Situation**: GD goes straight to Delivered
- No Allocated records
- No Pending records available

**Process**:
1. Create new Reserved Table record with status = "Delivered"
2. Subtract inventory from **Unrestricted** category

**Example**:
```
Before:
- Reserved Table: (no records)
- Inventory: 100 units in Unrestricted

After (deliver 50):
- Reserved Table: New record - 50 qty, status = "Delivered", delivered_qty = 50, open_qty = 0
- Inventory: 50 units subtracted from Unrestricted → Out of system
```

---

## Workflow Structure

### Required Search Nodes (Pre-Loop)

#### Search 1: Fetch Allocated Records
**Node Name**: "Search Allocated Records"
**Collection**: `reserved_table`
**Filters**:
```
target_reserved_id = {{form:_id}}
status = "Allocated"
organization_id = {{form:organization_id}}
```

#### Search 2: Fetch Pending Records
**Node Name**: "Search Pending Records"
**Collection**: `reserved_table`
**Filters**:
```
plant_id = {{workflowparams:plant_id}}
organization_id = {{workflowparams:organization_id}}
material_id = {{workflowparams:material_id}}
bin_location = {{workflowparams:location_id}}
batch_id = {{workflowparams:batch_id}}
status = "Pending"
parent_id = {{workflowparams:parent_id}}
parent_line_id = {{workflowparams:parent_line_id}}
```

### Loop Through table_gd → temp_data

Inside the temp_data loop, call the GDdeliveredLogic.js as a code node.

### Process Results

#### Step 1: Update Reserved Table Records (if any)
**Condition**: `{{node:delivered_logic.recordsToUpdate}}` exists and length > 0

**Action**: Loop through recordsToUpdate and update each record in reserved_table

#### Step 2: Create Reserved Table Record (if any)
**Condition**: `{{node:delivered_logic.recordToCreate}}` is not null

**Action**: Create new record in reserved_table

#### Step 3: Process Inventory Movements
**Loop**: Through `{{node:delivered_logic.inventoryMovements}}`

For each inventory movement:
- **If source = "Reserved"**: Subtract from Reserved inventory
- **If source = "Unrestricted"**: Subtract from Unrestricted inventory

---

## Logic Flow Diagram

```
GD Delivered/Completed
    ↓
┌─────────────────────────────────────────────────────────────┐
│ PRE-LOOP: Search Allocated & Pending Records               │
│   - Search 1: Allocated (target_reserved_id = GD._id)      │
│   - Search 2: Pending (material, location, batch, parent)  │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ LOOP: table_gd → temp_data                                  │
│   ↓                                                          │
│   Execute GDdeliveredLogic.js                               │
│   ↓                                                          │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ IF has Allocated records                            │  │
│   │ → Update to status = "Delivered"                    │  │
│   │ → Subtract from Reserved inventory                  │  │
│   └─────────────────────────────────────────────────────┘  │
│   ↓                                                          │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ ELSE IF has Pending records                         │  │
│   │ → Update Pending to status = "Delivered"           │  │
│   │ → Subtract from Reserved inventory                  │  │
│   └─────────────────────────────────────────────────────┘  │
│   ↓                                                          │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ ELSE (no Allocated, no Pending)                     │  │
│   │ → Create new record status = "Delivered"           │  │
│   │ → Subtract from Unrestricted inventory             │  │
│   └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Return Value Structure

The GDdeliveredLogic.js returns:

```javascript
{
  code: "200" | "400",
  recordsToUpdate: [
    {
      _id: "record_id",
      status: "Delivered",
      delivered_qty: 50,
      open_qty: 0,
      // ... other fields
    }
  ],
  recordToCreate: {
    doc_type: "Good Delivery",
    status: "Delivered",
    reserved_qty: 50,
    delivered_qty: 50,
    open_qty: 0,
    // ... other fields
  } | null,
  inventoryMovements: [
    {
      source: "Reserved" | "Unrestricted",
      quantity: 50,
      operation: "subtract"
    }
  ],
  message: "Delivery processed successfully"
}
```

---

## Workflow Implementation Steps

### Step 1: Create Search Nodes (Before Loop)

Create two search nodes at the workflow level (before looping table_gd):

**Search Node 1**: Fetch Allocated Records
- Output variable: `allocatedRecords`

**Search Node 2**: Fetch Pending Records
- Output variable: `pendingRecords`
- **Note**: This search needs to be inside the temp_data loop OR you need to pass material_id, location_id, etc. as parameters

### Step 2: Create Loop Structure

```
Loop table_gd
  └─ Loop temp_data
      ├─ Search Allocated Records (for this line/temp_data)
      ├─ Search Pending Records (for this material/location/batch)
      ├─ Execute GDdeliveredLogic.js
      ├─ IF recordsToUpdate exists
      │   └─ Loop & Update Reserved Table
      ├─ IF recordToCreate exists
      │   └─ Create Reserved Table Record
      └─ Loop inventoryMovements
          ├─ IF source = "Reserved"
          │   └─ Subtract Inventory Workflow (category: Reserved)
          └─ IF source = "Unrestricted"
              └─ Subtract Inventory Workflow (category: Unrestricted)
```

### Step 3: Handle Inventory Movements

**Important**: Use the `inventoryMovements` array to determine which inventory category to subtract from.

**Why this matters**:
- If delivery comes from Allocated/Pending → Subtract from **Reserved**
- If delivery comes from direct (no prior allocation) → Subtract from **Unrestricted**
- If delivery is mixed (50 from Pending, 50 from Unrestricted) → Two separate subtractions

**Example Code Node**:
```javascript
const movements = {{node:delivered_logic.inventoryMovements}};

for (const movement of movements) {
  if (movement.source === "Reserved") {
    // Call Subtract Inventory Workflow
    await subtractInventory({
      inventory_category: "Reserved",
      quantity: movement.quantity,
      // ... other params
    });
  } else if (movement.source === "Unrestricted") {
    // Call Subtract Inventory Workflow
    await subtractInventory({
      inventory_category: "Unrestricted",
      quantity: movement.quantity,
      // ... other params
    });
  }
}
```

---

## Validation & Error Handling

### Validation 1: Quantity Check (Scenario 1)
**Issue**: User tries to deliver more than allocated
**Error**: "Cannot deliver X units. Only Y units are allocated for this item."
**Code**: 400

**Example**:
- Allocated: 50 units
- User tries to deliver: 100 units
- Result: Error message returned

### Validation 2: Multiple Pending Records
**Issue**: Multiple pending records from same source type
**Error**: "Multiple pending sales orders found" or "Multiple pending production receipts found"
**Code**: 400

---

## Key Improvements in This Logic

### 1. **Dual Inventory Source Tracking**
Returns `inventoryMovements` array that tells you exactly which inventory category to subtract from:
- `source: "Reserved"` - When delivery uses Allocated/Pending records
- `source: "Unrestricted"` - When delivery has no prior allocation

### 2. **Quantity Validation for Allocated**
Prevents over-delivery by checking:
```javascript
if (quantity > totalAllocatedQty) {
  return { code: "400", message: "Cannot deliver more than allocated" };
}
```

### 3. **Priority-Based Pending Consumption**
When using Pending records (Scenario 2):
- Priority 1: Production Receipt
- Priority 2: Sales Order
- Fallback: Unrestricted

### 4. **Proper Record Splitting**
When partial delivery from Pending:
- Update original record → status = "Delivered", delivered_qty = X
- Create new record → status = "Pending", remaining qty

### 5. **Complete Audit Trail**
Reserved table maintains:
- `status: "Delivered"` - Record was delivered
- `delivered_qty` - How much was delivered
- `open_qty` - How much remains (should be 0 for Delivered)
- `target_reserved_id` - Which GD document used this

---

## Testing Scenarios

### Test 1: Normal Flow (Allocated → Delivered)
**Setup**:
1. Create GD with status "Created" (this creates Allocated records)
2. Change GD status to "Delivered"

**Expected**:
- Reserved table: Allocated records updated to status = "Delivered"
- Inventory: Subtracted from Reserved category
- inventoryMovements: `[{ source: "Reserved", quantity: X }]`

### Test 2: Direct Delivery with Pending
**Setup**:
1. Create Pending records (from SO save as Issued)
2. Create GD and save directly as "Delivered" (skip Created)

**Expected**:
- Reserved table: Pending records updated to status = "Delivered"
- Inventory: Subtracted from Reserved category
- inventoryMovements: `[{ source: "Reserved", quantity: X }]`

### Test 3: Direct Delivery without Pending
**Setup**:
1. No Pending or Allocated records exist
2. Create GD and save directly as "Delivered"

**Expected**:
- Reserved table: New record created with status = "Delivered"
- Inventory: Subtracted from Unrestricted category
- inventoryMovements: `[{ source: "Unrestricted", quantity: X }]`

### Test 4: Mixed Delivery (Partial Pending + Unrestricted)
**Setup**:
1. Pending records exist with 50 qty
2. Create GD with 100 qty and save as "Delivered"

**Expected**:
- Reserved table:
  - Pending updated to status = "Delivered" (50 qty)
  - New record created status = "Delivered" (50 qty)
- Inventory:
  - 50 subtracted from Reserved
  - 50 subtracted from Unrestricted
- inventoryMovements: `[{ source: "Reserved", quantity: 50 }, { source: "Unrestricted", quantity: 50 }]`

### Test 5: Over-Delivery Validation (Should Fail)
**Setup**:
1. Create GD as "Created" with 50 qty (Allocated)
2. Try to change status to "Delivered" with 100 qty

**Expected**:
- Error: "Cannot deliver 100 units. Only 50 units are allocated for this item."
- Code: 400
- No inventory movement

---

## Files Reference

- **GDdeliveredLogic.js**: Core logic for delivery processing
- **SUBTRACT_INVENTORY Workflow**: Existing workflow for inventory subtraction
- **Reserved Table**: Database collection for tracking allocations

---

## Summary

The Delivered logic handles three scenarios intelligently:

1. **GD Created → Delivered**: Uses Allocated records, subtracts from Reserved
2. **GD → Delivered (with Pending)**: Uses Pending records, subtracts from Reserved
3. **GD → Delivered (no Pending)**: Creates new record, subtracts from Unrestricted

**Key Feature**: Returns `inventoryMovements` array that tells you exactly which inventory category to subtract from, supporting mixed scenarios (partial Reserved + partial Unrestricted).

**Validation**: Prevents over-delivery by checking allocated quantity before processing.

**Audit Trail**: Maintains complete history in reserved table with status, delivered_qty, and open_qty fields.
