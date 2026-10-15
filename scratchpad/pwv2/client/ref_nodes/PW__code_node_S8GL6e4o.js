const allData = {{workflowparams:allData}};

const errors = [];

// table_putaway_item is a tree: an item bundle is one row with its items under
// `children`. The items are stock lines in their own right and are validated as
// such. Split children are flat siblings, so `children` only ever means a bundle.
const flattenPutawayRows = (rows) => {
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

// The bundle row carries the bundle id and no item code. It holds no stock — no
// bin, nothing of its own to store away — so none of the checks below apply.
const isBundleParentRow = (row) =>
  Boolean(row.item_bundle_id) && !row.item_code;

const items = flattenPutawayRows(allData.table_putaway_item);

for (let index = 0; index < items.length; index++) {
  const item = items[index];

  // Skip cancelled items
  if (item.line_status === 'Cancelled') continue;

  // Skip parent items with split children
  if (item.parent_or_child === 'Parent' && item.is_split === 'Yes') continue;

  // Skip item bundle rows
  if (isBundleParentRow(item)) continue;

  const putawayQty = parseFloat(item.putaway_qty) || 0;
  const pendingProcessQty = parseFloat(item.pending_process_qty) || 0;

  // Validate putaway_qty doesn't exceed pending_process_qty
  if (putawayQty > pendingProcessQty) {
    errors.push(
      `Putaway quantity (${putawayQty}) cannot be greater than pending quantity (${pendingProcessQty}) for item ${item.item_code || '#' + (index + 1)}`
    );
  }

  // Validate putaway_qty is not negative
  if (putawayQty < 0) {
    errors.push(
      `Putaway quantity cannot be negative for item ${item.item_code || '#' + (index + 1)}`
    );
  }

  // Check target location for items with putaway_qty > 0 (non-split items only)
  if (item.is_split === 'No' && putawayQty > 0) {
    if (!item.target_location || item.target_location === null || item.target_location === '') {
      errors.push(
        `Target Location is required for item ${item.item_code || '#' + (index + 1)} (Putaway Qty: ${putawayQty})`
      );
    }
  }
}

// The stored lines decide what is still pending: a stale screen (a mobile copy opened before another confirmation)
// must not post a line twice. Quantities are grouped the way code_node_KbJLkjP8 applies them ("<line> - <n>" split
// children count against their line).
const storedRaw = [{{node:get_node_C64LC1sr.data.data}}][0];
const stored = Array.isArray(storedRaw) ? storedRaw[0] || {} : storedRaw || {};
const storedLines = {};
for (const row of flattenPutawayRows(stored.table_putaway_item)) {
  storedLines[String(row.line_index)] = row;
}
const claimed = {};
for (const item of items) {
  if (item.line_status === 'Cancelled') continue;
  if (item.parent_or_child === 'Parent' && item.is_split === 'Yes') continue;
  if (isBundleParentRow(item)) continue;
  const qty = parseFloat(item.putaway_qty) || 0;
  if (qty <= 0) continue;
  const lineIndex = String(item.line_index);
  const key = lineIndex.includes(' - ') ? lineIndex.split(' - ')[0] : lineIndex;
  claimed[key] = (claimed[key] || 0) + qty;
}
for (const key of Object.keys(claimed)) {
  const row = storedLines[key];
  if (!row) continue;
  const pending = parseFloat(row.pending_process_qty) || 0;
  if (claimed[key] - pending > 0.0005) {
    errors.push(
      `Putaway quantity (${claimed[key]}) cannot be greater than the pending quantity (${pending}) of line ${key}${row.item_name ? ' (' + row.item_name + ')' : ''} - it may already have been put away; please reload the putaway.`
    );
  }
}

const isValid = errors.length === 0 ? 1 : 0;

return {
  isValid: isValid,
  errors: errors,
  errorMessage: errors.join('; ')
};