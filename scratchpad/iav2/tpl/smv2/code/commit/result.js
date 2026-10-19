// LOT_V2_COMMIT - Result of one exit: the job status this run left, the path (SPLIT / PARK from L1's hand-over) and why
const commitResult = function commitResult(guard, entry, src, path) {
  const e = entry || {};
  const x = src || {};
  const p = s(x.path) || path;
  return {
    job_id: guard.jobId, job_status: s(x.job_status) || s(e.job_status), path: p, result_code: s(x.result_code), result_message: s(x.result_message) || s(e.result_message),
    evidence: JSON.stringify({ v: 1, workflow: "LOT_V2_COMMIT", phase: s(e.phase), action: s(e.action), path: p }),
  };
};
