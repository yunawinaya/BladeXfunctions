// PICKING_BULK_COMMIT - P3 slice: rows [index * 250, + 250) of the P3 plan
const writeBatchPick = function writeBatchPick(rows, indexRaw, size) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const index = indexRaw === undefined || indexRaw === null || indexRaw === "" ? 0 : Math.max(0, parseInt(String(indexRaw), 10) || 0);
  const part = list.slice(index * size, (index + 1) * size);
  return { rows: part, index: index, nextIndex: index + 1, count: part.length, from: index * size };
};
const res = writeBatchPick([{{node:code_node_PCp3plan.data.rows}}][0], {{node:get_cache_PCp3idx.data}}, 250);
console.log("commit P3 slice", JSON.stringify({ index: res.index, from: res.from, count: res.count }));
return res;
