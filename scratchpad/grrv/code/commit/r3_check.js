// GR_REVERT_COMMIT - R3 check: every document of the receipt removed / cancelled -> DONE
const commitR3Check = function commitR3Check(entry, inp, toRows, itRows, qiRows, batchRows) {
  const docs = inp.docs || {};
  const to = byId(toRows);
  const it = byId(itRows);
  const qi = byId(qiRows);
  const bt = byId(batchRows);
  const off = [];
  for (const id of list(docs.putaway)) if (!to[id] || String(to[id].is_deleted) !== "1") off.push("putaway " + id);
  for (const id of list(docs.transit)) if (!it[id] || s(it[id].status) !== "Cancelled" || Math.abs(num(it[id].open_qty)) > 1e-8) off.push("in-transit row " + id);
  for (const id of list(docs.qi)) if (!qi[id] || String(qi[id].is_deleted) !== "1") off.push("inspection lot " + id);
  for (const id of list(docs.batches)) if (!bt[id] || String(bt[id].is_deleted) !== "1") off.push("batch " + id);
  if (off.length) return stepEnd(entry, "R3_DOCS", off.length + " document(s) not removed after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "R3_DOCS", list(docs.putaway).length + " putaway(s), " + list(docs.transit).length + " in-transit row(s), " + list(docs.qi).length + " inspection lot(s), "
    + list(docs.batches).length + " batch(es)", "documents removed");
};
const res = commitR3Check([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCr3in.data}}][0], [{{node:sql_node_VCr3toB.data}}][0], [{{node:sql_node_VCr3itB.data}}][0],
  [{{node:sql_node_VCr3qiB.data}}][0], [{{node:sql_node_VCr3batchB.data}}][0]);
console.log("commit R3 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
