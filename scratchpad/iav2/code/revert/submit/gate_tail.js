const iarvGateRes = iarvGate([{{node:code_node_IVSguard.data}}][0], [{{node:code_node_IVSentry.data}}][0], {
  hdr: [{{node:sql_node_IVShdr.data}}][0], moves: [{{node:sql_node_IVSmoves.data}}][0], batch: [{{node:sql_node_IVSbatch.data}}][0], serial: [{{node:sql_node_IVSserial.data}}][0],
});
console.log("submit gate", JSON.stringify({ route: iarvGateRes.route, code: iarvGateRes.code, message: iarvGateRes.message, live: iarvGateRes.liveRows }));
return { route: iarvGateRes.route, code: iarvGateRes.code, message: iarvGateRes.message, reason: iarvGateRes.reason, errorCode: iarvGateRes.errorCode, liveRows: iarvGateRes.liveRows,
  liveOut: iarvGateRes.liveOut, liveIn: iarvGateRes.liveIn, movesFingerprint: iarvGateRes.movesFingerprint, prevStatus: iarvGateRes.prevStatus };
