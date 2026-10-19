// GR_COMPLETE_COMMIT - C4 putaway: the receipt's Transfer Order Putaway (code_node_jo9g6Ldx's row; a line's batch_no is the
// batch id, as ADD_INVENTORY's batchId gave it) unless an earlier run of this job added it (gr_no = the GR id, live)
const commitC4To = function commitC4To(entry, toPartRows, batchPartRows, intentRows, batchRows, toRows) {
  const base = { route: "GO", toRow: {}, needTo: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_GR" };
  const part = joinChunks(toPartRows, entry.partPrefix + "TO|");
  if (!part) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", "the putaway part of the prepared payload is missing", true));
  const existing = list(toRows).filter((r) => s(r.id));
  const want = (part.lines || []).length;
  if (!part.header) {
    if (existing.length) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", "a Transfer Order Putaway exists for this receipt although none was planned", true));
    return Object.assign(base, { result_message: "no putaway planned" });
  }
  if (existing.length > 1) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", existing.length + " live Transfer Order Putaways point at this receipt", true));
  if (existing.length === 1) {
    if (num(existing[0].line_count) !== want) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", "Transfer Order Putaway " + s(existing[0].to_id) + " holds " + num(existing[0].line_count) + " of " + want + " line(s)", true));
    return Object.assign(base, { result_message: "Transfer Order Putaway " + s(existing[0].to_id) + " already added" });
  }
  const ids = batchIdMap(entry, batchPartRows, intentRows, batchRows);
  const missing = [];
  const lines = (part.lines || []).map((l) => {
    const o = Object.assign({}, l);
    if (s(l.batch_ref) !== "") {
      o.batch_no = ids[s(l.batch_ref)] || "";
      if (!o.batch_no) missing.push(s(l.batch_ref));
    }
    delete o.batch_ref;
    return o;
  });
  if (missing.length) return Object.assign(base, stepEnd(entry, "C4_PUTAWAY", missing.length + " putaway line batch reference(s) have no batch row (e.g. " + missing.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { toRow: Object.assign({}, part.header, { table_putaway_item: lines }), needTo: "YES", result_message: "Transfer Order Putaway with " + want + " line(s) to add" });
};
const res = commitC4To([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc4part.data}}][0], [{{node:sql_node_RCc4bpart.data}}][0], [{{node:sql_node_RCc4intent.data}}][0],
  [{{node:sql_node_RCc4batch.data}}][0], [{{node:sql_node_RCc4to.data}}][0]);
console.log("commit C4 TO", JSON.stringify({ route: res.route, add: res.needTo, result: res.result_code, message: res.result_message }));
return res;
