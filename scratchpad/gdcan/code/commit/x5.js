// GD_CANCEL_COMMIT - X5 NUMBERS: the cancelled number wherever the old one is copied (user, 10-20), whatever the Picking /
// Packing status: the Picking header's GD numbers (a whole token), its rows' gd_no, the Packing header's and both its line
// tables' gd_no (the NUM part, rows still at before are written), and every stock movement still carrying the old number in
// the GD's organization (the GD list's bulk Cancel's rename, read fresh by id: inventory_movement has no index but its key)
const NUM_TABLES = { H: ["picking_headers", "delivery_no"], L: ["picking_rows", "gd_no"], P: ["packing_headers", "gd_no"], I: ["packing_items", "gd_no"], S: ["packing_sources", "gd_no"] };
// the part's { id, before, after } text values as guardRows rows of one column
const numRows = (list_, col) => (list_ || []).map((r) => ({ id: r.id, before: { [col]: r.before }, after: { [col]: r.after } }));
const cancelX5Ids = function cancelX5Ids(entry, partRows) {
  const n = joinChunks(partRows, entry.partPrefix + "NUM|");
  const ids = (xs) => Array.from(new Set(xs.map(s).filter(digits)));
  const j = (xs) => JSON.stringify(xs.length ? xs : ["0"]);
  const out = { ok: n && s(n.old_no) && s(n.new_no) ? "YES" : "NO" };
  for (const [k, [field]] of Object.entries(NUM_TABLES)) out[k + "IdsJson"] = j(n ? ids((n[field] || []).map((r) => r.id)) : []);
  // SQL text: the old number quoted for the movement read (a quote or backslash in a number is escaped), the id floor an hour
  // before the GD was made (ids are time-ordered: a movement of the GD is never older)
  out.oldNoSql = n ? s(n.old_no).replace(/\\/g, "\\\\").replace(/'/g, "''") : "";
  out.orgSql = digits(entry.organizationId) ? entry.organizationId : "0";
  out.idFloor = digits(entry.gdId) ? String(BigInt(entry.gdId) - (3600000n << 22n)) : "0";
  return out;
};
const cancelX5Plan = function cancelX5Plan(entry, partRows, nowRows, moveRows) {
  const base = { route: "GO", headerRows: [], needHeaders: "NO", rowSlices: [], rowCount: 0, packHeaderRows: [], needPackHeaders: "NO", itemSlices: [], itemCount: 0,
    sourceSlices: [], sourceCount: 0, moveSlices: [], moveCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const n = joinChunks(partRows, entry.partPrefix + "NUM|");
  if (!n) return Object.assign(base, stepEnd(entry, "X5_NUMBERS", "the number part of the prepared payload is missing", true));
  const now = byKind(nowRows);
  const g = {};
  const conflicts = [];
  for (const [k, [field, col]] of Object.entries(NUM_TABLES)) {
    g[k] = guardRows(numRows(n[field], col), now[k], [col]);
    conflicts.push(...g[k].conflicts.map((x) => field + " " + x));
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "X5_NUMBERS", conflicts.length + " row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const moves = list(moveRows).map((r) => ({ id: s(r.id), trx_no: s(n.new_no) })).filter((r) => digits(r.id));
  return Object.assign(base, {
    headerRows: g.H.writes, needHeaders: g.H.writes.length ? "YES" : "NO", rowSlices: slicesOf(g.L.writes, 250), rowCount: g.L.writes.length,
    packHeaderRows: g.P.writes, needPackHeaders: g.P.writes.length ? "YES" : "NO", itemSlices: slicesOf(g.I.writes, 250), itemCount: g.I.writes.length,
    sourceSlices: slicesOf(g.S.writes, 250), sourceCount: g.S.writes.length, moveSlices: slicesOf(moves, 250), moveCount: moves.length,
    result_message: g.H.writes.length + g.L.writes.length + g.P.writes.length + g.I.writes.length + g.S.writes.length + " number(s), " + moves.length + " movement(s) to rename",
  });
};
const cancelX5Check = function cancelX5Check(entry, partRows, nowRows, moveRows) {
  const n = joinChunks(partRows, entry.partPrefix + "NUM|") || {};
  const now = byKind(nowRows);
  let off = 0;
  for (const [k, [field, col]] of Object.entries(NUM_TABLES)) off += offRows(numRows(n[field], col), now[k], [col]).length;
  const left = list(moveRows).filter((r) => digits(r.id)).length;
  if (off || left) return stepEnd(entry, "X5_NUMBERS", off + " number(s) and " + left + " movement(s) do not read back", false);
  return stepOk(entry, "X5_NUMBERS", s(n.old_no) + " -> " + s(n.new_no), "numbers updated");
};
