// GR_COMPLETE_SUBMIT - Result: the answer of whichever node ended the run; after the queue writes, the read-back decides
const submitResult = function submitResult(guard, entry, src, back) {
  const e = entry || {};
  const r = src || {};
  const out = { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(e.jobId), job_status: s(e.jobStatus), gr_id: s(e.grId) === "0" ? "" : s(e.grId),
    gr_no: s(e.grNo), line_count: String(num(e.lineCount)), progress_percent: String(num(e.progressPercent)), progress_message: s(e.progressMessage),
    error_code: s(e.errorCode), error_message: s(e.errorMessage), evidence: "" };
  if (back) {
    const b = list(back)[0] || {};
    const ok = digits(b.job_id) && s(b.gr_status) === "Processing" && s(b.gr_v2_job_id) === s(b.job_id) && s(b.lock_ref) === guard.key;
    const m = s(b.correlation_id).match(/^GR\|([0-9]{1,20})$/);
    Object.assign(out, ok
      ? { route: "QUEUED", code: "200", message: "Queued for processing", job_id: s(b.job_id), job_status: s(b.job_status), gr_id: m ? m[1] : out.gr_id, gr_no: s(b.gr_no),
        progress_percent: "0", progress_message: "Queued for processing" }
      : { route: "STOP", code: "500", message: "The completion could not be queued: please try again.", job_id: s(b.job_id), job_status: s(b.job_status) });
  }
  out.evidence = JSON.stringify({ v: 1, workflow: "GR_COMPLETE_SUBMIT", operation: s(guard.operation), page: s(guard.pageStatus), route: out.route, code: out.code, reason: out.reason });
  return out;
};
