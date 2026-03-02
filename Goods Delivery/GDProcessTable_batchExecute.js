/**
 * GDProcessTable_batchExecute.js
 *
 * PURPOSE: Prepare data for batch database operations
 * USAGE: This code node prepares data for workflow batch update/create nodes
 *
 * INPUT: Output from GDProcessTable_batchProcess.js
 * OUTPUT: Prepared data arrays for batch update/create workflow nodes
 */

const batchResult = {{node:code_node_b71wypDJ.data}};

const {
  recordsToUpdate,
  recordsToCreate,
  inventoryMovements,
  code,
  message
} = batchResult;

// Check for error in processing
if (code === "400") {
  return {
    code: "400",
    message: message || "Error in batch processing",
    hasUpdates: 0,
    hasCreates: 0,
    hasMovements: 0
  };
}

// Separate updates by type for different batch operations
const reservedRecordUpdates = recordsToUpdate.filter(r => r.id);
const reservedRecordCreates = recordsToCreate.filter(r => !r.id);

return {
  code: "200",
  // For batch update node targeting on_reserved_gd collection
  reservedRecordUpdates,
  reservedRecordUpdatesCount: reservedRecordUpdates.length,

  // For batch create node targeting on_reserved_gd collection
  reservedRecordCreates,
  reservedRecordCreatesCount: reservedRecordCreates.length,

  // For inventory workflow loops - no aggregation, keep line-level detail
  inventoryMovements,
  inventoryMovementsCount: inventoryMovements.length,

  // Flags for conditional workflow branches
  hasUpdates: reservedRecordUpdates.length > 0 ? 1 : 0,
  hasCreates: reservedRecordCreates.length > 0 ? 1 : 0,
  hasMovements: inventoryMovements.length > 0 ? 1 : 0,

  message: `Ready for batch execution: ${reservedRecordUpdates.length} updates, ${reservedRecordCreates.length} creates, ${inventoryMovements.length} movements`
};
