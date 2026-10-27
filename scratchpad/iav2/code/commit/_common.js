// IA_V2_COMMIT - helpers every step node includes after code/shared/ia_common.js: tpl/sav2 commit/_common.js with the IA's
// unlock (prevStatus Draft or Created only, while the job owns the IA), this job's Batch rows soft-deleted on a clean failure, GD's
// lockWait and grv2's stepWait (not counted)
const MAX_RETRIES = 3;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
// the DB clock now: the entry's db_now (read at the START of this pass) + the JS time since the entry ran
const endNow = (entry) => (Number(entry.jsAt) > 0 ? iaDbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const MSG = {
  invalid: "The Item Assembly could not be completed: its prepared data is missing. Nothing was moved, please try again.",
  batchTwice: "The Batch row of the assembled item was created twice: nothing was moved, please complete it again.",
  batchMissing: "The Batch row of the assembled item could not be created: nothing was moved, please complete it again.",
  planFailed: "The completion could not be prepared: the receipt check did not answer. Nothing was moved, please try again.",
};
const P75 = "Components issued; receiving the assembled item";
const P80 = "Assembled item received; finishing";
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
// the job row this pass writes; the progress defaults to this pass's (phase A 70, phase B 75 before I3 is DONE, 85 after)
const jobRow = function jobRow(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_IA", progress_percent: num(entry.progress) || 70, progress_message: s(entry.progressMessage) || "Completing the Item Assembly",
    attempt_count: num(entry.attempts), next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: num(entry.rowVersion) + 2, error_code: null, error_message: null,
    error_details: null, finished_at: null }, patch);
};
const END_EMPTY = { stepRows: [], needStep: "NO", unlockRows: [], needUnlock: "NO", batchDelRows: [], needBatchDel: "NO" };
// REQUIRES_REVIEW: the Item Assembly stays Processing, nothing else is written
const reviewEnd = function reviewEnd(entry, step, code, why, extra) {
  const msg = step + ": " + why + "; the Item Assembly stays Processing for review";
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the completion stopped half-way",
    error_code: code, error_message: IA_TEXT.review, error_details: JSON.stringify(Object.assign({ step: step, why: s(why).slice(0, 4000) }, extra || {})), finished_at: endNow(entry) })],
  needJobUpd: "YES", result_code: code, result_message: msg, job_status: "REQUIRES_REVIEW" });
};
// a step that did not complete: retry with backoff (2 s x 2^n, max 30 s), REQUIRES_REVIEW after MAX_RETRIES or at once when `review`
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = num(entry.attempts);
  if (review || n >= MAX_RETRIES) return reviewEnd(entry, step, "IA_RECONCILIATION_MISMATCH", why + (review ? "" : " (after " + n + " retries)"));
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: iaDbAddSeconds(endNow(entry), Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)),
    error_code: "IA_STEP_RETRY", error_message: (step + ": " + why).slice(0, 1000), error_details: JSON.stringify({ step: step, why: s(why).slice(0, 4000), attempt: n + 1 }) })], needJobUpd: "YES",
  result_code: "IA_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_IA" });
};
// a wait that is not a failure (op 2 locked out by another operation): due again in `seconds`, attempt_count unchanged
const stepWait = function stepWait(entry, step, why, seconds, extra) {
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { next_attempt_at: iaDbAddSeconds(endNow(entry), seconds), error_code: "IA_WAIT", error_message: (step + ": " + why).slice(0, 1000),
    error_details: JSON.stringify(Object.assign({ step: step, why: s(why).slice(0, 4000) }, extra || {})) })], needJobUpd: "YES", result_code: "IA_WAIT", result_message: step + ": " + why + " - waiting " + seconds + " s",
  job_status: "COMMITTING_IA" });
};
// op 1 answered 409 with no intent row: nothing was written - wait for the other operation (15 s x 2^n, at most 5 min)
const lockWait = function lockWait(entry, why) {
  const n = num(entry.attempts);
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: iaDbAddSeconds(endNow(entry), Math.min(300, 15 * Math.pow(2, n))), error_code: "IA_LOCK_WAIT",
    error_message: ("I2_ISSUE: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "I2_ISSUE", why: s(why).slice(0, 2000), attempt: n + 1 }) })], needJobUpd: "YES", result_code: "IA_LOCK_WAIT",
  result_message: "I2_ISSUE: the components' stock is locked by another operation - wait " + (n + 1) + " of " + IA_LOCK_WAIT_TRIES, job_status: "COMMITTING_IA" });
};
// before op 1 moved stock (phase A): FAILED, the IA back to its prevStatus while this job owns it, and this job's own Batch
// rows (`ours`: the ids its I1 inserted) soft-deleted; an owned IA whose prevStatus is not Draft / Created -> REQUIRES_REVIEW, nothing else written.
// Op 1 already has engine rows (a run died after its APPLY, before I2 DONE) -> REQUIRES_REVIEW, nothing else written (ruling 10 R2)
// this job's Batch rows: I1's one (batchId) or, for an output split, one per group (batchIds); `more` = this pass's I1 output (plan 10-27)
const iaBatchIdsOf = (entry, more) => [entry, more].reduce((out, x) => out.concat(x && x.batchIds && typeof x.batchIds === "object" ? Object.values(x.batchIds) : [],
  x && x.batchId ? [x.batchId] : []), []).map((v) => (v === undefined || v === null ? "" : String(v))).filter((v, i, a) => /^[0-9]{1,20}$/.test(v) && a.indexOf(v) === i);
const failNoWrite = function failNoWrite(entry, code, message, why, ours) {
  if (entry.op1Wrote === "YES") {
    return reviewEnd(entry, "I2_ISSUE", "IA_RECONCILIATION_MISMATCH", "op 1 (" + iaOpKey(entry.jobId, "I") + ") already has engine rows, so " + code + " (" + s(why || message)
      + ") cannot be written as a clean failure: no unlock, no Batch row removed", { wouldFail: code });
  }
  const owned = entry.unlockOk === "YES";
  const detail = JSON.stringify({ step: "IA_V2_COMMIT", why: s(why || message).slice(0, 4000) });
  if (owned && !iaPrevStatusOk(entry.prevStatus)) {
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: IA_TEXT.prevUnknown, error_code: "IA_PREV_STATUS_UNKNOWN",
      error_message: IA_TEXT.prevUnknown, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "IA_PREV_STATUS_UNKNOWN",
    result_message: s(why || message) + " (prevStatus '" + s(entry.prevStatus) + "' unknown: no unlock)", job_status: "REQUIRES_REVIEW" });
  }
  const unlock = owned ? [{ id: entry.iaId, item_assembly_status: s(entry.prevStatus) }] : [];
  const del = list(ours).map(s).filter((x, i, a) => digits(x) && a.indexOf(x) === i).map((x) => ({ id: x, is_deleted: 1 }));
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not completed: " + message).slice(0, 250), error_code: code,
    error_message: message, error_details: detail, finished_at: endNow(entry) })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", batchDelRows: del,
  needBatchDel: del.length ? "YES" : "NO", result_code: code, result_message: s(why || message), job_status: "FAILED" });
};
const stepOk = function stepOk(entry, step, ref, message) {
  return Object.assign({ route: "OK" }, END_EMPTY, { stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", result_code: "", result_message: message || step + " done",
    job_status: "COMMITTING_IA" });
};
// an engine answer's text: the platform's error envelope carries it in msg, not message
const engineWhy = function engineWhy(what, ans) {
  const code = s(ans.code);
  return what + " answered " + (code || "nothing") + (s(ans.result_code) ? " " + s(ans.result_code) : "") + (s(ans.message) ? ": " + s(ans.message) : "");
};
