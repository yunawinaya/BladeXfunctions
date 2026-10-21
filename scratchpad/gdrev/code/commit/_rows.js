// a prepared part's rows ({ id, before, after }) against the rows read now: at after = done, at before = write, anything else
// (someone else wrote it, or it is gone) = a conflict for review; and the read-back check of the same rows
const byKind = function byKind(rows) {
  const g = {};
  for (const r of list(rows)) {
    const o = parseJ(r.j);
    if (o && o.id !== undefined && o.id !== null) (g[s(r.k)] = g[s(r.k)] || {})[s(o.id)] = o;
  }
  return g;
};
const guardRows = function guardRows(planned, now, cols) {
  const writes = [];
  const conflicts = [];
  for (const r of planned || []) {
    const cur = (now || {})[s(r.id)];
    if (!cur || String(cur.is_deleted) !== "0") {
      conflicts.push(s(r.id) + " (gone)");
      continue;
    }
    if (cols.every((c) => sameVal(cur[c], r.after[c]))) continue;
    const row = { id: s(r.id) };
    for (const c of cols) row[c] = r.after[c] === undefined ? null : r.after[c];
    if (cols.every((c) => sameVal(cur[c], r.before[c]))) writes.push(row);
    else conflicts.push(s(r.id));
  }
  return { writes: writes, conflicts: conflicts };
};
const offRows = (planned, now, cols) => (planned || []).filter((r) => !(now || {})[s(r.id)] || !cols.every((c) => sameVal(now[s(r.id)][c], r.after[c])));
