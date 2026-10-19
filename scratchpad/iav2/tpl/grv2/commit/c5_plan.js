// GR_COMPLETE_COMMIT - C5 plan: Item last_transaction_date (code_node_2Cq2eMRb, the time PREPARE planned it) in slices, then
// the receipt's gr_status (Completed / Received) and putaway_status (unchanged when no putaway applies) - the end of its
// Processing lock
const commitC5Plan = function commitC5Plan(entry, grPartRows, afterPartRows, grRows) {
  const base = { route: "GO", headerRows: [], itemSlices: [], jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_GR" };
  const g = joinChunks(grPartRows, entry.partPrefix + "GR|");
  const a = joinChunks(afterPartRows, entry.partPrefix + "AFTER|");
  if (!g || !g.patch || !s(g.patch.gr_status) || !a) return Object.assign(base, stepEnd(entry, "C5_FINISH", "the receipt / after part of the prepared payload is missing", true));
  const stored = list(grRows)[0] || {};
  const now = new Date().toISOString();
  const items = (a.itemDates || []).map((x) => (x && typeof x === "object" ? x : { id: x })).filter((x) => digits(x.id))
    .map((x) => ({ id: s(x.id), last_transaction_date: s(x.last_transaction_date) || now }));
  const putaway = g.patch.putaway_status === undefined || g.patch.putaway_status === null ? s(stored.putaway_status) : s(g.patch.putaway_status);
  return Object.assign(base, { headerRows: [{ id: entry.grId, gr_status: s(g.patch.gr_status), putaway_status: putaway }], itemSlices: slicesOf(items, 250),
    result_message: "Goods Receiving " + entry.grNo + " -> " + s(g.patch.gr_status) + "; " + items.length + " item date(s)" });
};
const res = commitC5Plan([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc5part.data}}][0], [{{node:sql_node_RCc5after.data}}][0], [{{node:sql_node_RCc5gr.data}}][0]);
console.log("commit C5 plan", JSON.stringify({ route: res.route, header: res.headerRows, items: res.itemSlices.length, result: res.result_code, message: res.result_message }));
return res;
