// PICKING_BULK_COMMIT 1c - PM2 RESERVATIONS (GD Edit V2's E3): each planned update written whole (the 10 columns the classic
// update node writes) only while the row still holds what PREPARE read; at its target = already done; anything else ->
// review (the stock has moved). Each create once, by job_line_key <job>|R|<gi>.<k> (doc_id <- target_gd_id, as
// add_node_ojy0rTgC). The check reads both back.
const commitPM2Plan = function commitPM2Plan(entry, mvp, facts) {
  const base = Object.assign({}, PM_END, { route: "GO", slices: [], writeCount: 0, createRows: [], needCreates: "NO", result_code: "", result_message: "", job_status: "COMMITTING_PICKING" });
  const m = mvp || {};
  if (pmS(m.ok) !== "YES") return Object.assign(base, pmEnd(entry, "PM2_RESERVATIONS", "the move's parts could not be read (" + pmS(m.why) + ")", true));
  const f = pmRows(facts);
  const writes = [], conflicts = [];
  for (const u of pmList(m.res && m.res.updates)) {
    const cur = f.U[pmS(u.id)];
    if (!cur || String(cur.is_deleted) !== "0") { conflicts.push(pmS(u.id) + " (gone)"); continue; }
    if (PM_RES_COLS.every((c) => pmSame(cur[c], (u.after || {})[c]))) continue;
    if (PM_RES_COLS.every((c) => pmSame(cur[c], (u.before || {})[c]))) {
      const w = { id: pmS(u.id) };
      for (const c of PM_RES_COLS) w[c] = pmResCell(c, (u.after || {})[c]);
      writes.push(w);
    } else conflicts.push(pmS(u.id));
  }
  if (conflicts.length) return Object.assign(base, pmEnd(entry, "PM2_RESERVATIONS", conflicts.length + " reservation(s) changed by someone else after the stock moved (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const twice = Object.keys(f.C).filter((k) => f.C[k] > 1);
  if (twice.length) return Object.assign(base, pmEnd(entry, "PM2_RESERVATIONS", "reservation(s) created twice: " + twice.slice(0, 3).join(", "), true));
  const creates = pmList(m.res && m.res.creates).filter((c) => !f.C[pmS(c.job_line_key)]).map((c) => {
    const o = {};
    for (const k of PM_RES_CREATE_COLS) o[k] = pmResCell(k, c[k]);
    o.doc_id = c.target_gd_id === undefined ? null : c.target_gd_id;
    return o;
  });
  return Object.assign(base, { slices: pmSlices(writes, 250), writeCount: writes.length, createRows: creates, needCreates: creates.length ? "YES" : "NO",
    result_message: writes.length + " reservation update(s), " + creates.length + " create(s) to write" });
};
const commitPM2Check = function commitPM2Check(entry, mvp, facts) {
  const m = mvp || {};
  if (pmS(m.ok) !== "YES") return pmEnd(entry, "PM2_RESERVATIONS", "the move's parts could not be read (" + pmS(m.why) + ")", true);
  const f = pmRows(facts);
  const updates = pmList(m.res && m.res.updates), creates = pmList(m.res && m.res.creates);
  const off = updates.filter((u) => !f.U[pmS(u.id)] || !PM_RES_COLS.every((c) => pmSame(f.U[pmS(u.id)][c], (u.after || {})[c])));
  const missing = creates.filter((c) => !f.C[pmS(c.job_line_key)]);
  const twice = Object.keys(f.C).filter((k) => f.C[k] > 1);
  if (twice.length) return pmEnd(entry, "PM2_RESERVATIONS", "reservation(s) created twice: " + twice.slice(0, 3).join(", "), true);
  if (off.length || missing.length) return pmEnd(entry, "PM2_RESERVATIONS", off.length + " update(s) and " + missing.length + " create(s) do not read back", false);
  return pmOk(entry, "PM2_RESERVATIONS", updates.length + " updated, " + creates.length + " created", "reservations saved");
};
