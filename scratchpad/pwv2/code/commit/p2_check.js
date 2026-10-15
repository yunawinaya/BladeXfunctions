// PUTAWAY_BULK_COMMIT - P2 check: every line at its after-values, every new record present once (job_line_key), the
// putaway's to_status -> DONE
const PW_LINE_COLS = ["pending_process_qty", "putaway_qty", "line_status", "target_location", "remark", "is_split", "parent_or_child"];
const objsOf = (rows) => list(rows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r.j || r)).filter((o) => o && o.id !== undefined);
const commitP2Check = function commitP2Check(entry, toPartRows, toRows, lineRows, recordRows) {
  const to = joinChunks(toPartRows, entry.partPrefix + "TO|") || {};
  const lines = {};
  for (const o of objsOf(lineRows)) lines[s(o.id)] = o;
  const off = (to.lines || []).filter((l) => !lines[s(l.id)] || !Object.keys(l.after || {}).every((c) => sameStored(l.after[c], lines[s(l.id)][c]))).map((l) => s(l.id));
  if (off.length) return stepEnd(entry, "P2_TO", off.length + " putaway line(s) not at the intended values after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  const count = {};
  for (const r of objsOf(recordRows)) if (s(r.job_line_key)) count[s(r.job_line_key)] = (count[s(r.job_line_key)] || 0) + 1;
  const missing = (to.records || []).filter((r) => count[s(r.job_line_key)] !== 1).map((r) => s(r.job_line_key));
  if (missing.length) return stepEnd(entry, "P2_TO", missing.length + " record(s) missing or doubled after the write (e.g. " + missing.slice(0, 3).join(", ") + ")", false);
  const head = list(toRows)[0] || {};
  if (s(head.to_status) !== s(to.to_status)) return stepEnd(entry, "P2_TO", "the putaway reads back as " + s(head.to_status) + ", not " + s(to.to_status), false);
  return stepOk(entry, "P2_TO", (to.lines || []).length + " line(s), " + (to.records || []).length + " record(s), " + s(to.to_status), "putaway updated");
};
const res = commitP2Check([{{node:code_node_PCentry.data}}][0], [{{node:sql_node_PCp2part.data}}][0], [{{node:sql_node_PCp2headB.data}}][0], [{{node:sql_node_PCp2linesB.data}}][0],
  [{{node:sql_node_PCp2recordsB.data}}][0]);
console.log("commit P2 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
