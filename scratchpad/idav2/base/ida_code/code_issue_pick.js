const pick = {{node:loop_issue_picks}};

// Every nullable param is null, never '': SUBTRACT_INVENTORY's own Batch ID node
// does `const batchId = ...; if (batchId === "") batchId = null`, which throws
// TypeError: Assignment to constant. MSI passes null for the same reason.
return {
  location_id: pick.location_id || null,
  batch_id: pick.batch_id || null,
  quantity: parseFloat(pick.sm_quantity) || 0,
  inventory_category: pick.category || 'Unrestricted',
  manufacturing_date: pick.manufacturing_date || null,
  expired_date: pick.expired_date || null,
  handling_unit_id: pick.handling_unit_id || null
};