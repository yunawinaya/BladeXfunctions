// GR_REVERT_COMMIT - R3 plan: the documents the receipt created, as GR_REVERT_COMPLETED removes them - its putaway
// (is_deleted 1; never while it is being processed), its in-transit rows (Cancelled, open 0), its inspection lots and the
// batches its split lines minted (is_deleted 1). Absolute writes of what is not yet in that state
const commitR3Plan = function commitR3Plan(entry, inp, toRows, itRows, qiRows, batchRows) {
  const base = { route: "GO", toSlices: [], toCount: 0, itSlices: [], itCount: 0, qiSlices: [], qiCount: 0, batchSlices: [], batchCount: 0, jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_REVERT" };
  if (s(inp.ok) !== "YES") return Object.assign(base, stepEnd(entry, "R3_DOCS", s(inp.why), true));
  const docs = inp.docs || {};
  const to = byId(toRows);
  const it = byId(itRows);
  const qi = byId(qiRows);
  const bt = byId(batchRows);
  const gone = [];
  const busy = [];
  const toOut = [];
  for (const id of list(docs.putaway)) {
    const cur = to[id];
    if (!cur) gone.push("putaway " + id);
    else if (String(cur.is_deleted) === "1") continue;
    else if (String(cur.is_processing) === "1") busy.push(s(cur.to_id) || id);
    else toOut.push({ id: id, is_deleted: 1 });
  }
  if (busy.length) return Object.assign(base, stepWait(entry, "R3_DOCS", "putaway " + busy.slice(0, 3).join(", ") + " is being processed right now", 15));
  const itOut = [];
  for (const id of list(docs.transit)) {
    const cur = it[id];
    if (!cur) gone.push("in-transit row " + id);
    else if (s(cur.status) === "Cancelled" && Math.abs(num(cur.open_qty)) <= 1e-8) continue;
    else itOut.push({ id: id, status: "Cancelled", open_qty: "0.00000000" });
  }
  const del = (ids, rows, tag, out) => {
    for (const id of list(ids)) {
      const cur = rows[id];
      if (!cur) gone.push(tag + " " + id);
      else if (String(cur.is_deleted) !== "1") out.push({ id: id, is_deleted: 1 });
    }
  };
  const qiOut = [];
  const batchOut = [];
  del(docs.qi, qi, "inspection lot", qiOut);
  del(docs.batches, bt, "batch", batchOut);
  if (gone.length) return Object.assign(base, stepEnd(entry, "R3_DOCS", gone.length + " document(s) of the receipt cannot be found (e.g. " + gone.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, {
    toSlices: slicesOf(toOut, 250), toCount: toOut.length, itSlices: slicesOf(itOut, 250), itCount: itOut.length, qiSlices: slicesOf(qiOut, 250), qiCount: qiOut.length,
    batchSlices: slicesOf(batchOut, 250), batchCount: batchOut.length,
    result_message: toOut.length + " putaway(s), " + itOut.length + " in-transit row(s), " + qiOut.length + " inspection lot(s), " + batchOut.length + " batch(es) to remove",
  });
};
const res = commitR3Plan([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCr3in.data}}][0], [{{node:sql_node_VCr3to.data}}][0], [{{node:sql_node_VCr3it.data}}][0],
  [{{node:sql_node_VCr3qi.data}}][0], [{{node:sql_node_VCr3batch.data}}][0]);
console.log("commit R3 plan", JSON.stringify({ route: res.route, to: res.toCount, it: res.itCount, qi: res.qiCount, batches: res.batchCount, result: res.result_code, message: res.result_message }));
return res;
