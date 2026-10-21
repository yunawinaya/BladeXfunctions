// IA_REVERT_V2_SUBMIT - Gate: the lifted prep on the stored IA -> the classic's refusals, NOT_ELIGIBLE, the caps (RV4)
const iarvGate = function iarvGate(guard, entry, S) {
  const e = entry || {};
  const out = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "", reason: "", errorCode: "", liveRows: 0, liveOut: 0, liveIn: 0,
    movesFingerprint: "", prevStatus: "" }, extra || {});
  if (s(e.route) !== "GO") return out("STOP", "400", "the Item Assembly cannot be reverted", { errorCode: "IA_RV_INVALID_DATA" });
  if (!digits(e.organizationId) || !digits(e.plantId) || s(e.plantId) === "0") return out("STOP", "400", "The Item Assembly has no valid organization or plant.", { errorCode: "IA_RV_INVALID_DATA" });
  const hdr = iaRows(S.hdr)[0] || null;
  const moves = iarvSqlRows(S.moves);
  const run = iarvRunPrep(iarvHeaderSeen(hdr, guard.formOrg, hdr ? s(hdr.item_assembly_status) : ""), moves, iarvJRows(S.batch),
    { iaId: guard.iaId, iaNo: s(e.iaNo), organizationId: guard.formOrg });
  const p = run.prep;
  if (Number(run.params.hasParams) !== 1) return out("STOP", "400", "ia_id, ia_no and organization_id are required.", { errorCode: "IA_RV_REFUSED" });
  if (Number(p.refuse) === 1) return out("STOP", "400", s(p.refuseMessage), { errorCode: "IA_RV_REFUSED" });
  const L = iarvLive(p);
  const extra = { liveRows: L.liveRows, liveOut: L.liveOut, liveIn: L.liveIn, movesFingerprint: iaMovesFingerprint(moves), prevStatus: s(e.storedStatus) };
  if (guard.minPicks > 0 && L.liveRows <= guard.minPicks) return out("NOT_ELIGIBLE", "300", "classic", Object.assign({ reason: "classic", errorCode: "IA_RV_NOT_ELIGIBLE" }, extra));
  const serial = {};
  for (const r of list(S.serial)) serial[s(r.id)] = 1;
  const why = L.hu > 0 ? "handling units" : L.items.some((id) => serial[id]) ? "serial numbers" : "";
  // the classic's cap counts component rows (= the completion's picks), not the receipt row
  if (why && L.liveOut > IA_CLASSIC_MAX_PICKS) return out("STOP", "400", IA_TEXT.rvTooBig(L.liveRows, why, IA_CLASSIC_MAX_PICKS), Object.assign({ reason: why, errorCode: "IA_RV_TOO_BIG" }, extra));
  if (why) return out("NOT_ELIGIBLE", "300", why, Object.assign({ reason: why, errorCode: "IA_RV_NOT_ELIGIBLE" }, extra));
  if (L.liveRows > IA_MAX_PICKS) return out("STOP", "400", IA_TEXT.rvSplitRequired(L.liveRows), Object.assign({ reason: "split", errorCode: "IA_RV_SPLIT_REQUIRED" }, extra));
  if (!iaRvPrevStatusOk(e.storedStatus)) return out("STOP", "400", "The status to restore (" + (s(e.storedStatus) || "blank") + ") is not one a revert takes.", { errorCode: "IA_RV_INVALID_DATA" });
  return out("GO", "", "", extra);
};
