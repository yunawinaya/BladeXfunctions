// 8dp is the maximum configurable column precision: rounding COMPUTED values there keeps
// every client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
let data = {{node:code_node_kku8SAT9.data.data}}

// Helper function to format qty and price fields to 3 decimal places

// table_putaway_item is a tree: an item bundle is one row with its items under
// `children`. The items are stock lines in their own right, so their quantities
// are formatted the same way — and rebuilt under the row they belong to, so the
// tree is what gets written to the document.
const formatPutawayLine = (item) => {
  const formatted = {
    ...item,
    received_qty: q8(item.received_qty),
    qty_to_putaway: q8(item.qty_to_putaway),
    putaway_qty: q8(item.putaway_qty),
    pending_process_qty: q8(item.pending_process_qty),
  };

  if (Array.isArray(item.children)) {
    formatted.children = item.children.map((child) => formatPutawayLine(child));
  }

  return formatted;
};

// Format qty fields in table_putaway_item
if (data.table_putaway_item && data.table_putaway_item.length > 0) {
  data.table_putaway_item = data.table_putaway_item.map(formatPutawayLine);
}

// Format qty fields in table_putaway_records if exists
if (data.table_putaway_records && data.table_putaway_records.length > 0) {
  data.table_putaway_records = data.table_putaway_records.map(item => ({
    ...item,
    store_in_qty: q8(item.store_in_qty),
  }));
}

return {
  data
}