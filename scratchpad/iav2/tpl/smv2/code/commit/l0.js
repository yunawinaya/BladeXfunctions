// LOT_V2_COMMIT - L0 REVALIDATE (nothing moved yet): the stored lines still at the request's lineFingerprint, every In Transit
// row the plan updates still at its before-values (the entry checked the lock) -> DONE; else FAILED + the transfer back to
// its status before the save
const commitL0 = function commitL0(entry, itPartRows, lineRows, ledgerRows) {
  const it = lotJoinChunks(itPartRows, entry.partPrefix + "IT|");
  if (!it || typeof it !== "object" || !Array.isArray(it.updates) || !Array.isArray(it.creates)) return failNoWrite(entry, "LOT_INVALID_DATA", MSG.invalid, "the IT part of the prepared payload is missing or unreadable: no stock was moved");
  if (!entry.lineFingerprint) return failNoWrite(entry, "LOT_INVALID_REQUEST", MSG.badRequest, "the job's request has no lineFingerprint: no stock was moved");
  const fp = lotLineFingerprint(lotRows(lineRows));
  if (fp !== entry.lineFingerprint) return failNoWrite(entry, "LOT_LINES_CHANGED", MSG.linesChanged, "the stored lines are " + fp + ", the request expects " + (entry.lineFingerprint || "(none)") + ": no stock was moved");
  const cur = byId(ledgerRows);
  const moved = [];
  for (const u of it.updates) {
    if (!ledgerAtBefore(u && u.before, cur[s(u && u.id)])) moved.push(s(u && u.id));
  }
  if (moved.length) return failNoWrite(entry, "LOT_LEDGER_CHANGED", MSG.ledgerChanged, moved.length + " In Transit row(s) are no longer as prepared (e.g. " + moved.slice(0, 3).join(", ") + "): no stock was moved");
  return stepOk(entry, "L0_REVALIDATE", fp + "; " + it.updates.length + " In Transit row(s) at before", "revalidated");
};
const res = commitL0([{{node:code_node_LCentry.data}}][0], [{{node:sql_node_LCl0it.data}}][0], [{{node:sql_node_LCl0lines.data}}][0], [{{node:sql_node_LCl0ledger.data}}][0]);
console.log("commit L0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
