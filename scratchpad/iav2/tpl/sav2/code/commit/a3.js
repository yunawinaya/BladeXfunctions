// SA_V2_COMMIT - A3 STOCK COUNT (phase B: the stock moved - never unlocks, never fails: retry -> REQUIRES_REVIEW).
// REVIEW: ONE update of the Stock Count by id with the SC part = update_node_sc's props minus stock_count_no /
// stock_count_no_type (the review's fill-back: the header props + the whole table_stock_count). Stored lines at the part's
// afterFingerprint (+ the three statuses) -> done; at its beforeFingerprint -> write; else REQUIRES_REVIEW.
// PARITY (a FORM Stock Adjustment with stock_count_id: update_node_ArYV2yrs + code_node_SZmrixfL + update_node_OoK68qFj):
// every Approved line of the Stock Count -> Adjusted (the ids computed here: an update's WHERE is not enforced), then
// adjustment_status Fully Adjusted when every line is Adjusted, else Partially Adjusted. No Approved left + the status at the
// computed value -> done.
const SC_PROPS = __SCPROPS__;
const SC_STATUS = ["stock_count_status", "review_status", "adjustment_status"];
// the Stock Count lines as stored against the lines written, by id: statuses and flags exactly (a switch may arrive as
// true / false), the decimals (count_qty, adjusted_qty, variance_qty: decimal(65,8), rounded by the tenant's rule) with sameStored
const scB01 = (t) => (t === "true" ? "1" : t === "false" ? "0" : t);
const scLineExpect = (rows) => scLineFpCanonRows(rows).map((r) => [r[0], r[1], r[2], r[3], scB01(r[4]), r[5], r[6], r[7]]);
const scLinesAt = function scLinesAt(lineRows, expect) {
  const got = scLineExpect(saRows(lineRows));
  if (!Array.isArray(expect) || got.length !== expect.length) return false;
  return got.every((g, i) => {
    const w = expect[i] || [];
    return g[0] === w[0] && g[1] === w[1] && g[2] === w[2] && g[3] === w[3] && g[4] === w[4] && [5, 6, 7].every((k) => g[k] === w[k] || sameStored(w[k], g[k]));
  });
};
const commitA3ReviewPlan = function commitA3ReviewPlan(entry, partRows, lineRows, hdrRows) {
  const base = { route: "GO", row: {}, status: {}, expect: [], needWrite: "NO", lineCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_SA" };
  const review = (why) => Object.assign(base, stepEnd(entry, "A3_STOCK_COUNT", why, true));
  const p = saJoinChunks(partRows, entry.partPrefix + "SC|");
  if (!p || typeof p !== "object" || s(p.id) !== entry.scId || !Array.isArray(p.table_stock_count)) return review("the SC part of the prepared payload is missing or is not Stock Count " + entry.scId + "'s");
  const gone = SC_PROPS.filter((k) => !(k in p));
  if (gone.length) return review("the SC part lacks " + gone.join(", ") + " (a prop left out would be stored NULL)");
  const noId = p.table_stock_count.filter((r) => !r || typeof r !== "object" || !digits(r.id)).length;
  if (noId) return review(noId + " line(s) of the SC part carry no id (each retry would insert them again)");
  const before = s(p.beforeFingerprint);
  const after = s(p.afterFingerprint);
  if (before !== entry.scFingerprint || (entry.scAfterFingerprint && after !== entry.scAfterFingerprint) || scLineFingerprint(p.table_stock_count) !== after) {
    return review("the SC part's fingerprints (before " + before + ", after " + after + ") are not the plan's (" + entry.scFingerprint + " / " + (entry.scAfterFingerprint || "-") + ")");
  }
  const cur = saRows(hdrRows)[0];
  if (!cur) return review("Stock Count " + entry.scId + " is gone");
  const expect = scLineExpect(p.table_stock_count);
  const status = {};
  for (const k of SC_STATUS) status[k] = p[k] === undefined ? null : p[k];
  const fp = scLineFingerprint(saRows(lineRows));
  const linesAt = fp === after || scLinesAt(lineRows, expect);
  const statusAt = SC_STATUS.every((k) => sameStored(status[k], cur[k]));
  if (linesAt && statusAt) return Object.assign(base, { status: status, expect: expect, result_message: "the Stock Count is already at " + after });
  if (fp !== before && !linesAt) return review("the Stock Count's lines are " + fp + ", neither " + before + " (before) nor " + after + " (after)");
  const row = {};
  for (const k of SC_PROPS) row[k] = p[k] === undefined ? null : p[k];
  return Object.assign(base, { row: row, status: status, expect: expect, needWrite: "YES", lineCount: p.table_stock_count.length,
    result_message: (linesAt ? "the Stock Count statuses -> " : "the Stock Count lines " + fp + " -> ") + after });
};
const commitA3ReviewCheck = function commitA3ReviewCheck(entry, plan, lineRows, hdrRows) {
  const pl = plan || {};
  const fp = scLineFingerprint(saRows(lineRows));
  const cur = saRows(hdrRows)[0] || {};
  const status = pl.status && typeof pl.status === "object" ? pl.status : {};
  const off = Object.keys(status).filter((k) => !sameStored(status[k], cur[k]));
  if (!scLinesAt(lineRows, pl.expect) || off.length) return stepEnd(entry, "A3_STOCK_COUNT", "the Stock Count reads back as " + fp + (off.length ? " with " + off.join(", ") + " off" : ""), false);
  return stepOk(entry, "A3_STOCK_COUNT", fp, "Stock Count updated");
};
const scParityStatus = function scParityStatus(lines, approved) {
  const adjusted = lines.filter((l) => s(l.line_status) === "Adjusted" || approved[s(l.id)]).length;
  return lines.length === adjusted ? "Fully Adjusted" : "Partially Adjusted";
};
const commitA3ParityPlan = function commitA3ParityPlan(entry, partRows, lineRows, hdrRows) {
  const base = { route: "GO", lineSlices: [], lineCount: 0, needLines: "NO", headerRows: [], needHeader: "NO", status: "", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "",
    job_status: "COMMITTING_SA" };
  const p = saJoinChunks(partRows, entry.partPrefix + "SC|");
  if (!p || typeof p !== "object" || s(p.mode) !== "PARITY" || s(p.scId) !== entry.scId) return Object.assign(base, stepEnd(entry, "A3_STOCK_COUNT", "the SC part of the prepared payload is missing or is not PARITY of Stock Count " + entry.scId, true));
  const cur = saRows(hdrRows)[0];
  if (!cur) return Object.assign(base, { result_message: "Stock Count " + entry.scId + " not found: no line to mark Adjusted" });
  const lines = saRows(lineRows);
  const approved = {};
  for (const l of lines) if (s(l.line_status) === "Approved" && digits(l.id)) approved[s(l.id)] = true;
  const ids = Object.keys(approved);
  const status = scParityStatus(lines, approved);
  const needHeader = s(cur.adjustment_status) !== status;
  if (!ids.length && !needHeader) return Object.assign(base, { status: status, result_message: "no Approved line left; the Stock Count is already " + status });
  return Object.assign(base, { lineSlices: slicesOf(ids.map((id) => ({ id: id, line_status: "Adjusted" })), 250), lineCount: ids.length, needLines: ids.length ? "YES" : "NO",
    headerRows: [{ id: entry.scId, adjustment_status: status }], needHeader: needHeader ? "YES" : "NO", status: status,
    result_message: ids.length + " Approved line(s) -> Adjusted; adjustment_status " + s(cur.adjustment_status) + " -> " + status });
};
const commitA3ParityCheck = function commitA3ParityCheck(entry, plan, lineRows, hdrRows) {
  const cur = saRows(hdrRows)[0];
  if (!cur) return stepOk(entry, "A3_STOCK_COUNT", "Stock Count " + entry.scId + " not found", "no Stock Count to mark");
  const lines = saRows(lineRows);
  const left = lines.filter((l) => s(l.line_status) === "Approved").length;
  const status = scParityStatus(lines, {});
  if (left || s(cur.adjustment_status) !== status) return stepEnd(entry, "A3_STOCK_COUNT", left + " line(s) still Approved, adjustment_status " + s(cur.adjustment_status) + " (expected " + status + ")", false);
  return stepOk(entry, "A3_STOCK_COUNT", "PARITY: " + num((plan || {}).lineCount) + " line(s) Adjusted; " + status, "Stock Count " + status);
};
const res = __CALL__;
console.log("commit A3", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
