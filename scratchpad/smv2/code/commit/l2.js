// LOT_V2_COMMIT - L2 LINES (COMPLETE / EDIT): ONE update of the transfer with update_node_TxDhhT03's props minus the status
// (SUBMIT's S|..|LINES part: the header props + the whole stock_movement subform - never sliced: rows missing from the call
// get soft-deleted). Stored lines at the request's lineFingerprint (not written yet) or incomingFingerprint (an earlier
// attempt) -> write (the same content again is harmless); anything else -> REQUIRES_REVIEW. Read back = incomingFingerprint.
const L2_HEADER = __HEADER__;
const commitL2Plan = function commitL2Plan(entry, partRows, lineRows) {
  const base = { route: "GO", row: {}, needWrite: "NO", lineCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_LOT" };
  const p = lotJoinChunks(partRows, entry.sPartPrefix + "LINES|");
  if (!p || typeof p !== "object" || s(p.lotId) !== entry.lotId || !Array.isArray(p.stock_movement) || !p.header || typeof p.header !== "object") {
    return Object.assign(base, stepEnd(entry, "L2_LINES", "the S LINES part of the request is missing or is not this transfer's", true));
  }
  const target = entry.incomingFingerprint;
  const own = lotLineFingerprint(p.stock_movement);
  if (!target || s(p.fingerprint) !== target || own !== target) return Object.assign(base, stepEnd(entry, "L2_LINES", "the S LINES part (" + own + ", stamped " + s(p.fingerprint) + ") is not the request's incomingFingerprint " + (target || "(none)"), true));
  const stored = lotLineFingerprint(lotRows(lineRows));
  if (stored !== entry.lineFingerprint && stored !== target) return Object.assign(base, stepEnd(entry, "L2_LINES", "the stored lines are " + stored + ", neither " + entry.lineFingerprint + " (before) nor " + target + " (after)", true));
  const row = { id: entry.lotId };
  for (const k of L2_HEADER) row[k] = p.header[k] === undefined ? null : p.header[k];
  row.stock_movement = p.stock_movement;
  return Object.assign(base, { row: row, needWrite: "YES", lineCount: p.stock_movement.length, result_message: (stored === target ? "lines already at " : "lines " + stored + " -> ") + target });
};
const commitL2Check = function commitL2Check(entry, lineRows) {
  const fp = lotLineFingerprint(lotRows(lineRows));
  if (fp !== entry.incomingFingerprint) return stepEnd(entry, "L2_LINES", "the lines read back as " + fp + ", not " + entry.incomingFingerprint, false);
  return stepOk(entry, "L2_LINES", fp, "lines saved");
};
const res = __CALL__;
console.log("commit L2", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
