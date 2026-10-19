// IA_REVERT_V2_PREPARE - Result: the job as read back after the write (READY_TO_COMMIT / FAILED / REQUIRES_REVIEW)
const prepareResult = function prepareResult(guard, entry, ready, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const e = entry || {};
  const r = ready || {};
  return {
    job_id: guard.jobId, job_status: job ? s(job.job_status) : "", result_code: s(r.result_code) || s(e.result_code), result_message: s(r.result_message) || s(e.result_message),
    evidence: JSON.stringify({ v: 1, workflow: "IA_REVERT_V2_PREPARE", entry: s(e.route), ready: s(r.route) }),
  };
};
const res = prepareResult([{{node:code_node_IVPguard.data}}][0], [{{node:code_node_IVPentry.data}}][0], [__READY__][0], [{{node:__BACK__.data}}][0]);
console.log("prepare result", JSON.stringify(res));
return res;
