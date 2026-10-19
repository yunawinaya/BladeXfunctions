// GD_COMPLETE_PREPARE - Ready: the plan + the engine's PLAN answer -> READY_TO_COMMIT (manifest; the worker's lease is kept)
// or FAILED (lease released) with the GD back to Created when this job holds its lock. Nothing else was written.
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const prepareReady = function prepareReady(entry, plan, engine) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const e = entry || {};
  const p = plan || {};
  const g = engine || {};
  const base = { route: "FAIL", needParts: "NO", needReady: "NO", readyRows: [], needJobUpd: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], result_code: "", result_message: "", job_status: "" };
  if (s(e.route) === "NOOP") return Object.assign(base, { route: "NOOP", result_code: s(e.result_code), result_message: s(e.result_message) });
  const fail = (code, message, details) => Object.assign(base, {
    needJobUpd: "YES",
    jobRows: [{
      id: s(e.jobId), job_status: "FAILED", progress_percent: 0, progress_message: ("Not completed: " + message).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: code, error_message: message,
      error_details: JSON.stringify(Object.assign({ step: "GD_COMPLETE_PREPARE" }, details || {})),
      lease_owner: null, lease_expires_at: null, finished_at: s(endNow(e)) || null,
    }],
    needUnlock: String(p.unlockOk) === "1" ? "YES" : "NO",
    unlockRows: String(p.unlockOk) === "1" ? [{ id: s(p.gdId), gd_status: "Created" }] : [],
    result_code: code, result_message: message, job_status: "FAILED",
  });
  if (s(p.route) !== "ENGINE") return fail(s(p.code) || "GDC_PLAN_FAILED", s(p.message) || "the completion could not be planned");
  if (s(g.code) !== "200") return fail("GDC_INVENTORY_" + (s(g.result_code) || "FAILED"), s(g.message) || "the inventory plan failed", { engine: { code: s(g.code), result_code: s(g.result_code) } });
  return Object.assign(base, {
    route: "OK", needParts: "YES", needReady: "YES",
    readyRows: [{
      id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to complete: " + s(p.message)).slice(0, 250),
      row_version: (Number(e.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null,
      prepared_payload: s(p.payload), line_count: Number(p.lineCount) || 0,
    }],
    result_message: s(p.message), job_status: "READY_TO_COMMIT",
  });
};
const p = { route: [{{node:code_node_GCplan.data.route}}][0], code: [{{node:code_node_GCplan.data.code}}][0], message: [{{node:code_node_GCplan.data.message}}][0],
  payload: [{{node:code_node_GCplan.data.payload}}][0], lineCount: [{{node:code_node_GCplan.data.lineCount}}][0], gdId: [{{node:code_node_GCplan.data.gdId}}][0],
  unlockOk: [{{node:code_node_GCplan.data.unlockOk}}][0] };
const g = { code: [{{node:workflow_node_GCengine.data.code}}][0], result_code: [{{node:workflow_node_GCengine.data.result_code}}][0], message: [{{node:workflow_node_GCengine.data.message}}][0] };
const res = prepareReady([{{node:code_node_GCentry.data}}][0], p, g);
console.log("prepare ready", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
