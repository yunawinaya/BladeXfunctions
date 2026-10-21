// IA_REVERT_V2_SUBMIT - The IA row: Processing under the job just inserted (prevStatus travels in the request)
const submitIaRow = function submitIaRow(guard, jobAdded) {
  const job = list(jobAdded)[0] || {};
  const jobId = s(job.id);
  const ok = digits(jobId);
  return { ok: ok ? "YES" : "NO", jobId: jobId, iaRows: ok ? [{ id: guard.iaId, item_assembly_status: "Processing", ia_v2_job_id: jobId }] : [] };
};
const res = submitIaRow([{{node:code_node_IVSguard.data}}][0], [{{node:add_node_IVSjob.data}}][0]);
console.log("submit ia row", JSON.stringify({ ok: res.ok, job: res.jobId }));
return res;
