// IA_REVERT_V2_COMMIT - V3 check: every Batch row of the part removed -> DONE; else retry
const commitV3Check = function commitV3Check(entry, inp, rows) {
  const cur = byId(rows);
  const off = list(inp.ids).filter((id) => !cur[id] || String(cur[id].is_deleted) !== "1");
  if (off.length) return stepEnd(entry, "V3_BATCH", off.length + " batch row(s) not removed after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "V3_BATCH", list(inp.ids).length + " batch row(s) removed", "batches removed");
};
const res = commitV3Check([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCv3in.data}}][0], [{{node:sql_node_IVCv3batchB.data}}][0]);
console.log("commit V3 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
