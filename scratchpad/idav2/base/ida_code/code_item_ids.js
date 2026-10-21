const entry = {{node:code_fillback.data.allData}};

// The source BOM item plus every recovery item, in one fetch.
const ids = [];
if (entry.item_id) ids.push(String(entry.item_id));
(entry.stock_movement || []).forEach(function (line) {
  if (line.item_selection) ids.push(String(line.item_selection));
});

// Typed batch numbers, so Validate Disassembly can reject one that already
// exists. '-' and the auto-generate placeholder are not real numbers. The
// sentinel keeps the lookup from matching everything when nothing was typed.
const batchNumbers = [];
(entry.stock_movement || []).forEach(function (line) {
  const batch = String(line.batch_number || '').trim();
  if (batch && batch !== '-' && batch !== 'Auto-generated batch number' &&
      batchNumbers.indexOf(batch) === -1) {
    batchNumbers.push(batch);
  }
});
if (batchNumbers.length === 0) batchNumbers.push('__no_batch__');

return {
  itemIds: ids.filter(function (v, i, a) { return a.indexOf(v) === i; }),
  batchNumbers: batchNumbers
};