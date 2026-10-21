const entry = {{node:code_fillback.data.allData}};
// Every source pick is checked before the first write, so a shortfall on any
// pick stops the save while nothing has moved yet.
let picks = [];
try {
  picks = entry.temp_qty_data ? JSON.parse(entry.temp_qty_data) : [];
} catch (e) {
  picks = [];
}

return {
  plant_id: entry.issuing_operation_faci,
  organization_id: entry.organization_id,
  material_id: entry.item_id,
  material_uom: entry.item_uom,
  balancesToProcess: picks.filter(function (p) {
    return (parseFloat(p.sm_quantity) || 0) > 0;
  })
};