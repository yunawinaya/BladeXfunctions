// table_picking_items is a tree: an item bundle is ONE row with the items under it
// as `children`. The items are the rows that actually pull stock, so the whole
// tree is walked flat here -- reading the top level alone would leave a bundle's
// items with no picking record at all. A row with no `children` yields just
// itself, so a document with no bundles is unaffected.
const flattenPickingRows = (rows) =>
  (rows || []).flatMap((row) => [
    row,
    ...(Array.isArray(row.children) ? row.children : []),
  ]);

const allData = {{workflowparams:allData}};
const isForceComplete = {{workflowparams:isForceComplete}} || 0;

// allData is a single object, not an array
const input = allData;

// The stored Picking, not the client payload, is the authority on which GDs
// this Picking covers: mobile sends only the lines scanned in this session, so
// a GD finished in an earlier session is absent from input.table_picking_items.
const _opd = {{node:get_node_jEllcWiJ.data.data}};
const originalPickingData = (Array.isArray(_opd) ? _opd[0] : _opd) || {};
const storedGdIds = flattenPickingRows(originalPickingData.table_picking_items)
  .filter(i => i && i.line_status !== 'Cancelled')
  .map(i => i.gd_id);

// FORCE COMPLETE: Don't create new records - just complete with existing picked qty
if (isForceComplete === 1) {
  // Extract IDs from existing picking items for GD processing
  const gdLineIds = [...new Set(flattenPickingRows(input.table_picking_items).map(i => i.gd_line_id).filter(Boolean))];
  const gdIds = [...new Set(
    flattenPickingRows(input.table_picking_items).map(i => i.gd_id)
      .concat(storedGdIds)
      .filter(Boolean)
  )];
  const locationIds = [...new Set(flattenPickingRows(input.table_picking_items).map(i => i.source_bin).filter(Boolean))];
  const batchIds = [...new Set(flattenPickingRows(input.table_picking_items).map(i => i.batch_no).filter(Boolean))];
  
  return { 
    records: [], 
    totalOriginalQuantity: 0, 
    totalPickedQuantity: 0, 
    hasAnyQuantity: false, 
    clampedLines: [], 
    gdLineIds,
    locationIds,
    batchIds,
    gdIds
  };
}

const records = [];
let totalOriginalQuantity = 0;
let totalPickedQuantity = 0;
let hasAnyQuantity = false;

const gdId = input.gd_no && input.gd_no[0] ? input.gd_no[0] : '';

// A second picker can empty these bins while this picker is still in the aisles:
// the client validates picked_qty against the pending it loaded, which may be
// minutes stale by now. Clamp against what the stored document says so a line's
// records can never sum past its real remaining qty -- the additive records
// array is what force complete later rebuilds gd_qty from.
const freshPending = {};
for (const row of flattenPickingRows(originalPickingData.table_picking_items)) {
  if (!row || !row.id) continue;
  if (row.line_status === 'Cancelled') continue;
  freshPending[String(row.id)] = parseFloat(row.pending_process_qty) || 0;
}
const clampedLines = [];

for (const item of flattenPickingRows(input.table_picking_items)) {
  
  if (item.line_status === 'Cancelled') continue;

  // A bundle row holds no stock -- no bin, no batch, nothing to pull -- so it
  // never produces a picking record. Its items do, and the bundle row's own
  // progress is derived from theirs.
  if (item.item_bundle_id && !item.item_code) continue;

  
  const itemRemark = (input.individual_remarks && input.individual_remarks[item.id]) || item.remark || '';
  const itemRemark2 = item.remark_2 || '';
  const itemRemark3 = item.remark_3 || '';
  const isSplitItem = item._is_split_entry === true;
  const splitIndex = isSplitItem ? parseInt(item._split_index || '0') : -1;
  
  let locationsToProcess = [];
  let itemPickedQuantity = 0;
  
  const itemBaseId = item.id.split('_split_')[0];
  const splitData = input.split_data && input.split_data[item.gd_line_id || itemBaseId];
  
  if (splitData && splitData.is_split && splitData.split_locations) {
    if (isSplitItem && splitIndex >= 0 && splitIndex < splitData.split_locations.length) {
      const splitLoc = splitData.split_locations[splitIndex];
      itemPickedQuantity = splitLoc.allocated_quantity || 0;
      locationsToProcess = [{
        location_id: item.source_bin || '',
        target_location_id: splitLoc.target_location_id,
        allocated_quantity: splitLoc.allocated_quantity,
        batch_no: splitLoc.batch_no,
        batch_number: splitLoc.batch_number,
        target_batch: splitLoc.target_batch
      }];
    } else if (!isSplitItem) {
      itemPickedQuantity = splitData.split_locations.reduce((sum, loc) => sum + (loc.allocated_quantity || 0), 0);
      locationsToProcess = splitData.split_locations.map(loc => ({
        location_id: item.source_bin || '',
        target_location_id: loc.target_location_id,
        allocated_quantity: loc.allocated_quantity,
        batch_no: loc.batch_no,
        batch_number: loc.batch_number,
        target_batch: loc.target_batch
      }));
    }
  } else {
    if (item._mobile_locations && item._mobile_locations.length > 0) {
      itemPickedQuantity = item._mobile_locations.reduce((sum, loc) => sum + (loc.allocated_quantity || 0), 0);
      locationsToProcess = item._mobile_locations;
    }
    if (itemPickedQuantity === 0) {
      itemPickedQuantity = item.picked_qty ?? item.qty_to_pick ?? 0;
      locationsToProcess = [{
        location_id: item.source_bin || '',
        target_location_id: item.target_location || item.source_bin || '',
        allocated_quantity: itemPickedQuantity,
        batch_no: item.batch_no,
        target_batch: item.target_batch
      }];
    }
  }
  
  if (splitData && splitData.is_split && splitData.split_locations) {
    if (!isSplitItem || splitIndex === 0) {
      totalOriginalQuantity += splitData.split_locations.reduce((sum, loc) => sum + (loc.allocated_quantity || 0), 0);
    }
  } else {
    totalOriginalQuantity += item.qty_to_pick || 0;
  }
  totalPickedQuantity += itemPickedQuantity;
  
  if (itemPickedQuantity > 0) {
    hasAnyQuantity = true;
    
    for (const location of locationsToProcess) {
      if (location.allocated_quantity && location.allocated_quantity > 0) {
        const originalBatchNo = location.batch_no || location.batch_number || item.batch_no || '';
        const targetBatch = location.target_batch || item.target_batch || originalBatchNo;
        const sourceBin = item.source_bin || location.location_id || '';
        const targetLocation = location.target_location_id || item.target_location || sourceBin;
        
        const uomScale =
          (Number(item.picking_base_qty) || Number(item.order_base_qty) || 1) /
          (Number(item.order_base_qty) || 1);
        let storeOutQty = Math.round((location.allocated_quantity || 0) * uomScale * 1000) / 1000;
        let pickedQtyAlt = location.allocated_quantity;

        // Only rows the stored document still knows about are clamped; an id it
        // has never seen is left alone rather than silently zeroed.
        if (Object.prototype.hasOwnProperty.call(freshPending, itemBaseId)) {
          const allowed = freshPending[itemBaseId];
          if (storeOutQty > allowed) {
            clampedLines.push({
              picking_item_id: itemBaseId,
              item_name: item.item_name || item.item_code || itemBaseId,
              requested: storeOutQty,
              allowed: allowed,
            });
            storeOutQty = allowed;
            pickedQtyAlt = uomScale
              ? Math.round((allowed / uomScale) * 1000) / 1000
              : allowed;
          }
          freshPending[itemBaseId] = Math.round((allowed - storeOutQty) * 1000) / 1000;
          if (storeOutQty <= 0) continue;
        }

        records.push({
          picking_item_id: itemBaseId,
          item_code: item.item_code,
          item_name: item.item_name,
          item_desc: item.item_desc || '',
          more_desc: item.more_desc || '',
          store_out_qty: storeOutQty,
          item_uom: item.item_uom,
          picked_uom: item.picking_uom || item.item_uom,
          picked_qty_alt: pickedQtyAlt,
          source_bin: sourceBin,
          target_location: targetLocation,
          batch_no: originalBatchNo,
          target_batch: targetBatch,
          so_id: item.so_id,
          so_no: item.so_no || input.so_no,
          so_line_id: item.so_line_id,
          gd_id: item.gd_id || gdId,
          gd_no: item.gd_no || input.delivery_no,
          gd_line_id: item.gd_line_id,
          handling_unit_id: item.handling_unit_id || null,
          remark: itemRemark,
          remark_2: itemRemark2,
          remark_3: itemRemark3,
          line_status: 'Confirmed',
          confirmed_by: {{workflowparams:confirmed_by}} || "",
          confirmed_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("T", " "), // DB datetimes are Malaysia time (UTC+8)
          attachment: item.attachment || [],
        });
      }
    }
  }
}

const gdLineIds = [...new Set(records.map(r => r.gd_line_id).filter(Boolean))];
const locationIds = [...new Set(records.map(r => r.target_location).concat(records.map(r => r.source_bin)).filter(Boolean))];
const batchIds = [...new Set(records.map(r => r.target_batch).concat(records.map(r => r.batch_no)).filter(Boolean))];
// Every GD on this Picking, not only those with qty entered in THIS session.
// A multi-GD Picking (the M:N split) completes with records saved in earlier
// sessions, and code_node_pMVdQBEQ builds one Packing per GD in updatedItems
// (cumulative). A GD missing from "Get GD Datas" yields gd={} -> tableGd=[]
// -> a Packing with no lines. Mirrors the isForceComplete branch above.
const gdIds = [...new Set(
  records.map(r => r.gd_id)
    .concat(flattenPickingRows(input.table_picking_items).map(i => i.gd_id))
    .concat(storedGdIds)
    .filter(Boolean)
)];

return { records, totalOriginalQuantity, totalPickedQuantity, hasAnyQuantity, gdLineIds, locationIds, batchIds, gdIds, clampedLines };
