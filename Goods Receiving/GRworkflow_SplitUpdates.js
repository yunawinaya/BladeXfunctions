/**
 * GR Workflow Updates for Split Functionality
 * ============================================
 *
 * This file contains the script code updates needed for the GR workflow.
 * Apply these changes in your low-code platform's workflow editor.
 *
 * CRITICAL ISSUES IDENTIFIED & SOLUTIONS:
 * =======================================
 *
 * ISSUE 1: PO Line Double-Counting
 * --------------------------------
 * The workflow updates PO line by ADDING each row's quantity to existing received_qty.
 * For split items, this causes DOUBLE-COUNTING:
 *   - Parent (qty=100) updates PO: received_qty = 0 + 100 = 100 ✓
 *   - Child1 (qty=50) updates PO: received_qty = 100 + 50 = 150 ✗ WRONG!
 *
 * SOLUTION 1:
 * - Split PARENT: Update PO line + Create batch + Skip inventory
 * - Split CHILD: Skip PO line update + Get cached batch + Create inventory
 * - Regular row: Normal flow (PO update + Create batch + Create inventory)
 *
 * ISSUE 2: Parent Quantity Out of Sync with Children
 * --------------------------------------------------
 * After splitting, users can edit child quantities. Example:
 *   - Split creates: Parent=100, Child1=50, Child2=50
 *   - User edits: Child1=30, Child2=20
 *   - Result: Parent still shows 100, but actual total is 50
 *
 * SOLUTION 2 (in GRworkflowCompleted.js):
 * - Before calling workflow, recalculate parent's received_qty from children
 * - This ensures PO line gets updated with the ACTUAL total quantity
 */

// ============================================================
// 1. VALIDATE LOCATION & CATEGORY (code_node_Ga3BZDyy)
// ============================================================
// Replace the existing script with this updated version:

const validateLocationCategory = `
const allData = {{node:code_node_4r2Fv9G5.data.allData}};
const subformData = allData.table_gr

let locationFailed = 0;
let categoryFailed = 0;
let locationMessage
let categoryMessage

for (let i = 0; i < subformData.length; i++) {
  const item = subformData[i];

  // Skip split parent rows (they don't have location)
  if (item.is_split === "Yes" && item.parent_or_child === "Parent") {
    continue;
  }

  if (!item.location_id) {
    locationFailed = 1;
    locationMessage = \`Location is required for item \${i + 1} in Goods Receiving\`
    break;
  }
}

for (let i = 0; i < subformData.length; i++) {
  const item = subformData[i];

  // Skip split parent rows
  if (item.is_split === "Yes" && item.parent_or_child === "Parent") {
    continue;
  }

  if (!item.inv_category) {
    categoryFailed = 1;
    categoryMessage = \`Category is required for item \${i + 1} in Goods Receiving\`
    break;
  }
}

return {
  locationFailed: locationFailed,
  categoryFailed: categoryFailed,
  locationMessage: locationMessage,
  categoryMessage: categoryMessage
};
`;


// ============================================================
// 2. SUBFORM PREPARATION (code_node_D9IbUV8t)
// ============================================================
// Add these fields to the existing return statement:

const subformPreparationAdditions = `
// ============================================================
// FULL UPDATED Subform Preparation SCRIPT
// ============================================================
// Replace the ENTIRE return statement with this updated version:

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

const page_status = {{workflowparams:pageStatus}};
const gr_status = {{node:code_node_4r2Fv9G5.data.gr_status}}
let allData;

if (page_status === "Add") {
  const rawData = {{node:add_node_nGMSu41b.data}};
  allData = Array.isArray(rawData) ? rawData[0] : rawData;
} else if (page_status === "Edit") {
  allData = {{node:get_node_UeM3HpzR.data.data}};
} else {
  allData = {{node:code_node_4r2Fv9G5.data.allData}};
}

const subformData = allData.table_gr;
const currentIndexRaw = {{node:get_cache_node_5vPHf6xv.data}};
const index = currentIndexRaw ? parseInt(currentIndexRaw, 10) : 0;

const plant_id = allData.plant_id;
const organization_id = allData.organization_id;
const gr_no = allData.gr_no;
const doc_date = allData.gr_date;

const item = subformData[index];
const material_id = item.item_id;
const material_uom = item.item_uom || item.ordered_uom;
const quantity = item.received_qty;
const unit_price = item.unit_price;
const location_id = item.location_id;
const batch_no = item.item_batch_no || null;
const remark = item.line_remark_1 || null;
const remark2 = item.line_remark_2 || null;
const remark3 = item.line_remark_3 || null;
const inventory_category = item.inv_category || "Unrestricted";
const manufacturing_date = item.manufacturing_date || null;
const expired_date = item.expired_date || null;
const po_no = item.line_po_no || "";
const po_id = item.line_po_id || "";
const po_line_id = item.po_line_item_id || "";
const onOrderQty = roundQty(item.base_received_qty) || roundQty(item.received_qty) || 0;

// === NEW: Split detection fields ===
const is_split = item.is_split || "No";
const parent_or_child = item.parent_or_child || "Parent";
const parent_index = item.parent_index;

// === UPDATED: skipInventory logic ===
// Skip if: no material_id OR split parent row
const isSplitParent = is_split === "Yes" && parent_or_child === "Parent";
const skipInventory = (!material_id || isSplitParent) ? 1 : 0;

// === NEW: isChild flag for easier branching ===
const isChild = parent_or_child === "Child" ? 1 : 0;

return {
  skipInventory: skipInventory,
  plant_id: plant_id,
  organization_id: organization_id,
  gr_no: gr_no,
  page_status: page_status,
  material_id: material_id,
  material_uom: material_uom,
  quantity: quantity,
  unit_price: unit_price,
  location_id: location_id,
  batch_no: batch_no,
  inventory_category: inventory_category,
  doc_date: doc_date,
  remark: remark,
  remark2: remark2,
  remark3: remark3,
  index: index,
  nextIndex: index + 1,
  manufacturing_date: manufacturing_date,
  expired_date: expired_date,
  po_no: po_no,
  po_id: po_id,
  po_line_id: po_line_id,
  onOrderQty: onOrderQty,
  grData: allData,
  grItem: item,

  // === NEW split fields ===
  is_split: is_split,
  parent_or_child: parent_or_child,
  parent_index: parent_index,
  isChild: isChild,
  isSplitParent: isSplitParent ? 1 : 0,
};
`;


// ============================================================
// 3. NEW WORKFLOW STRUCTURE INSIDE LOOP SUBFORM
// ============================================================
// After "Subform Preparation" node, add the following branching logic:

const workflowStructure = `
WORKFLOW STRUCTURE CHANGES (DETAILED):
======================================

The workflow needs 3 distinct paths:
1. Split PARENT: Update PO + Create batch + Cache batch_id + SKIP inventory
2. Split CHILD: Get cached batch_id + SKIP PO update + Create inventory
3. Regular row: Create batch + Update PO + Create inventory

MODIFIED FLOW INSIDE "Loop SubForm":
------------------------------------

After "Subform Preparation" node, REPLACE the existing "IF Skip Inventory" logic:

╔═══════════════════════════════════════════════════════════════════════════╗
║  NEW IF NODE: "IF Split Parent"                                           ║
║  Condition: is_split === "Yes" && parent_or_child === "Parent"            ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  TRUE BRANCH (Split Parent):                                              ║
║  ├─> Add Batch Record (add_node to "batch")                               ║
║  ├─> Cache Batch ID (set_cache_node)                                      ║
║  │     Key: batch_id_{{parent_index}}_{{unique}}                          ║
║  ├─> Get PO Data                                                          ║
║  ├─> Get PO Line Data                                                     ║
║  ├─> PO Data Preparation                                                  ║
║  ├─> Update PO Line                                                       ║
║  └─> SKIP Add Inventory (parent doesn't create inventory)                 ║
║                                                                           ║
║  FALSE BRANCH: Continue to "IF Child Row" check...                        ║
╚═══════════════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════════════╗
║  NEW IF NODE: "IF Child Row"                                              ║
║  Condition: parent_or_child === "Child"                                   ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  TRUE BRANCH (Split Child):                                               ║
║  ├─> Get Cached Batch ID (get_cache_node)                                 ║
║  │     Key: batch_id_{{parent_index}}_{{unique}}                          ║
║  ├─> Get Item Data                                                        ║
║  ├─> Add Inventory Workflow (use cached batch_id)                         ║
║  ├─> IF Inspection Lot → Create Inspection                                ║
║  ├─> Update GR Line Item                                                  ║
║  └─> SKIP PO Line Update (already done by parent)                         ║
║                                                                           ║
║  FALSE BRANCH (Regular non-split row): Normal existing flow               ║
║  ├─> Add Batch Record (add_node to "batch")                               ║
║  ├─> All existing logic (PO update, Add Inventory, etc.)                  ║
╚═══════════════════════════════════════════════════════════════════════════╝

SUMMARY OF WHAT EACH ROW TYPE DOES:
===================================
| Action              | Split Parent | Split Child | Regular Row |
|---------------------|--------------|-------------|-------------|
| Create Batch Record | YES          | NO (cached) | YES         |
| Cache Batch ID      | YES          | GET         | NO          |
| Update PO Line      | YES          | NO          | YES         |
| Add Inventory       | NO           | YES         | YES         |
| Create Inspection   | NO           | YES (if QI) | YES (if QI) |
| Create Putaway      | NO           | YES (if PA) | YES (if PA) |
`;


// ============================================================
// 4. BATCH RECORD DATA STRUCTURE (for add_node)
// ============================================================

const batchRecordStructure = `
BATCH RECORD DATA (for add_node to "batch" collection):
=======================================================

Collection: batch

Fields to set:
{
  "batch_number": "{{node:code_node_D9IbUV8t.data.batch_no}}",
  "material_id": "{{node:code_node_D9IbUV8t.data.material_id}}",
  "initial_quantity": "{{node:code_node_D9IbUV8t.data.quantity}}",
  "transaction_no": "{{node:code_node_D9IbUV8t.data.gr_no}}",
  "plant_id": "{{node:code_node_D9IbUV8t.data.plant_id}}",
  "organization_id": "{{node:code_node_D9IbUV8t.data.organization_id}}",
  "manufacturing_date": "{{node:code_node_D9IbUV8t.data.manufacturing_date}}",
  "expired_date": "{{node:code_node_D9IbUV8t.data.expired_date}}"
}

Note: The add_node will return the created record in data[0].id
`;


// ============================================================
// 5. ADD INVENTORY WORKFLOW UPDATE (workflow_node_7Ojf9JlE)
// ============================================================

const addInventoryUpdate = `
ADD INVENTORY WORKFLOW UPDATE:
==============================

Change the batch_number parameter to batch_id:

BEFORE:
{
  "prop": "batch_number",
  "valueType": "field",
  "value": "{{node:code_node_D9IbUV8t.data.batch_no}}"
}

AFTER (for regular rows & split children):
{
  "prop": "batch_id",
  "valueType": "field",
  "value": "{{node:add_node_XXX.data[0].id}}"  // For regular rows
  // OR
  "value": "{{node:get_cache_node_XXX.data}}"  // For child rows (from cache)
}
`;


// ============================================================
// 6. INSPECTION AND PUTAWAY HANDLING FOR SPLIT ROWS
// ============================================================

const inspectionAndPutaway = `
INSPECTION & PUTAWAY HANDLING FOR SPLIT ROWS:
==============================================

CURRENT WORKFLOW LOGIC:
-----------------------
1. IF Inspection Lot (if_mKqJdVJn):
   - Condition: receiving_inspection === 1 AND inventory_category === "Quality Inspection"
   - Creates inspection record using: workflow_node_7Ojf9JlE.data.batchId
   - Happens PER ROW inside the loop

2. IF Create Putaway (if_a8rItRtZ):
   - Condition: putaway_required === 1 AND auto_trigger_to === 1 AND inventory_category !== "Quality Inspection"
   - Adds line item to putaway cache using: workflow_node_7Ojf9JlE.data.batchId
   - Happens PER ROW inside the loop
   - At end of workflow: Auto Create Putaway creates the putaway document from cached items

KEY INSIGHT:
------------
Both Inspection and Putaway depend on data from Add Inventory workflow (workflow_node_7Ojf9JlE),
specifically the batchId returned from inventory creation.

SPLIT ROW HANDLING:
-------------------
| Row Type     | Add Inventory | Inspection      | Putaway         |
|--------------|---------------|-----------------|-----------------|
| Split Parent | NO            | SKIP            | SKIP            |
| Split Child  | YES           | YES (if QI)     | YES (if config) |
| Regular      | YES           | YES (if QI)     | YES (if config) |

WHY SPLIT PARENT SKIPS INSPECTION/PUTAWAY:
------------------------------------------
1. Split parent does NOT call Add Inventory workflow
2. No batchId available from workflow_node_7Ojf9JlE
3. No inventory record exists for parent (children have the inventory)
4. Inspection and Putaway should be created per CHILD (each has its own location/qty)

NO CHANGES NEEDED TO INSPECTION/PUTAWAY NODES:
----------------------------------------------
The existing IF conditions will naturally work because:
- Split parent skips Add Inventory → skipInventory path
- The existing "IF Skip Inventory" (or new "IF Split Parent") already bypasses:
  - Add Inventory workflow
  - All nodes AFTER Add Inventory (including Inspection and Putaway)

IMPORTANT: The Inspection and Putaway nodes are INSIDE the skipInventory=0 branch,
so they will only execute for:
- Split CHILDREN (call Add Inventory → proceed to Inspection/Putaway)
- Regular rows (call Add Inventory → proceed to Inspection/Putaway)

VERIFICATION CHECKLIST:
-----------------------
☐ Split parent: No inspection record created
☐ Split parent: No putaway line item added
☐ Split child 1: Inspection created (if QI) with child's batch_id
☐ Split child 2: Inspection created (if QI) with same batch_id (from cache)
☐ Split child 1: Putaway line added (if config) with child's location
☐ Split child 2: Putaway line added (if config) with child's location
☐ Final putaway document has ALL child line items (not parent)
`;


// ============================================================
// 7. CONDITION FOR SKIPPING BATCH CREATION (if needed)
// ============================================================

const skipBatchCondition = `
SKIP BATCH CREATION CONDITION:
==============================

Do NOT create batch record if:
- batch_no is null, empty, or "-"
- skipInventory === 1

Add this check before add_node for batch:

IF Expression:
'{{node:code_node_D9IbUV8t.data.batch_no}}' !== ''
&& '{{node:code_node_D9IbUV8t.data.batch_no}}' !== '-'
&& '{{node:code_node_D9IbUV8t.data.batch_no}}' !== null
`;

// ============================================================
// 8. ADDITIONAL NODES NEEDED
// ============================================================

const additionalNodes = `
NEW NODES TO ADD IN WORKFLOW:
=============================

1. IF NODE: "IF Split Parent"
   ─────────────────────────
   Location: After Subform Preparation, BEFORE existing IF Skip Inventory

   Condition Type: ConditionRule
   Filter:
   - node.code_node_D9IbUV8t.data.is_split === "Yes"
   - AND node.code_node_D9IbUV8t.data.parent_or_child === "Parent"

   TRUE blocks:
   - add_node (batch) → Add Batch Record
   - set_cache_node → Cache Batch ID
   - Existing PO update logic (copy from skipInventory=1 branch)

   FALSE blocks: Continue to next IF check

2. IF NODE: "IF Child Row"
   ───────────────────────
   Location: Inside FALSE branch of "IF Split Parent"

   Condition Type: ConditionRule
   Filter:
   - node.code_node_D9IbUV8t.data.parent_or_child === "Child"

   TRUE blocks:
   - get_cache_node → Get Batch ID (use parent_index in key)
   - Item data fetch
   - Add Inventory Workflow (use cached batch_id)
   - Inspection lot logic (if needed)
   - Update GR Line Item
   - NO PO LINE UPDATE

   FALSE blocks: Regular non-split row (existing logic + batch creation)

3. ADD NODE: "Add Batch Record"
   ────────────────────────────
   Collection: batch

   For SPLIT PARENT and REGULAR rows only (not children)

4. SET CACHE NODE: "Cache Batch ID"
   ─────────────────────────────────
   For SPLIT PARENT only
   Key: batch_id_{{node:code_node_D9IbUV8t.data.parent_index}}_{{node:code_node_LFPr1wQW.data.unique}}
   Value: {{node:add_node_XXX.data[0].id}}

5. GET CACHE NODE: "Get Batch ID"
   ───────────────────────────────
   For SPLIT CHILD only
   Key: batch_id_{{node:code_node_D9IbUV8t.data.parent_index}}_{{node:code_node_LFPr1wQW.data.unique}}
`;


// ============================================================
// 9. RESPONSE_JSON UPDATES FOR SUBFORM PREPARATION
// ============================================================

const responseJsonUpdates = `
ADD THESE TO response_json OF Subform Preparation NODE:
=======================================================

{
  "key": "new_is_split",
  "name": "is_split",
  "title": "is_split",
  "description": "",
  "bsonType": "string",
  "isExpand": false
},
{
  "key": "new_parent_or_child",
  "name": "parent_or_child",
  "title": "parent_or_child",
  "description": "",
  "bsonType": "string",
  "isExpand": false
},
{
  "key": "new_parent_index",
  "name": "parent_index",
  "title": "parent_index",
  "description": "",
  "bsonType": "int",
  "isExpand": false
},
{
  "key": "new_isChild",
  "name": "isChild",
  "title": "isChild",
  "description": "",
  "bsonType": "int",
  "isExpand": false
},
{
  "key": "new_isSplitParent",
  "name": "isSplitParent",
  "title": "isSplitParent",
  "description": "",
  "bsonType": "int",
  "isExpand": false
}
`;


// ============================================================
// 10. COMPLETE CHECKLIST
// ============================================================

const checklist = `
IMPLEMENTATION CHECKLIST:
=========================

CLIENT-SIDE (GRworkflowCompleted.js):
☑ Update batch generation loop to handle split rows (DONE)
☑ Recalculate parent received_qty from children before workflow (DONE)

WORKFLOW NODES TO MODIFY:
☐ 1. Validate Location & Category - Skip split parent rows
☐ 2. Subform Preparation - Add split detection fields + update script
☐ 3. Subform Preparation - Add response_json entries for new fields

WORKFLOW NODES TO ADD:
☐ 4. IF Split Parent node (after Subform Preparation)
☐ 5. Add Batch Record node (for parent & regular rows)
☐ 6. Set Cache Batch ID node (for parent rows)
☐ 7. IF Child Row node
☐ 8. Get Cache Batch ID node (for child rows)

WORKFLOW MODIFICATIONS:
☐ 9. Split Parent TRUE branch: PO update + batch creation + cache + skip inventory
☐ 10. Child TRUE branch: get cached batch + inventory only (no PO update)
☐ 11. Regular FALSE branch: batch creation + existing full flow
☐ 12. Update Add Inventory calls to use batch_id instead of batch_number

TESTING:
☐ 13. Test regular (non-split) GR - should work as before
☐ 14. Test single split group (1 parent + 2 children)
☐ 15. Test multiple split groups in same GR
☐ 16. Test mixed (split + non-split items in same GR)
☐ 17. Verify PO line received_qty is correct (no double-counting)
☐ 18. Verify batch records in database (one per split group)
☐ 19. Verify inventory records (one per child, same batch_id)

INSPECTION TESTING (when inv_category = "Quality Inspection"):
☐ 20. Split parent: NO inspection lot created
☐ 21. Split children: Each creates inspection lot with same batch_id
☐ 22. Inspection lot table_insp_mat: Has child's qty and location
☐ 23. Regular row: Creates inspection lot normally

PUTAWAY TESTING (when putaway_required = 1, auto_trigger_to = 1):
☐ 24. Split parent: NOT added to putaway line items
☐ 25. Split children: Each added to putaway line items
☐ 26. Putaway document table_putaway_item: Contains all children (not parent)
☐ 27. Each putaway line has correct source_bin (child's location_id)
☐ 28. Regular row: Added to putaway normally
`;

console.log("GR Workflow Split Updates - Documentation File");
console.log("Apply these changes in your low-code platform workflow editor.");
console.log("\n" + checklist);
