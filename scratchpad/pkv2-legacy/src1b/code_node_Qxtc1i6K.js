// The re-save below is hard-coded saveAs "Created"; a finished plan must not be reopened by it.
const toDatas = ({{node:search_node_cERaaVGY.data.data}} || []).filter(
  (to) => to.to_status !== "Completed" && to.to_status !== "Cancelled"
);

// table_to is a TREE: an item bundle is ONE row with the bundle's items under
// `children`. The items are what get picked -- the bundle row carries no material
// and never receives a picked_qty -- so the roll-up walks the tree flat and steps
// over the bundle row. Reading the top level alone saw ONLY that row, with
// picked_qty 0 against to_qty 2, and pinned a fully-picked Picking Plan at
// "Created" for ever.
const flattenToRows = (rows) =>
  (rows || []).flatMap((row) => {
    const { children, ...rest } = row || {};
    return [rest, ...(Array.isArray(children) ? children : [])];
  });

const isBundleParentLine = (line) =>
  Boolean(line && line.item_bundle_id) && !line.material_id;

const updatedToDatas = toDatas.map(to => {
  const tableTo = flattenToRows(to.table_to).filter(
    (line) => !isBundleParentLine(line)
  );

  if (tableTo.length === 0) {
    return {
      ...to,
      picking_status: 'Created'
    };
  }

  let allCompleted = true;
  let hasAnyProgress = false;

  for (const line of tableTo) {
    const pickingStatus = line.picking_status || 'Created';
    const pickedQty = parseFloat(line.picked_qty || 0);
    const toQty = parseFloat(line.to_qty || 0);

    // Use picked_qty vs to_qty for accurate status
    if (pickedQty >= toQty && toQty > 0) {
      hasAnyProgress = true;
    } else if (pickedQty > 0) {
      allCompleted = false;
      hasAnyProgress = true;
    } else {
      allCompleted = false;
    }
  }

  let toPickingStatus;
  if (allCompleted && hasAnyProgress) {
    toPickingStatus = 'Completed';
  } else if (hasAnyProgress) {
    toPickingStatus = 'In Progress';
  } else {
    toPickingStatus = 'Created';
  }

  return {
    ...to,
    picking_status: toPickingStatus,
  };
});

return {
  updatedToDatas: updatedToDatas
};
