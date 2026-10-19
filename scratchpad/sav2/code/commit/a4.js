// SA_V2_COMMIT - A4 FINISH (phase B): Item last_transaction_date (the ITEMS part: code_node_WFXy3gHI's value, taken at PREPARE
// time) in slices of 250; the A4_REORDER marker row, then REORDER_SET_REDIS SA_COMPLETED with the REORDER part (at most once:
// the marker is written BEFORE the call; a marker already there = called before -> skipped); then the header's
// stock_adjustment_status Completed (the HDR part) - that write ends the Processing lock. Header at after -> done (nothing
// written again); at before (Processing) -> write; anything else -> REQUIRES_REVIEW
const commitA4Plan = function commitA4Plan(entry, hdrPartRows, itemPartRows, reorderPartRows, saNow) {
  const base = { route: "GO", after: {}, statusRows: [], needStatus: "NO", itemSlices: [], itemCount: 0, reorderRows: [], needReorder: "NO", reorderLatest: [], jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_SA" };
  const review = (why) => Object.assign(base, stepEnd(entry, "A4_FINISH", why, true));
  const hdr = saJoinChunks(hdrPartRows, entry.partPrefix + "HDR|");
  const items = saJoinChunks(itemPartRows, entry.partPrefix + "ITEMS|");
  const reorder = saJoinChunks(reorderPartRows, entry.partPrefix + "REORDER|");
  const after = hdr && typeof hdr === "object" && hdr.after && typeof hdr.after === "object" ? hdr.after : null;
  const want = after ? s(after.stock_adjustment_status) : "";
  const partsOk = !!after && want === "Completed" && (hdr.id === undefined || s(hdr.id) === entry.saId) && !!items && typeof items === "object" && Array.isArray(items.itemDates)
    && !!reorder && typeof reorder === "object" && Array.isArray(reorder.latest_data) && (reorder.document_type === undefined || s(reorder.document_type) === "SA_COMPLETED")
    && (reorder.organization_id === undefined || s(reorder.organization_id) === entry.organizationId);
  if (!partsOk) return review("the HDR / ITEMS / REORDER part of the prepared payload is missing or is not this Stock Adjustment's");
  const cur = saRows(saNow)[0] || {};
  if (s(cur.stock_adjustment_status) === want) return Object.assign(base, { after: { stock_adjustment_status: want }, result_message: "the Stock Adjustment is already " + want });
  const before = hdr.before && typeof hdr.before === "object" ? hdr.before : {};
  const atBefore = s(cur.stock_adjustment_status) === "Processing" && Object.keys(before).every((k) => s(cur[k]) === s(before[k]));
  if (!atBefore) return review("the Stock Adjustment is " + (s(cur.stock_adjustment_status) || "missing") + ", neither Processing (as prepared) nor " + want);
  const now = new Date().toISOString();
  const dates = items.itemDates.map((x) => (x && typeof x === "object" ? x : { id: x })).filter((x) => digits(x.id))
    .map((x) => ({ id: s(x.id), last_transaction_date: s(x.last_transaction_date) || now }));
  const needReorder = entry.doneReorder !== "YES";
  // the marker is written after the Item dates: a marker already there means an earlier pass wrote them
  const todo = needReorder ? dates : [];
  return Object.assign(base, { after: { stock_adjustment_status: want }, statusRows: [{ id: entry.saId, stock_adjustment_status: want }], needStatus: "YES", itemSlices: slicesOf(todo, 250),
    itemCount: todo.length, reorderRows: needReorder ? [doneRow(entry, "A4_REORDER", "pre-call")] : [], needReorder: needReorder ? "YES" : "NO",
    reorderLatest: needReorder ? reorder.latest_data : [],
    result_message: "Stock Adjustment -> " + want + "; " + todo.length + " item date(s); reorder " + (needReorder ? "now" : "already called, item dates already written") });
};
const commitA4Check = function commitA4Check(entry, plan, saNow) {
  const want = s(((plan || {}).after || {}).stock_adjustment_status) || "Completed";
  const cur = saRows(saNow)[0] || {};
  if (s(cur.stock_adjustment_status) !== want) return stepEnd(entry, "A4_FINISH", "the Stock Adjustment reads back as " + (s(cur.stock_adjustment_status) || "missing") + ", not " + want, false);
  return stepOk(entry, "A4_FINISH", s(cur.stock_adjustment_status) + " / " + s(cur.adjustment_no), "Stock Adjustment " + want);
};
const res = __CALL__;
console.log("commit A4", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
