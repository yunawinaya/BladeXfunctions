// GR_COMPLETE_SUBMIT - Receipt row: the gate's filled-back GR (code_node_4r2Fv9G5's allData, as add_node_nGMSu41b /
// update_node_a31whzYI write it) Processing under the job just inserted (gr_v2_job_id), with the status it had before
const submitGrRow = function submitGrRow(guard, post, gate, jobAdded) {
  const job = list(jobAdded)[0] || {};
  const jobId = s(job.id);
  const a = gate.allData || {};
  const row = Object.assign({}, a, { gr_status: "Processing", previous_status: post.previousStatus, gr_v2_job_id: jobId });
  if (guard.pageStatus === "Edit") row.id = guard.grId;
  else delete row.id;
  return { ok: digits(jobId) ? "YES" : "NO", jobId: jobId, grRow: row };
};
const res = submitGrRow([{{node:code_node_RSguard.data}}][0], [{{node:code_node_RSpost.data}}][0], [{{node:code_node_RSgate.data}}][0], [{{node:add_node_RSjob.data}}][0]);
console.log("submit receipt row", JSON.stringify({ ok: res.ok, job: res.jobId, lines: (res.grRow.table_gr || []).length }));
return res;
