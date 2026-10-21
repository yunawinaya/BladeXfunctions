// LOT_V2_PREPARE - Ready: the plan -> READY_TO_COMMIT (manifest; the worker's lease is kept), FAILED (lease released; the LOT back to
// prevStatus when this job holds its lock and nothing was written) or REQUIRES_REVIEW (prevStatus unknown: no unlock)
// finished_at = the real end time (bladexfunctions-a6's recipe): the entry's DB clock + the seconds since it ran
const dbAddSeconds = lotDbAddSeconds;
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const prepareReady = function prepareReady(entry, plan) {
  const s = lotS;
  const e = entry || {};
  const p = plan || {};
  const base = { route: "FAIL", needParts: "NO", needReady: "NO", readyRows: [], needJobUpd: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], result_code: "", result_message: "", job_status: "" };
  if (s(e.route) === "NOOP") return Object.assign(base, { route: "NOOP", result_code: s(e.result_code), result_message: s(e.result_message) });
  const end = (status, code, message, unlock) => {
    const rows = lotPrevStatusOk(e.prevStatus) ? unlock.filter((u) => lotDigits(u.id)).map((u) => ({ id: s(u.id), stock_movement_status: s(e.prevStatus) })) : [];
    const review = status === "REQUIRES_REVIEW" || (unlock.length > 0 && !rows.length);
    const st = review ? "REQUIRES_REVIEW" : "FAILED";
    const c = review && status !== "REQUIRES_REVIEW" ? "LOT_PREV_STATUS_UNKNOWN" : code;
    const msg = review && status !== "REQUIRES_REVIEW" ? "Under review: the status to restore is unknown. Please contact support." : message;
    return Object.assign(base, {
      needJobUpd: "YES",
      jobRows: [{ id: s(e.jobId), job_status: st, progress_percent: 0, progress_message: ((st === "FAILED" ? "Not completed: " : "") + msg).slice(0, 250),
        attempt_count: Number(e.attempts) || 0, next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: (Number(e.rowVersion) || 0) + 1, error_code: c,
        error_message: msg, error_details: JSON.stringify({ step: "LOT_V2_PREPARE", action: s(e.action) }), finished_at: endNow(e) || null }],
      needUnlock: !review && rows.length ? "YES" : "NO", unlockRows: !review ? rows : [], result_code: c, result_message: msg, job_status: st,
    });
  };
  if (s(e.route) === "REVIEW") return end("REQUIRES_REVIEW", s(e.result_code), s(e.result_message), []);
  if (s(e.route) === "FAIL") return end("FAILED", s(e.result_code) || "LOT_INVALID_REQUEST", s(e.result_message), lotList(e.unlockRows));
  if (s(p.route) !== "READY") {
    const unlock = String(p.unlockOk) === "1" ? [{ id: s(e.lotId) }] : [];
    return end("FAILED", s(p.code) || "LOT_PLAN_FAILED", s(p.message) || "The save could not be prepared.", unlock);
  }
  return Object.assign(base, {
    route: "OK", needParts: "YES", needReady: "YES",
    readyRows: [{ id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to save: " + s(p.message)).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null, prepared_payload: s(p.payload), line_count: Number(p.lineCount) || 0 }],
    result_message: s(p.message), job_status: "READY_TO_COMMIT",
  });
};
const p = { route: [{{node:code_node_LPplan.data.route}}][0], code: [{{node:code_node_LPplan.data.code}}][0], message: [{{node:code_node_LPplan.data.message}}][0],
  payload: [{{node:code_node_LPplan.data.payload}}][0], lineCount: [{{node:code_node_LPplan.data.lineCount}}][0], unlockOk: [{{node:code_node_LPplan.data.unlockOk}}][0] };
const res = prepareReady([{{node:code_node_LPentry.data}}][0], p);
console.log("prepare ready", JSON.stringify({ route: res.route, status: res.job_status, result: res.result_code, message: res.result_message }));
return res;
