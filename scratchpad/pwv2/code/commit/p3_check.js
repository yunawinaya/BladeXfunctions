// PUTAWAY_BULK_COMMIT - P3 check: every consumed row at its after-values, every remainder present once -> DONE
const IT_UPD_COLS = ["transit_qty", "received_qty", "open_qty", "status", "to_bin", "to_category", "target_doc_type", "target_doc_id", "target_doc_no", "target_doc_line_id"];
const commitP3Check = function commitP3Check(entry, itPartRows, updRows, keyRows) {
  const it = joinChunks(itPartRows, entry.partPrefix + "IT|") || {};
  const cur = {};
  for (const r of list(updRows)) { const o = typeof r.j === "string" ? parseJ(r.j) : r.j || r; if (o && o.id !== undefined) cur[s(o.id)] = o; }
  const off = (it.updates || []).filter((u) => !cur[s(u.id)] || !IT_UPD_COLS.every((k) => sameStored(u[k], cur[s(u.id)][k]))).map((u) => s(u.id));
  if (off.length) return stepEnd(entry, "P3_TRANSIT", off.length + " in-transit row(s) not at the intended values after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  const count = {};
  for (const r of list(keyRows)) { const o = typeof r.j === "string" ? parseJ(r.j) : r.j || r; if (o && s(o.job_line_key)) count[s(o.job_line_key)] = (count[s(o.job_line_key)] || 0) + 1; }
  const missing = (it.creates || []).filter((c) => count[s(c.job_line_key)] !== 1).map((c) => s(c.job_line_key));
  if (missing.length) return stepEnd(entry, "P3_TRANSIT", missing.length + " in-transit remainder(s) missing or doubled after the write (e.g. " + missing.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "P3_TRANSIT", (it.updates || []).length + " closed, " + (it.creates || []).length + " added", "in-transit ledger updated");
};
const res = commitP3Check([{{node:code_node_PCentry.data}}][0], [{{node:sql_node_PCp3part.data}}][0], [{{node:sql_node_PCp3rowsB.data}}][0], [{{node:sql_node_PCp3keysB.data}}][0]);
console.log("commit P3 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
