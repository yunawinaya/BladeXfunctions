// prepareAllocationData - Updated to include so_line_item_id
const allData = {{workflowparams:allData}};
const tableGd = allData.table_gd || [];

// Filter rows that need allocation: gd_qty > 0 AND no temp_qty_data
const rowsNeedingAllocation = [];

tableGd.forEach((row, index) => {
  const gdQty = parseFloat(row.gd_qty) || 0;
  const hasTempData = row.temp_qty_data &&
                      row.temp_qty_data !== "[]" &&
                      row.temp_qty_data.trim() !== "";

  // Only allocate if: has quantity AND no existing allocation AND has material_id
  if (gdQty > 0 && !hasTempData && row.material_id) {
    rowsNeedingAllocation.push({
      rowIndex: index,
      materialId: row.material_id,
      quantity: gdQty,
      uomId: row.gd_order_uom_id,
      plantId: allData.plant_id,
      organizationId: allData.organization_id,
      soLineItemId: row.so_line_item_id || null  // 🔧 NEW: Extract SO line item ID
    });
  }
});

// Initialize allocation tracker for cross-row deduplication
const allocationTracker = {};

return {
  rowsNeedingAllocation,
  allocationTracker,
  plantId: allData.plant_id,
  organizationId: allData.organization_id,
  totalRowsToAllocate: rowsNeedingAllocation.length
};
