// PUTAWAY_BULK_PREPARE - Ready: the plan -> READY_TO_COMMIT (manifest; the worker's lease is kept) or FAILED (lease released)
// with the putaway released when this job holds its lock. Nothing else was written
const prepareReady = function prepareReady(entry, plan) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const e = entry || {};
  // the DB clock now: entry's DB time plus what this run has spent since (no server clock or time zone mixing)
  const endNow = () => {
    const m = s(e.dbNow).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    const js = Number(e.jsAt);
    if (!m || !(js > 0)) return s(e.dbNow);
    const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + Math.max(0, Math.floor((Date.now() - js) / 1000)) * 1000);
    const p = (n) => (n < 10 ? "0" : "") + n;
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
  };
  const p = plan || {};
  const base = { route: "FAIL", needParts: "NO", needReady: "NO", readyRows: [], needJobUpd: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], result_code: "", result_message: "", job_status: "" };
  if (s(e.route) === "NOOP") return Object.assign(base, { route: "NOOP", result_code: s(e.result_code), result_message: s(e.result_message) });
  const fail = (code, message, unlock) => Object.assign(base, {
    needJobUpd: "YES",
    jobRows: [{ id: s(e.jobId), job_status: "FAILED", progress_percent: 0, progress_message: ("Not completed: " + message).slice(0, 250), row_version: (Number(e.rowVersion) || 0) + 1,
      error_code: code, error_message: message, error_details: JSON.stringify({ step: "PUTAWAY_BULK_PREPARE" }), lease_owner: null, lease_expires_at: null, finished_at: endNow() || null }],
    needUnlock: unlock ? "YES" : "NO", unlockRows: unlock ? [{ id: s(e.toId), is_processing: 0 }] : [], result_code: code, result_message: message, job_status: "FAILED",
  });
  if (s(p.route) !== "READY") return fail(s(p.code) || s(e.result_code) || "PWC_PLAN_FAILED", s(p.message) || s(e.result_message) || "the completion could not be planned", String(p.unlockOk) === "1" && /^[0-9]{1,20}$/.test(s(e.toId)));
  return Object.assign(base, {
    route: "OK", needParts: "YES", needReady: "YES",
    readyRows: [{ id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to complete: " + s(p.message)).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null, prepared_payload: s(p.payload), line_count: Number(p.lineCount) || 0 }],
    result_message: s(p.message), job_status: "READY_TO_COMMIT",
  });
};
const p = { route: [{{node:code_node_PPplan.data.route}}][0], code: [{{node:code_node_PPplan.data.code}}][0], message: [{{node:code_node_PPplan.data.message}}][0],
  payload: [{{node:code_node_PPplan.data.payload}}][0], lineCount: [{{node:code_node_PPplan.data.lineCount}}][0], unlockOk: [{{node:code_node_PPplan.data.unlockOk}}][0] };
const res = prepareReady([{{node:code_node_PPentry.data}}][0], p);
console.log("prepare ready", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
