// IA_REVERT_V2_SUBMIT - Result: the answer of the node that ended the run (QUEUED only when rvQueuedOk, else STOP 500)
const submitResult = function submitResult(guard, entry, src, back) {
  const e = entry || {};
  const r = src || {};
  const jobStatus = s(e.jobStatus);
  const out = { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), action: "REVERT", job_id: s(e.jobId), job_status: jobStatus,
    terminal: IA_TERMINAL_JOB.indexOf(jobStatus) >= 0 ? "YES" : "NO", ia_id: s(guard.iaId) === "0" ? "" : s(guard.iaId), ia_no: s(e.iaNo),
    line_count: String(num(r.liveRows) || num(e.lineCount)), progress_percent: String(num(e.progressPercent)), progress_message: s(e.progressMessage), error_code: s(r.errorCode),
    error_message: "", evidence: "" };
  if (out.route === "STATUS") {
    Object.assign(out, { action: s(e.jobAction), error_code: s(e.jobErrorCode), error_message: s(e.errorMessage) });
  } else if (out.route === "INVALID" || out.route === "REJECT") {
    Object.assign(out, { route: "INVALID", code: "400", error_code: out.error_code || "IA_RV_INVALID_REQUEST", error_message: out.message });
  } else if (out.route !== "QUEUED") {
    out.error_message = out.message;
  }
  if (back) {
    const o = list(back.owner)[0] || {};
    const j = list(back.job)[0] || {};
    Object.assign(out, rvQueuedOk(guard, o, j)
      ? { route: "QUEUED", code: "200", message: "Queued for processing", reason: "", job_id: s(j.job_id), job_status: s(j.job_status), terminal: "NO", ia_no: s(o.stock_movement_no) || out.ia_no,
        line_count: String(num(j.line_count)), progress_percent: "0", progress_message: "Queued for processing", error_code: "", error_message: "" }
      : { route: "STOP", code: "500", message: IA_TEXT.rvQueueFailed, job_id: s(j.job_id), job_status: s(j.job_status), terminal: IA_TERMINAL_JOB.indexOf(s(j.job_status)) >= 0 ? "YES" : "NO",
        error_code: "IA_RV_QUEUE_FAILED", error_message: IA_TEXT.rvQueueFailed });
  }
  out.evidence = JSON.stringify({ v: 1, workflow: "IA_REVERT_V2_SUBMIT", operation: s(guard.operation), source: s(guard.source), route: out.route, code: out.code, reason: out.reason });
  return out;
};
