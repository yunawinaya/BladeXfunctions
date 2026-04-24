/**
 * GDProcessTable_batchFetch.js
 *
 * PURPOSE: Replace multiple database queries inside loops with a SINGLE batch fetch
 * USAGE: Add as a code node BEFORE the Loop Table in GD_PROCESS_TABLE workflow
 *
 * WORKFLOW CHANGES REQUIRED:
 * 1. Add search nodes BEFORE this code node to fetch:
 *    - All Items (using IN clause with all unique material_ids)
 *    - All Allocated records for this GD
 *    - All Pending records (non-GD/PP doc_types)
 * 2. This code node processes the fetched data into Maps for O(1) lookup
 * 3. Remove the individual "Get itemData" queries inside the loop
 *
 * INPUT (from workflow params and previous search nodes):
 * - workflowparams:tableData - the table_gd array
 * - node:search_all_items.data.data - all items fetched in batch
 * - node:search_all_allocated.data.data - all allocated records
 * - node:search_all_pending.data.data - all pending records
 *
 * OUTPUT: Pre-processed data ready for batch allocation processing
 */

const tableData = {{workflowparams:tableData}} || [];
const isGDPP = {{workflowparams:isGDPP}} || 0;
const docId = {{workflowparams:doc_id}};
const docNo = {{workflowparams:doc_no}};
const plantId = {{workflowparams:plant_id}};
const organizationId = {{workflowparams:organization_id}};
const saveAs = {{workflowparams:saveAs}};
const docDate = {{workflowparams:doc_date}};
const parentId = {{workflowparams:parent_id}};
const parentNo = {{workflowparams:parent_no}};
const pickingPlanId = {{workflowparams:picking_plan_id}} || "";
const isPacking = {{workflowparams:isPacking}} || 0;

// Data from batch search nodes (these need to be added to workflow)
const allItemsData = {{node:search_node_muUXSBRg.data.data}} || [];
const allAllocatedData = isGDPP === 0 ? {{node:search_node_r3NiR6B7.data.data}} : {{node:search_node_NxFJeRXS.data.data}} || [];
const allPendingData = {{node:search_node_QdY1FLLA.data.data}} || [];

// Helper function to safely parse JSON
const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    if (typeof jsonString === 'object') return jsonString || defaultValue;
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    return defaultValue;
  }
};

// Create item lookup Map (material_id -> itemData) for internal use in this code node
const itemDataMap = {};
for (const item of allItemsData) {
  itemDataMap[item.id] = item;
}
// Note: We pass allItemsData as array to next node (workflow can't handle object maps)

// Pre-process table data: extract unique material_ids and group temp_qty_data
const processedTableData = [];
const allGroupKeys = [];

for (let tableIndex = 0; tableIndex < tableData.length; tableIndex++) {
  const item = tableData[tableIndex];
  if (!item.material_id) continue;

  const tempQtyData = parseJsonSafely(item.temp_qty_data);
  if (tempQtyData.length === 0) {
    processedTableData.push({
      tableIndex,
      item,
      itemData: itemDataMap[item.material_id] || null,
      groupedTempData: {},
      groupKeys: [],
      skipProcessing: true,
      skipReason: "No temp_qty_data"
    });
    continue;
  }

  const itemData = itemDataMap[item.material_id];
  if (!itemData) {
    processedTableData.push({
      tableIndex,
      item,
      itemData: null,
      groupedTempData: {},
      groupKeys: [],
      skipProcessing: true,
      skipReason: "Item not found"
    });
    continue;
  }

  const isBatchManagedItem = itemData.item_batch_management === 1;

  // Group temp_qty_data by location + batch + handling_unit combination
  const groupedTempData = {};
  for (const temp of tempQtyData) {
    let groupKey = isBatchManagedItem && temp.batch_id
      ? `${temp.location_id}|${temp.batch_id}`
      : temp.location_id;

    // Include handling_unit_id in key to keep HU and loose separate
    if (temp.handling_unit_id) {
      groupKey += `|hu-${temp.handling_unit_id}`;
    }

    if (!groupedTempData[groupKey]) {
      groupedTempData[groupKey] = {
        location_id: temp.location_id,
        batch_id: temp.batch_id || null,
        handling_unit_id: temp.handling_unit_id || null,
        totalQty: 0,
      };
    }

    groupedTempData[groupKey].totalQty += parseFloat(
      temp.gd_quantity || temp.to_quantity || temp.quantity || 0
    );
  }

  const groupKeys = Object.keys(groupedTempData);

  // Extract common fields from table item
  const isPickingPlan = isGDPP === 1;
  const material_uom = isPickingPlan
    ? item.to_order_uom_id || item.picking_plan_uom_id
    : item.gd_order_uom_id || item.good_delivery_uom_id;

  const processedItem = {
    tableIndex,
    item,
    itemData,
    groupedTempData,
    groupKeys,
    skipProcessing: false,
    // Pre-extracted fields for allocation processing
    material_id: item.material_id,
    material_uom,
    parent_id: item.line_so_id || "",
    parent_line_id: item.so_line_item_id || "",
    doc_line_id: item.id || "",
    remark: item.line_remark_1 || "",
    picking_plan_line_id: item.pp_line_item_id || "",
    line_pp_id: item.line_pp_id || "",
    isBatchManagedItem,
    // Additional fields for inventory movement records
    line_so_no: item.line_so_no || item.so_no || "",
    material_code: itemData.material_code || "",
    material_name: itemData.material_name || "",
    // Excess data for whole-HU picks (FULL_HU_PICK/NO_SPLIT)
    temp_excess_data: item.temp_excess_data || "[]"
  };

  processedTableData.push(processedItem);

  // Collect all group keys for stats
  for (const gk of groupKeys) {
    allGroupKeys.push({
      tableIndex,
      groupKey: gk,
      ...groupedTempData[gk]
    });
  }
}

// Summary stats
const totalTableItems = tableData.length;
const itemsToProcess = processedTableData.filter(p => !p.skipProcessing).length;
const totalGroupKeys = allGroupKeys.length;

return {
  code: "200",
  // Pre-fetched data as arrays (workflow platform requires arrays, not objects)
  allItemsData,
  allAllocatedData,
  allPendingData,
  // Pre-processed table data with groupings
  processedTableData,
  // Stats
  totalTableItems,
  itemsToProcess,
  totalGroupKeys,
  // Workflow params passed through
  isGDPP,
  docId,
  docNo,
  plantId,
  organizationId,
  saveAs,
  docDate,
  parentId,
  parentNo,
  pickingPlanId,
  isPacking,
  message: `Batch fetch complete: ${itemsToProcess}/${totalTableItems} items, ${totalGroupKeys} total group keys`
};
