// IA_REVERT_V2_COMMIT shared helpers (tpl/grrv + tpl/sav2 commit _common.js with the revert's names)
const MAX_RETRIES = 3;
// V2_COST waits for its COST lock at most this long after its first busy wait, then REQUIRES_REVIEW IA_RV_COST_TIMEOUT
const RV_COST_WAIT_S = 1800;
const s = iaS;
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = iaDigits;
const num = (v) => Number(v || 0);
const q8 = iaQ8;
const dbAddSeconds = iaDbAddSeconds;
// the DB clock now: the entry's db_now (read at the START of this pass) + the JS time since the entry ran (entry.jsAt)
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const RV_TEXT = {
  invalid: "The Item Assembly could not be reverted: its prepared data is missing. Nothing was moved, please try again.",
  rowsChanged: "The Item Assembly's stock movements changed while it was waiting: nothing was reverted, please revert it again.",
};
const slicesOf = function slicesOf(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push({ n: out.length + 1, rows: rows.slice(i, i + size) });
  return out;
};
const doneRow = function doneRow(entry, step, ref) {
  const row = { job_id: entry.jobId, organization_id: entry.organizationId, step_name: step, step_status: "DONE", attempt_count: 1, started_at: entry.dbNow,
    finished_at: endNow(entry), inventory_operation_id: "", result_ref: s(ref).slice(0, 2000), error_code: null, error_message: null };
  return row;
};
// the job row this pass writes: progress / message default to the entry's (phase A 70, phase B 85), never a constant
const jobRow = function jobRow(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_REVERT", progress_percent: num(entry.progress) || 70, progress_message: s(entry.progressMessage) || "Reverting the Item Assembly",
    attempt_count: entry.attempts, next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: null, error_message: null,
    error_details: null, finished_at: null }, patch);
};
const END_EMPTY = { stepRows: [], needStep: "NO", unlockRows: [], needUnlock: "NO" };
// a step that did not complete: retry with backoff, then (or at once when `review`) REQUIRES_REVIEW
const stepEnd = function stepEnd(entry, step, why, review, code) {
  const n = entry.attempts;
  const rc = code || "IA_RV_RECONCILIATION_MISMATCH";
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Item Assembly stays Processing for review";
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the revert stopped half-way",
      error_code: rc, error_message: IA_TEXT.rvReview, error_details: JSON.stringify({ step: step, why: s(why).slice(0, 4000) }), finished_at: endNow(entry) })], needJobUpd: "YES",
      result_code: rc, result_message: msg, job_status: "REQUIRES_REVIEW" });
  }
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)),
    error_code: "IA_RV_STEP_RETRY", error_message: (step + ": " + why).slice(0, 1000), error_details: JSON.stringify({ step: step, why: s(why).slice(0, 4000), attempt: n + 1 }) })], needJobUpd: "YES",
    result_code: "IA_RV_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_REVERT" });
};
// a wait that is not a failure (a COST lock held by another operation): due again in `seconds`, never counted towards review
const stepWait = function stepWait(entry, step, why, seconds, waitFrom) {
  const details = Object.assign({ step: step, why: s(why).slice(0, 2000) }, waitFrom ? { waitFrom: waitFrom } : {});
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { next_attempt_at: dbAddSeconds(entry.dbNow, seconds || 5), error_code: "IA_RV_WAIT", error_message: (step + ": " + why).slice(0, 1000),
    error_details: JSON.stringify(details) })], needJobUpd: "YES", result_code: "IA_RV_WAIT", result_message: step + ": " + why + " - waiting",
    job_status: "COMMITTING_REVERT" });
};
// engine 409 / no answer, no intent rows: nothing written - wait 15 s x 2^n (at most 5 min)
const lockWait = function lockWait(entry, why) {
  const n = entry.attempts;
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.min(300, 15 * Math.pow(2, n))), error_code: "IA_RV_LOCK_WAIT",
    error_message: ("V1_INVENTORY: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "V1_INVENTORY", why: s(why).slice(0, 2000), attempt: n + 1 }) })], needJobUpd: "YES",
    result_code: "IA_RV_LOCK_WAIT", result_message: "V1_INVENTORY: the stock is locked by another operation - wait " + (n + 1) + " of " + IA_LOCK_WAIT_TRIES, job_status: "COMMITTING_REVERT" });
};
// phase A: FAILED + back to Completed while owned; another prevStatus, or an engine operation that already wrote -> REVIEW, nothing unlocked
const failNoWrite = function failNoWrite(entry, code, message, why) {
  if (entry.opWrote === "YES") {
    return stepEnd(entry, "V1_INVENTORY", code + ": " + s(why || message) + " - but the engine operation IAV|" + entry.jobId + " has already written (intent / DONE rows): stock may have moved", true);
  }
  const owned = entry.unlockOk === "YES";
  const detail = JSON.stringify({ step: "IA_REVERT_V2_COMMIT", why: s(why || message).slice(0, 4000) });
  if (owned && !iaRvPrevStatusOk(entry.prevStatus)) {
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: IA_TEXT.prevUnknown, error_code: "IA_RV_PREV_STATUS_UNKNOWN",
      error_message: IA_TEXT.prevUnknown, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "IA_RV_PREV_STATUS_UNKNOWN",
      result_message: s(why || message) + " (prevStatus '" + s(entry.prevStatus) + "' unknown: no unlock)", job_status: "REQUIRES_REVIEW" });
  }
  const unlock = owned ? [{ id: entry.iaId, item_assembly_status: s(entry.prevStatus) }] : [];
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not reverted: " + message).slice(0, 250), error_code: code,
    error_message: message, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code,
    result_message: s(why || message), job_status: "FAILED" });
};
const stepOk = function stepOk(entry, step, ref, message) {
  return Object.assign({ route: "OK" }, END_EMPTY, { stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", result_code: "", result_message: message || step + " done",
    job_status: "COMMITTING_REVERT" });
};
const byId = function byId(rows) {
  const out = {};
  for (const o of iaRows(rows)) if (o.id !== undefined && o.id !== null) out[s(o.id)] = o;
  return out;
};
