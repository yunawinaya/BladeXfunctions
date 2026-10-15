// PUTAWAY_BULK_COMMIT - P3 ids: the in-transit rows the confirmation consumes (the IT part's updates) as a JSON array for
// the P3 reads' JSON_TABLE, so P3 reads those rows, not the receipt's whole ledger; 100 ids per line keeps the SQL short
const commitP3Ids = function commitP3Ids(entry, itPartRows) {
  const it = joinChunks(itPartRows, entry.partPrefix + "IT|") || {};
  const ids = [...new Set((it.updates || []).map((u) => s(u.id)).filter(digits))];
  const lines = [];
  for (let i = 0; i < ids.length; i += 100) lines.push(ids.slice(i, i + 100).map((x) => '"' + x + '"').join(","));
  return { idsSql: "[" + lines.join(",\n") + "]", n: ids.length };
};
const res = commitP3Ids([{{node:code_node_PCentry.data}}][0], [{{node:sql_node_PCp3part.data}}][0]);
console.log("commit P3 ids", JSON.stringify({ n: res.n }));
return res;
