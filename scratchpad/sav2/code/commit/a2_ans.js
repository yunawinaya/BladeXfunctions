// SA_V2_COMMIT - A2 answer: the engine's answer (when it was called) and which extra read the decision needs. A 409, NO answer
// (a child workflow's failure does not abort the parent: its node data may be null) or a 400 WITHOUT a result_code (the
// platform's error envelope { code 400, success false, data null, msg } of an engine run that died, e.g. the duplicate Lock Key
// seed of a first concurrent use of a key) reads the intent rows; a real 400 (a plan result_code: REQUEST_INVALID,
// INSUFFICIENT, ...) reads the LABELS part. The envelope's text is in msg, not message
const commitA2Ans = function commitA2Ans(input, eng) {
  const called = s(input.needCall) === "YES";
  const code = called ? s(eng.code) : "";
  const rc = called ? s(eng.result_code) : "";
  const transient = code === "409" || code === "" || (code === "400" && !rc);
  const out = { code: code, result_code: rc, message: called ? (s(eng.message) || s(eng.msg)).slice(0, 4000) : "", need409: called && transient ? "YES" : "NO",
    need400: called && code === "400" && rc ? "YES" : "NO" };
  return out;
};
const res = commitA2Ans({ needCall: [{{node:code_node_SACa2in.data.needCall}}][0] }, { code: [{{node:workflow_node_SACa2.data.code}}][0], result_code: [{{node:workflow_node_SACa2.data.result_code}}][0],
  message: [{{node:workflow_node_SACa2.data.message}}][0], msg: [{{node:workflow_node_SACa2.data.msg}}][0] });
console.log("commit A2 answer", JSON.stringify(res));
return res;
