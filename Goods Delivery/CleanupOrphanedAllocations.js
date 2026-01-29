// ============================================================================
// POST-LOOP CLEANUP - Convert Orphaned Allocations to Pending
// Runs after all temp_data items have been processed in GD Created workflow
// Handles cases where user deletes entire lines or changes location/batch
// Returns recordsToUpdate for workflow to execute (consistent with other logic files)
// ============================================================================

const docId = {{form:_id}};
const organizationId = {{form:organization_id}};
const tableGd = {{form:table_gd}};

// Fetch current allocated records (re-fetch to get state after loop processing)
// This ensures we only process records still in "Allocated" status
const currentAllocatedRecords = await db
  .collection("reserved_table")
  .where({
    target_reserved_id: docId,
    status: "Allocated",
    organization_id: organizationId,
  })
  .get();

if (!currentAllocatedRecords.data || currentAllocatedRecords.data.length === 0) {
  return {
    code: "200",
    recordsToUpdate: [],
    message: "No cleanup needed - no allocated records found",
  };
}

// Build list of all current temp_data combinations
// This represents what SHOULD exist after the user's edits
const currentTempDataKeys = tableGd.flatMap((line) => {
  const tempData = typeof line.temp_data === "string"
    ? JSON.parse(line.temp_data || "[]")
    : (line.temp_data || []);

  return tempData.map((td) => ({
    doc_line_id: line._id,
    material_id: td.material_id,
    batch_id: td.batch_id,
    bin_location: td.location_id,
  }));
});

// Find orphaned records (exist in allocated but not in current temp_data)
// These are allocations that were removed by the user's edits
const orphanedRecords = currentAllocatedRecords.data.filter(
  (allocated) =>
    !currentTempDataKeys.some(
      (current) =>
        allocated.doc_line_id === current.doc_line_id &&
        allocated.material_id === current.material_id &&
        allocated.batch_id === current.batch_id &&
        allocated.bin_location === current.bin_location,
    ),
);

if (orphanedRecords.length === 0) {
  return {
    code: "200",
    recordsToUpdate: [],
    message: "No orphaned allocations found",
  };
}

// Build recordsToUpdate array with _id, status, and target_reserved_id
// Workflow will handle the actual database updates
// Note: Inventory stays in Reserved category, only status changes
const recordsToUpdate = orphanedRecords.map((record) => ({
  _id: record._id,
  status: "Pending",
  target_reserved_id: null,
}));

return {
  code: "200",
  recordsToUpdate: recordsToUpdate,
  orphanedCount: orphanedRecords.length,
  message: `Found ${orphanedRecords.length} orphaned allocations to convert to Pending`,
};
