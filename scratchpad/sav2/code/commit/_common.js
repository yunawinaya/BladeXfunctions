// SA_V2_COMMIT - shared helpers (included into each code node by build_commit.py after code/shared/sa_common.js):
// tpl/smv2 commit/_common.js (pwv2 / grv2) with the Stock Adjustment's unlock (back to the job's prevStatus, never a default) and GD's lock waits
const MAX_RETRIES = 3;
const LOCK_WAIT_TRIES = 8;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const dbAddSeconds = saDbAddSeconds;
// the DB clock now: the entry's db_now (read at the START of this pass) + the JS time since the entry ran (entry.jsAt); a pass
// can run ~30 s at 2k, so finished_at never takes db_now as is
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const MSG = {
  invalid: "The Stock Adjustment could not be completed: its prepared data is missing. Nothing was moved, please try again.",
  notLocked: "The Stock Adjustment is no longer locked by this completion: nothing was moved.",
  linesChanged: "The Stock Adjustment's lines changed while it was waiting: nothing was moved, please complete it again.",
  scChanged: "The Stock Count changed while its adjustment was waiting: nothing was moved, please review it again.",
  scBusy: "Another Stock Adjustment from this Stock Count is being processed: nothing was moved, please review it again later.",
  lockBusy: "The stock of its items stayed locked by another operation: nothing was moved, please try again later.",
  review: "Under review: the completion stopped half-way. Please contact support.",
  prevUnknown: "Under review: the status to restore is unknown. Please contact support.",
  writeFailed: "The Stock Adjustment's lines could not be saved: nothing was moved.",
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
// a marker written BEFORE a write that cannot be told apart from "not tried yet" afterwards (A1: a thrown write leaves the lines as
// they were); a later pass that finds it with the rows still at their before-values knows the write failed
const tryRow = function tryRow(entry, step, ref) {
  return Object.assign(doneRow(entry, step, ref), { step_status: "TRY" });
};
const jobRow = function jobRow(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_SA", progress_percent: 70, progress_message: "Completing the Stock Adjustment", attempt_count: entry.attempts,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: null, error_message: null, error_details: null, finished_at: null }, patch);
};
const END_EMPTY = { stepRows: [], needStep: "NO", unlockRows: [], needUnlock: "NO" };
// a step that did not complete: retry with backoff, or REQUIRES_REVIEW (after MAX_RETRIES, or at once when `review`); the
// Stock Adjustment stays Processing
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = entry.attempts;
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Stock Adjustment stays Processing for review";
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the completion stopped half-way", error_code: "SA_RECONCILIATION_MISMATCH", error_message: MSG.review, error_details: JSON.stringify({ step: step, why: why.slice(0, 4000) }), finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "SA_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" });
  }
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)), error_code: "SA_STEP_RETRY", error_message: (step + ": " + why).slice(0, 1000), error_details: JSON.stringify({ step: step, why: why.slice(0, 4000), attempt: n + 1 }) })], needJobUpd: "YES", result_code: "SA_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_SA" });
};
// 409 from the engine with no intent rows: nothing was written - wait for the other operation (15 s x 2^n, at most 5 min)
const lockWait = function lockWait(entry, why) {
  const n = entry.attempts;
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.min(300, 15 * Math.pow(2, n))), error_code: "SA_LOCK_WAIT",
    error_message: ("A2_INVENTORY: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "A2_INVENTORY", why: why.slice(0, 2000), attempt: n + 1 }) })], needJobUpd: "YES", result_code: "SA_LOCK_WAIT",
    result_message: "A2_INVENTORY: the stock is locked by another operation - wait " + (n + 1) + " of " + LOCK_WAIT_TRIES, job_status: "COMMITTING_SA" });
};
// before A2 moves the stock (phase A): FAILED and the Stock Adjustment back to the status before the completion - only while
// this job owns it; an owned Stock Adjustment whose prevStatus is not Draft / Cancelled keeps its lock and the job goes to REQUIRES_REVIEW
const failNoWrite = function failNoWrite(entry, code, message, why) {
  const owned = entry.unlockOk === "YES";
  const detail = JSON.stringify({ step: "SA_V2_COMMIT", why: s(why || message).slice(0, 4000) });
  if (owned && !saPrevStatusOk(entry.prevStatus)) {
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: MSG.prevUnknown, error_code: "SA_PREV_STATUS_UNKNOWN", error_message: MSG.prevUnknown, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "SA_PREV_STATUS_UNKNOWN", result_message: s(why || message) + " (prevStatus '" + s(entry.prevStatus) + "' unknown: no unlock)", job_status: "REQUIRES_REVIEW" });
  }
  const unlock = owned ? [{ id: entry.saId, stock_adjustment_status: s(entry.prevStatus) }] : [];
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not completed: " + message).slice(0, 250), error_code: code, error_message: message, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: s(why || message), job_status: "FAILED" });
};
const stepOk = function stepOk(entry, step, ref, message) {
  return Object.assign({ route: "OK" }, END_EMPTY, { stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", result_code: "", result_message: message || step + " done", job_status: "COMMITTING_SA" });
};
const byId = function byId(rows) {
  const out = {};
  for (const o of saRows(rows)) if (o.id !== undefined && o.id !== null) out[s(o.id)] = o;
  return out;
};
