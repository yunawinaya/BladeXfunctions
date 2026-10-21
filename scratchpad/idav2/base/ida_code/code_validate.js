// 8dp is the maximum configurable column precision: rounding COMPUTED values there keeps
// every client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const entry = {{node:code_fillback.data.allData}};
const storedStatus = {{node:code_fillback.data.storedStatus}};
const items = {{node:search_items.data.data}} || [];
const existingBatches = {{node:search_batches.data.data}} || [];

const itemMap = {};
items.forEach(function (it) { itemMap[String(it.id)] = it; });

let message = '';

// Re-completing a disassembly would move stock a second time.
if (storedStatus === 'Completed') {
  message = 'This Item Disassembly is already Completed and cannot be saved again.';
}

if (!message && !itemMap[String(entry.item_id)]) {
  message = 'The BOM item to disassemble could not be found.';
}

const itemQty = q8(entry.item_qty);
if (!message && itemQty <= 0) {
  message = 'Disassembly quantity must be greater than zero.';
}
if (!message && !entry.item_uom) {
  message = 'Quantity UOM is required.';
}

// --- Source allocation -------------------------------------------------------
let picks = [];
if (!message) {
  try {
    picks = entry.temp_qty_data ? JSON.parse(entry.temp_qty_data) : [];
    if (!Array.isArray(picks)) throw new Error('not an array');
  } catch (e) {
    message = 'The selected stock data is invalid. Select the stock again.';
    picks = [];
  }
}
picks = picks.filter(function (p) { return q8(p.sm_quantity) > 0; });

if (!message && picks.length === 0) {
  message = 'No source stock has been allocated. Select the stock to disassemble.';
}

// temp_qty_data already carries HU picks in balance shape. temp_hu_data is only
// dialog state -- adding it here would count HU stock twice.
if (!message) {
  const allocated = q8(picks.reduce(function (sum, p) {
    return sum + (parseFloat(p.sm_quantity) || 0);
  }, 0));
  if (Math.abs(allocated - itemQty) > 0.00000001) {
    message = 'The allocated stock (' + allocated + ') does not match the disassembly quantity (' +
      itemQty + '). Select the stock again.';
  }
}

const seenSerials = {};
for (let i = 0; i < picks.length && !message; i++) {
  const p = picks[i];
  if (!p.location_id) {
    message = 'Selected stock ' + (i + 1) + ': the bin location is missing. Select the stock again.';
    break;
  }
  const serial = p.serial_number ? String(p.serial_number).trim() : '';
  if (serial) {
    const key = [p.location_id, p.batch_id || '', serial].join('|');
    if (seenSerials[key]) {
      message = 'Serial number ' + serial + ' is selected more than once.';
    }
    seenSerials[key] = true;
  }
}

// --- Recovery components -----------------------------------------------------
const lines = entry.stock_movement || [];
if (!message && lines.length === 0) {
  message = 'There are no recovery components. Add at least one item to recover.';
}

// A typed batch number creates a new batch, so it must not already exist in
// this organization. Within the document, two lines of the same item may
// share one (one batch received into two bins), different items may not.
const existingBatchNumbers = {};
existingBatches.forEach(function (b) {
  existingBatchNumbers[String(b.batch_number).trim()] = true;
});
const batchOwner = {};

for (let i = 0; i < lines.length && !message; i++) {
  const line = lines[i];
  const label = 'Line ' + (i + 1) + ' (' + (line.item_name || line.item_selection || '-') + ')';
  const item = itemMap[String(line.item_selection)];

  if (!line.item_selection) {
    message = label + ': item is required.';
  } else if (!item) {
    message = label + ': the item could not be found.';
  } else if (q8(line.total_quantity) <= 0) {
    message = label + ': quantity must be greater than zero.';
  } else if (!line.quantity_uom) {
    message = label + ': UOM is required.';
  } else if (!line.storage_location_id) {
    message = label + ': storage location is required.';
  } else if (!line.location_id) {
    message = label + ': bin location is required.';
  } else if (item.serial_number_management === 1) {
    // The recovery table has no serial number field yet, so a serial item
    // cannot be received correctly.
    message = label + ': serial-managed items cannot be recovered yet.';
  } else if (item.item_batch_management === 1 &&
             item.batch_number_genaration !== 'According To System Settings') {
    const batch = String(line.batch_number || '').trim();
    if (batch === '' || batch === '-' || batch === 'Auto-generated batch number') {
      message = label + ': Batch number is required.';
    } else if (existingBatchNumbers[batch]) {
      message = label + ': Batch No ' + batch + ' already exists.';
    } else if (batchOwner[batch] && batchOwner[batch] !== String(line.item_selection)) {
      message = label + ': Batch No ' + batch + ' is already used by another item in this document.';
    } else {
      batchOwner[batch] = String(line.item_selection);
    }
  }
}

return { status: message ? 'Failed' : 'Passed', message: message };