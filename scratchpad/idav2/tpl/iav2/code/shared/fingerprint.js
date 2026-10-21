// IF1: one fingerprint of an Item Assembly's stored component lines + the header fields that change the stock or the price (CONTRACT.md section 6)
const iaFpParse = function iaFpParse(t) {
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return undefined;
  }
};
const iaFpRows = function iaFpRows(lines) {
  return (Array.isArray(lines) ? lines : lines ? [lines] : []).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? iaFpParse(r.j) : r))
    .filter((r) => r && typeof r === "object");
};
const iaFpS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
// an id that went through a JS number past 2^53 is marked, never silently equal
const iaFpId = (v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v);
  const t = iaFpS(v);
  return /^[0-9]{1,20}$/.test(t) || t === "" ? t : "?" + t;
};
const iaFpQ8 = (v) => (v === undefined || v === null || iaFpS(v) === "" ? "" : Number((parseFloat(v) || 0).toFixed(8)).toFixed(8));
const iaFpHash = function iaFpHash(text) {
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
const iaFpEntries = function iaFpEntries(v) {
  if (Array.isArray(v)) return v;
  const t = iaFpS(v);
  if (!t) return [];
  const p = iaFpParse(t);
  return Array.isArray(p) ? p : "RAW:" + t;
};
const iaFpCanonRows = function iaFpCanonRows(lines) {
  const canon = iaFpRows(lines).map((l) => {
    const e = iaFpEntries(l.temp_qty_data);
    return [iaFpId(l.id), iaFpS(l.line_index), iaFpS(l.item_selection), iaFpId(l.quantity_uom), iaFpQ8(l.total_quantity),
      typeof e === "string" ? e : e.map((x) => (x && typeof x === "object" ? [iaFpId(x.balance_id), iaFpId(x.location_id), iaFpId(x.batch_id), iaFpS(x.category) || "Unrestricted",
        iaFpQ8(x.sm_quantity)] : ["?", iaFpS(x)]))];
  });
  const key = (a) => (a[0] ? "1" + String(a[0].length).padStart(2, "0") + a[0] : "0" + a[1].padStart(12, "0"));
  canon.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return canon;
};
const iaFpCanonHeader = function iaFpCanonHeader(header) {
  const h = iaFpRows(header)[0] || {};
  return [iaFpS(h.item_id), iaFpQ8(h.item_qty), iaFpId(h.item_uom), iaFpId(h.location_id), iaFpS(h.inventory_category) || "Unrestricted", iaFpS(h.batch_no),
    iaFpId(h.issuing_operation_faci)];
};
const iaLineFingerprint = function iaLineFingerprint(lines, header) {
  const rows = iaFpCanonRows(lines);
  return "IF1:" + rows.length + ":" + iaFpHash(JSON.stringify([iaFpCanonHeader(header), rows]));
};
// IM1: every movement row of one IA as the classic revert reads them (Revert V2 V0: the live-row set unchanged)
const iaMovesFingerprint = function iaMovesFingerprint(rows) {
  const canon = iaFpRows(rows).map((r) => [iaFpId(r.id), iaFpS(r.transaction_type), iaFpS(r.movement).toUpperCase(), iaFpId(r.item_id), iaFpId(r.batch_number_id),
    iaFpId(r.bin_location_id), iaFpS(r.inventory_category), iaFpId(r.handling_unit_id), iaFpQ8(r.base_qty)]);
  const key = (a) => String(a[0].length).padStart(2, "0") + a[0];
  canon.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return "IM1:" + canon.length + ":" + iaFpHash(JSON.stringify(canon));
};
if (typeof module !== "undefined") module.exports = { iaFpParse, iaFpRows, iaFpId, iaFpQ8, iaFpHash, iaFpEntries, iaFpCanonRows, iaFpCanonHeader, iaLineFingerprint, iaMovesFingerprint };
