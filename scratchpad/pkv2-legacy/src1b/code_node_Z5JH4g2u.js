// 8dp is the maximum configurable column precision: rounding COMPUTED values there keeps
// every client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// table_picking_items is a tree: an item bundle is ONE row with the items under it
// as `children`. Status is worked out a row at a time, so it runs over a flat view
// of that tree and writes back through refs that remember where each row sat.
// A document with no bundles flattens to itself, so this is a no-op there.
const flattenPickingRows = (rows) => {
  const flat = [];
  const refs = [];

  (rows || []).forEach((row, parent) => {
    flat.push(row);
    refs.push({ parent, child: null });

    const children = Array.isArray(row.children) ? row.children : [];

    children.forEach((child, childIndex) => {
      flat.push(child);
      refs.push({ parent, child: childIndex });
    });
  });

  return { flat, refs };
};

const rebuildPickingTree = (rows, flat, refs) => {
  const out = (rows || []).map((row) => ({ ...row }));

  refs.forEach((ref, index) => {
    // The parent's own `children` is stale by now -- the items are written
    // through their own refs, which come after this one.
    const { children: staleChildren, ...rest } = flat[index] || {};

    if (ref.child === null) {
      out[ref.parent] = { ...out[ref.parent], ...rest };
      return;
    }

    const parent = out[ref.parent] || {};
    const children = Array.isArray(parent.children) ? [...parent.children] : [];
    children[ref.child] = { ...children[ref.child], ...flat[index] };
    out[ref.parent] = { ...parent, children };
  });

  return out;
};

// Input from previous nodes
const originalPickingData = {{node:get_node_jEllcWiJ.data.data}};
const allData = {{workflowparams:allData}};
const newRecords = {{node:code_node_oHIIKfiw.data.records}};

// NEW: Check for force complete flag
const isForceComplete = {{workflowparams:isForceComplete}} || 0;

// M:N config: when allow_full_picking is ON, a Picking line goes directly
// from Open to Completed once any qty is picked (no In Progress middle state).
// Leftover qty becomes a new Picking via Convert to Picking. Mirrors the
// PP-branch behavior for the GD-source flow.
const allowFullPicking = ({{node:get_node_Uj1uV9PU.data.data.allow_full_picking}} || 0) === 1;

// Get original items from fetched data
const originalTree = originalPickingData.table_picking_items || [];
const { flat: originalItems, refs: originalRefs } = flattenPickingRows(originalTree);
const originalRecords = originalPickingData.table_picking_records || [];

// Create map of workflow items by gd_line_id or id
const workflowItemMap = {};
for (const item of flattenPickingRows(allData.table_picking_items).flat) {
  const baseId = item.id.split('_split_')[0];
  const key = baseId;
  workflowItemMap[key] = item;
}

// Create map of picked quantities by gd_line_id (not item_code)
const pickedQuantityMap = {};
for (const record of newRecords) {
  const key = record.picking_item_id || record.gd_line_id;
  const current = pickedQuantityMap[key] || 0;
  pickedQuantityMap[key] = current + record.store_out_qty;
}

// Update each original item
const updatedFlat = originalItems.map(originalItem => {
  const key = originalItem.id;
  const workflowItem = workflowItemMap[key];
  
  // FORCE COMPLETE: Set all non-cancelled items to Completed
  if (isForceComplete === 1) {
    return {
      ...originalItem,
      pending_process_qty: 0,
      line_status: originalItem.line_status === 'Cancelled' ? 'Cancelled' : 'Completed'
    };
  }
  
  if (workflowItem) {
    // Item was processed in this session
    const pickedQty = pickedQuantityMap[originalItem.id] || 0;
    const newPendingQty = Math.max(0, q8((originalItem.pending_process_qty || 0) - pickedQty));
    
    // Determine line status
    let lineStatus;
    let finalPendingQty = newPendingQty;
    if (originalItem.line_status === 'Cancelled') {
      lineStatus = 'Cancelled';
    } else if (allowFullPicking && pickedQty > 0) {
      // M:N: any picked qty closes the line. Remaining (if any) goes to a
      // new Picking via Convert to Picking. Force pending to 0 since this
      // Picking is done with this line.
      lineStatus = 'Completed';
      finalPendingQty = 0;
    } else if (newPendingQty === 0) {
      lineStatus = 'Completed';
    } else if (pickedQty > 0) {
      lineStatus = 'In Progress';
    } else {
      lineStatus = 'Open';
    }
    
    return {
      ...originalItem,
      pending_process_qty: finalPendingQty,
      line_status: lineStatus,
      attachment: pickedQty > 0 ? [] : originalItem.attachment
    };
  } else {
    // Item was not processed - preserve original state
    return {
      ...originalItem,
      line_status: originalItem.line_status || 'Open'
    };
  }
});

// Combine original records with new records
// Authoritative packing qty + net weight from each line's qty_to_pick.
updatedFlat.forEach((it) => {
  const qtyToPick = parseFloat(it.qty_to_pick) || 0;
  const packingConversion = parseFloat(it.packing_conversion) || 1;
  const weightConversion = parseFloat(it.weight_conversion) || 0;
  it.packing_qty = Math.round((qtyToPick / packingConversion) * 1000) / 1000;
  it.net_weight = Math.round((qtyToPick * weightConversion) * 1000) / 1000;
});


// Back into the tree the document came in as, so a bundle keeps its items.
const updatedItems = rebuildPickingTree(originalTree, updatedFlat, originalRefs);

// ============================================================================
// ITEM BUNDLES - the bundle row follows its items
// ----------------------------------------------------------------------------
// A bundle row holds no stock, so nothing is ever picked against it directly and
// no picking record names it. Left alone it would sit at Open for ever, and the
// rollup below would never see every line Completed -- the Picking could not be
// finished at all. Its progress is its items' progress.
//
// Its remaining quantity tracks the LEAST picked item, so the bundle only reads
// as done once every item under it is.
// ============================================================================
const bundleRowsToFollow = updatedItems.filter(
  (i) => i && i.row_type !== "header" && i.item_bundle_id && !i.item_code
);

for (const bundleRow of bundleRowsToFollow) {
  if (bundleRow.line_status === "Cancelled") continue;

  // The items are the rows under the bundle. A document that arrives flat
  // instead -- items pointing back at the bundle row through parent_id -- is
  // handled too, the same way GD and PO handle their own trees.
  const nestedParts = Array.isArray(bundleRow.children) ? bundleRow.children : [];
  const bundleRowId = String(bundleRow.id || "");
  const flatParts = bundleRowId
    ? updatedItems.filter((i) => i && String(i.parent_id || "") === bundleRowId)
    : [];

  const allParts = nestedParts.length > 0 ? nestedParts : flatParts;
  const parts = allParts.filter((i) => i && i.line_status !== "Cancelled");

  // Every item under the bundle is cancelled, so the bundle is cancelled too. A
  // plain line in this situation reads "Cancelled"; left alone the bundle row sat
  // at Open for ever with its full pending qty, and the Picking could never read
  // as finished because the rollup counted it as one still-open line.
  if (allParts.length > 0 && parts.length === 0) {
    bundleRow.line_status = "Cancelled";
    bundleRow.pending_process_qty = 0;
    continue;
  }

  if (parts.length === 0) continue;

  const worstRemaining = parts.reduce((worst, part) => {
    const planned = parseFloat(part.qty_to_pick) || 0;
    const left = parseFloat(part.pending_process_qty) || 0;
    const share = planned > 0 ? left / planned : 0;
    return share > worst ? share : worst;
  }, 0);

  const bundlesPlanned = parseFloat(bundleRow.qty_to_pick) || 0;
  bundleRow.pending_process_qty =
    q8(bundlesPlanned * worstRemaining);

  const anyStarted = parts.some(
    (part) =>
      (parseFloat(part.pending_process_qty) || 0) <
      (parseFloat(part.qty_to_pick) || 0)
  );

  if (bundleRow.pending_process_qty === 0) {
    bundleRow.line_status = "Completed";
  } else if (anyStarted) {
    bundleRow.line_status = "In Progress";
  } else {
    bundleRow.line_status = "Open";
  }
}

const combinedRecords = [...originalRecords, ...newRecords];

// Determine overall transfer order status
// FORCE COMPLETE: Override to Completed
let toStatus;
if (isForceComplete === 1) {
  toStatus = 'Completed';
} else {
  const nonCancelledItems = updatedItems.filter(i => i.line_status !== 'Cancelled' && i.row_type !== 'header');
  const completedItems = nonCancelledItems.filter(i => i.line_status === 'Completed');
  const inProgressItems = nonCancelledItems.filter(i => i.line_status === 'In Progress');

  if (completedItems.length === nonCancelledItems.length && nonCancelledItems.length > 0) {
    toStatus = 'Completed';
  } else if (completedItems.length > 0 || inProgressItems.length > 0) {
    toStatus = 'In Progress';
  } else {
    toStatus = 'Open';
  }
}

return {
  updatedItems: updatedItems,
  combinedRecords: combinedRecords,
  toStatus: toStatus,
  originalRecordsCount: originalRecords.length,
  newRecordsCount: newRecords.length,
  isForceComplete: isForceComplete === 1 ? "Yes" : null
};
