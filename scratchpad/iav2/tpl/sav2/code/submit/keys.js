// SA_V2_SUBMIT - Keys: the request's record (INVALID when it is not one); FORM: what the form alone shows the background save does
// not take (serial lines, handling units, entry categories other than Unrestricted / Blocked / Quality Inspection, nothing to
// move, a stored status it does not take), the size limit, and the digit-only ids the reads take; REVIEW: a stored line Adjusted
// that the payload shows Approved (STALE), whether the review would create a Stock Adjustment at all (the lifted
// code_review_prep: hasApprovedVariance), serial lines, the size limit, and the review reads' ids (saReviewIds: prep's
// materialIds / locationIds / baseUomIds / batchIds, 0 = none; the gate's chain re-runs prep and must find the same lists)
const saFormReasons = function saFormReasons(lines) {
  for (const l of lines) {
    if (!l || typeof l !== "object") continue;
    if (num(l.is_serialized_item) === 1) return "it has serial-numbered items";
    for (const e of saMoving(l)) {
      if (s(e.handling_unit_id)) return "it has handling units";
      if (SA_OK_CATEGORIES.indexOf(s(e.category)) < 0) return "it moves " + s(e.category) + " stock";
    }
  }
  return "";
};
const submitKeys = function submitKeys(guard, entry, form, scLineRows) {
  const review = entry.action === "REVIEW";
  const base = { ok: "NO", why: "", reason: "", errorCode: "", itemIdsSql: "0", batchIdsSql: "0", storedSaId: "0", needStored: "NO", needReview: "NO", rvMatSql: "0",
    rvLocSql: "0", rvUomSql: "0", rvBatchSql: "0", organizationId: "0", lineCount: 0, entryCount: 0 };
  const out = (a) => Object.assign(base, a);
  if (!form || typeof form !== "object" || Array.isArray(form)) {
    return out(answer("INVALID", "400", review ? "form: the Stock Count's record" : "form: the Stock Adjustment's record", { errorCode: "SA_INVALID_REQUEST" }));
  }
  if (review) {
    if (saIdOf(form.id) && saIdOf(form.id) !== guard.scId) return out(answer("INVALID", "400", "form: not the record of Stock Count " + guard.scId, { errorCode: "SA_INVALID_REQUEST" }));
    const lines = (Array.isArray(form.table_stock_count) ? form.table_stock_count : []).filter((l) => l && typeof l === "object");
    const adjusted = {};
    for (const r of saRows(scLineRows)) if (s(r.line_status) === "Adjusted") adjusted[saIdStr(r.id)] = true;
    const stale = lines.find((l) => s(l.line_status) === "Approved" && saIdOf(l.id) && adjusted[saIdOf(l.id)]);
    if (stale) {
      return out(answer("STALE", "409", "This Stock Count was changed by someone else (line " + (s(stale.line_index) || "?") + " is already Adjusted). Please close it and open it again.",
        { errorCode: "SA_SC_STALE" }));
    }
    // the lifted code_review_prep (code/shared/review_chain.js saReviewPrep) over the REQUEST's record: no SA -> NOT_ELIGIBLE (the
    // classic Review handles it); the review reads' ids are its own lists (saReviewIds)
    let p = null;
    try {
      p = saReviewPrep({ scRecord: JSON.parse(JSON.stringify(form)), createAdjustment: guard.createAdjustment, organizationId: guard.organizationId });
    } catch (e) {
      return out(answer("STOP", "400", "The review could not be checked: " + s(e && e.message), { errorCode: "SA_INVALID_DATA" }));
    }
    const prep = p.prep || {};
    const variance = list(prep.itemsWithVariance).filter((l) => l && typeof l === "object");
    const count = variance.length;
    base.lineCount = count;
    if (num(prep.hasApprovedVariance) !== 1) {
      return out(answer("NOT_ELIGIBLE", "300", "the review creates no Stock Adjustment", { reason: "no adjustment", errorCode: "SA_NOT_ELIGIBLE" }));
    }
    if (variance.some((l) => num(l.is_serialized) === 1)) return out(notEligible("it has serial-numbered items", count, true));
    if (count > SA_MAX_ENTRIES) return out(splitRequired(count, true));
    const ids = p.ids || {};
    if (!digits(ids.ORG) || s(ids.ORG) === "0") return out(answer("STOP", "400", "The review has no organization.", { errorCode: "SA_INVALID_DATA" }));
    return out(answer("GO", "", "", { ok: "YES", itemIdsSql: s(ids.MID) || "0", batchIdsSql: "0," + (s(ids.BID) || "0"), needReview: "YES", rvMatSql: s(ids.MID) || "0",
      rvLocSql: s(ids.LID) || "0", rvUomSql: s(ids.UID) || "0", rvBatchSql: s(ids.BID) || "0", organizationId: s(ids.ORG) }));
  }
  if (guard.pageStatus === "Edit" && saIdOf(form.id) && saIdOf(form.id) !== guard.saId) {
    return out(answer("INVALID", "400", "form: not the record of Stock Adjustment " + guard.saId, { errorCode: "SA_INVALID_REQUEST" }));
  }
  const lines = (Array.isArray(form.stock_adjustment) ? form.stock_adjustment : []).filter((l) => l && typeof l === "object");
  const entries = saEntryCount(lines);
  base.lineCount = lines.length;
  base.entryCount = entries;
  if (entry.action === "OTHER") return out(notEligible(entry.reason, entries, false));
  const why = saFormReasons(lines);
  if (why) return out(Object.assign(notEligible(why, entries, false), { why: why }));
  // nothing moves: the classic completes it without a movement (V2 never runs an empty engine call)
  if (entries === 0) return out(notEligible("it has no stock to adjust", entries, false));
  if (entries > SA_MAX_ENTRIES) return out(splitRequired(entries, false));
  const org = entry.action === "COMPLETE" ? s(entry.organizationId) : saIdOf(form.organization_id);
  if (!digits(org)) return out(answer("STOP", "400", "The Stock Adjustment has no organization.", { errorCode: "SA_INVALID_DATA" }));
  const items = {};
  const batches = {};
  for (const l of lines) {
    if (saIdOf(l.material_id)) items[saIdOf(l.material_id)] = true;
    for (const e of saMoving(l)) if (saIdOf(e.batch_id)) batches[saIdOf(e.batch_id)] = true;
  }
  const complete = entry.action === "COMPLETE";
  return out(answer("GO", "", "", { ok: "YES", itemIdsSql: saIdsSql(items), batchIdsSql: saIdsSql(batches), storedSaId: complete ? guard.saId : "0",
    needStored: complete ? "YES" : "NO", organizationId: org }));
};
const res = submitKeys([{{node:code_node_SSguard.data}}][0], [{{node:code_node_SSentry.data}}][0], [{{workflowparams:form}}][0], [{{node:sql_node_SSscLines.data}}][0]);
console.log("submit keys", JSON.stringify({ route: res.route, why: res.why || res.reason, lines: res.lineCount, entries: res.entryCount, items: res.itemIdsSql.split(",").length - 1,
  review: res.needReview, stored: res.needStored }));
// the declared keys, spelled out (the platform keeps only these)
return {
  route: res.route, code: res.code, message: res.message, reason: res.reason, errorCode: res.errorCode, ok: res.ok, why: res.why,
  itemIdsSql: res.itemIdsSql, batchIdsSql: res.batchIdsSql, storedSaId: res.storedSaId, needStored: res.needStored, needReview: res.needReview,
  rvMatSql: res.rvMatSql, rvLocSql: res.rvLocSql, rvUomSql: res.rvUomSql, rvBatchSql: res.rvBatchSql, organizationId: res.organizationId,
  lineCount: res.lineCount, entryCount: res.entryCount
};
