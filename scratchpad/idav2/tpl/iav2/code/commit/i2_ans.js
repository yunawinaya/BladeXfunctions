// IA_V2_COMMIT - I2 answer: op 1's answer and the extra read the decision needs. A 409, NO answer, or a 400 WITHOUT a
// result_code (the platform's envelope of an engine run that died) reads op 1's intent rows; a 400 with a result_code reads
// the LABELS part. The per-movement results are never read here, only the summary
const commitI2Ans = function commitI2Ans(input, eng) {
  const called = s(input.needCall) === "YES";
  const code = called ? s(eng.code) : "";
  const rc = called ? s(eng.result_code) : "";
  const transient = code === "409" || code === "" || (code === "400" && !rc);
  const sum = called ? iaParseJ(eng.summary) : null;
  const out = { code: code, result_code: rc, message: called ? (s(eng.message) || s(eng.msg)).slice(0, 4000) : "", summary: sum && typeof sum === "object" ? sum : {},
    need409: called && transient ? "YES" : "NO", need400: called && code === "400" && rc ? "YES" : "NO" };
  return out;
};
const res = commitI2Ans({ needCall: [{{node:code_node_IACi2in.data.needCall}}][0] }, { code: [{{node:workflow_node_IACi2.data.code}}][0], result_code: [{{node:workflow_node_IACi2.data.result_code}}][0],
  message: [{{node:workflow_node_IACi2.data.message}}][0], msg: [{{node:workflow_node_IACi2.data.msg}}][0], summary: [{{node:workflow_node_IACi2.data.summary}}][0] });
console.log("commit I2 answer", JSON.stringify(res));
return res;
