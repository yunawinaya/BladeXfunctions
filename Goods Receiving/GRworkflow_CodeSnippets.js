/**
 * GR Workflow Code Snippets - Clean Copy-Paste Version
 * =====================================================
 * Copy these snippets directly into your workflow nodes.
 */

// ============================================================
// 1. VALIDATE LOCATION & CATEGORY (code_node_Ga3BZDyy)
// ============================================================

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
    locationMessage = `Location is required for item ${i + 1} in Goods Receiving`
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
    categoryMessage = `Category is required for item ${i + 1} in Goods Receiving`
    break;
  }
}

return {
  locationFailed: locationFailed,
  categoryFailed: categoryFailed,
  locationMessage: locationMessage,
  categoryMessage: categoryMessage
};


// ============================================================
// 2. SUBFORM PREPARATION (code_node_D9IbUV8t) - FULL SCRIPT
// ============================================================

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


// ============================================================
// 3. RESPONSE_JSON FOR SUBFORM PREPARATION NODE
// ============================================================
// Add these entries to the response_json array:

/*
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
*/
