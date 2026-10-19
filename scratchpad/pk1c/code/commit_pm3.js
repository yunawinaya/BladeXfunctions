// PICKING_BULK_COMMIT 1c - PM3 GD ALLOCATION: each moved GD line gets the allocation classic PICKING writes (temp_qty_data,
// view_stock; prev_temp_qty_data = the new allocation, as GOODS_DELIVERY's re-save leaves it). Three-way: at the new value =
// already done; at PREPARE's before-image = write; anything else -> review (stock and reservations have moved). P3 then
// writes picking_status and prev_temp_qty_data from the line as it is now, as on every other pick.
const commitPM3Plan = function commitPM3Plan(entry, mvp, facts) {
  const base = Object.assign({}, PM_END, { route: "GO", slices: [], writeCount: 0, result_code: "", result_message: "", job_status: "COMMITTING_PICKING" });
  const m = mvp || {};
  if (pmS(m.ok) !== "YES") return Object.assign(base, pmEnd(entry, "PM3_GD_ALLOC", "the move's parts could not be read (" + pmS(m.why) + ")", true));
  const f = pmRows(facts);
  // PM2's result must still stand: a GD save in between re-aligns the reservations to the old allocation
  const resOff = pmList(m.res && m.res.updates).filter((u) => !f.U[pmS(u.id)] || !PM_RES_COLS.every((c) => pmSame(f.U[pmS(u.id)][c], (u.after || {})[c]))).map((u) => pmS(u.id))
    .concat(pmList(m.res && m.res.creates).filter((c) => f.C[pmS(c.job_line_key)] !== 1).map((c) => pmS(c.job_line_key)));
  if (resOff.length) return Object.assign(base, pmEnd(entry, "PM3_GD_ALLOC", resOff.length + " reservation(s) changed after they were written (e.g. " + resOff.slice(0, 3).join(", ") + ")", true));
  const writes = [], conflicts = [];
  for (const l of pmList(m.alc)) {
    const cur = f.L[pmS(l.id)];
    if (!cur) { conflicts.push(pmS(l.id) + " (gone)"); continue; }
    if (pmSame(cur.temp_qty_data, l.temp_qty_data)) continue;
    if (pmSame(cur.temp_qty_data, l.before_temp)) writes.push({ id: pmS(l.id), temp_qty_data: l.temp_qty_data, view_stock: l.view_stock, prev_temp_qty_data: l.temp_qty_data });
    else conflicts.push(pmS(l.id));
  }
  if (conflicts.length) return Object.assign(base, pmEnd(entry, "PM3_GD_ALLOC", conflicts.length + " delivery line(s) changed by someone else after the stock moved (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { slices: pmSlices(writes, 250), writeCount: writes.length, result_message: writes.length + " delivery line(s) to write" });
};
const commitPM3Check = function commitPM3Check(entry, mvp, facts) {
  const m = mvp || {};
  if (pmS(m.ok) !== "YES") return pmEnd(entry, "PM3_GD_ALLOC", "the move's parts could not be read (" + pmS(m.why) + ")", true);
  const f = pmRows(facts);
  const off = pmList(m.alc).filter((l) => !f.L[pmS(l.id)] || !pmSame(f.L[pmS(l.id)].temp_qty_data, l.temp_qty_data) || !pmSame(f.L[pmS(l.id)].view_stock, l.view_stock));
  if (off.length) return pmEnd(entry, "PM3_GD_ALLOC", off.length + " delivery line(s) do not read back", false);
  return pmOk(entry, "PM3_GD_ALLOC", pmList(m.alc).length + " delivery line(s) moved", "delivery lines saved");
};
