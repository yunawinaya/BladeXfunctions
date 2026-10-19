// IA_REVERT_V2_PREPARE - Prep: owned + IM1 unchanged -> the lifted prep as the classic saw it (Completed) -> FAIL / go
const RV_PREP_TEXT = {
  notFound: "Item Assembly not found - it may have been deleted.",
  rowsChanged: "The Item Assembly's stock movements changed while it was waiting: nothing was reverted, please revert it again.",
  noParams: "ia_id, ia_no and organization_id are required.",
};
const iarvNotEligible = (reason) => "This Item Assembly cannot be reverted in the background (" + reason + ").";
const iarvPrepNode = function iarvPrepNode(entry, S, track) {
  const e = entry || {};
  const tr = track || {};
  const req = e.request && typeof e.request === "object" ? e.request : {};
  const base = { route: "FAIL", code: "", message: "", unlockOk: 0, details: "", iaNo: "", liveRows: 0, liveOut: 0, liveIn: 0, movesFingerprint: "", iaIdSql: "0", orgSql: "0",
    plantIdSql: "0", assembledIdsCsv: "0", itemIdsCsv: "0", batchIdsCsv: "0", binIdsCsv: "0" };
  const fail = (code, message, details) => Object.assign(base, { route: "FAIL", code: code, message: message,
    details: JSON.stringify(Object.assign({ step: "IA_REVERT_V2_PREPARE" }, details || {})) });
  if (iaS(e.route) !== "GO") return fail(iaS(e.result_code) || "IA_RV_INVALID_REQUEST", iaS(e.result_message) || "the job's request could not be read");
  if (!iaDigits(e.tenantId) || !iaDigits(e.iaId) || !iaDigits(e.organizationId) || !iaDigits(e.jobId)) return fail("IA_RV_INVALID_DATA", "the job's tenant, Item Assembly, organization or id is not an id");
  const own = iaList(S.own)[0] || {};
  const hdr = iaRows(S.hdr)[0] || null;
  if (!hdr || !iaS(hdr.id) || !iaS(own.ia_id)) return fail("IA_RV_NOT_FOUND", RV_PREP_TEXT.notFound);
  const mine = iaS(own.item_assembly_status) === "Processing" && iaS(own.ia_v2_job_id) === iaS(e.jobId) && iaS(own.lock_ref) !== "" && iaS(own.lock_ref) === iaS(e.idempotencyKey);
  if (!mine) {
    return fail("IA_RV_NOT_LOCKED", IA_TEXT.rvNotLocked, { why: "the Item Assembly is " + (iaS(own.item_assembly_status) || "blank") + " under job " + (iaS(own.ia_v2_job_id) || "none")
      + (iaS(own.lock_ref) === iaS(e.idempotencyKey) ? "" : ", its lock is not this job's") });
  }
  // from here a failure puts the Item Assembly back to Completed (this job holds its lock; nothing was written)
  base.unlockOk = 1;
  tr.locked = 1;
  const moves = iarvSqlRows(S.moves);
  const fp = iaMovesFingerprint(moves);
  base.movesFingerprint = fp;
  if (fp !== iaS(req.movesFingerprint)) return fail("IA_RV_ROWS_CHANGED", RV_PREP_TEXT.rowsChanged, { want: iaS(req.movesFingerprint), got: fp });
  const iaNo = iaS(hdr.stock_movement_no);
  base.iaNo = iaNo;
  const run = iarvRunPrep(iarvHeaderSeen(hdr, e.organizationId, e.prevStatus), moves, iarvJRows(S.batch), { iaId: e.iaId, iaNo: iaNo, organizationId: e.organizationId });
  const p = run.prep;
  if (Number(run.params.hasParams) !== 1) return fail("IA_RV_REFUSED", RV_PREP_TEXT.noParams);
  if (Number(p.refuse) === 1) return fail("IA_RV_REFUSED", iaS(p.refuseMessage));
  const L = iarvLive(p);
  Object.assign(base, { liveRows: L.liveRows, liveOut: L.liveOut, liveIn: L.liveIn });
  if (L.hu > 0) return fail("IA_RV_NOT_ELIGIBLE", iarvNotEligible("handling units"), { reason: "handling units", rows: L.hu });
  if (L.liveRows > IA_MAX_PICKS) return fail("IA_RV_SPLIT_REQUIRED", IA_TEXT.rvSplitRequired(L.liveRows));
  const bins = {};
  for (const r of iaList(p.liveOut).concat(iaList(p.liveIn))) if (iaS(r.bin_location_id)) bins[iaS(r.bin_location_id)] = 1;
  const sql = { iaIdSql: iaDigits(p.iaIdSql) && iaS(p.iaIdSql) === iaS(e.iaId) ? iaS(p.iaIdSql) : null, orgSql: iaDigits(p.orgSql) ? iaS(p.orgSql) : null,
    plantIdSql: iaDigits(p.plantIdSql) && iaS(p.plantIdSql) !== "0" ? iaS(p.plantIdSql) : null, assembledIdsCsv: iarvIdsSql(p.assembledIds), itemIdsCsv: iarvIdsSql(p.itemIds),
    batchIdsCsv: iarvIdsSql(p.batchIds), binIdsCsv: iarvIdsSql(Object.keys(bins)) };
  const badIds = Object.keys(sql).filter((k) => sql[k] === null);
  if (badIds.length) return fail("IA_RV_INVALID_DATA", "the Item Assembly's " + badIds.join(", ") + " are not all ids");
  return Object.assign(base, sql, { route: "GO", code: "200", message: "prepared " + L.liveRows + " live movement row(s)" });
};
