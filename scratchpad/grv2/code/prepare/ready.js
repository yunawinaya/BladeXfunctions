// GR_COMPLETE_PREPARE - Ready: the plan -> READY_TO_COMMIT (manifest; the worker's lease is kept) or FAILED (lease
// released) with the receipt back to the status it had before the submit when this job holds its lock. Nothing else was
// written (no batch number, no stock, no purchase order)
const prepareReady = function prepareReady(entry, plan) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const e = entry || {};
  const p = plan || {};
  const base = { route: "FAIL", needParts: "NO", needReady: "NO", readyRows: [], needJobUpd: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], result_code: "", result_message: "", job_status: "" };
  if (s(e.route) === "NOOP") return Object.assign(base, { route: "NOOP", result_code: s(e.result_code), result_message: s(e.result_message) });
  const fail = (code, message, unlock) => Object.assign(base, {
    needJobUpd: "YES",
    jobRows: [{
      id: s(e.jobId), job_status: "FAILED", progress_percent: 0, progress_message: ("Not completed: " + message).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: code, error_message: message, error_details: JSON.stringify({ step: "GR_COMPLETE_PREPARE" }),
      lease_owner: null, lease_expires_at: null, finished_at: s(e.dbNow) || null,
    }],
    needUnlock: unlock.length ? "YES" : "NO", unlockRows: unlock, result_code: code, result_message: message, job_status: "FAILED",
  });
  if (s(e.route) === "FAIL") return fail(s(e.result_code) || "GRC_INVALID_REQUEST", s(e.result_message), Array.isArray(e.unlockRows) ? e.unlockRows : []);
  if (s(p.route) !== "READY") {
    const unlock = String(p.unlockOk) === "1" ? [{ id: s(e.grId), gr_status: s(e.previousStatus) || "Draft" }] : [];
    return fail(s(p.code) || "GRC_PLAN_FAILED", s(p.message) || "the completion could not be planned", unlock);
  }
  return Object.assign(base, {
    route: "OK", needParts: "YES", needReady: "YES",
    readyRows: [{
      id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to complete: " + s(p.message)).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null, prepared_payload: s(p.payload), line_count: Number(p.lineCount) || 0,
    }],
    result_message: s(p.message), job_status: "READY_TO_COMMIT",
  });
};
const p = { route: [{{node:code_node_RPplan.data.route}}][0], code: [{{node:code_node_RPplan.data.code}}][0], message: [{{node:code_node_RPplan.data.message}}][0],
  payload: [{{node:code_node_RPplan.data.payload}}][0], lineCount: [{{node:code_node_RPplan.data.lineCount}}][0], unlockOk: [{{node:code_node_RPplan.data.unlockOk}}][0] };
const res = prepareReady([{{node:code_node_RPentry.data}}][0], p);
console.log("prepare ready", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
