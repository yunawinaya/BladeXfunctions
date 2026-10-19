// PICKING_BULK_PREPARE 1c - Final (a pick that moves stock): READY_TO_COMMIT with the prepared payload and the move's
// summary (COMMIT reads its parts by the nonce), or FAILED with the reason and the Picking unlocked: the rows code_node_PPplan
// writes on the other path. Nothing has been written to stock, reservations, the GD or the Picking yet.
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// finished_at = the run's real end: the DB clock read at entry + the seconds since (jsAt = the entry's Date.now())
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const prepareFinal = function prepareFinal(entry, plan, move, mp, eng) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const jobId = s(entry.jobId);
  const pickingId = s(entry.pickingId);
  const p = plan || {}, m = move || {}, x = mp || {}, g = eng || {};
  const base = { route: "FAIL", jobRows: [], needJobUpd: "NO", readyRows: [], needReady: "NO", unlockRows: [], needUnlock: "NO", result_code: "", result_message: "", job_status: "",
    recordCount: Number(p.recordCount || 0), touchedRows: Number(p.touchedRows || 0), gdLineCount: Number(p.gdLineCount || 0) };
  const fail = (code, message) => Object.assign({}, base, {
    jobRows: [{ id: jobId, job_status: "FAILED", progress_percent: 0, progress_message: ("Not confirmed: " + message).slice(0, 250), row_version: (Number(entry.rowVersion) || 0) + 1,
      error_code: code, error_message: message, error_details: JSON.stringify({ step: "PICKING_BULK_PREPARE", stage: "1c move" }), lease_owner: null, lease_expires_at: null,
      finished_at: s(endNow(entry)) || null }],
    needJobUpd: "YES", unlockRows: /^[0-9]{1,20}$/.test(pickingId) ? [{ id: pickingId, is_processing: 0 }] : [], needUnlock: /^[0-9]{1,20}$/.test(pickingId) ? "YES" : "NO",
    result_code: code, result_message: message, job_status: "FAILED",
  });
  if (!p.prepared || typeof p.prepared !== "object") return fail("PK_INVALID_DATA", "the prepared confirmation is missing");
  if (s(m.route) !== "OK" && s(m.route) !== "NONE") return fail(s(m.result_code) || "PK_REPLAN", s(m.result_message) || "the moved lines could not be prepared");
  const prepared = JSON.parse(JSON.stringify(p.prepared));
  if (s(m.route) === "OK") {
    if (s(x.route) !== "OK") return fail(s(x.result_code) || "PK_REPLAN", s(x.result_message) || "the moved deliveries could not be re-planned");
    if (s(x.needEngine) === "YES" && s(g.code) !== "200") {
      return fail("PK_STOCK_" + (s(g.result_code) || "FAILED"), "the stock cannot be moved: " + (s(g.message) || s(g.result_code) || "no answer from the stock engine"));
    }
    prepared.move = { nonce: s(m.nonce), operation_key: s(x.operationKey), has_movements: s(x.needEngine) === "YES" ? 1 : 0, gd_ids: x.gdIds || [], counts: x.counts || {} };
  }
  const records = (prepared.records || []).length;
  const ready = {
    id: jobId, job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready to save " + records + " picked line(s)",
    row_version: (Number(entry.rowVersion) || 0) + 1, error_code: null, error_message: null, error_details: null,
    prepared_payload: JSON.stringify(prepared), line_count: records, picking_no: s(prepared.picking_no),
  };
  return Object.assign({}, base, { route: "OK", readyRows: [ready], needReady: "YES", result_message: s(p.result_message) || "Picking processed successfully", job_status: "READY_TO_COMMIT" });
};
// each upstream node's fields this node reads, not the whole output (the plan's records, the move's cells, the movements)
const res = prepareFinal({ jobId: [{{node:code_node_PPentry.data.jobId}}][0], pickingId: [{{node:code_node_PPentry.data.pickingId}}][0], rowVersion: [{{node:code_node_PPentry.data.rowVersion}}][0], dbNow: [{{node:code_node_PPentry.data.dbNow}}][0], jsAt: [{{node:code_node_PPentry.data.jsAt}}][0] },
  { prepared: [{{node:code_node_PPplan.data.prepared}}][0], recordCount: [{{node:code_node_PPplan.data.recordCount}}][0], touchedRows: [{{node:code_node_PPplan.data.touchedRows}}][0], gdLineCount: [{{node:code_node_PPplan.data.gdLineCount}}][0], result_message: [{{node:code_node_PPplan.data.result_message}}][0] },
  { route: [{{node:code_node_PPmove.data.route}}][0], result_code: [{{node:code_node_PPmove.data.result_code}}][0], result_message: [{{node:code_node_PPmove.data.result_message}}][0], nonce: [{{node:code_node_PPmove.data.nonce}}][0] },
  { route: [{{node:code_node_PPmoveplan.data.route}}][0], result_code: [{{node:code_node_PPmoveplan.data.result_code}}][0], result_message: [{{node:code_node_PPmoveplan.data.result_message}}][0], needEngine: [{{node:code_node_PPmoveplan.data.needEngine}}][0], operationKey: [{{node:code_node_PPmoveplan.data.operationKey}}][0], gdIds: [{{node:code_node_PPmoveplan.data.gdIds}}][0], counts: [{{node:code_node_PPmoveplan.data.counts}}][0] },
  { code: [{{node:workflow_node_PPengine.data.code}}][0], result_code: [{{node:workflow_node_PPengine.data.result_code}}][0], message: [{{node:workflow_node_PPengine.data.message}}][0] });
console.log("prepare final", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
