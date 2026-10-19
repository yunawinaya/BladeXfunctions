// LOT_V2_COMMIT - L1 answer: the engine's answer (when it was called) and which extra read the decision needs (409: its intent
// rows; 400: the LABELS part)
const commitL1Ans = function commitL1Ans(input, eng) {
  const called = s(input.needCall) === "YES";
  const code = called ? s(eng.code) : "";
  return { code: code, result_code: called ? s(eng.result_code) : "", message: called ? s(eng.message).slice(0, 4000) : "", need409: called && code === "409" ? "YES" : "NO",
    need400: called && code === "400" ? "YES" : "NO" };
};
const res = commitL1Ans({ needCall: [{{node:code_node_LCl1in.data.needCall}}][0] }, { code: [{{node:workflow_node_LCl1.data.code}}][0], result_code: [{{node:workflow_node_LCl1.data.result_code}}][0],
  message: [{{node:workflow_node_LCl1.data.message}}][0] });
console.log("commit L1 answer", JSON.stringify(res));
return res;
