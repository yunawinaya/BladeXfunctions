// SM V2 / Location Transfer - lotLineFingerprint: ONE canonical fingerprint of a Location Transfer's lines. SUBMIT (B) stamps
// it on the job (request.lineFingerprint over the STORED lines; request.incomingFingerprint over the lines a COMPLETE / EDIT
// will write at L2), COMMIT L0 (C) compares the stored lines with it, COMMIT L2 uses both to tell "written" from "not yet".
//
// Input: the lines as code/shared/sql.py FP_LINES reads them ({ j: "<JSON_OBJECT>" } rows), as plain objects (a get-node /
// adapter document's stock_movement, flattened), or the form's / code_node_yPlLXIZW's flatLines. Fields used:
//   id, line_index, item_selection (the line's item), quantity_uom, location_id (the TARGET bin), temp_qty_data
//   (text or array; per entry: material_id, location_id (the SOURCE bin), batch_id, category, sm_quantity, material_uom,
//   handling_unit_id)
// Deliberately NOT used: total_quantity and every other decimal COLUMN (the platform rounds a decimal column to the
// tenant's number rule on write, so a value read back can differ from the one written - see _cmp.js sameStored); the
// quantities that move stock are the entries' sm_quantity, kept verbatim inside the temp_qty_data text.
// Entries with sm_quantity <= 0 are kept (any change is a change); entry order is kept (it orders the movements); lines are
// ordered by id (numeric), a line without an id sorts first by line_index.
// Output: "LF1:<line count>:<16 hex>" - FNV-1a 32 + djb2 32 over the canonical text (the GR V2 client's idemKey hash).
const lotFpCanonRows = function lotFpCanonRows(lines) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const id = (v) => {
    if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v);
    const t = s(v);
    return /^[0-9]{1,20}$/.test(t) || t === "" ? t : "?" + t;
  };
  const q8t = (v) => (v === undefined || v === null || s(v) === "" ? "" : Number((parseFloat(v) || 0).toFixed(8)).toFixed(8));
  const cat = (c) => (c === "UNR" ? "Unrestricted" : c === "BLK" ? "Blocked" : s(c) || "Unrestricted");
  const parse = (t) => {
    try {
      return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
    } catch (e) {
      return undefined;
    }
  };
  const rows = (Array.isArray(lines) ? lines : lines ? [lines] : []).map((r) => (r && typeof r === "object" && typeof r.j === "string" ? parse(r.j) : r))
    .filter((r) => r && typeof r === "object");
  const entriesOf = (v) => {
    if (Array.isArray(v)) return v;
    const t = s(v);
    if (!t) return [];
    const p = parse(t);
    return Array.isArray(p) ? p : "RAW:" + t;
  };
  const canon = rows.map((l) => {
    const e = entriesOf(l.temp_qty_data);
    return [id(l.id), s(l.line_index), s(l.item_selection), id(l.quantity_uom), id(l.location_id),
      typeof e === "string" ? e : e.map((x) => (x && typeof x === "object" ? [s(x.material_id), id(x.location_id), id(x.batch_id), cat(x.category), q8t(x.sm_quantity),
        id(x.material_uom), s(x.handling_unit_id)] : ["?", s(x)]))];
  });
  const key = (a) => (a[0] ? "1" + String(a[0].length).padStart(2, "0") + a[0] : "0" + a[1].padStart(12, "0"));
  canon.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return canon;
};
const lotFpCanon = (lines) => JSON.stringify(lotFpCanonRows(lines));
const lotFpHash = function lotFpHash(text) {
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
const lotLineFingerprint = function lotLineFingerprint(lines) {
  const canon = lotFpCanonRows(lines);
  return "LF1:" + canon.length + ":" + lotFpHash(JSON.stringify(canon));
};
if (typeof module !== "undefined") module.exports = { lotFpCanonRows, lotFpCanon, lotFpHash, lotLineFingerprint };
