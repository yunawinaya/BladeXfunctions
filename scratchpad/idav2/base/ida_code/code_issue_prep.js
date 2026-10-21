const entry = {{node:code_fillback.data.allData}};
const persisted = {{node:code_persisted.data}};
const items = {{node:search_items.data.data}} || [];

let picks = [];
try {
  picks = entry.temp_qty_data ? JSON.parse(entry.temp_qty_data) : [];
} catch (e) {
  picks = [];
}

const itemData = items.find(function (it) {
  return String(it.id) === String(entry.item_id);
}) || null;

return {
  plant_id: entry.issuing_operation_faci,
  organization_id: entry.organization_id,
  stock_movement_no: persisted.stock_movement_no,
  doc_date: entry.item_disassembly_date || null,
  material_id: entry.item_id,
  material_uom: entry.item_uom,
  itemData: itemData,
  balancesToProcess: picks.filter(function (p) {
    return (parseFloat(p.sm_quantity) || 0) > 0;
  })
};