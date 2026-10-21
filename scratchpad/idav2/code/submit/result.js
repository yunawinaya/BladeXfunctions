// IDA_V2_SUBMIT - Result (CONTRACT section 7 answer): the answer of whichever node ended the run; after the queue writes the read-back (and the
// link, as Due) decides. line_count = moves (the job's line_count unit)
const submitResult = function submitResult(guard, entry, src, back, linkOk) {
  const e = entry || {};
  const r = src || {};
  const id = (v) => (s(v) === "0" ? "" : s(v));
  const jobStatus = s(e.jobStatus);
  const out = { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), action: s(e.action), job_id: s(e.jobId), job_status: jobStatus,
    terminal: IDA_TERMINAL_JOB.indexOf(jobStatus) >= 0 ? "YES" : "NO", ida_id: id(r.idaId || e.idaId), ida_no: s(r.idaNo || e.idaNo),
    line_count: String(num(r.moveCount || e.lineCount)), progress_percent: String(num(e.progressPercent)), progress_message: s(e.progressMessage), error_code: s(r.errorCode),
    error_message: "", evidence: "" };
  if (out.route === "STATUS") {
    Object.assign(out, { action: s(e.jobAction), error_code: s(e.jobErrorCode), error_message: s(e.errorMessage) });
  } else if (out.route === "INVALID" || out.route === "REJECT") {
    Object.assign(out, { route: "INVALID", code: "400", error_code: out.error_code || "IDA_INVALID_REQUEST", error_message: out.message });
  } else if (out.route !== "QUEUED") {
    out.error_message = out.message;
  }
  if (back) {
    const b = list(back)[0] || {};
    const m = s(b.correlation_id).match(/^IDA\|([0-9]{1,20})$/);
    Object.assign(out, idaQueuedOk(guard, b) && linkOk === true
      ? { route: "QUEUED", code: "200", message: "Queued for processing", reason: "", action: "DIRECT", job_id: s(b.job_id), job_status: s(b.job_status), terminal: "NO",
        ida_id: m ? m[1] : out.ida_id, ida_no: s(b.stock_movement_no), progress_percent: "0", progress_message: "Queued for processing", error_code: "", error_message: "" }
      : { route: "STOP", code: "500", message: IDA_TEXT.queueFailed, action: "DIRECT", job_id: s(b.job_id), job_status: s(b.job_status),
        terminal: IDA_TERMINAL_JOB.indexOf(s(b.job_status)) >= 0 ? "YES" : "NO", error_code: "IDA_QUEUE_FAILED", error_message: IDA_TEXT.queueFailed });
  }
  out.evidence = JSON.stringify({ v: 1, workflow: "IDA_V2_SUBMIT", operation: s(guard && guard.operation), route: out.route, code: out.code, reason: out.reason });
  return out;
};
