// ============================================================================
// POST-LOOP CLEANUP - Convert Orphaned Allocations to Pending
// Runs after all temp_data items have been processed in GD Created workflow
// Handles cases where user deletes entire lines or changes location/batch
// ============================================================================

const docId = {{form:_id}};
const organizationId = {{form:organization_id}};
const tableGd = {{form:table_gd}};

// Fetch old allocated records (same query as pre-loop)
const oldAllocatedRecords = await db
  .collection("reserved_table")
  .where({
    target_reserved_id: docId,
    status: "Allocated",
    organization_id: organizationId,
  })
  .get();

if (!oldAllocatedRecords.data || oldAllocatedRecords.data.length === 0) {
  return {
    code: "200",
    message: "No cleanup needed - no old allocations found",
  };
}

// Build list of all current temp_data combinations
// This represents what SHOULD exist after the user's edits
const currentTempDataKeys = tableGd.flatMap((line) =>
  line.temp_data.map((td) => ({
    doc_line_id: line._id,
    material_id: td.material_id,
    batch_id: td.batch_id,
    bin_location: td.location_id,
  })),
);

// Find orphaned records (exist in old allocated but not in current temp_data)
// These are allocations that were removed by the user's edits
const orphanedRecords = oldAllocatedRecords.data.filter(
  (old) =>
    !currentTempDataKeys.some(
      (current) =>
        old.doc_line_id === current.doc_line_id &&
        old.material_id === current.material_id &&
        old.batch_id === current.batch_id &&
        old.bin_location === current.bin_location,
    ),
);

if (orphanedRecords.length === 0) {
  return {
    code: "200",
    message: "No orphaned allocations found",
  };
}

// Convert orphaned allocations to Pending
// This releases them for other GD documents to use
// Note: Inventory stays in Reserved category, only status changes
const updatePromises = orphanedRecords.map((record) =>
  db.collection("reserved_table").doc(record._id).update({
    status: "Pending",
    target_reserved_id: null,
  }),
);

await Promise.all(updatePromises);

return {
  code: "200",
  orphanedCount: orphanedRecords.length,
  message: `Converted ${orphanedRecords.length} orphaned allocations to Pending`,
};
