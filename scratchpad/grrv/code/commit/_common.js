// GR_REVERT_COMMIT - shared helpers (included into each code node by build_grrv.py)
const MAX_RETRIES = 3;
const EPS = 0.005;
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const qtyStr = (v) => Math.max(0, q8(v)).toFixed(8);
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
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
const idsSql = (ids) => ["0"].concat(list(ids).map(s).filter(digits)).join(",");
const doneRow = function doneRow(entry, step, ref) {
  return { job_id: entry.jobId, organization_id: entry.organizationId, step_name: step, step_status: "DONE", attempt_count: 1, started_at: entry.dbNow,
    finished_at: entry.dbNow, inventory_operation_id: "", result_ref: s(ref).slice(0, 2000), error_code: null, error_message: null };
};
const jobRow = function jobRow(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_REVERT", progress_percent: 70, progress_message: "Reverting the receipt", attempt_count: entry.attempts,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: null, error_message: null, error_details: null, finished_at: null }, patch);
};
const END = { route: "END", stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "YES", unlockRows: [], needUnlock: "NO", freeRows: [], needFree: "NO" };
// a step that did not complete: retry with backoff, or REQUIRES_REVIEW (after MAX_RETRIES, or at once when `review`)
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = entry.attempts;
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Goods Receiving stays Processing for review";
    return Object.assign({}, END, { jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the revert stopped half-way",
      error_code: "GRV_RECONCILIATION_MISMATCH", error_message: msg, error_details: JSON.stringify({ step: step, why: why }), finished_at: entry.dbNow })],
      result_code: "GRV_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" });
  }
  return Object.assign({}, END, { jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)),
    error_code: "GRV_STEP_RETRY", error_message: step + ": " + why, error_details: JSON.stringify({ step: step, why: why, attempt: n + 1 }) })],
    result_code: "GRV_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_REVERT" });
};
// a wait that is not a failure (a purchase order held by another receipt): retry later, never counted towards review
const stepWait = function stepWait(entry, step, why, seconds) {
  return Object.assign({}, END, { jobRows: [jobRow(entry, { next_attempt_at: dbAddSeconds(entry.dbNow, seconds || 5), error_code: "GRV_WAIT", error_message: step + ": " + why,
    error_details: JSON.stringify({ step: step, why: why }) })], result_code: "GRV_WAIT", result_message: step + ": " + why + " - waiting", job_status: "COMMITTING_REVERT" });
};
// purchase-order locks, shared with GR Completion V2: gd_publish_step GRPO|<po> / HOLD|<n> (result_ref = the holding job) and
// FREE|<n>; a hold of a job that is no longer open counts as free, a REQUIRES_REVIEW hold does not
const OPEN_JOB = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GR", "COMMITTING_REVERT", "REQUIRES_REVIEW"];
const poLockState = function poLockState(rows) {
  const by = {};
  for (const r of list(rows)) {
    const m = s(r.step_name).match(/^(HOLD|FREE)\|([0-9]{1,9})$/);
    if (!m) continue;
    const key = s(r.job_id);
    const st = by[key] || (by[key] = { n: 0, hold: {}, free: {} });
    const n = Number(m[2]);
    if (m[1] === "HOLD") {
      st.hold[n] = { job: s(r.result_ref), status: s(r.holder_status) };
      if (n > st.n) st.n = n;
    } else st.free[n] = true;
  }
  const out = {};
  for (const key of Object.keys(by)) {
    const st = by[key];
    const h = st.n && !st.free[st.n] ? st.hold[st.n] : null;
    out[key] = { n: st.n, holder: h ? h.job : "", holderStatus: h ? h.status : "", held: h && OPEN_JOB.indexOf(h.status) >= 0 ? "YES" : "NO" };
  }
  return out;
};
const lockRowOf = function lockRowOf(entry, key, step) {
  return { job_id: key, organization_id: entry.organizationId, step_name: step, step_status: "DONE", attempt_count: 1, started_at: entry.dbNow,
    finished_at: entry.dbNow, inventory_operation_id: "", result_ref: entry.jobId, error_code: null, error_message: null };
};
// FREE|<n> for every purchase order this job still holds (the state read at the start of this run)
const freeRowsOf = function freeRowsOf(entry) {
  const st = entry.poLocks || {};
  return Object.keys(st).filter((k) => st[k].holder === entry.jobId).sort().map((k) => lockRowOf(entry, k, "FREE|" + st[k].n));
};
// before R1 moves the stock: FAILED, the Goods Receiving back to the status it had before the submit, its PO locks freed
const failNoWrite = function failNoWrite(entry, code, why, details) {
  const unlock = entry.unlockOk === "YES" ? [{ id: entry.grId, gr_status: entry.prevStatus }] : [];
  const free = freeRowsOf(entry);
  return Object.assign({}, END, { jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not reverted: " + why).slice(0, 250), error_code: code,
    error_message: why, error_details: details ? JSON.stringify(details) : JSON.stringify({ step: "GR_REVERT_COMMIT", why: why }), finished_at: entry.dbNow })],
    unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", freeRows: free, needFree: free.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });
};
const stepOk = function stepOk(entry, step, ref, message) {
  return { route: "OK", stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", freeRows: [], needFree: "NO",
    result_code: "", result_message: message || step + " done", job_status: "COMMITTING_REVERT" };
};
const rowsOf = (rows) => list(rows).map((r) => parseJ(r.j)).filter((o) => o && o.id);
const byId = (rows) => {
  const m = {};
  for (const o of rowsOf(rows)) m[s(o.id)] = o;
  return m;
};
