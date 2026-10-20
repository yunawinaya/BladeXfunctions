// PICKING_FC_DRIVE - Result: the call's answer {route: DONE | WAIT | ABORTED | REVIEW | NONE | REJECT, kick: the EDIT_GD jobs the
// screen must run GD_EDIT_WORKER on, actions: how many this call took}
const driveResult = function driveResult(guard, entry, next, fin) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const g = guard || {}, e = entry || {}, x = next || {}, f = fin || {};
  if (s(g.route) === "REJECT") return { route: "REJECT", job_id: "", job_status: "", kick: [], actions: 0, progress_message: "", result_code: s(g.result_code), result_message: s(g.result_message) };
  if (s(e.route) !== "GO") {
    return { route: s(e.route) || "NONE", job_id: s(e.jobId), job_status: s(e.jobStatus), kick: [], actions: 0, progress_message: "", result_code: s(e.result_code), result_message: s(e.result_message) };
  }
  const actions = s(x.kind) ? Number(x.index) + (s(x.terminal) === "YES" && s(x.kind) !== "MARK_GDS" ? 0 : 1) : 0;
  return { route: s(f.route) || "WAIT", job_id: s(e.jobId), job_status: s(f.job_status), kick: Array.isArray(f.kick) ? f.kick.map(s) : [], actions: actions,
    progress_message: s(f.progress_message), result_code: s(f.result_code), result_message: s(f.result_message) };
};
const res = driveResult([{{node:code_node_DRguard.data}}][0], [{{node:code_node_DRentry.data}}][0], [{{node:code_node_DRnext.data}}][0], [{{node:code_node_DRfinal.data}}][0]);
console.log("drive result", JSON.stringify(res));
return res;
