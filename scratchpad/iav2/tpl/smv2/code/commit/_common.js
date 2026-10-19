// LOT_V2_COMMIT - shared helpers (included into each code node by build_commit.py after code/shared/lot_common.js):
// pwv2 / grv2 commit/_common.js with the transfer's unlock (back to the job's prevStatus, never a default) and GD's lock waits
const MAX_RETRIES = 3;
const LOCK_WAIT_TRIES = 8;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const dbAddSeconds = lotDbAddSeconds;
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const MSG = {
  invalid: "The save could not be completed: its prepared data is missing. Nothing was moved, please save it again.",
  notLocked: "The Location Transfer is no longer locked by this save: nothing was moved.",
  linesChanged: "The Location Transfer's lines changed while it was waiting: nothing was moved, please save it again.",
  ledgerChanged: "Its In Transit stock changed while it was waiting: nothing was moved, please save it again.",
  lockBusy: "The stock of its items stayed locked by another operation: nothing was moved, save it again later.",
  review: "Under review: the save stopped half-way. Please contact support.",
  prevUnknown: "Under review: the status to restore is unknown. Please contact support.",
  notBuilt: "This kind of Location Transfer save is not available in the background yet: nothing was moved, please save it again.",
  badRequest: "The save's request is incomplete: nothing was moved. Please save again.",
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
const jobRow = function jobRow(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_LOT", progress_percent: 70, progress_message: "Saving the Location Transfer", attempt_count: entry.attempts,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: null, error_message: null, error_details: null, finished_at: null }, patch);
};
const END_EMPTY = { stepRows: [], needStep: "NO", unlockRows: [], needUnlock: "NO" };
// a step that did not complete: retry with backoff, or REQUIRES_REVIEW (after MAX_RETRIES, or at once when `review`); the
// transfer stays Processing
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = entry.attempts;
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Location Transfer stays Processing for review";
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the save stopped half-way", error_code: "LOT_RECONCILIATION_MISMATCH", error_message: MSG.review, error_details: JSON.stringify({ step: step, why: why.slice(0, 4000) }), finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "LOT_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" });
  }
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)), error_code: "LOT_STEP_RETRY", error_message: (step + ": " + why).slice(0, 1000), error_details: JSON.stringify({ step: step, why: why.slice(0, 4000), attempt: n + 1 }) })], needJobUpd: "YES", result_code: "LOT_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_LOT" });
};
// 409 from the engine with no intent rows: nothing was written - wait for the other operation (15 s x 2^n, at most 5 min)
const lockWait = function lockWait(entry, why) {
  const n = entry.attempts;
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.min(300, 15 * Math.pow(2, n))), error_code: "LOT_LOCK_WAIT",
    error_message: ("L1_INVENTORY: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "L1_INVENTORY", why: why.slice(0, 2000), attempt: n + 1 }) })], needJobUpd: "YES", result_code: "LOT_LOCK_WAIT",
    result_message: "L1_INVENTORY: the stock is locked by another operation - wait " + (n + 1) + " of " + LOCK_WAIT_TRIES, job_status: "COMMITTING_LOT" });
};
// before L1 moves the stock (phase A): FAILED and the transfer back to the status before the save - only while this job owns it;
// an owned transfer whose prevStatus is not Draft / In Progress keeps its lock and the job goes to REQUIRES_REVIEW
const failNoWrite = function failNoWrite(entry, code, message, why) {
  const owned = entry.unlockOk === "YES";
  const detail = JSON.stringify({ step: "LOT_V2_COMMIT", why: s(why || message).slice(0, 4000) });
  if (owned && !lotPrevStatusOk(entry.prevStatus)) {
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: MSG.prevUnknown, error_code: "LOT_PREV_STATUS_UNKNOWN", error_message: MSG.prevUnknown, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "LOT_PREV_STATUS_UNKNOWN", result_message: s(why || message) + " (prevStatus '" + s(entry.prevStatus) + "' unknown: no unlock)", job_status: "REQUIRES_REVIEW" });
  }
  const unlock = owned ? [{ id: entry.lotId, stock_movement_status: s(entry.prevStatus) }] : [];
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not completed: " + message).slice(0, 250), error_code: code, error_message: message, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: s(why || message), job_status: "FAILED" });
};
const stepOk = function stepOk(entry, step, ref, message) {
  return Object.assign({ route: "OK" }, END_EMPTY, { stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", result_code: "", result_message: message || step + " done", job_status: "COMMITTING_LOT" });
};
const byId = function byId(rows) {
  const out = {};
  for (const o of lotRows(rows)) if (o.id !== undefined && o.id !== null) out[s(o.id)] = o;
  return out;
};
// In Transit rows (Putaway V2's P3 rule): "not yet written" = status / open_qty / received_qty / transit_qty at the before-values
// (numerically); "already written" = every planned column but received_date (a date's text form must never send a job to review)
const LEDGER_BEFORE = ["status", "open_qty", "received_qty", "transit_qty"];
const ledgerAtBefore = function ledgerAtBefore(before, cur) {
  const b = before && typeof before === "object" ? before : {};
  const cols = LEDGER_BEFORE.filter((k) => k in b);
  return !!cur && cols.length > 0 && cols.every((k) => sameVal(cur[k], b[k]));
};
const ledgerAtAfter = function ledgerAtAfter(after, cur) {
  const a = after && typeof after === "object" ? after : {};
  return !!cur && Object.keys(a).every((k) => k === "received_date" || sameStored(a[k], cur[k]));
};
