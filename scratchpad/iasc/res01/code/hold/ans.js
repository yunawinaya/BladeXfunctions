// IA_HOLD - Answer: 200 (also replayed) = the moves applied; a 400 with a result_code = refused, all or nothing, so nothing
// moved; anything else (409, no answer, a 400 without a result_code: a dead child run, 500) = read the engine's record of it
const hdAns = function hdAns(mv, eng) {
  const called = hdS(mv.needCall) === "YES";
  const code = hdS(eng.code);
  const rc = hdS(eng.result_code);
  const outcome = !called ? "NONE" : code === "200" ? "DONE" : code === "400" && rc ? "NOTHING" : "ASK";
  return { outcome: outcome, code: code, result_code: rc, message: (hdS(eng.message) || hdS(eng.msg)).slice(0, 2000), needOps: outcome === "ASK" ? "YES" : "NO",
    opsJson: JSON.stringify(outcome === "ASK" ? [hdS(mv.opKey)] : []) };
};
const res = hdAns([{{node:code_node_HDmoves.data}}][0] || {}, { code: [{{node:workflow_node_HDapply.data.code}}][0], result_code: [{{node:workflow_node_HDapply.data.result_code}}][0],
  message: [{{node:workflow_node_HDapply.data.message}}][0], msg: [{{node:workflow_node_HDapply.data.msg}}][0] });
console.log("hold answer", JSON.stringify(res));
return res;
