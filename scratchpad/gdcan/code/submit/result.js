// GD_CANCEL_SUBMIT - Result: the answer of whichever node ended the run; after the queue writes, the read-back and the re-check decide
const cancelResult = function cancelResult(guard, entry, src, back, due) {
  const e = entry || {};
  const r = src || {};
  const out = { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(e.jobId), job_status: s(e.jobStatus), gd_id: s(guard.gdId),
    gd_no: s(e.gdNo), line_count: String(num(e.lineCount)), progress_percent: String(num(e.progressPercent)), progress_message: s(e.progressMessage),
    error_code: s(e.errorCode), error_message: s(e.errorMessage), evidence: "" };
  if (back) {
    const b = list(back)[0] || {};
    const d = due || {};
    if (s(d.route) === "DUE") Object.assign(out, { route: "QUEUED", code: "200", message: "Queued for cancelling", job_id: s(b.job_id), job_status: "QUEUED", progress_percent: "0", progress_message: "Queued for cancelling" });
    else if (s(d.route) === "RACE") Object.assign(out, { route: "BUSY", code: "409", message: "A Packing or Picking of this delivery started just now - please wait for it to finish, then cancel again.", job_id: s(b.job_id), job_status: "CANCELLED" });
    else Object.assign(out, { route: "STOP", code: "500", message: "The cancel could not be queued: please try again.", job_id: s(b.job_id), job_status: s(b.job_status) });
  }
  out.evidence = JSON.stringify({ v: 1, workflow: "GD_CANCEL_SUBMIT", operation: s(guard.operation), source: s(guard.source), route: out.route, code: out.code, reason: out.reason });
  return out;
};
