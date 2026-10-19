// PICKING_ASYNC_SUBMIT - Result: the job read back by its key is the answer (QUEUED / an earlier job of the same click)
const submitResult = function submitResult(guard, decide, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  if (!job) return { route: "REJECT", result_code: "400", result_message: "the request could not be queued; press the button again", job_id: "", job_status: "", picking_id: guard.pickingId };
  const failed = s(job.job_status) === "FAILED" || s(job.job_status) === "REQUIRES_REVIEW";
  return { route: decide.route === "CREATE" ? "QUEUED" : "EXISTING", result_code: failed ? "400" : "200", result_message: failed ? s(job.error_message) || s(job.progress_message) : s(job.progress_message) || "queued", job_id: s(job.id), job_status: s(job.job_status), picking_id: guard.pickingId };
};
const guard = [{{node:code_node_PSguard.data}}][0];
const decide = [{{node:code_node_PSdecide.data}}][0];
const res = submitResult(guard, decide, [{{node:sql_node_PSback.data}}][0]);
console.log("submit result", JSON.stringify(res));
return res;
