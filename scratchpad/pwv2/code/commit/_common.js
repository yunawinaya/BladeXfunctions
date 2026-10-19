// PUTAWAY_BULK_COMMIT - shared helpers (included into each code node by build_pwv2.py)
const MAX_RETRIES = 3;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// the DB clock now: entry's DB time plus what this run has spent since (no server clock or time zone mixing)
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
// a payload part: its chunk rows (step_name ...|nnn) joined in order
const joinChunks = function joinChunks(rows, prefix) {
  const mine = list(rows).filter((r) => s(r.step_name).indexOf(prefix) === 0).sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1));
  if (!mine.length) return null;
  try {
    return JSON.parse(mine.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
  } catch (e) {
    return undefined;
  }
};
const slicesOf = function slicesOf(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push({ n: out.length + 1, rows: rows.slice(i, i + size) });
  return out;
};
const doneRow = function doneRow(entry, step, ref) {
  return { job_id: entry.jobId, organization_id: entry.organizationId, step_name: step, step_status: "DONE", attempt_count: 1, started_at: entry.dbNow,
    finished_at: endNow(entry), inventory_operation_id: "", result_ref: s(ref).slice(0, 2000), error_code: null, error_message: null };
};
const jobRow = function jobRow(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_PUTAWAY", progress_percent: 70, progress_message: "Completing the putaway", attempt_count: entry.attempts,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: null, error_message: null, error_details: null, finished_at: null }, patch);
};
const END_EMPTY = { stepRows: [], needStep: "NO", unlockRows: [], needUnlock: "NO" };
// a step that did not complete: retry with backoff, or REQUIRES_REVIEW (after MAX_RETRIES, or at once when `review`)
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = entry.attempts;
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the putaway stays locked for review";
    return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the completion stopped half-way", error_code: "PWC_RECONCILIATION_MISMATCH", error_message: msg, error_details: JSON.stringify({ step: step, why: why }), finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "PWC_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" });
  }
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)), error_code: "PWC_STEP_RETRY", error_message: step + ": " + why, error_details: JSON.stringify({ step: step, why: why, attempt: n + 1 }) })], needJobUpd: "YES", result_code: "PWC_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_PUTAWAY" });
};
// a wait that is not a failure (an inventory lock held by another operation): retry later, never counted towards review
const stepWait = function stepWait(entry, step, why, seconds) {
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { next_attempt_at: dbAddSeconds(entry.dbNow, seconds || 5), error_code: "PWC_WAIT", error_message: step + ": " + why, error_details: JSON.stringify({ step: step, why: why }) })], needJobUpd: "YES", result_code: "PWC_WAIT", result_message: step + ": " + why + " - waiting", job_status: "COMMITTING_PUTAWAY" });
};
// before P1 moves the stock: FAILED and the putaway released (is_processing 0); nothing else was written
const failNoWrite = function failNoWrite(entry, code, why) {
  const unlock = entry.unlockOk === "YES" ? [{ id: entry.toId, is_processing: 0 }] : [];
  return Object.assign({ route: "END" }, END_EMPTY, { jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not completed: " + why).slice(0, 250), error_code: code, error_message: why, error_details: JSON.stringify({ step: "PUTAWAY_BULK_COMMIT", why: why }), finished_at: endNow(entry) })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });
};
const stepOk = function stepOk(entry, step, ref, message) {
  return Object.assign({ route: "OK" }, END_EMPTY, { stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", result_code: "", result_message: message || step + " done", job_status: "COMMITTING_PUTAWAY" });
};
