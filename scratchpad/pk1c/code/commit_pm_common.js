// Picking V2 1c - PICKING_BULK_COMMIT's move steps (PM1 stock, PM2 reservations, PM3 the moved lines' allocation): shared
// helpers. A step that does not complete ends as the other Picking V2 checks do: retry with backoff, or REQUIRES_REVIEW
// (after PM_MAX_RETRIES, or at once) with the Picking still locked; FAILED + unlock only while nothing was written.
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// finished_at = the run's real end: the DB clock read at entry + the seconds since (jsAt = the entry's Date.now())
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
const PM_MAX_RETRIES = 3;
const pmS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const pmList = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const pmQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const pmParseJ = function pmParseJ(t) {
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
  } catch (e) {
    return null;
  }
};
const pmSame = function pmSame(a, b) {
  const ea = a === undefined || a === null || a === "";
  const eb = b === undefined || b === null || b === "";
  if (ea || eb) return ea && eb;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  const na = typeof a === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(String(a));
  const nb = typeof b === "number" || /^-?[0-9]+(\.[0-9]+)?$/.test(String(b));
  if (na && nb && String(a).replace(/\.0+$/, "").length < 16 && String(b).replace(/\.0+$/, "").length < 16) return Math.abs(pmQ8(a) - pmQ8(b)) < 1e-8;
  return String(a) === String(b);
};
const pmDbAddSeconds = function pmDbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const pmSlices = function pmSlices(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push({ n: out.length + 1, rows: rows.slice(i, i + size) });
  return out;
};
const PM_END = { stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", waitRows: [], needWait: "NO" };
const pmJob = function pmJob(entry, patch) {
  return Object.assign({ id: entry.jobId, job_status: "COMMITTING_PICKING", progress_percent: 70, progress_message: "Saving the picked lines (retrying)", attempt_count: entry.attempts,
    next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: null, error_message: null, error_details: null, finished_at: null }, patch);
};
const pmEnd = function pmEnd(entry, step, why, review) {
  const n = entry.attempts;
  if (review || n >= PM_MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Picking stays locked for review";
    return Object.assign({}, PM_END, { route: "END", jobRows: [pmJob(entry, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the confirmation stopped half-way",
      error_code: "PK_RECONCILIATION_MISMATCH", error_message: msg, error_details: JSON.stringify({ step: step, why: why }), finished_at: endNow(entry) })], needJobUpd: "YES",
      result_code: "PK_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" });
  }
  return Object.assign({}, PM_END, { route: "END", jobRows: [pmJob(entry, { attempt_count: n + 1, next_attempt_at: pmDbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)),
    error_code: "PK_STEP_RETRY", error_message: step + ": " + why, error_details: JSON.stringify({ step: step, why: why, attempt: n + 1 }) })], needJobUpd: "YES", result_code: "PK_STEP_RETRY",
    result_message: step + ": " + why + " - retry " + (n + 1) + " of " + PM_MAX_RETRIES, job_status: "COMMITTING_PICKING" });
};
// nothing was written by this job yet (no stock moved): FAILED with the reason and the Picking unlocked
const pmFail = function pmFail(entry, code, why) {
  return Object.assign({}, PM_END, { route: "END", jobRows: [pmJob(entry, { job_status: "FAILED", progress_percent: 0, progress_message: ("Not confirmed: " + why).slice(0, 250), error_code: code,
    error_message: why, error_details: JSON.stringify({ step: "PICKING_BULK_COMMIT", why: why }), finished_at: endNow(entry) })], needJobUpd: "YES",
    unlockRows: [{ id: entry.pickingId, is_processing: 0 }], needUnlock: "YES", result_code: code, result_message: why, job_status: "FAILED" });
};
const pmOk = function pmOk(entry, step, ref, message, opId) {
  return Object.assign({}, PM_END, { route: "OK", stepRows: [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: step, step_status: "DONE", attempt_count: 1,
    started_at: entry.dbNow, finished_at: endNow(entry), inventory_operation_id: opId || "", result_ref: pmS(ref).slice(0, 500), error_code: null, error_message: null }], needStep: "YES",
    result_code: "", result_message: message || step + " done", job_status: "COMMITTING_PICKING" });
};
// update_node_7k2yYMLH / add_node_ojy0rTgC's columns (GD Edit V2's E3); decimals as 8-dp strings (the multipleOf check)
const PM_RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const PM_RES_CREATE_COLS = ["doc_type", "status", "parent_id", "parent_line_id", "parent_no", "doc_no", "doc_id", "doc_line_id", "material_id", "item_code", "item_name", "item_desc",
  "batch_id", "bin_location", "item_uom", "reserved_qty", "delivered_qty", "open_qty", "reserved_date", "line_no", "plant_id", "organization_id", "remark", "target_gd_id",
  "source_reserved_id", "handling_unit_id", "job_line_key"];
const pmResDec = { reserved_qty: 1, open_qty: 1, delivered_qty: 1 };
const pmResCell = (c, v) => (v === undefined || v === null ? null : pmResDec[c] ? (v === "" ? null : pmQ8(v).toFixed(8)) : v);
// the k / j rows of a facts read: U = a reservation now, C = one this job created, L = a moved line now, I = the intent count
const pmRows = function pmRows(rows) {
  const out = { U: {}, C: {}, L: {}, I: 0 };
  for (const r of pmList(rows)) {
    const k = pmS(r.k);
    if (k === "I") { out.I = Number(r.j) || 0; continue; }
    const o = typeof r.j === "string" ? pmParseJ(r.j) : r.j;
    if (!o) continue;
    if (k === "U") out.U[pmS(o.id)] = o;
    else if (k === "L") out.L[pmS(o.id)] = o;
    else if (k === "C") out.C[pmS(o.job_line_key)] = (out.C[pmS(o.job_line_key)] || 0) + 1;
  }
  return out;
};
