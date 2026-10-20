// GD_CANCEL_COMMIT - X4P PICKINGS: the PICK part (the GD list's bulk Cancel's Picking writes, server-side) on the rows read now.
// ids -> the fresh read; plan -> rows / headers still at before are written; check -> everything reads back at after.
const PICK_ROW_COLS = ["line_status", "pending_process_qty"];
const PICK_HDR_COLS = ["to_status", "to_id"];
const cancelX4PIds = function cancelX4PIds(entry, partRows) {
  const pick = joinChunks(partRows, entry.partPrefix + "PICK|");
  const ids = (xs) => Array.from(new Set(xs.map(s).filter(digits)));
  const rows = pick ? ids((pick.rows || []).map((r) => r.id)) : [];
  const heads = pick ? ids((pick.headers || []).map((h) => h.id)) : [];
  return { ok: pick ? "YES" : "NO", lineIdsJson: JSON.stringify(rows.length ? rows : ["0"]), pickingIdsJson: JSON.stringify(heads.length ? heads : ["0"]) };
};
const cancelX4PPlan = function cancelX4PPlan(entry, partRows, nowRows) {
  const base = { route: "GO", lineSlices: [], lineCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const pick = joinChunks(partRows, entry.partPrefix + "PICK|");
  if (!pick) return Object.assign(base, stepEnd(entry, "X4P_PICKING", "the Picking part of the prepared payload is missing", true));
  const now = byKind(nowRows);
  const L = guardRows(pick.rows, now.L, PICK_ROW_COLS);
  const H = guardRows(pick.headers, now.P, PICK_HDR_COLS);
  const conflicts = L.conflicts.concat(H.conflicts.map((x) => "Picking " + x));
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "X4P_PICKING", conflicts.length + " Picking row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { lineSlices: slicesOf(L.writes, 250), lineCount: L.writes.length, headerRows: H.writes, needHeaders: H.writes.length ? "YES" : "NO",
    result_message: L.writes.length + " Picking row(s), " + H.writes.length + " Picking header(s) to write" });
};
const cancelX4PCheck = function cancelX4PCheck(entry, partRows, nowRows) {
  const pick = joinChunks(partRows, entry.partPrefix + "PICK|") || {};
  const now = byKind(nowRows);
  const off = offRows(pick.rows, now.L, PICK_ROW_COLS).length + offRows(pick.headers, now.P, PICK_HDR_COLS).length;
  if (off) return stepEnd(entry, "X4P_PICKING", off + " Picking row(s) do not read back", false);
  return stepOk(entry, "X4P_PICKING", (pick.rows || []).length + " row(s), " + (pick.headers || []).length + " header(s)", "Pickings updated");
};
