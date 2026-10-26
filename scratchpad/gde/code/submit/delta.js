// GD Edit V2 - the edit as a delta: the form's allData against the GD as stored, column by column (gdc's gcColValue
// decides equality, as GD_COMPLETE_SUBMIT's form check does). Changed cells carry the form's raw value; a column the
// form leaves out is a drop (the classic write of the form's row leaves it empty); a line without an id is added whole;
// a stored line the form no longer has is removed; `layout` keeps the form's order and bundle nesting.
// delta = { header: {col: value}, dropHeader: [col], lines: [{id, cells: {col: value}, drop: [col]}], added: [row],
//           removed: [id], layout: [{ref: id | "+n", children: [id | "+n"]}] }
// cfDefs: the header table's custom-field definitions (cf.js) - a header custom_fields value compares as names
const geDelta = function geDelta(form, stored, kinds, cfDefs) {
  const H = kinds.header, L = kinds.line;
  const hv = (c, v) => (c === "custom_fields" && cfDefs ? geCfCanon(v, cfDefs) : v);
  // JSON with sorted keys: a MySQL json column keeps its own key order
  const sorted = (key, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => ((o[kk] = x[kk]), o), {}) : x);
  const norm = (v, k) => {
    const x = gcColValue(v, k);
    return x === undefined ? null : typeof x === "object" ? JSON.stringify(x, sorted) : x;
  };
  const eq = (a, b) => (a === null && b === null) || (a !== null && b !== null && (typeof a === "number" || typeof b === "number" ? Math.abs(Number(a) - Number(b)) < 1e-9 : String(a) === String(b)));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const delta = { header: {}, dropHeader: [], lines: [], added: [], removed: [], layout: [] };
  for (const c of Object.keys(H)) {
    if (c === "table_gd" || c === "id") continue;
    if (has(form, c)) { if (!eq(norm(hv(c, form[c]), H[c]), norm(hv(c, stored[c]), H[c]))) delta.header[c] = form[c]; }
    else if (has(stored, c)) delta.dropHeader.push(c);
  }
  const byId = {};
  for (const r of stored.table_gd || []) { byId[String(r.id)] = r; for (const ch of r.children || []) byId[String(ch.id)] = ch; }
  const seen = {};
  const cellsOf = (r, o) => {
    const cells = {}, drop = [];
    for (const c of Object.keys(L)) {
      if (c === "id" || c === "children") continue;
      if (has(r, c)) { if (!eq(norm(r[c], L[c]), norm(o[c], L[c]))) cells[c] = r[c]; }
      else if (has(o, c)) drop.push(c);
    }
    return { cells, drop };
  };
  const refOf = (r) => {
    const id = r.id === undefined || r.id === null || r.id === "" ? "" : String(r.id);
    if (id && byId[id]) {
      seen[id] = true;
      const d = cellsOf(r, byId[id]);
      if (Object.keys(d.cells).length || d.drop.length) delta.lines.push({ id: id, cells: d.cells, drop: d.drop });
      return id;
    }
    const row = JSON.parse(JSON.stringify(r));
    delete row.children;
    delta.added.push(row);
    return "+" + (delta.added.length - 1);
  };
  for (const r of form.table_gd || []) delta.layout.push({ ref: refOf(r), children: (r.children || []).map(refOf) });
  delta.removed = Object.keys(byId).filter((id) => !seen[id]);
  return delta;
};
