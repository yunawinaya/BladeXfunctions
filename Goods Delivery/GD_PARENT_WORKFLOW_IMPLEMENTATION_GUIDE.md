# GD Save Parent Workflow Implementation Guide

## Overview

This guide shows the structure of the **parent workflow** that orchestrates the reserved table allocation process. The global function you've already created will be called inside the loop.

---

## Parent Workflow Structure

```
GD Save Event
    ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: PRE-LOOP - FETCH OLD ALLOCATED DATA               │
│ Purpose: Get baseline for re-allocation detection          │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: LOOP THROUGH TABLE_GD & TEMP_DATA                 │
│ Purpose: Process each temp_data item (allocation logic)    │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: POST-LOOP - CLEANUP ORPHANED ALLOCATIONS          │
│ Purpose: Convert deleted/changed items to Pending          │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### STEP 1: Create Pre-Loop Search Node

**Node Type**: Search Node
**Node Name**: "Fetch Old Allocated Records"
**Collection**: `reserved_table`

**Filters**:
```
target_reserved_id = {{form:_id}}
status = "Allocated"
organization_id = {{form:organization_id}}
```

**Output Variable**: Save result to a variable (e.g., `oldAllocatedRecords`)

**Purpose**: This fetches all currently allocated records for this GD document before we start processing the new temp_data. This allows us to detect what changed (re-allocation scenario).

---

### STEP 2: Create Loop Nodes

#### Loop 1: Loop through table_gd
**Node Type**: Loop
**Loop Source**: `{{form:table_gd}}`
**Node Name**: "Loop GD Lines"

##### Inside Loop 1: Loop through temp_data
**Node Type**: Loop
**Loop Source**: `{{line:temp_data}}`
**Node Name**: "Loop Temp Data"

**CRITICAL - Pass Parameters to Loop**:
When configuring this temp_data loop, you must pass the following parameters:

| Parameter Name | Value | Description |
|---------------|-------|-------------|
| `oldAllocatedData` | `{{node:fetch_old_allocated_records.data.data}}` | The old allocated records from Step 1 |
| `quantity` | `{{tempdata:quantity}}` | Quantity from current temp_data item |
| `parent_id` | `{{form:parent_id}}` | Parent SO/PR ID |
| `parent_line_id` | `{{form:parent_line_id}}` | Parent line ID |
| `parent_no` | `{{form:parent_no}}` | Parent document number |
| `doc_id` | `{{form:_id}}` | GD document ID |
| `doc_line_id` | `{{line:_id}}` | GD line ID (from table_gd) |
| `doc_no` | `{{form:doc_no}}` | GD document number |
| `material_id` | `{{tempdata:material_id}}` | Material ID |
| `itemData` | `{{tempdata:itemData}}` | Item data object |
| `batch_id` | `{{tempdata:batch_id}}` | Batch ID |
| `location_id` | `{{tempdata:location_id}}` | Location ID |
| `material_uom` | `{{tempdata:material_uom}}` | UOM |
| `doc_date` | `{{form:doc_date}}` | Document date |
| `index` | `{{loopIndex}}` | Loop index |
| `plant_id` | `{{form:plant_id}}` | Plant ID |
| `organization_id` | `{{form:organization_id}}` | Organization ID |
| `remark` | `{{tempdata:remark}}` | Remark |
| `transaction_type` | `"Good Delivery"` or appropriate value | Transaction type |

##### Inside Temp Data Loop: Call Global Function
**Node Type**: Workflow Node (call your global function)
**Workflow**: The workflow you already created with the allocation logic
**Node Name**: "Execute Allocation Logic"

This is where your existing global function workflow runs (the JSON you showed me).

---

### STEP 3: Create Post-Loop Cleanup Node

**Node Type**: Code Node
**Node Name**: "Cleanup Orphaned Allocations"
**Position**: AFTER both loops complete (at the same level as Step 1)

**Code**: Use the CleanupOrphanedAllocations.js file content

**Key Points**:
- This runs ONCE after all table_gd and temp_data loops complete
- Finds allocated records that no longer have matching temp_data items
- Converts those orphaned allocations back to "Pending" status

---

## Visual Workflow Structure in Your Low-Code Platform

```
Parent Workflow: "GD Save - Reserved Table Management"

├─ [Search Node] Fetch Old Allocated Records
│   └─ Collection: reserved_table
│   └─ Filters: target_reserved_id, status=Allocated, organization_id
│   └─ Output: oldAllocatedRecords
│
├─ [Loop Node] Loop GD Lines
│   └─ Source: {{form:table_gd}}
│   │
│   └─ [Loop Node] Loop Temp Data
│       └─ Source: {{line:temp_data}}
│       └─ Parameters: oldAllocatedData + all other params ⚠️ CRITICAL
│       │
│       └─ [Workflow Node] Execute Allocation Logic
│           └─ Calls: Your global function workflow
│           └─ Returns: recordsToUpdate, recordToCreate
│           │
│           └─ [IF] Handle recordsToUpdate
│           └─ [IF] Handle recordToCreate
│           └─ [IF] Handle inventory movements
│
└─ [Code Node] Cleanup Orphaned Allocations
    └─ Runs AFTER all loops complete
    └─ Code: CleanupOrphanedAllocations.js
```

---

## Critical Configuration Checklist

Before testing, verify these configurations:

### ✅ Pre-Loop Search Node
- [ ] Searches reserved_table
- [ ] Filters by target_reserved_id = {{form:_id}}
- [ ] Filters by status = "Allocated"
- [ ] Filters by organization_id = {{form:organization_id}}
- [ ] Output saved to a variable

### ✅ Loop Configuration
- [ ] Outer loop iterates table_gd
- [ ] Inner loop iterates temp_data
- [ ] **Inner loop passes oldAllocatedData parameter** ⚠️ MOST IMPORTANT
- [ ] All other parameters (quantity, material_id, etc.) are passed correctly

### ✅ Post-Loop Cleanup
- [ ] Positioned AFTER both loops (not inside)
- [ ] Uses CleanupOrphanedAllocations.js code
- [ ] Has access to {{form:_id}}, {{form:organization_id}}, {{form:table_gd}}

---

## Testing Sequence

After implementation, test in this order:

### Test 1: Initial Allocation (Baseline)
1. Create new GD with 1 line, 1 temp_data item
2. Verify:
   - oldAllocatedRecords is empty (pre-loop fetch finds nothing)
   - Allocation logic executes NEW ALLOCATION path
   - Record created in reserved_table with status = "Allocated"

### Test 2: Re-allocation - Increase Quantity
1. Edit the GD from Test 1
2. Increase temp_data quantity from 10 → 15
3. Save
4. Verify:
   - oldAllocatedRecords contains the 10 qty record (pre-loop fetch finds it)
   - Allocation logic executes RE-ALLOCATION path
   - netChange = +5 calculated correctly
   - Additional 5 qty allocated (no duplicate of original 10)

### Test 3: Re-allocation - Decrease Quantity
1. Edit the GD from Test 2
2. Decrease temp_data quantity from 15 → 8
3. Save
4. Verify:
   - oldAllocatedRecords contains the 15 qty record
   - netChange = -7 calculated correctly
   - 7 qty released: status changed from "Allocated" → "Pending"
   - 8 qty remains "Allocated"

### Test 4: Re-allocation - Delete Temp Data Item
1. Edit the GD from Test 3
2. Remove the temp_data item entirely (delete from line)
3. Save
4. Verify:
   - Inner loop doesn't process deleted item (it's not in temp_data anymore)
   - Post-loop cleanup identifies orphaned allocation
   - Orphaned allocation converted: "Allocated" → "Pending"
   - No more allocations with target_reserved_id = this GD

### Test 5: Re-allocation - Change Location
1. Edit the GD
2. Change location_id in temp_data from Location A → Location B
3. Save
4. Verify:
   - Inner loop doesn't match old record (different bin_location in matching key)
   - Inner loop creates NEW allocation for Location B
   - Post-loop cleanup converts Location A allocation to "Pending" (orphaned)

---

## Common Issues & Troubleshooting

### Issue 1: Duplicate Allocations Created
**Symptom**: Every save creates new allocated records instead of updating
**Cause**: `oldAllocatedData` parameter not passed to loop
**Fix**: Verify Step 2 - ensure loop configuration includes `oldAllocatedData: {{node:...}}`

### Issue 2: Orphaned Allocations Not Cleaned Up
**Symptom**: Deleted temp_data items remain "Allocated" forever
**Cause**: Post-loop cleanup not running or positioned incorrectly
**Fix**: Ensure cleanup node is AFTER loops, not inside them

### Issue 3: Re-allocation Logic Never Executes
**Symptom**: Always creates new allocations, never updates existing
**Cause**: Pre-loop search returns empty or not saved correctly
**Fix**: Check pre-loop search filters, verify output variable is accessible to loop

### Issue 4: Wrong Field References in Loop
**Symptom**: Errors like "undefined field" during execution
**Cause**: Incorrect template syntax ({{line:...}} vs {{tempdata:...}} vs {{form:...}})
**Fix**: Review parameter mapping in Step 2, ensure correct context

---

## File References

- **Global Function Workflow**: The JSON you showed me (already created)
- **Workflow.js**: `/Users/yunawinaya/Developer/BladeXfunctions/Workflow.js` (already created)
- **CleanupOrphanedAllocations.js**: `/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/CleanupOrphanedAllocations.js` (already created)
- **This Guide**: Reference for parent workflow implementation

---

## Summary: What You Need to Create

In your low-code platform, create a new workflow with these 3 phases:

1. **Pre-Loop Search**: Fetch old allocated records → save to variable
2. **Nested Loops**: table_gd → temp_data → pass oldAllocatedData + other params → call global function
3. **Post-Loop Code**: Run cleanup to convert orphaned allocations

**Most Critical Step**: When configuring the inner loop (temp_data), you MUST pass the `oldAllocatedData` parameter with value `{{node:fetch_old_allocated_records.data.data}}` or equivalent reference to the pre-loop search result.

Without this parameter, re-allocation will not work and duplicate allocations will be created every time a user edits a GD.
