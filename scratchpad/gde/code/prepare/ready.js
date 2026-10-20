// GD_EDIT_PREPARE - Ready: the plan + the engine's PLAN answer -> READY_TO_COMMIT (manifest; the worker's lease is kept: the
// row carries no lease column), or for a cascade's job (request.hold 1) HELD in the same write - lease released, held 15
// minutes (next_attempt_at; the worker cancels it after) until SO_SAVE's RELEASE; or FAILED (lease released) with the GD back
// to its stored status when this job holds its lock, and our Picking lock released when the Picking is still at the version
// this job locked. Nothing else was written.
const prepareReady = function prepareReady(entry, plan, engine) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const addSeconds = (text, seconds) => {
    const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return "";
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  };
  const endNow = (x) => (Number(x.jsAt) > 0 ? addSeconds(x.dbNow, Math.max(0, Math.floor((Date.now() - Number(x.jsAt)) / 1000))) : "") || x.dbNow;
  const e = entry || {}, p = plan || {}, g = engine || {};
  const base = { route: "FAIL", needParts: "NO", needReady: "NO", readyRows: [], needHold: "NO", holdRows: [], needJobUpd: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], needPickUnlock: "NO", pickUnlockRows: [],
    result_code: "", result_message: "", job_status: "" };
  if (s(e.route) === "NOOP") return Object.assign(base, { route: "NOOP", result_code: s(e.result_code), result_message: s(e.result_message) });
  const req = e.request || {};
  const fail = (code, message, details) => Object.assign(base, {
    needJobUpd: "YES",
    jobRows: [{ id: s(e.jobId), job_status: "FAILED", progress_percent: 0, progress_message: ("Not saved: " + message).slice(0, 250), row_version: (Number(e.rowVersion) || 0) + 1,
      error_code: code, error_message: message, error_details: JSON.stringify(Object.assign({ step: "GD_EDIT_PREPARE" }, details || {})), lease_owner: null, lease_expires_at: null, finished_at: s(endNow(e)) || null }],
    needUnlock: String(p.unlockOk) === "1" ? "YES" : "NO",
    unlockRows: String(p.unlockOk) === "1" ? [{ id: s(p.gdId), gd_status: s(req.stored_status) || "Created" }] : [],
    needPickUnlock: s(p.pickUnlockId) ? "YES" : "NO", pickUnlockRows: s(p.pickUnlockId) ? [{ id: s(p.pickUnlockId), is_processing: 0 }] : [],
    result_code: code, result_message: message, job_status: "FAILED",
  });
  if (s(p.route) !== "ENGINE") return fail(s(p.code) || "GDE_PLAN_FAILED", s(p.message) || "the edit could not be planned");
  if (Number(p.movementCount) > 0 && s(g.code) !== "200") return fail("GDE_INVENTORY_" + (s(g.result_code) || "FAILED"), s(g.message) || "the inventory plan failed", { engine: { code: s(g.code), result_code: s(g.result_code) } });
  const row = { id: s(e.jobId), job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: ("Ready to save: " + s(p.message)).slice(0, 250), row_version: (Number(e.rowVersion) || 0) + 1,
    error_code: null, error_message: null, error_details: null, prepared_payload: s(p.payload), line_count: Number(p.lineCount) || 0 };
  if (Number(req.hold) === 1) {
    // a Picking force complete holds each delivery while it holds the others: 30 minutes; a Sales Order save 15
    const fcHold = s(req.source) === "PICKING_FC";
    const hold = addSeconds(e.dbNow, fcHold ? 1800 : 900);
    return Object.assign(base, { route: "OK", needParts: "YES", needHold: "YES",
      holdRows: [Object.assign(row, { job_status: "HELD", progress_message: ((fcHold ? "Held for the force complete: " : "Held for the sales order save: ") + s(p.message)).slice(0, 250), lease_owner: null, lease_expires_at: null, next_attempt_at: hold })],
      result_message: "held until " + hold + ": " + s(p.message), job_status: "HELD" });
  }
  return Object.assign(base, { route: "OK", needParts: "YES", needReady: "YES", readyRows: [row], result_message: s(p.message), job_status: "READY_TO_COMMIT" });
};
