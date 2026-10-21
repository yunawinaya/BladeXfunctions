const pick = {{node:loop_precheck_picks}};

return {
  location_id: pick.location_id || null,
  batch_id: pick.batch_id || null,
  quantity: parseFloat(pick.sm_quantity) || 0,
  inventory_category: pick.category || 'Unrestricted'
};