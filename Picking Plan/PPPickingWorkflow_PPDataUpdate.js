// PP Data Update - Code Node for Picking Plan Issued Workflow
// This code calculates the overall picking_status for the Picking Plan header
// based on the line-level picking statuses and picked quantities

// NOTE: Update this node reference to match your actual workflow node ID
const toDatas = {{node:search_node_t4fp5B7z.data.data}} || [];

// Process each PP to determine and update its document-level picking_status
const updatedToDatas = toDatas.map(to => {
  const tableTo = to.table_to || [];

  if (tableTo.length === 0) {
    return {
      ...to,
      picking_status: 'Created'
    };
  }

  // Track status across all lines
  let allCompleted = true;
  let hasAnyProgress = false;

  for (const line of tableTo) {
    const pickedQty = parseFloat(line.picked_qty || 0);
    const toQty = parseFloat(line.to_qty || 0);

    // Use picked_qty vs to_qty for accurate status determination
    if (pickedQty >= toQty && toQty > 0) {
      // Line is completed
      hasAnyProgress = true;
    } else if (pickedQty > 0) {
      // Line is in progress (partially picked)
      allCompleted = false;
      hasAnyProgress = true;
    } else {
      // Line has not been picked yet
      allCompleted = false;
    }
  }

  // Determine PP-level picking_status
  let toPickingStatus;
  if (allCompleted && hasAnyProgress) {
    // All lines are completed (picked_qty >= to_qty for all)
    toPickingStatus = 'Completed';
  } else if (hasAnyProgress) {
    // Some picking has happened but not all complete
    toPickingStatus = 'In Progress';
  } else {
    // No picking has happened yet
    toPickingStatus = 'Created';
  }

  return {
    ...to,
    picking_status: toPickingStatus
  };
});

return {
  updatedToDatas: updatedToDatas
};
