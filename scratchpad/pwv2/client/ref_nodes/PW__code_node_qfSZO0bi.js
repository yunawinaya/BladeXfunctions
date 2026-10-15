const allData = {{workflowparams:allData}};

const records = [];
const itemsToProcess = []; // Items with putaway_qty > 0 for inventory processing
let totalOriginalQuantity = 0;
let totalPutawayQuantity = 0;
let hasAnyQuantity = false;

// table_putaway_item is a tree: an item bundle is one row with its items under
// `children`. Split children are flat siblings, so `children` only ever means a
// bundle.
//
// The bundle row carries the bundle id and no item code. It holds no stock, so
// it moves none — but it stays in the putaway records exactly as it stands in
// the putaway items, with its own items underneath it.
const isBundleParentRow = (row) =>
  Boolean(row.item_bundle_id) && !row.item_code;

const isSkippedRow = (item) =>
  // Skip cancelled items, and parent items with split children (process
  // children instead)
  item.line_status === 'Cancelled' ||
  (item.parent_or_child === 'Parent' && item.is_split === 'Yes');

const buildRecord = (item, putawayQty) => ({
  line_index: item.line_index,
  item_code: item.item_code,
  item_name: item.item_name,
  item_desc: item.item_desc || '',
  batch_no: item.batch_no || '',
  source_inv_category: item.source_inv_category,
  target_inv_category: item.target_inv_category,
  store_in_qty: putawayQty,
  item_uom: item.item_uom,
  source_bin: item.source_bin || '',
  target_location: item.target_location || '',
  remark: item.remark || '',
  line_status: 'Confirmed',
  confirmed_by: {{workflowparams:confirmed_by}} || "",
  confirmed_at: new Date().toISOString().replace("T", " ").slice(0, 19),
});

// One line: its totals, its putaway record, and its entry for inventory
// processing. Returns the record, or null when the line puts nothing away.
const processLine = (item) => {
  if (isSkippedRow(item)) return null;

  const putawayQty = parseFloat(item.putaway_qty) || 0;

  // Track totals for parent items only
  if (item.parent_or_child !== 'Child') {
    totalOriginalQuantity += parseFloat(item.qty_to_putaway) || 0;
  }
  totalPutawayQuantity += putawayQty;

  // Only create records for items with quantity
  if (putawayQty <= 0) return null;

  hasAnyQuantity = true;

  // The bundle row moves no stock, so it gets a record but no inventory entry.
  // The items under it are what actually move.
  if (!isBundleParentRow(item)) {
    itemsToProcess.push({
      putaway_line_id: item.id || '',
      item_code: item.item_code,
      item_uom: item.item_uom,
      putaway_qty: putawayQty,
      source_bin: item.source_bin || '',
      storage_location: item.storage_location || '',
      target_location: item.target_location || '',
      batch_no: item.batch_no || '',
      source_inv_category: item.source_inv_category,
      target_inv_category: item.target_inv_category,
      unit_price: parseFloat(item.unit_price) || 0,
      hu_data: item.hu_data || '',
    });
  }

  return buildRecord(item, putawayQty);
};

for (const item of allData.table_putaway_item) {
  const record = processLine(item);

  // A bundle keeps its items under `children` in the putaway records too, so
  // the records read the same way the items do.
  const bundleChildren = Array.isArray(item.children) ? item.children : [];
  const childRecords = [];

  for (const child of bundleChildren) {
    const childRecord = processLine(child);

    if (childRecord) {
      childRecords.push(childRecord);
    }
  }

  if (record) {
    if (childRecords.length > 0) {
      record.children = childRecords;
    }

    records.push(record);
  } else {
    // The row itself put nothing away this run; anything its items did put away
    // is kept rather than dropped along with it.
    for (const childRecord of childRecords) {
      records.push(childRecord);
    }
  }
}

// Extract unique item codes for Item master lookup
const uniqueItemCodes = [...new Set(itemsToProcess.map(i => i.item_code))];

return {
  records,
  itemsToProcess,
  uniqueItemCodes,
  grId: allData.gr_no || '',
  organizationId: allData.organization_id || '',
  totalOriginalQuantity,
  totalPutawayQuantity,
  hasAnyQuantity
};