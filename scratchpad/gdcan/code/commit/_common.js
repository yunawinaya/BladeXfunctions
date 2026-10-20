// GD_CANCEL_COMMIT - shared helpers (included into each code node by build_gdcan.py)
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
// the DB clock now: the run's start (dbNow) + the seconds this run has taken so far
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
// a payload part / an intent: its chunk rows (step_name ...|nnn) joined in order
const joinChunks = function joinChunks(rows, prefix) {
  const mine = list(rows).filter((r) => s(r.step_name).indexOf(prefix) === 0).sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1));
  if (!mine.length) return null;
  try {
    return JSON.parse(mine.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
  } catch (e) {
    return undefined;
  }
};
const chunkRows = function chunkRows(entry, stepPrefix, value) {
  const text = JSON.stringify(value);
  const out = [];
  for (let at = 0, n = 1; at < text.length || n === 1; at += 400000, n++) {
    out.push({ job_id: entry.jobId, organization_id: entry.organizationId, step_name: stepPrefix + String(n).padStart(3, "0"), step_status: "INTENT",
      attempt_count: 0, started_at: entry.dbNow, finished_at: null, inventory_operation_id: "", result_ref: text.slice(at, at + 400000), error_code: null, error_message: null });
  }
  return out;
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
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_GD", progress_percent: 70, progress_message: "Cancelling the delivery", attempt_count: entry.attempts,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: null, error_message: null, error_details: null, finished_at: null }, patch);
};
// a step that did not complete: retry with backoff, or REQUIRES_REVIEW (after MAX_RETRIES, or at once when `review`)
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = entry.attempts;
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Goods Delivery stays Processing for review";
    return { route: "END", jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the cancel stopped half-way", error_code: "GDX_RECONCILIATION_MISMATCH", error_message: msg, error_details: JSON.stringify({ step: step, why: why }), finished_at: endNow(entry) })], needJobUpd: "YES", unlockRows: [], needUnlock: "NO", result_code: "GDX_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" };
  }
  return { route: "END", jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)), error_code: "GDX_STEP_RETRY", error_message: step + ": " + why, error_details: JSON.stringify({ step: step, why: why, attempt: n + 1 }) })], needJobUpd: "YES", unlockRows: [], needUnlock: "NO", result_code: "GDX_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_GD" };
};
// before X2 moves the stock nothing was written: FAILED, the GD back to Created
const failNoWrite = function failNoWrite(entry, code, why) {
  return { route: "END", jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not cancelled: " + why).slice(0, 250), error_code: code, error_message: why, error_details: JSON.stringify({ step: "GD_CANCEL_COMMIT", why: why }), finished_at: endNow(entry) })], needJobUpd: "YES", unlockRows: entry.unlockOk === "YES" ? [{ id: entry.gdId, gd_status: "Created" }] : [], needUnlock: entry.unlockOk === "YES" ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" };
};
const stepOk = function stepOk(entry, step, ref, message) {
  return { route: "OK", stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", result_code: "", result_message: message || step + " done", job_status: "COMMITTING_GD" };
};
