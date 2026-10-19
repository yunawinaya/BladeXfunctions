const gdLines = {{node:search_node_krPmTbfL.data.data}} || [];
const existingLocationIds = {{node:code_node_oHIIKfiw.data.locationIds}} || [];
const existingBatchIds = {{node:code_node_oHIIKfiw.data.batchIds}} || [];

const allLocationIds = new Set(existingLocationIds);
const allBatchIds = new Set(existingBatchIds);
const allHuIds = new Set();

// Extract ALL location/batch/HU IDs from GD lines' temp_qty_data
for (const line of gdLines) {
  if (line.temp_qty_data) {
    try {
      const tempData = typeof line.temp_qty_data === 'string' 
        ? JSON.parse(line.temp_qty_data) 
        : line.temp_qty_data;
      
      if (Array.isArray(tempData)) {
        for (const entry of tempData) {
          if (entry.location_id) {
            allLocationIds.add(entry.location_id);
          }
          if (entry.batch_id && entry.batch_id !== 'undefined' && entry.batch_id !== null) {
            allBatchIds.add(entry.batch_id);
          }
          if (entry.handling_unit_id) {
            allHuIds.add(entry.handling_unit_id);
          }
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  }
}

return {
  locationIds: Array.from(allLocationIds).filter(id => id),
  batchIds: Array.from(allBatchIds).filter(id => id),
  huIds: Array.from(allHuIds).filter(id => id)
};
