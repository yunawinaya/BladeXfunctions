// LOT_V2_COMMIT - L4 FINISH: Item last_transaction_date (the ITEMS part, PREPARE's time; DIRECT / STAGE / COMPLETE) in slices,
// then the header (the HDR part: status = saveAs; a CANCEL also the "-Cancelled" number) - that write ends the Processing
// lock. Header at after -> done (nothing written again); at before (Processing) -> write; anything else -> REQUIRES_REVIEW
const commitL4Plan = function commitL4Plan(entry, hdrPartRows, itemPartRows, lotNow) {
  const base = { route: "GO", after: {}, statusRows: [], needStatus: "NO", numberRows: [], needNumber: "NO", itemSlices: [], itemCount: 0, jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_LOT" };
  const hdr = lotJoinChunks(hdrPartRows, entry.partPrefix + "HDR|");
  const items = lotJoinChunks(itemPartRows, entry.partPrefix + "ITEMS|");
  const after = hdr && typeof hdr === "object" && hdr.after && typeof hdr.after === "object" ? hdr.after : null;
  if (!after || (hdr.id !== undefined && s(hdr.id) !== entry.lotId) || !s(after.stock_movement_status) || !items || !Array.isArray(items.itemDates)) {
    return Object.assign(base, stepEnd(entry, "L4_FINISH", "the HDR / ITEMS part of the prepared payload is missing or is not this transfer's", true));
  }
  const cols = Object.keys(after).filter((k) => k === "stock_movement_status" || k === "stock_movement_no");
  const wantAfter = {};
  for (const k of cols) wantAfter[k] = s(after[k]);
  const cur = list(lotNow)[0] || {};
  const atAfter = cols.every((k) => s(cur[k]) === wantAfter[k]);
  if (atAfter) return Object.assign(base, { after: wantAfter, result_message: "the header is already " + wantAfter.stock_movement_status });
  const before = hdr.before && typeof hdr.before === "object" ? hdr.before : {};
  const atBefore = s(cur.stock_movement_status) === "Processing" && Object.keys(before).every((k) => s(cur[k]) === s(before[k]));
  if (!atBefore) return Object.assign(base, stepEnd(entry, "L4_FINISH", "the header is " + s(cur.stock_movement_status) + " / " + s(cur.stock_movement_no) + ", neither as prepared nor as planned", true));
  const now = new Date().toISOString();
  const dates = items.itemDates.map((x) => (x && typeof x === "object" ? x : { id: x })).filter((x) => digits(x.id))
    .map((x) => ({ id: s(x.id), last_transaction_date: s(x.last_transaction_date) || now }));
  const row = Object.assign({ id: entry.lotId }, wantAfter);
  const withNo = cols.indexOf("stock_movement_no") >= 0;
  return Object.assign(base, { after: wantAfter, statusRows: withNo ? [] : [row], needStatus: withNo ? "NO" : "YES", numberRows: withNo ? [row] : [], needNumber: withNo ? "YES" : "NO",
    itemSlices: slicesOf(dates, 250), itemCount: dates.length, result_message: "Location Transfer -> " + wantAfter.stock_movement_status + "; " + dates.length + " item date(s)" });
};
const commitL4Check = function commitL4Check(entry, plan, lotNow) {
  const want = plan.after || {};
  const cur = list(lotNow)[0] || {};
  const cols = Object.keys(want);
  if (!cols.length || !cols.every((k) => s(cur[k]) === s(want[k]))) return stepEnd(entry, "L4_FINISH", "the header reads back as " + s(cur.stock_movement_status) + " / " + s(cur.stock_movement_no) + ", not " + JSON.stringify(want), false);
  return stepOk(entry, "L4_FINISH", s(cur.stock_movement_status) + " / " + s(cur.stock_movement_no), "Location Transfer " + s(cur.stock_movement_status));
};
const res = __CALL__;
console.log("commit L4", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
