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
const newRecords = {{node:code_node_Q3hWck9R.data.records}};

// Get original items from fetched data
const originalTree = originalPickingData.table_picking_items || [];
const { flat: originalItems, refs: originalRefs } = flattenPickingRows(originalTree);
const originalRecords = originalPickingData.table_picking_records || [];

// Items that produced a record this session: clear their attachment so a
// later In Progress edit + complete doesn't re-copy it into new record lines.
const pickedItemIds = new Set(newRecords.map(r => r.picking_item_id).filter(Boolean));

// Map workflow items by picking-row id (NOT to_line_id): one to_line can fan
// out into multiple batch/location rows sharing a single to_line_id, so keying
// by to_line_id would let an unpicked sibling row match a picked one and get
// wrongly completed. Row id is stable between allData and the stored picking.
const workflowItemMap = {};
for (const item of flattenPickingRows(allData.table_picking_items).flat) {
  const baseId = item.id.split('_split_')[0];
  const key = baseId;
  workflowItemMap[key] = item;
}

// Update each original item - mark as Completed since this is Completed workflow
const updatedFlat = originalItems.map(originalItem => {
  const key = originalItem.id;
  const workflowItem = workflowItemMap[key];
  
  if (workflowItem) {
    // Item was processed in this session - mark as Completed
    let lineStatus;
    if (originalItem.line_status === 'Cancelled') {
      lineStatus = 'Cancelled';
    } else {
      lineStatus = 'Completed';  // Always Completed since this is Completed workflow
    }
    
    return {
      ...originalItem,
      pending_process_qty: 0,  // Set to 0 since picking is complete
      line_status: lineStatus,
      attachment: pickedItemIds.has(originalItem.id) ? [] : originalItem.attachment
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
// Authoritative packing qty + net weight from each line's picked_qty.
// picked_qty is entered in picking_uom, while packing_conversion and
// weight_conversion are denominated in the order UOM (item_uom). Convert first,
// using the same scaling the records funnel applies to store_out_qty.
updatedFlat.forEach((it) => {
  const pickedQty = parseFloat(it.picked_qty) || 0;
  const pickedQtyOrder = pickedQty * ((Number(it.picking_base_qty) || Number(it.order_base_qty) || 1) / (Number(it.order_base_qty) || 1));
  const packingConversion = parseFloat(it.packing_conversion) || 1;
  const weightConversion = parseFloat(it.weight_conversion) || 0;
  it.packing_qty = Math.round((pickedQtyOrder / packingConversion) * 1000) / 1000;
  it.net_weight = Math.round((pickedQtyOrder * weightConversion) * 1000) / 1000;
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

// For Completed workflow, to_status is always Completed
const toStatus = 'Completed';

return {
  updatedItems: updatedItems,
  combinedRecords: combinedRecords,
  toStatus: toStatus,
  originalRecordsCount: originalRecords.length,
  newRecordsCount: newRecords.length
};
