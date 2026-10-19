// IA_REVERT_V2_COMMIT - V1 answer; a dead engine run arrives as { code 400, msg } without a result_code
const commitV1Ans = function commitV1Ans(input, eng) {
  const called = s(input.needCall) === "YES";
  const code = called ? s(eng.code) : "";
  const rc = called ? s(eng.result_code) : "";
  const transient = code === "409" || code === "" || (code === "400" && !rc);
  const out = { code: code, result_code: rc, message: called ? (s(eng.message) || s(eng.msg)).slice(0, 4000) : "", need409: called && transient ? "YES" : "NO",
    need400: called && code === "400" && rc ? "YES" : "NO" };
  return out;
};
const res = commitV1Ans({ needCall: [{{node:code_node_IVCv1in.data.needCall}}][0] }, { code: [{{node:workflow_node_IVCv1.data.code}}][0], result_code: [{{node:workflow_node_IVCv1.data.result_code}}][0],
  message: [{{node:workflow_node_IVCv1.data.message}}][0], msg: [{{node:workflow_node_IVCv1.data.msg}}][0] });
console.log("commit V1 answer", JSON.stringify(res));
return res;
