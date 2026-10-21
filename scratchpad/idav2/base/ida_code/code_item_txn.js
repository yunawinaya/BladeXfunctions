const entry = {{node:code_fillback.data.allData}};

const ids = [];
if (entry.item_id) ids.push(String(entry.item_id));
(entry.stock_movement || []).forEach(function (line) {
  if (line.item_selection) ids.push(String(line.item_selection));
});

const stamp = new Date().toISOString();

const updates = [];
ids.filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (id) {
  updates.push({ id: id, last_transaction_date: stamp });
});

return { updates: updates };