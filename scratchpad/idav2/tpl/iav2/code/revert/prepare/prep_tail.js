const iarvTrack = { locked: 0 };
let iarvPrepRes;
try {
  iarvPrepRes = iarvPrepNode([{{node:code_node_IVPentry.data}}][0], {
    own: [{{node:sql_node_IVPown.data}}][0], hdr: [{{node:sql_node_IVPhdr.data}}][0], moves: [{{node:sql_node_IVPmoves.data}}][0], batch: [{{node:sql_node_IVPbatch.data}}][0],
  }, iarvTrack);
} catch (e) {
  // unlock only when the throw came after the lock check passed
  iarvPrepRes = { route: "FAIL", code: "IA_RV_PLAN_BROKEN", message: "The revert could not be prepared: " + String((e && e.message) || e).slice(0, 200), unlockOk: iarvTrack.locked, details: "",
    iaNo: "", liveRows: 0, liveOut: 0, liveIn: 0, movesFingerprint: "", iaIdSql: "0", orgSql: "0", plantIdSql: "0", assembledIdsCsv: "0", itemIdsCsv: "0", batchIdsCsv: "0", binIdsCsv: "0" };
}
console.log("prepare prep", JSON.stringify({ route: iarvPrepRes.route, code: iarvPrepRes.code, message: iarvPrepRes.message, live: iarvPrepRes.liveRows, unlock: iarvPrepRes.unlockOk }));
return { route: iarvPrepRes.route, code: iarvPrepRes.code, message: iarvPrepRes.message, unlockOk: iarvPrepRes.unlockOk, details: iarvPrepRes.details, iaNo: iarvPrepRes.iaNo,
  liveRows: iarvPrepRes.liveRows, liveOut: iarvPrepRes.liveOut, liveIn: iarvPrepRes.liveIn, movesFingerprint: iarvPrepRes.movesFingerprint, iaIdSql: iarvPrepRes.iaIdSql,
  orgSql: iarvPrepRes.orgSql, plantIdSql: iarvPrepRes.plantIdSql, assembledIdsCsv: iarvPrepRes.assembledIdsCsv, itemIdsCsv: iarvPrepRes.itemIdsCsv,
  batchIdsCsv: iarvPrepRes.batchIdsCsv, binIdsCsv: iarvPrepRes.binIdsCsv };
