// GD_CANCEL_COMMIT - X4K PACKINGS: the PACK part (every open Packing of the GD Cancelled; a shared one only in its lines of this
// GD) on the rows read now. ids -> the fresh read; plan -> rows / headers still at before are written; check -> read back.
const PACK_LINE_COLS = ["line_status", "remaining_qty"];
const PACK_HDR_COLS = ["packing_status", "gd_status"];
const cancelX4KIds = function cancelX4KIds(entry, partRows) {
  const pack = joinChunks(partRows, entry.partPrefix + "PACK|");
  const ids = (xs) => Array.from(new Set(xs.map(s).filter(digits)));
  const lines = pack ? ids((pack.lines || []).map((r) => r.id)) : [];
  const heads = pack ? ids((pack.headers || []).map((h) => h.id)) : [];
  return { ok: pack ? "YES" : "NO", lineIdsJson: JSON.stringify(lines.length ? lines : ["0"]), packingIdsJson: JSON.stringify(heads.length ? heads : ["0"]) };
};
const cancelX4KPlan = function cancelX4KPlan(entry, partRows, nowRows) {
  const base = { route: "GO", lineSlices: [], lineCount: 0, headerRows: [], needHeaders: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const pack = joinChunks(partRows, entry.partPrefix + "PACK|");
  if (!pack) return Object.assign(base, stepEnd(entry, "X4K_PACKING", "the Packing part of the prepared payload is missing", true));
  const now = byKind(nowRows);
  const L = guardRows(pack.lines, now.L, PACK_LINE_COLS);
  const H = guardRows(pack.headers, now.H, PACK_HDR_COLS);
  const conflicts = L.conflicts.concat(H.conflicts.map((x) => "Packing " + x));
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "X4K_PACKING", conflicts.length + " Packing row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { lineSlices: slicesOf(L.writes, 250), lineCount: L.writes.length, headerRows: H.writes, needHeaders: H.writes.length ? "YES" : "NO",
    result_message: L.writes.length + " Packing line(s), " + H.writes.length + " Packing header(s) to write" });
};
const cancelX4KCheck = function cancelX4KCheck(entry, partRows, nowRows) {
  const pack = joinChunks(partRows, entry.partPrefix + "PACK|") || {};
  const now = byKind(nowRows);
  const off = offRows(pack.lines, now.L, PACK_LINE_COLS).length + offRows(pack.headers, now.H, PACK_HDR_COLS).length;
  if (off) return stepEnd(entry, "X4K_PACKING", off + " Packing row(s) do not read back", false);
  return stepOk(entry, "X4K_PACKING", (pack.lines || []).length + " line(s), " + (pack.headers || []).length + " header(s)", "Packings cancelled");
};
