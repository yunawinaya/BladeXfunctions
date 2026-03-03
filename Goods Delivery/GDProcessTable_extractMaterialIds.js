/**
 * GDProcessTable_extractMaterialIds.js
 *
 * PURPOSE: Extract unique material IDs from tableData for batch Item query
 * USAGE: Add as first code node, BEFORE the search nodes
 *
 * This enables the "IN" clause query to fetch all items in a single query
 */

const tableData = {{workflowparams:tableData}} || [];

const materialIds = [];
const seen = new Set();

for (const item of tableData) {
  if (item.material_id && !seen.has(item.material_id)) {
    seen.add(item.material_id);
    materialIds.push(item.material_id);
  }
}

return {
  materialIds: materialIds,
  count: materialIds.length
};
