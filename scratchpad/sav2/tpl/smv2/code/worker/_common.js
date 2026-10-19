const PKC = {
  retry: { max_retries: 3, base_delay_ms: 2000, max_delay_ms: 30000 },
  worker_budget_seconds: 20,
  states: ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_LOT"],
  hard: ["LOT_INVALID_REQUEST", "LOT_INVALID_DATA", "LOT_NOT_FOUND", "LOT_NOT_LOCKED", "LOT_NOT_ELIGIBLE", "LOT_LINES_CHANGED", "LOT_LEDGER_CHANGED", "LOT_TRANSIT_SHORTAGE", "LOT_RECON_SHORTAGE", "LOT_SPLIT_REQUIRED", "LOT_PLAN_BROKEN", "JOB_ILLEGAL_TRANSITION"],
};
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// SM V2 / Location Transfer - helpers every package uses (SUBMIT, PREPARE, COMMIT, WORKER, client). Included into a code
// node by the builders (v2build.include_js drops the "if (typeof module" line); every top-level name carries the lot / LOT_
// prefix so the file concatenates with a step's own helpers (s, q8, list, digits, parseJ) without a redeclaration.
const lotS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
// q8: the 8-dp rounding of COMPUTED quantities (the LOT classic's own q8); a NUMBER
const lotQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// the ledger's decimal text (code_node_LOTmainCompute / uht83Wzh qtyStr): never negative, 8 dp, a STRING
const lotQtyStr = (v) => Math.max(0, lotQ8(v)).toFixed(8);
const lotDigits = (v) => /^[0-9]{1,20}$/.test(lotS(v));
// a bigint id as a digit string: a digit string as is (leading/trailing blanks trimmed), a SAFE non-negative integer
// number as its digits; anything else (a 19-digit id that already went through a JS number, "", null, text) -> ""
const lotIdStr = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "";
  const t = lotS(v);
  return /^[0-9]{1,20}$/.test(t) ? t : "";
};
// JSON text with every bare 16+ digit integer TOKEN read as a STRING (snowflake ids survive); only whole integer tokens
// (after [ , : or the start; before , ] } or the end) - never the fraction digits of a float such as 0.30000000000000004;
// null when it does not parse
const lotParseJ = (t) => {
  if (t === undefined || t === null) return null;
  if (typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
const lotList = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
// a JSON-text-or-array column (temp_qty_data, temp_hu_data, reference_documents): the array, [] when empty / not a list
const lotJsonList = (v) => {
  if (Array.isArray(v)) return v;
  const t = lotS(v);
  if (!t) return [];
  const p = lotParseJ(t);
  return Array.isArray(p) ? p : [];
};
// sql-node rows: JSON_OBJECT rows ({ j: "<json>" }) or already-plain objects -> plain objects (ids of 16+ digits as strings)
const lotRows = (rows) => lotList(rows).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? lotParseJ(r.j) : r)).filter((r) => r && typeof r === "object");
// code_node_yPlLXIZW's normalizeCategory (UNR / BLK -> the stored names); "" stays "" (the classic then reads "Unrestricted")
const lotCategory = (c) => (c === "UNR" ? "Unrestricted" : c === "BLK" ? "Blocked" : lotS(c));
const lotDbAddSeconds = function lotDbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// the bounded statuses a LOT job may restore (CONTRACT.md "prevStatus"): anything else = unknown = no unlock, REQUIRES_REVIEW
const LOT_PREV_STATUSES = ["Draft", "In Progress"];
const lotPrevStatusOk = (v) => LOT_PREV_STATUSES.indexOf(lotS(v)) >= 0;
// the payload part rows of one value: step_name <prefix><nnn>, 400,000 characters each (GR / Putaway V2's chunking)
const LOT_CHUNK = 400000;
const lotPartRows = function lotPartRows(jobId, organizationId, prefix, value, status) {
  const text = JSON.stringify(value);
  const out = [];
  for (let at = 0, n = 1; at < text.length || n === 1; at += LOT_CHUNK, n++) {
    out.push({ job_id: lotS(jobId), organization_id: lotS(organizationId), step_name: prefix + String(n).padStart(3, "0"), step_status: status || "PAYLOAD", attempt_count: 0,
      result_ref: text.slice(at, at + LOT_CHUNK) });
  }
  return out;
};
// a part's chunk rows (step_name <prefix>nnn) joined in step-name order -> the value; null when there is no row, undefined
// when the joined text does not parse (GR's joinChunks)
const lotJoinChunks = function lotJoinChunks(rows, prefix) {
  const mine = lotList(rows).filter((r) => lotS(r.step_name).indexOf(prefix) === 0).sort((a, b) => (lotS(a.step_name) < lotS(b.step_name) ? -1 : 1));
  if (!mine.length) return null;
  const p = lotParseJ(mine.map((r) => (r.result_ref === undefined || r.result_ref === null ? "" : String(r.result_ref))).join(""));
  return p === null ? undefined : p;
};
// the transfer back to the status before the save: only when this job owns it (lot id not "0") and prevStatus is Draft /
// In Progress; an owned transfer whose prevStatus is unknown keeps its lock and the job goes to REQUIRES_REVIEW (no default)
const lotWorkerRelease = function lotWorkerRelease(lotId, prevStatus) {
  const id = String(lotId === undefined || lotId === null ? "" : lotId).trim();
  if (!/^[0-9]{1,20}$/.test(id) || id === "0") return { unlockRows: [], result_code: "" };
  if (!lotPrevStatusOk(prevStatus)) return { unlockRows: [], result_code: "LOT_PREV_STATUS_UNKNOWN" };
  return { unlockRows: [{ id: id, stock_movement_status: lotS(prevStatus) }], result_code: "" };
};
const LOT_REVIEW_PREV = { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the status to restore is unknown. Please contact support.",
  error_code: "LOT_PREV_STATUS_UNKNOWN", error_message: "Under review: the status to restore is unknown. Please contact support." };
