// IA_REVERT_V2_COMMIT - V0: Processing under this job and RV_MOVES = the planned IM1 -> DONE, else FAILED + unlock
const commitV0 = function commitV0(entry, moveRows) {
  if (entry.unlockOk !== "YES") return failNoWrite(entry, "IA_RV_NOT_LOCKED", IA_TEXT.rvNotLocked, "the Item Assembly is not Processing under this job: no stock was moved");
  const fp = iaMovesFingerprint(moveRows);
  if (fp !== s(entry.movesFingerprint)) return failNoWrite(entry, "IA_RV_ROWS_CHANGED", RV_TEXT.rowsChanged, "its movement rows read " + fp + ", the plan was made from " + s(entry.movesFingerprint));
  return stepOk(entry, "V0_REVALIDATE", fp, "revalidated");
};
const res = commitV0([{{node:code_node_IVCentry.data}}][0], [{{node:sql_node_IVCv0moves.data}}][0]);
console.log("commit V0", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
