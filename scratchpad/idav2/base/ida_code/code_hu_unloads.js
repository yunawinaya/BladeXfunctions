const entry = {{node:code_fillback.data.allData}};

// Source stock picked out of a handling unit has to be unloaded from it.
let picks = [];
try {
  picks = entry.temp_qty_data ? JSON.parse(entry.temp_qty_data) : [];
} catch (e) {
  picks = [];
}

const byHu = {};
picks.forEach(function (p) {
  if (!p.handling_unit_id) return;
  if ((parseFloat(p.sm_quantity) || 0) <= 0) return;
  const key = String(p.handling_unit_id);
  if (!byHu[key]) {
    byHu[key] = {
      handling_unit_id: key,
      plant_id: entry.issuing_operation_faci,
      organization_id: entry.organization_id,
      location_id: p.location_id || null,
      storage_location_id: p.storage_location_id || null,
      table_hu_items: []
    };
  }
  byHu[key].table_hu_items.push({
    material_id: p.material_id || entry.item_id,
    location_id: p.location_id || null,
    batch_id: p.batch_id || null,
    material_uom: entry.item_uom,
    quantity: parseFloat(p.sm_quantity) || 0,
    balance_id: p.balance_id || null
  });
});

const huUpdates = Object.keys(byHu).map(function (k) { return byHu[k]; });

return { huUpdates: huUpdates, huUpdatesLength: huUpdates.length };