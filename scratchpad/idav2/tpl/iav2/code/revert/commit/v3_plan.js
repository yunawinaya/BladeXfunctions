// IA_REVERT_V2_COMMIT - V3 plan: soft-delete the Batch rows the assembly minted (update_node_iaRvBatchDel)
const commitV3Plan = function commitV3Plan(entry, inp, rows) {
  const base = { route: "GO", batchSlices: [], batchCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_REVERT" };
  if (s(inp.ok) !== "YES") return Object.assign(base, stepEnd(entry, "V3_BATCH", s(inp.why), true));
  const cur = byId(rows);
  const gone = list(inp.ids).filter((id) => !cur[id]);
  if (gone.length) return Object.assign(base, stepEnd(entry, "V3_BATCH", gone.length + " batch row(s) cannot be found (e.g. " + gone.slice(0, 3).join(", ") + ")", true));
  const out = list(inp.ids).filter((id) => String(cur[id].is_deleted) !== "1").map((id) => ({ id: id, is_deleted: 1 }));
  return Object.assign(base, { batchSlices: slicesOf(out, 250), batchCount: out.length, result_message: out.length + " batch row(s) to remove" });
};
const res = commitV3Plan([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCv3in.data}}][0], [{{node:sql_node_IVCv3batch.data}}][0]);
console.log("commit V3 plan", JSON.stringify({ route: res.route, batches: res.batchCount, result: res.result_code, message: res.result_message }));
return res;
