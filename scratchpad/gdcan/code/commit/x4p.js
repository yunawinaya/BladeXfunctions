// GD_CANCEL_COMMIT - X4P PICKINGS: the PICK part (the GD list's bulk Cancel's Picking writes, server-side) on the rows read now.
// ids -> the fresh read; plan -> rows / headers still at before are written; check -> everything reads back at after.
const PICK_ROW_COLS = ["line_status", "pending_process_qty"];
const cancelX4PIds = function cancelX4PIds(entry, partRows) {
  const pick = joinChunks(partRows, entry.partPrefix + "PICK|");
  const ids = (xs) => Array.from(new Set(xs.map(s).filter(digits)));
  const rows = pick ? ids((pick.rows || []).map((r) => r.id)) : [];
  // every Picking this GD has rows on, not only the headers PREPARE meant to close: a sibling cancel may close them meanwhile
  const heads = pick ? ids((pick.headers || []).map((h) => h.id).concat((pick.rows || []).map((r) => r.picking_id))) : [];
  return { ok: pick ? "YES" : "NO", lineIdsJson: JSON.stringify(rows.length ? rows : ["0"]), pickingIdsJson: JSON.stringify(heads.length ? heads : ["0"]) };
};
// a Picking header shared with other deliveries is decided on its rows as they are NOW (A rows), this GD's own counted Cancelled -
// PREPARE's rule: Cancelled + "-Cancelled" once every row is Cancelled, Completed once nothing is left to pick, else unchanged.
// Concurrent cancels on one Picking each write their own rows first, so the last one to check sees them all and closes it
// (LSH 2026-10-25: a whole-row before / after from PREPARE sent sibling cancels to review)
// A header already Cancelled stays. One already Completed stays too, unless this GD has rows on it: PREPARE saw it open, so a
// sibling cancel closed it Completed meanwhile (this GD's rows were still picked then) - once every row is Cancelled it is
// Cancelled (dev live test 10-25: two cancels on PI-20261019-0361 left Completed over all-Cancelled rows)
const x4pHeaderTargets = function x4pHeaderTargets(entry, now, pick) {
  const terminal = (st) => st === "Completed" || st === "Cancelled";
  const mine = {};
  for (const r of (pick && pick.rows) || []) mine[s(r.picking_id)] = true;
  const byPick = {};
  for (const r of Object.values(now.A || {})) if (String(r.is_deleted) === "0") (byPick[s(r.picking_id)] = byPick[s(r.picking_id)] || []).push(r);
  const out = [];
  for (const h of Object.values(now.P || {})) {
    if (String(h.is_deleted) !== "0" || s(h.to_status) === "Cancelled" || (s(h.to_status) === "Completed" && !mine[s(h.id)])) continue;
    const statuses = (byPick[s(h.id)] || []).map((r) => (s(r.gd_id) === s(entry.gdId) ? "Cancelled" : s(r.line_status)));
    if (!statuses.length) continue;
    const toId = s(h.to_id);
    let target = null;
    if (statuses.every((st) => st === "Cancelled")) target = { to_status: "Cancelled", to_id: /-Cancelled$/.test(toId) ? toId : toId + "-Cancelled" };
    else if (statuses.every((st) => terminal(st))) target = { to_status: "Completed", to_id: toId || null };
    if (target && (s(h.to_status) !== target.to_status || toId !== s(target.to_id))) out.push(Object.assign({ id: s(h.id) }, target));
  }
  return out;
};
const cancelX4PPlan = function cancelX4PPlan(entry, partRows, nowRows) {
  const base = { route: "GO", lineSlices: [], lineCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const pick = joinChunks(partRows, entry.partPrefix + "PICK|");
  if (!pick) return Object.assign(base, stepEnd(entry, "X4P_PICKING", "the Picking part of the prepared payload is missing", true));
  const now = byKind(nowRows);
  const L = guardRows(pick.rows, now.L, PICK_ROW_COLS);
  const conflicts = L.conflicts;
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "X4P_PICKING", conflicts.length + " Picking row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const H = x4pHeaderTargets(entry, now, pick);
  // a header to change on a Picking another job holds (the _fc.js rule): nothing is written yet, the step waits (counted retry)
  const held = H.filter((h) => Number(now.P[h.id].is_processing) === 1 && !(Number(now.P[h.id].lock_age_sec) > 900)).map((h) => h.id);
  if (held.length) return Object.assign(base, stepEnd(entry, "X4P_PICKING", "Picking " + held.slice(0, 3).join(", ") + " is held by another job (an edit or a confirm): waiting for it", false));
  return Object.assign(base, { lineSlices: slicesOf(L.writes, 250), lineCount: L.writes.length, headerRows: H, needHeaders: H.length ? "YES" : "NO",
    result_message: L.writes.length + " Picking row(s), " + H.length + " Picking header(s) to write" });
};
const cancelX4PCheck = function cancelX4PCheck(entry, partRows, nowRows) {
  const pick = joinChunks(partRows, entry.partPrefix + "PICK|") || {};
  const now = byKind(nowRows);
  const off = offRows(pick.rows, now.L, PICK_ROW_COLS).length + x4pHeaderTargets(entry, now, pick).length;
  if (off) return stepEnd(entry, "X4P_PICKING", off + " Picking row(s) do not read back", false);
  return stepOk(entry, "X4P_PICKING", (pick.rows || []).length + " row(s), " + (pick.headers || []).length + " header(s)", "Pickings updated");
};
