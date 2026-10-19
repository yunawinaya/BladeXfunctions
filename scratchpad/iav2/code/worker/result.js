// IA_V2_WORKER - Result (__PATH__): the planned jobs as read back at the end of the tick
const workerResult = function workerResult(guard, plan, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id));
  const byId = {};
  for (const r of list) byId[s(r.id)] = r;
  const jobs = ((plan && plan.items) || []).map((it) => {
    const j = byId[it.jobId] || null;
    return { job_id: it.jobId, before: it.jobStatus, job_status: j ? s(j.job_status) : "", error_code: j ? s(j.error_code) : "", gr_id: j ? s(j.gr_id) : "", attempt_count: j ? s(j.attempt_count) : "" };
  });
  const first = jobs[0] || null;
  const firstRow = first ? byId[first.job_id] || null : null;
  return { worker_route: guard.route === "REJECT" ? "REJECTED" : !plan || plan.route === "IDLE" ? "IDLE" : "WORKED", processed: String(jobs.length), jobs: JSON.stringify(jobs), job_id: first ? first.job_id : "", job_status: first ? first.job_status : "", result_code: firstRow && s(firstRow.error_code) ? s(firstRow.error_code) : s(guard.result_code), result_message: firstRow && s(firstRow.error_message) ? s(firstRow.error_message) : s(guard.result_message) || s(plan && plan.result_message), gr_id: first ? first.gr_id : "", evidence: JSON.stringify({ v: 1, workflow: "IA_V2_WORKER", path: "__PATH__" }) };
};
const guard = [{{node:code_node_RWguard.data}}][0];
const plan = __PLAN__;
const res = workerResult(guard, plan, __ROWS__);
console.log("worker result", JSON.stringify({ route: res.worker_route, processed: res.processed }));
return res;
