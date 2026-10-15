// GD Edit V2 - the edited GD rebuilt from the GD as stored (read fresh) and the edit's delta (code/submit/delta.js): the
// allData the classic save would have received from the form, in the form's line order and nesting.
const geApplyDelta = function geApplyDelta(stored, delta, kinds) {
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const out = copy(stored);
  delete out.table_gd;
  for (const [c, v] of Object.entries(delta.header || {})) out[c] = copy(v === undefined ? null : v);
  for (const c of delta.dropHeader || []) delete out[c];
  const byId = {};
  for (const r of stored.table_gd || []) { byId[String(r.id)] = r; for (const ch of r.children || []) byId[String(ch.id)] = ch; }
  const patch = {};
  for (const l of delta.lines || []) patch[String(l.id)] = l;
  const rowOf = (ref) => {
    if (ref.indexOf("+") === 0) return copy(delta.added[Number(ref.slice(1))]);
    const r = copy(byId[ref]);
    if (!r) throw new Error("delta names line " + ref + ", which the GD no longer has");
    delete r.children;
    const p = patch[ref];
    if (p) {
      for (const [c, v] of Object.entries(p.cells)) r[c] = copy(v === undefined ? null : v);
      for (const c of p.drop) delete r[c];
    }
    return r;
  };
  out.table_gd = (delta.layout || []).map((e) => {
    const r = rowOf(e.ref);
    if ((e.children || []).length) r.children = e.children.map(rowOf);
    return r;
  });
  return out;
};
