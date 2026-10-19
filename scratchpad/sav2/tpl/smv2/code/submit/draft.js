// LOT_V2_SUBMIT - Draft Add twins (grv2 phase2b created/keydup.js): the rows saved with this key, oldest first; this run's own
// row is the one with its lot_idem_key (<key>#<nonce>; else the add's answer); a newer twin soft-deletes itself and answers
// with the oldest
const submitDraftDup = function submitDraftDup(post, dupRows, added) {
  const rows = list(dupRows).filter((r) => digits(r.id));
  const a = list(added)[0] || {};
  const mine = rows.find((r) => s(r.lot_idem_key) === s(post.idemStore)) || (lotIdStr(a.id) ? { id: lotIdStr(a.id), stock_movement_no: s(a.stock_movement_no) } : null);
  const first = rows[0] || mine;
  const lose = Boolean(mine && first) && s(first.id) !== s(mine.id);
  return { lose: lose ? "YES" : "NO", mine: lose ? s(mine.id) : "0", route: first ? "SAVED" : "STOP", code: first ? "200" : "500",
    message: first ? "Location Transfer saved successfully" : "The save could not be completed: please try again.", errorCode: first ? "" : "LOT_QUEUE_FAILED",
    lotId: first ? s(first.id) : "", lotNo: first ? s(first.stock_movement_no) : "" };
};
const res = submitDraftDup([{{node:code_node_LSpost.data}}][0], [{{node:sql_node_LSdraftDup.data}}][0], [{{node:add_node_LSdraftAdd.data}}][0]);
console.log("submit draft", JSON.stringify(res));
return res;
