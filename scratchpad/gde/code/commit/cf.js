// custom fields: the platform stores field names as the table's definition ids (and keeps ids it is given), so a raw read sees
// ids where the form sent names (GD lines 502801, GD2610-0654; GD header LSH 128671). The reads carry the definitions as a row
// { cf_defs: { id: name } }; a custom-fields value compares as names, without the names a table with definitions lacks (its
// write drops them). Self-contained: SUBMIT's gate and PREPARE's plan include it too.
const geCfDefs = function geCfDefs(rows) {
  for (const r of Array.isArray(rows) ? rows : rows ? [rows] : []) {
    let x = r;
    if (r && typeof r.j === "string") { try { x = JSON.parse(r.j); } catch (e) { x = null; } }
    if (x && x.cf_defs && typeof x.cf_defs === "object") return x.cf_defs;
  }
  return {};
};
const geCfCanon = function geCfCanon(v, defs) {
  let o = v;
  if (typeof v === "string" && /^\s*\{/.test(v)) { try { o = JSON.parse(v); } catch (e) { o = v; } }
  if (!o || typeof o !== "object" || Array.isArray(o)) return v;
  const d = defs || {};
  const names = Object.keys(d).map((k) => d[k]);
  const out = {};
  for (const k of Object.keys(o)) {
    const name = d[k] || k;
    if (!names.length || names.indexOf(name) >= 0) out[name] = o[k];
  }
  return out;
};
const geSame = (defs) => (c, a, b) => (/^custom_fields/.test(c) ? sameVal(geCfCanon(a, defs), geCfCanon(b, defs)) : sameVal(a, b));
