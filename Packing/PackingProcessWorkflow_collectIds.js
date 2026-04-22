// PackingProcessWorkflow — node 7: Collect referenced IDs for master-data lookups
// Paste into the code-node. Walks packing.table_hu + existing GD line temp_qty_data
// to produce distinct lists of location_id / batch_id / handling_unit_id that
// downstream search-nodes will resolve into display names.
//
// Replace {{node:search_node_GD_LINES.data.data}} with your actual GD-line search-node ref.

const allData = {{workflowparams:allData}};
const gdLines = {{node:search_node_GD_LINES.data.data}} || [];

const locationIds = new Set();
const batchIds = new Set();
const huIds = new Set();

// From packing.table_hu (DB-recorded completed rows)
for (const row of allData.table_hu || []) {
  if (row.location_id) locationIds.add(row.location_id);
  if (row.handling_unit_id) huIds.add(row.handling_unit_id);

  let entries;
  try {
    entries = JSON.parse(row.temp_data || "[]");
  } catch (_) {
    entries = [];
  }
  for (const e of entries) {
    if (e && e.type === "nested_hu") {
      if (e.nested_hu_id) huIds.add(e.nested_hu_id);
      for (const c of e.children || []) {
        if (c.location_id) locationIds.add(c.location_id);
        if (c.batch_id) batchIds.add(c.batch_id);
      }
    } else if (e) {
      if (e.location_id) locationIds.add(e.location_id);
      if (e.batch_id) batchIds.add(e.batch_id);
    }
  }
}

// From existing GD line temp_qty_data (so post-patch view_stock can still resolve
// names for entries we didn't touch)
for (const line of gdLines) {
  let tqd;
  try {
    tqd = JSON.parse(line.temp_qty_data || "[]");
  } catch (_) {
    tqd = [];
  }
  for (const entry of tqd) {
    if (entry.location_id) locationIds.add(entry.location_id);
    if (entry.batch_id) batchIds.add(entry.batch_id);
    if (entry.handling_unit_id) huIds.add(entry.handling_unit_id);
  }

  // temp_hu_data entries too (display-only, but view_stock renders them)
  let thd;
  try {
    thd = JSON.parse(line.temp_hu_data || "[]");
  } catch (_) {
    thd = [];
  }
  for (const entry of thd) {
    if (entry.location_id) locationIds.add(entry.location_id);
    if (entry.batch_id) batchIds.add(entry.batch_id);
    if (entry.handling_unit_id) huIds.add(entry.handling_unit_id);
  }
}

return {
  locationIds: Array.from(locationIds),
  batchIds: Array.from(batchIds),
  huIds: Array.from(huIds),
};
