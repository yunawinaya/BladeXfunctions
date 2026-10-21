const entry = {{node:code_fillback.data.allData}};
const items = {{node:search_items.data.data}} || [];
const userId = {{system:uid}};

const itemMap = {};
items.forEach(function (it) { itemMap[String(it.id)] = it; });

// Only rows whose item numbers batches automatically, and that still hold the
// form's placeholder, need a real number before stock can be received.
const genLines = [];
(entry.stock_movement || []).forEach(function (line, index) {
  const item = itemMap[String(line.item_selection)] || {};
  const batch = String(line.batch_number || '');
  if (item.item_batch_management === 1 &&
      item.batch_number_genaration === 'According To System Settings' &&
      (batch === '' || batch === 'Auto-generated batch number')) {
    genLines.push({
      index: index,
      item_id: String(line.item_selection),
      document_date: entry.item_disassembly_date || null,
      manufacturing_date: line.manufacturing_date || null,
      expired_date: line.expired_date || null
    });
  }
});

return {
  genLines: genLines,
  genCount: genLines.length,
  // Cache keys are global, so each run gets its own.
  cacheKey: String(userId || '') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
};