const PKC = {
  retry: { max_retries: 3, base_delay_ms: 2000, max_delay_ms: 30000 },
  worker_budget_seconds: 20,
  states: ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA"],
  hard: ["SA_INVALID_REQUEST", "SA_INVALID_DATA", "SA_NOT_FOUND", "SA_SC_NOT_FOUND", "SA_NOT_LOCKED", "SA_NOT_ELIGIBLE", "SA_LINES_CHANGED", "SA_SC_CHANGED", "SA_SPLIT_REQUIRED", "SA_PLAN_BROKEN", "SA_REVIEW_BUILD_FAILED", "JOB_ILLEGAL_TRANSITION"],
};
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const endNow = (entry) => (Number(entry.jsAt) > 0 ? dbAddSeconds(entry.dbNow, Math.max(0, Math.floor((Date.now() - Number(entry.jsAt)) / 1000))) : "") || entry.dbNow;
// SA V2 / SC Review V2 - helpers every package uses (SUBMIT, PREPARE, COMMIT, WORKER, client). Copied from smv2
// code/shared/lot_common.js (with f8's lotParseJ fix) and renamed sa / SA_. Included into a code node by the builders
// (v2build.include_js drops the "if (typeof module" line); every top-level name carries the sa / SA_ prefix so the file
// concatenates with a step's own helpers (s, q8, list, digits, parseJ) without a redeclaration.
const saS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
// q8: the 8-dp rounding of COMPUTED quantities (STOCK_ADJUSTMENT code_node_O4tWJ5JH's q8); a NUMBER
const saQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// a decimal as the 8-dp text the platform stores, never negative; a STRING
const saQtyStr = (v) => Math.max(0, saQ8(v)).toFixed(8);
const saDigits = (v) => /^[0-9]{1,20}$/.test(saS(v));
// a bigint id as a digit string: a digit string as is, a SAFE non-negative integer number as its digits; anything else
// (a 19-digit id that already went through a JS number, "", null, text) -> ""
const saIdStr = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "";
  const t = saS(v);
  return /^[0-9]{1,20}$/.test(t) ? t : "";
};
// JSON text with every bare 16+ digit integer TOKEN read as a STRING (snowflake ids survive); only whole integer tokens -
// never the fraction digits of a float such as 0.30000000000000004; null when it does not parse
const saParseJ = (t) => {
  if (t === undefined || t === null) return null;
  if (typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
const saList = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
// a JSON-text-or-array column (balance_index, reference_documents): the array, [] when empty / not a list
const saJsonList = (v) => {
  if (Array.isArray(v)) return v;
  const t = saS(v);
  if (!t) return [];
  const p = saParseJ(t);
  return Array.isArray(p) ? p : [];
};
// sql-node rows: JSON_OBJECT rows ({ j: "<json>" }) or already-plain objects -> plain objects (ids of 16+ digits as strings)
const saRows = (rows) => saList(rows).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? saParseJ(r.j) : r)).filter((r) => r && typeof r === "object");
// STOCK_ADJUSTMENT code_node_GmKmvMGe: balance.category || "Unrestricted"
const saCategory = (c) => saS(c) || "Unrestricted";
// an entry's movement_type -> "ADD" (in) / "SUBTRACT" (out) / "" (invalid); readers are case-insensitive (prod holds
// In / IN / Out / OUT); the STORED casing is never rewritten (AutoCount V2 posting compares it exactly)
const saDirection = (mt) => {
  const t = saS(mt).toLowerCase();
  return t === "in" ? "ADD" : t === "out" ? "SUBTRACT" : "";
};
// UTF-8 byte length of a balance_index value (the column is TEXT, 65,535 bytes; prod's non-strict sql_mode truncates)
const saUtf8Bytes = (v) => {
  const t = Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : saS(v);
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
};
const SA_LINE_MAX_BYTES = 60000;
const SA_MAX_ENTRIES = 5000;
const SA_CLASSIC_MAX_ENTRIES = 500;
const SA_REVIEW_LINE_MAX_ENTRIES = 50;
const saDbAddSeconds = function saDbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// the bounded statuses a COMPLETE_SA job may restore (CONTRACT.md §2): FORM -> Draft, REVIEW -> Cancelled; anything else =
// unknown = no unlock, REQUIRES_REVIEW SA_PREV_STATUS_UNKNOWN
const SA_PREV_STATUSES = ["Draft", "Cancelled"];
const saPrevStatusOk = (v) => SA_PREV_STATUSES.indexOf(saS(v)) >= 0;
// the payload part rows of one value: step_name <prefix><nnn>, 400,000 characters each (GR / Putaway / LOT V2's chunking)
const SA_CHUNK = 400000;
const saPartRows = function saPartRows(jobId, organizationId, prefix, value, status) {
  const text = JSON.stringify(value);
  const out = [];
  for (let at = 0, n = 1; at < text.length || n === 1; at += SA_CHUNK, n++) {
    out.push({ job_id: saS(jobId), organization_id: saS(organizationId), step_name: prefix + String(n).padStart(3, "0"), step_status: status || "PAYLOAD", attempt_count: 0,
      result_ref: text.slice(at, at + SA_CHUNK) });
  }
  return out;
};
// a part's chunk rows (step_name <prefix>nnn) joined in step-name order -> the value; null when there is no row, undefined
// when the joined text does not parse (GR's joinChunks)
const saJoinChunks = function saJoinChunks(rows, prefix) {
  const mine = saList(rows).filter((r) => saS(r.step_name).indexOf(prefix) === 0).sort((a, b) => (saS(a.step_name) < saS(b.step_name) ? -1 : 1));
  if (!mine.length) return null;
  const p = saParseJ(mine.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
  return p === null ? undefined : p;
};
// the Stock Adjustment back to the status before the completion: only when this job owns it (sa id not "0") and prevStatus is
// Draft / Cancelled (CONTRACT section 2); an owned Stock Adjustment whose prevStatus is anything else keeps its lock and the job
// goes to REQUIRES_REVIEW SA_PREV_STATUS_UNKNOWN (no default)
const saWorkerRelease = function saWorkerRelease(saId, prevStatus) {
  const id = String(saId === undefined || saId === null ? "" : saId).trim();
  const rel = { unlockRows: [], result_code: "" };
  if (!/^[0-9]{1,20}$/.test(id) || id === "0") return rel;
  if (!saPrevStatusOk(prevStatus)) return Object.assign(rel, { result_code: "SA_PREV_STATUS_UNKNOWN" });
  return Object.assign(rel, { unlockRows: [{ id: id, stock_adjustment_status: saS(prevStatus) }] });
};
const SA_REVIEW_PREV = { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the status to restore is unknown. Please contact support.",
  error_code: "SA_PREV_STATUS_UNKNOWN", error_message: "Under review: the status to restore is unknown. Please contact support." };
