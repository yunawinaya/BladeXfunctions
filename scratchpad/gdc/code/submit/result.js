// GD_COMPLETE_SUBMIT - Result: the answer of whichever node ended the run; after the queue writes, the read-back decides
const submitResult = function submitResult(guard, entry, src, back) {
  const e = entry || {};
  const r = src || {};
  const out = { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(e.jobId), job_status: s(e.jobStatus), gd_id: s(guard.gdId),
    gd_no: s(e.gdNo), line_count: String(num(e.lineCount)), progress_percent: String(num(e.progressPercent)), progress_message: s(e.progressMessage),
    error_code: s(e.errorCode), error_message: s(e.errorMessage), evidence: "" };
  if (back) {
    const b = list(back)[0] || {};
    const ok = s(b.job_id) && s(b.gd_status) === "Processing" && s(b.lock_ref) === s(r.idemKey);
    Object.assign(out, ok
      ? { route: "QUEUED", code: "200", message: "Queued for processing", job_id: s(b.job_id), job_status: s(b.job_status), progress_percent: "0", progress_message: "Queued for processing" }
      : { route: "STOP", code: "500", message: "The completion could not be queued: please try again.", job_id: s(b.job_id), job_status: s(b.job_status) });
  }
  out.evidence = JSON.stringify({ v: 1, workflow: "GD_COMPLETE_SUBMIT", operation: s(guard.operation), source: s(guard.source), route: out.route, code: out.code, reason: out.reason });
  return out;
};
