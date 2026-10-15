// 8dp is the maximum configurable column precision: rounding COMPUTED values there keeps
// every client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const allData = {{workflowparams:allData}};
const itemsToProcess = {{node:code_node_qfSZO0bi.data.itemsToProcess}};
const itemMasterData = {{node:code_node_PwItems.data.items}} || [];

// Helper: round to 3 decimal places

// Build item master lookup map
const itemMasterMap = {};
for (const item of itemMasterData) {
  itemMasterMap[item.id] = item;
}

// Array to collect inventory movements for loop processing
const inventoryMovements = [];

for (const mat of itemsToProcess) {
  const itemData = itemMasterMap[mat.item_code];

  if (!itemData) {
    continue;
  }

  // UOM conversion
  let basedQty = mat.putaway_qty;
  if (mat.item_uom !== itemData.based_uom && itemData.table_uom_conversion) {
    for (const uom of itemData.table_uom_conversion) {
      if (mat.item_uom === uom.alt_uom_id) {
        basedQty = q8(mat.putaway_qty * uom.base_qty);
        break;
      }
    }
  }
  basedQty = q8(basedQty);

  const isBatchManaged = itemData.item_batch_management === 1;

  // OUT movement from source_bin
  inventoryMovements.push({
    movement: "OUT",
    item_id: mat.item_code,
    item_uom: mat.item_uom,
    based_uom: itemData.based_uom,
    quantity: mat.putaway_qty,
    based_qty: basedQty,
    bin_location_id: mat.source_bin,
    batch_id: mat.batch_no || null,
    inventory_category: mat.source_inv_category,
    target_bin: mat.target_location,
    target_category: mat.target_inv_category,
    target_doc_line_id: mat.putaway_line_id || "",
    unit_price: q8(mat.unit_price),
    total_price: q8(mat.unit_price * basedQty),
    costing_method_id: itemData.material_costing_method || "",
    is_batch_managed: isBatchManaged ? 1 : 0,
    transaction_type: "TO - PA",
    trx_no: allData.to_id,
    parent_trx_no: allData.receiving_no || "",
    plant_id: allData.plant_id,
    organization_id: allData.organization_id,
  });

  // IN movement to target_location
  inventoryMovements.push({
    movement: "IN",
    item_id: mat.item_code,
    item_uom: mat.item_uom,
    based_uom: itemData.based_uom,
    quantity: mat.putaway_qty,
    based_qty: basedQty,
    storage_location: mat.storage_location,
    bin_location_id: mat.target_location,
    batch_id: mat.batch_no || null,
    inventory_category: mat.target_inv_category,
    unit_price: q8(mat.unit_price),
    total_price: q8(mat.unit_price * basedQty),
    costing_method_id: itemData.material_costing_method || "",
    is_batch_managed: isBatchManaged ? 1 : 0,
    transaction_type: "TO - PA",
    trx_no: allData.to_id,
    parent_trx_no: allData.receiving_no || "",
    plant_id: allData.plant_id,
    organization_id: allData.organization_id,
    hu_data: mat.hu_data || "",
  });
}

return {
  inventoryMovements: inventoryMovements,
  inventoryMovementsLength: inventoryMovements.length
};
