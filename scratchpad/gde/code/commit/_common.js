// GD_EDIT_COMMIT - shared helpers (included into each code node by build_gde.py); gdc's commit/_common.js + _cmp.js with
// the edit's unlock: the GD back to its stored status (Created or Draft) and our Picking lock released at its version
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
// finished_at = the run's real end: the DB clock read at entry + the seconds since (jsAt = the entry's Date.now())
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
// value comparison for read-backs: "" / null / undefined are one nothing; numbers compare at 8 dp; ids and text exactly
const sameVal = function sameVal(a, b) {
  const ea = a === undefined || a === null || a === "";
  const eb = b === undefined || b === null || b === "";
  if (ea || eb) return ea && eb;
  // JSON (objects, or JSON text on both sides) compares with sorted keys: a MySQL json column keeps its own key order
  const jt = (v) => typeof v === "string" && /^\s*[[{]/.test(v);
  if (typeof a === "object" || typeof b === "object" || (jt(a) && jt(b))) {
    const pa = typeof a === "string" ? parseJ(a) : a, pb = typeof b === "string" ? parseJ(b) : b;
    const sorted = (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x);
    if (pa !== null && pb !== null) return JSON.stringify(pa, sorted) === JSON.stringify(pb, sorted);
  }
  const na = typeof a === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(String(a));
  const nb = typeof b === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(String(b));
  if (na && nb && String(a).replace(/\.0+$/, "").length < 16 && String(b).replace(/\.0+$/, "").length < 16) return Math.abs(q8(a) - q8(b)) < 1e-8;
  return String(a) === String(b);
};
const parseJ = function parseJ(t) {
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
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
const doneRow = function doneRow(entry, step, ref) {
  return { job_id: entry.jobId, organization_id: entry.organizationId, step_name: step, step_status: "DONE", attempt_count: 1, started_at: entry.dbNow,
    finished_at: endNow(entry), inventory_operation_id: "", result_ref: s(ref).slice(0, 2000), error_code: null, error_message: null };
};
const jobRow = function jobRow(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_GD", progress_percent: 70, progress_message: "Saving the delivery", attempt_count: entry.attempts,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: null, error_message: null, error_details: null, finished_at: null }, patch);
};
const END_EMPTY = { stepRows: [], needStep: "NO", unlockRows: [], needUnlock: "NO", pickUnlockRows: [], needPickUnlock: "NO", restoreRows: [], needRestore: "NO" };
// a step that did not complete: retry with backoff, or REQUIRES_REVIEW (after MAX_RETRIES, or at once when `review`)
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = entry.attempts;
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Goods Delivery stays Processing for review";
    return Object.assign({}, END_EMPTY, { route: "END", jobRows: [jobRow(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the edit stopped half-way", error_code: "GDE_RECONCILIATION_MISMATCH", error_message: msg, error_details: JSON.stringify({ step: step, why: why }), finished_at: endNow(entry) })], needJobUpd: "YES", result_code: "GDE_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" });
  }
  return Object.assign({}, END_EMPTY, { route: "END", jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)), error_code: "GDE_STEP_RETRY", error_message: step + ": " + why, error_details: JSON.stringify({ step: step, why: why, attempt: n + 1 }) })], needJobUpd: "YES", result_code: "GDE_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_GD" });
};
// before E1 writes the inventory nothing irreversible exists: FAILED, the GD back to its stored status (when the latest
// lock is ours), our Picking lock released (at its version), a Draft's number put back (E0N's intent)
const failNoWrite = function failNoWrite(entry, code, why, restore) {
  const unlock = entry.unlockOk === "YES";
  const pickUnlock = entry.pickUnlockOk === "YES";
  return Object.assign({}, END_EMPTY, { route: "END", jobRows: [jobRow(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not saved: " + why).slice(0, 250), error_code: code, error_message: why, error_details: JSON.stringify({ step: "GD_EDIT_COMMIT", why: why }), finished_at: endNow(entry) })], needJobUpd: "YES",
    unlockRows: unlock ? [{ id: entry.gdId, gd_status: entry.storedStatus || "Created" }] : [], needUnlock: unlock ? "YES" : "NO",
    pickUnlockRows: pickUnlock ? [{ id: entry.pickingId, is_processing: 0 }] : [], needPickUnlock: pickUnlock ? "YES" : "NO",
    restoreRows: restore ? [Object.assign({ id: entry.gdId }, restore)] : [], needRestore: restore ? "YES" : "NO",
    result_code: code, result_message: why, job_status: "FAILED" });
};
// a phase ended: COMMITTING_GD under a SPLIT|<nonce> hand-over lease with no next attempt - the worker calls GD_EDIT_COMMIT
// again in the same tick for the next phase
const commitPhaseSplit = function commitPhaseSplit(entry, guard, progress, message) {
  return { splitRows: [jobRow(entry, { progress_percent: progress, progress_message: message, lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })], needSplit: "YES" };
};
const stepOk = function stepOk(entry, step, ref, message) {
  return Object.assign({}, END_EMPTY, { route: "OK", stepRows: [doneRow(entry, step, ref)], needStep: "YES", jobRows: [], needJobUpd: "NO", result_code: "", result_message: message || step + " done", job_status: "COMMITTING_GD" });
};
// the placeholders PREPARE minted, resolved: a new line's id (E2 inserted it under job_line_key <job>|L|<n>) and a Draft's
// number (E0N's DONE row)
const geResolver = function geResolver(entry, gdl, lineRows, number) {
  const byKey = {};
  for (const r of list(lineRows)) if (s(r.job_line_key).indexOf(entry.jobId + "|L|") === 0) byKey[s(r.job_line_key)] = s(r.id);
  const map = {};
  (gdl.inserts || []).forEach((ins, i) => { const id = byKey[entry.jobId + "|L|" + (i + 1)]; if (id) map[s(ins.ph)] = id; });
  const fix = (v) => {
    if (typeof v === "string") { if (map[v]) return map[v]; if (number && v === "#GDE-DELIVERY-NO#") return number; return v; }
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = fix(v[k]); return o; }
    return v;
  };
  const unresolved = (v) => JSON.stringify(v).match(/"9\d{18}"|#GDE-DELIVERY-NO#/);
  return { map, fix, unresolved };
};
