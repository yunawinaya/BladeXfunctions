const originalPutawayData = {{node:get_node_C64LC1sr.data.data}};
const allData = {{workflowparams:allData}};
const newRecords = {{node:code_node_qfSZO0bi.data.records}};

const originalItems = [...(originalPutawayData.table_putaway_item || [])];
const originalRecords = originalPutawayData.table_putaway_records || [];

const workflowItemMap = {};
for (const item of allData.table_putaway_item) {
  workflowItemMap[String(item.line_index)] = item;
}

// Both the items and the records are trees: an item bundle is one row with its
// items under `children`. Split children are flat siblings, so `children` only
// ever means a bundle.
const flattenRows = (rows) => {
  const flat = [];

  for (const row of rows || []) {
    flat.push(row);

    const children = Array.isArray(row.children) ? row.children : [];

    for (const child of children) {
      flat.push(child);
    }
  }

  return flat;
};

// Calculate total putaway quantity per PARENT from new records
const parentPutawayMap = {};
for (const record of flattenRows(newRecords)) {
  const lineIndexStr = String(record.line_index);
  const parentLineIndex = lineIndexStr.includes(' - ')
    ? lineIndexStr.split(' - ')[0]
    : lineIndexStr;
  const current = parentPutawayMap[parentLineIndex] || 0;
  parentPutawayMap[parentLineIndex] = current + (parseFloat(record.store_in_qty) || 0);
}

// Applied to every line, bundle row and bundle item alike. A bundle's items are
// lines in their own right, and their line_index is "{parent}-{child}", which
// carries no " - " and so is keyed on its own rather than folded into the parent
// the way a split child is.
const updateLine = (originalItem) => {
  const lineIndexStr = String(originalItem.line_index);
  const totalPutawayQty = parentPutawayMap[lineIndexStr] || 0;
  const currentPending = parseFloat(originalItem.pending_process_qty) || 0;
  const newPendingQty = Math.max(0, currentPending - totalPutawayQty);

  let lineStatus;
  if (originalItem.line_status === 'Cancelled') {
    lineStatus = 'Cancelled';
  } else if (newPendingQty === 0 && totalPutawayQty > 0) {
    lineStatus = 'Completed';
  } else if (totalPutawayQty > 0) {
    lineStatus = 'In Progress';
  } else {
    lineStatus = originalItem.line_status || 'Open';
  }

  // Only reset form fields for lines actually processed this run; untouched lines keep their original target_location/remark/split state.
  if (totalPutawayQty > 0) {
    return {
      ...originalItem,
      pending_process_qty: newPendingQty,
      line_status: lineStatus,
      putaway_qty: 0,
      target_location: '',
      remark: '',
      is_split: 'No',
      parent_or_child: 'Parent'
    };
  }

  return {
    ...originalItem,
    pending_process_qty: newPendingQty,
    line_status: lineStatus
  };
};

// The bundle row carries the bundle id and no item code.
const isBundleParentRow = (row) =>
  Boolean(row.item_bundle_id) && !row.item_code;

// Update each original item (parents only)
const updatedItems = originalItems.map(originalItem => {
  const bundleChildren = Array.isArray(originalItem.children)
    ? originalItem.children
    : [];

  if (!isBundleParentRow(originalItem) || bundleChildren.length === 0) {
    return updateLine(originalItem);
  }

  const updatedChildren = bundleChildren.map(child => updateLine(child));
  const updatedParent = updateLine(originalItem);

  const allChildrenDone = updatedChildren.every(
    child => child.line_status === 'Completed' || child.line_status === 'Cancelled'
  );

  // A bundle is not put away until every item under it is, however its own
  // quantity happened to work out.
  if (!allChildrenDone && updatedParent.line_status === 'Completed') {
    updatedParent.line_status = 'In Progress';
  }

  return { ...updatedParent, children: updatedChildren };
});

const combinedRecords = [...originalRecords, ...newRecords];

// Calculate overall to_status
let toStatus;
const allCompleted = updatedItems.every(item =>
  item.line_status === 'Completed' || item.line_status === 'Cancelled'
);
const anyInProgress = updatedItems.some(item =>
  item.line_status === 'In Progress' || item.line_status === 'Completed'
);

if (allCompleted) {
  toStatus = 'Completed';
} else if (anyInProgress) {
  toStatus = 'In Progress';
} else {
  toStatus = 'Open';
}

return { updatedItems, combinedRecords, toStatus };