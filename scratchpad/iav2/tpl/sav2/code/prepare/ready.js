// SA_V2_PREPARE - Ready: the plan -> READY_TO_COMMIT (manifest; the worker's lease is kept), FAILED (lease released; the Stock Adjustment back to
// prevStatus when this job holds its lock and nothing was written) or REQUIRES_REVIEW (prevStatus unknown: no unlock).
// PARK above SA_PARK_ENTRIES movements (controller ruling 5, as smv2 COMMIT's PARK): READY_TO_COMMIT with the lease cleared and
// next_attempt_at = db_now, attempt_count untouched (no retry counted) - the worker ends the tick, the next tick runs COMMIT
// (node data: PREPARE + COMMIT A of a 2,000-entry job in one synchronous chain would be ~46 MB)
const SA_PARK_ENTRIES = 1000;
const prepareReady = function prepareReady(entry, plan) {
  const s = saS;
  const e = entry || {};
  const p = plan || {};
  const base = { route: "FAIL", needParts: "NO", needReady: "NO", readyRows: [], needPark: "NO", parkRows: [], needJobUpd: "NO", jobRows: [], needUnlock: "NO", unlockRows: [],
    result_code: "", result_message: "", job_status: "" };
  if (s(e.route) === "NOOP") return Object.assign(base, { route: "NOOP", result_code: s(e.result_code), result_message: s(e.result_message) });
  const end = (status, code, message, unlock) => {
    const rows = saPrevStatusOk(e.prevStatus) ? unlock.filter((u) => saDigits(u.id)).map((u) => ({ id: s(u.id), stock_adjustment_status: s(e.prevStatus) })) : [];
    const review = status === "REQUIRES_REVIEW" || (unlock.length > 0 && !rows.length);
    const st = review ? "REQUIRES_REVIEW" : "FAILED";
    const c = review && status !== "REQUIRES_REVIEW" ? "SA_PREV_STATUS_UNKNOWN" : code;
    const msg = review && status !== "REQUIRES_REVIEW" ? "Under review: the status to restore is unknown. Please contact support." : message;
    return Object.assign(base, {
      needJobUpd: "YES",
      jobRows: [{ id: s(e.jobId), job_status: st, progress_percent: 0, progress_message: ((st === "FAILED" ? "Not completed: " : "") + msg).slice(0, 250),
        attempt_count: Number(e.attempts) || 0, next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: (Number(e.rowVersion) || 0) + 1, error_code: c,
        error_message: msg, error_details: JSON.stringify({ step: "SA_V2_PREPARE", action: s(e.action) }), finished_at: s(e.dbNow) || null }],
      needUnlock: !review && rows.length ? "YES" : "NO", unlockRows: !review ? rows : [], result_code: c, result_message: msg, job_status: st,
    });
  };
  if (s(e.route) === "REVIEW") return end("REQUIRES_REVIEW", s(e.result_code), s(e.result_message), []);
  if (s(e.route) === "FAIL") return end("FAILED", s(e.result_code) || "SA_INVALID_REQUEST", s(e.result_message), saList(e.unlockRows));
  if (s(p.route) !== "READY") {
    const unlock = String(p.unlockOk) === "1" ? [{ id: s(e.saId) }] : [];
    return end("FAILED", s(p.code) || "SA_PLAN_FAILED", s(p.message) || "The save could not be prepared.", unlock);
  }
  const ready = { id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to complete: " + s(p.message)).slice(0, 250),
    row_version: (Number(e.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null, prepared_payload: s(p.payload), line_count: Number(p.lineCount) || 0 };
  if ((Number(p.movementCount) || 0) > SA_PARK_ENTRIES) {
    const park = Object.assign(ready, { progress_message: ("Prepared, the stock is moved next: " + s(p.message)).slice(0, 250), lease_owner: null, lease_expires_at: null,
      next_attempt_at: s(e.dbNow) || null });
    return Object.assign(base, { route: "PARK", needParts: "YES", needPark: "YES", parkRows: [park], result_message: s(p.message), job_status: "READY_TO_COMMIT" });
  }
  return Object.assign(base, { route: "OK", needParts: "YES", needReady: "YES", readyRows: [ready], result_message: s(p.message), job_status: "READY_TO_COMMIT" });
};
const p = { route: [{{node:code_node_SPplan.data.route}}][0], code: [{{node:code_node_SPplan.data.code}}][0], message: [{{node:code_node_SPplan.data.message}}][0],
  payload: [{{node:code_node_SPplan.data.payload}}][0], lineCount: [{{node:code_node_SPplan.data.lineCount}}][0], movementCount: [{{node:code_node_SPplan.data.movementCount}}][0],
  unlockOk: [{{node:code_node_SPplan.data.unlockOk}}][0] };
const res = prepareReady([{{node:code_node_SPentry.data}}][0], p);
console.log("prepare ready", JSON.stringify({ route: res.route, status: res.job_status, result: res.result_code, message: res.result_message }));
return res;
