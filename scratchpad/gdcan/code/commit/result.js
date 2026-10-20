// GD_CANCEL_COMMIT - Result of one exit: the job status this run left, the path and why
const commitResult = function commitResult(guard, entry, src, path) {
  const e = entry || {};
  const x = src || {};
  return {
    job_id: guard.jobId, job_status: s(x.job_status) || s(e.job_status), path: path, result_code: s(x.result_code), result_message: s(x.result_message) || s(e.result_message),
    evidence: JSON.stringify({ v: 1, workflow: "GD_CANCEL_COMMIT", phase: s(e.phase), path: path }),
  };
};
