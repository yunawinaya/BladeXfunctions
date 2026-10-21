// GR_COMPLETE_COMMIT - C4 in-transit: the receipt's in_transit_detail rows (code_node_ITrow / ITrows: doc = the GR, target_doc
// = the putaway read back, batch = C1's) less those an earlier run of this job added (same doc_line_id, not Cancelled)
const commitC4It = function commitC4It(entry, toPartRows, batchPartRows, intentRows, batchRows, toRows, itRows) {
  const base = { route: "GO", itSlices: [], itCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_GR" };
  const part = joinChunks(toPartRows, entry.partPrefix + "TO|");
  if (!part) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", "the putaway part of the prepared payload is missing", true));
  const to = list(toRows).filter((r) => s(r.id));
  if (part.header && to.length !== 1) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", "the Transfer Order Putaway did not read back (" + to.length + " found)", false));
  const toId = to.length ? s(to[0].id) : "";
  const toNo = to.length ? s(to[0].to_id) : "";
  const have = {};
  for (const r of list(itRows)) {
    const o = parseJ(r.j);
    if (o && o.id) have[s(o.doc_line_id)] = (have[s(o.doc_line_id)] || 0) + 1;
  }
  const byLine = {};
  for (const r of part.inTransit || []) (byLine[s(r.line_id)] = byLine[s(r.line_id)] || []).push(r);
  const ids = batchIdMap(entry, batchPartRows, intentRows, batchRows);
  const add = [];
  const odd = [];
  const missing = [];
  for (const line of Object.keys(byLine)) {
    const n = have[line] || 0;
    if (n === byLine[line].length) continue;
    if (n) { odd.push(line); continue; }
    for (const r of byLine[line]) {
      const o = Object.assign({}, r, { doc_id: entry.grId, doc_no: entry.grNo, doc_line_id: line, target_doc_type: toId ? "Putaway" : "", target_doc_id: toId, target_doc_no: toNo, target_doc_line_id: "" });
      if (s(r.batch_ref) !== "") {
        o.batch_id = ids[s(r.batch_ref)] || "";
        if (!o.batch_id) missing.push(s(r.batch_ref));
      }
      delete o.batch_ref;
      delete o.line_id;
      add.push(o);
    }
  }
  if (odd.length) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", odd.length + " receipt line(s) hold part of their in-transit rows (e.g. " + odd.slice(0, 3).join(", ") + ")", true));
  if (missing.length) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", missing.length + " in-transit batch reference(s) have no batch row (e.g. " + missing.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { itSlices: slicesOf(add, 250), itCount: add.length, result_message: add.length + " in-transit row(s) to add" });
};
const res = commitC4It([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc4part.data}}][0], [{{node:sql_node_RCc4bpart.data}}][0], [{{node:sql_node_RCc4intent.data}}][0],
  [{{node:sql_node_RCc4batch.data}}][0], [{{node:sql_node_RCc4toB.data}}][0], [{{node:sql_node_RCc4it.data}}][0]);
console.log("commit C4 in-transit", JSON.stringify({ route: res.route, add: res.itCount, result: res.result_code, message: res.result_message }));
return res;
