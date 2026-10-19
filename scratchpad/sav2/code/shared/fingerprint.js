// SA V2 / SC Review V2 - the two canonical fingerprints (CONTRACT.md §6). Copied from smv2 code/shared/fingerprint.js.
//
// saLineFingerprint(lines) -> "SAF1:<n>:<16 hex>" over a Stock Adjustment's lines - ID-FREE (reviewer A3): a whole-subform
//   update inserts rows sent without an id under NEW ids on every attempt, so ids can never prove "already written".
//   Per line, in line_index order (numeric; ties keep input order): line_index, material_id, uom_id, total_quantity (the
//   VARCHAR text, trimmed), unit_price (q8 text), balance_index (the TEXT verbatim; an array arriving parsed is
//   JSON.stringify-ed first, which equals how the platform stores a value it received as an array).
//   unit_price is decimal(65,8): the platform rounds it to the tenant's rule on write - a caller comparing a read-back must
//   use sameStored (commit/_cmp.js) on unit_price itself when the fingerprint differs only there; q8 here.
// scLineFingerprint(lines) -> "SCF1:<n>:<16 hex>" over a Stock Count's lines, sorted by id (numeric; a line without an id
//   first by line_index): id, line_status, review_status, is_counted, count_qty, adjusted_qty, variance_qty (q8 text; "" for
//   null / blank).
// Input: { j: "<JSON_OBJECT>" } sql rows (code/shared/sql.py FP_SA_LINES / FP_SC_LINES) or plain objects (form / adapter rows).
const saFpParse = function saFpParse(t) {
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return undefined;
  }
};
const saFpRows = function saFpRows(lines) {
  return (Array.isArray(lines) ? lines : lines ? [lines] : []).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? saFpParse(r.j) : r))
    .filter((r) => r && typeof r === "object");
};
const saFpS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const saFpId = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v);
  const t = saFpS(v);
  return /^[0-9]{1,20}$/.test(t) || t === "" ? t : "?" + t;
};
const saFpQ8 = (v) => (v === undefined || v === null || saFpS(v) === "" ? "" : Number((parseFloat(v) || 0).toFixed(8)).toFixed(8));
const saFpHash = function saFpHash(text) {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  const hex = (x) => ("00000000" + x.toString(16)).slice(-8);
  return hex(h1) + hex(h2);
};
const saLineFpCanonRows = function saLineFpCanonRows(lines) {
  const rows = saFpRows(lines).map((l, i) => {
    const bi = l.balance_index;
    const biText = Array.isArray(bi) || (bi && typeof bi === "object") ? JSON.stringify(bi) : bi === undefined || bi === null ? "" : String(bi);
    return { i, li: parseFloat(saFpS(l.line_index)), row: [saFpS(l.line_index), saFpS(l.material_id), saFpId(l.uom_id), saFpS(l.total_quantity), saFpQ8(l.unit_price), biText] };
  });
  rows.sort((a, b) => {
    const x = isNaN(a.li) ? Infinity : a.li;
    const y = isNaN(b.li) ? Infinity : b.li;
    return x !== y ? (x < y ? -1 : 1) : a.i - b.i;
  });
  return rows.map((r) => r.row);
};
const saLineFingerprint = function saLineFingerprint(lines) {
  const canon = saLineFpCanonRows(lines);
  return "SAF1:" + canon.length + ":" + saFpHash(JSON.stringify(canon));
};
const scLineFpCanonRows = function scLineFpCanonRows(lines) {
  const canon = saFpRows(lines).map((l) => [saFpId(l.id), saFpS(l.line_index), saFpS(l.line_status), saFpS(l.review_status), saFpS(l.is_counted),
    saFpQ8(l.count_qty), saFpQ8(l.adjusted_qty), saFpQ8(l.variance_qty)]);
  const key = (a) => (a[0] ? "1" + String(a[0].length).padStart(2, "0") + a[0] : "0" + a[1].padStart(12, "0"));
  canon.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return canon;
};
const scLineFingerprint = function scLineFingerprint(lines) {
  const canon = scLineFpCanonRows(lines);
  return "SCF1:" + canon.length + ":" + saFpHash(JSON.stringify(canon));
};
if (typeof module !== "undefined") module.exports = { saFpParse, saFpRows, saFpHash, saLineFpCanonRows, saLineFingerprint, scLineFpCanonRows, scLineFingerprint };
