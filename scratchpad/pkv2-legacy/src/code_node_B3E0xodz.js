const gdDatas = {{node:search_node_c7BtNx91.data.data}} || [];

// Process each GD to determine and update its document-level picking_status
// table_gd is a TREE: an item bundle is ONE row with the bundle's items under
// `children`. The bundle row is stamped picking_status "Completed" when the GD is
// created -- nothing is ever picked against a bundle -- so reading the top level
// alone saw ONLY that row and reported the GD fully picked even when not a single
// item had been picked. The items are the lines that carry real progress.
const flattenGdRows = (rows) =>
  (rows || []).flatMap((row) => {
    const { children, ...rest } = row || {};
    return [rest, ...(Array.isArray(children) ? children : [])];
  });

const isBundleParentLine = (line) =>
  Boolean(line && line.item_bundle_id) && !line.material_id;

const updatedGdDatas = gdDatas.map(gd => {
  const tableGd = flattenGdRows(gd.table_gd).filter(
    (line) => !isBundleParentLine(line)
  );
  
  if (tableGd.length === 0) {
    return {
      ...gd,
      picking_status: 'Created'
    };
  }
  
  // Check status of all lines
  let allCompleted = true;
  let hasAnyProgress = false;
  
  for (const line of tableGd) {
    const pickingStatus = line.picking_status || 'Created';
    
    if (pickingStatus === 'Completed') {
      hasAnyProgress = true;
    } else if (pickingStatus === 'In Progress') {
      allCompleted = false;
      hasAnyProgress = true;
    } else {
      allCompleted = false;
    }
  }
  
  // Determine GD-level picking_status
  let gdPickingStatus;
  if (allCompleted) {
    gdPickingStatus = 'Completed';
  } else if (hasAnyProgress) {
    gdPickingStatus = 'In Progress';
  } else {
    gdPickingStatus = 'Created';
  }
  
  return {
    ...gd,
    picking_status: gdPickingStatus
  };
});

return {
  updatedGdDatas: updatedGdDatas
};