// GR_REVERT_SUBMIT - Receipt row: Processing under the job just inserted (gr_v2_job_id); the status it had before travels
// in the job's request
const submitGrRow = function submitGrRow(guard, jobAdded) {
  const job = list(jobAdded)[0] || {};
  const jobId = s(job.id);
  const ok = digits(jobId);
  return { ok: ok ? "YES" : "NO", jobId: jobId, grRows: ok ? [{ id: guard.grId, gr_status: "Processing", gr_v2_job_id: jobId }] : [] };
};
const res = submitGrRow([{{node:code_node_VSguard.data}}][0], [{{node:add_node_VSjob.data}}][0]);
console.log("submit receipt row", JSON.stringify({ ok: res.ok, job: res.jobId }));
return res;
