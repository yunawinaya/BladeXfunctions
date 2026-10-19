// GR_REVERT_PREPARE - Ready: the plan -> READY_TO_COMMIT (manifest; the worker's lease is kept) or FAILED (lease released)
// with the receipt back to the status it had before the submit when this job holds its lock. Nothing else was written
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
  const prev = s((e.request || {}).previousStatus);
  const fail = (code, message, details, unlock) => Object.assign(base, {
    needJobUpd: "YES",
    jobRows: [{
      id: s(e.jobId), job_status: "FAILED", progress_percent: 0, progress_message: ("Not reverted: " + message).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: code, error_message: message, error_details: s(details) || JSON.stringify({ step: "GR_REVERT_PREPARE" }),
      lease_owner: null, lease_expires_at: null, finished_at: endNow() || null,
    }],
    needUnlock: unlock ? "YES" : "NO", unlockRows: unlock ? [{ id: s(e.grId), gr_status: prev }] : [], result_code: code, result_message: message, job_status: "FAILED",
  });
  const canUnlock = String(p.unlockOk) === "1" && /^[0-9]{1,20}$/.test(s(e.grId)) && ["Completed", "Received"].indexOf(prev) >= 0;
  if (s(e.route) !== "GO") return fail(s(e.result_code) || "GRV_INVALID_REQUEST", s(e.result_message) || "the job's request could not be read", "", false);
  if (s(p.route) !== "READY") return fail(s(p.code) || "GRV_PLAN_FAILED", s(p.message) || "the revert could not be planned", p.errorDetails, canUnlock);
  return Object.assign(base, {
    route: "OK", needParts: "YES", needReady: "YES",
    readyRows: [{
      id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to revert: " + s(p.message)).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null, prepared_payload: s(p.payload), line_count: Number(p.lineCount) || 0,
    }],
    result_message: s(p.message), job_status: "READY_TO_COMMIT",
  });
};
const res = prepareReady([{{node:code_node_VPentry.data}}][0], [__PLAN__][0]);
console.log("prepare ready", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
