// GD_COMPLETE_COMMIT - C4P check: every Picking row and header of the intent reads back at its after-values -> DONE
const commitC4PCheck = function commitC4PCheck(entry, intentRows, byIdRows) {
  const intent = joinChunks(intentRows, "C4P|I|");
  if (!intent) return stepEnd(entry, "C4P_PICKING", "the recorded intent cannot be read back", false);
  const line = {};
  const head = {};
  for (const r of list(byIdRows)) {
    if (s(r.k) === "L") line[s(r.id)] = r;
    else if (s(r.k) === "P") head[s(r.id)] = r;
  }
  const off = (intent.lines || []).filter((r) => !line[r.id] || s(line[r.id].status) !== r.after.line_status || !sameVal(line[r.id].pending, r.after.pending_process_qty));
  const offH = (intent.pickings || []).filter((h) => !head[h.id] || s(head[h.id].status) !== h.after.to_status);
  if (off.length || offH.length) return stepEnd(entry, "C4P_PICKING", off.length + " Picking row(s) and " + offH.length + " Picking header(s) do not read back", false);
  return stepOk(entry, "C4P_PICKING", (intent.lines || []).length + " Picking row(s), " + (intent.pickings || []).length + " Picking header(s) closed", "Picking closed");
};
const res = commitC4PCheck([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc4pintentB.data}}][0], [{{node:sql_node_CCc4prowsB.data}}][0]);
console.log("commit C4P check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
