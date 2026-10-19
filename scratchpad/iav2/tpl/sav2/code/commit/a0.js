// SA_V2_COMMIT - A0 REVALIDATE (nothing moved yet; the entry checked the lock: owner + Processing).
// FORM: the stored lines still at the plan's lineFingerprint (or already at its incomingFingerprint) -> DONE, else
// SA_LINES_CHANGED. REVIEW: the Stock Count's lines still at the scFingerprint the review was built on and no OTHER Processing
// Stock Adjustment of that Stock Count -> DONE, else SA_SC_CHANGED. A failure = FAILED + the Stock Adjustment back (Draft / Cancelled)
const commitA0 = function commitA0(entry, saLineRows, scLineRows, otherRows) {
  if (entry.source === "REVIEW") {
    const fp = scLineFingerprint(saRows(scLineRows));
    if (fp !== entry.scFingerprint) return failNoWrite(entry, "SA_SC_CHANGED", MSG.scChanged, "the Stock Count's lines are " + fp + ", the review was built on " + entry.scFingerprint + ": no stock was moved");
    const other = num((list(otherRows)[0] || {}).other);
    if (other > 0) return failNoWrite(entry, "SA_SC_CHANGED", MSG.scBusy, other + " other Processing Stock Adjustment(s) of Stock Count " + entry.scId + ": no stock was moved");
    return stepOk(entry, "A0_REVALIDATE", fp + "; no other Processing Stock Adjustment", "revalidated");
  }
  const fp = saLineFingerprint(saRows(saLineRows));
  if (fp !== entry.lineFingerprint && fp !== entry.incomingFingerprint) return failNoWrite(entry, "SA_LINES_CHANGED", MSG.linesChanged, "the stored lines are " + fp + ", the plan expects " + entry.lineFingerprint + (entry.incomingFingerprint !== entry.lineFingerprint ? " or " + entry.incomingFingerprint : "") + ": no stock was moved");
  return stepOk(entry, "A0_REVALIDATE", fp, "revalidated");
};
const res = commitA0([{{node:code_node_SACentry.data}}][0], [{{node:sql_node_SACa0lines.data}}][0], [{{node:sql_node_SACa0sc.data}}][0], [{{node:sql_node_SACa0other.data}}][0]);
console.log("commit A0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
