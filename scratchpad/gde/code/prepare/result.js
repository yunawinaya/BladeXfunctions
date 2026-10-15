// GD_EDIT_PREPARE - Result: the job read back after the write is the answer (READY_TO_COMMIT / FAILED)
const prepareResult = function prepareResult(guard, entry, ready, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const e = entry || {}, r = ready || {};
  return { job_id: guard.jobId, job_status: job ? s(job.job_status) : "", result_code: s(r.result_code) || s(e.result_code), result_message: s(r.result_message) || s(e.result_message),
    evidence: JSON.stringify({ v: 1, workflow: "GD_EDIT_PREPARE", entry: s(e.route), ready: s(r.route) }) };
};
