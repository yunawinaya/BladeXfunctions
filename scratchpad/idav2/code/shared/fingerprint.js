// DF1: one fingerprint of an Item Disassembly's STORED recovery lines + the header fields and source picks that become a movement or a
// Batch row (CONTRACT.md section 6; always over FP_LINES + FP_HEADER rows: SUBMIT's read-back, PREPARE, COMMIT D0)
const idaFpParse = function idaFpParse(t) {
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return undefined;
  }
};
const idaFpRows = function idaFpRows(lines) {
  return (Array.isArray(lines) ? lines : lines ? [lines] : []).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? idaFpParse(r.j) : r))
    .filter((r) => r && typeof r === "object");
};
const idaFpS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
// the stored text as it is (a batch number's own spaces count)
const idaFpRaw = (v) => (v === undefined || v === null ? "" : String(v));
// an id that went through a JS number past 2^53 is marked, never silently equal
const idaFpId = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v);
  const t = idaFpS(v);
  return /^[0-9]{1,20}$/.test(t) || t === "" ? t : "?" + t;
};
const idaFpQ8 = (v) => (v === undefined || v === null || idaFpS(v) === "" ? "" : Number((parseFloat(v) || 0).toFixed(8)).toFixed(8));
const idaFpHash = function idaFpHash(text) {
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
const idaFpEntries = function idaFpEntries(v) {
  if (Array.isArray(v)) return v;
  const t = idaFpS(v);
  if (!t) return [];
  const p = idaFpParse(t);
  return Array.isArray(p) ? p : "RAW:" + t;
};
// per line: id, line_index, item_selection, quantity_uom, total_quantity (8 dp), target bin, batch number (as stored), dates
const idaFpCanonRows = function idaFpCanonRows(lines) {
  const canon = idaFpRows(lines).map((l) => [idaFpId(l.id), idaFpS(l.line_index), idaFpS(l.item_selection), idaFpId(l.quantity_uom), idaFpQ8(l.total_quantity),
    idaFpId(l.location_id), idaFpRaw(l.batch_number), idaFpS(l.manufacturing_date), idaFpS(l.expired_date)]);
  const key = (a) => (a[0] ? "1" + String(a[0].length).padStart(2, "0") + a[0] : "0" + a[1].padStart(12, "0"));
  canon.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return canon;
};
// header: the item taken apart, its qty and UOM, the plant, the document date, every temp_qty_data entry in array order
const idaFpCanonHeader = function idaFpCanonHeader(header) {
  const h = idaFpRows(header)[0] || {};
  const e = idaFpEntries(h.temp_qty_data);
  const picks = typeof e === "string" ? e : e.map((x) => (x && typeof x === "object" ? [idaFpId(x.balance_id), idaFpId(x.location_id), idaFpId(x.batch_id),
    idaFpS(x.category) || "Unrestricted", idaFpQ8(x.sm_quantity), idaFpId(x.handling_unit_id)] : ["?", idaFpS(x)]));
  return [idaFpId(h.item_id), idaFpQ8(h.item_qty), idaFpId(h.item_uom), idaFpId(h.issuing_operation_faci), idaFpS(h.item_disassembly_date), picks];
};
const idaLineFingerprint = function idaLineFingerprint(lines, header) {
  const rows = idaFpCanonRows(lines);
  return "DF1:" + rows.length + ":" + idaFpHash(JSON.stringify([idaFpCanonHeader(header), rows]));
};
if (typeof module !== "undefined") module.exports = { idaFpParse, idaFpRows, idaFpId, idaFpQ8, idaFpHash, idaFpEntries, idaFpCanonRows, idaFpCanonHeader, idaLineFingerprint };
