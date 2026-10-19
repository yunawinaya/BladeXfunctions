// IA_V2_COMMIT - I3 answer: op 2's answer, R1's per-movement code, and whether it was transient (409, no answer, a 400 without
// a result_code): then op 2's intent rows are read for the record
const commitI3Ans = function commitI3Ans(input, eng) {
  const called = s(input.needCall) === "YES";
  const code = called ? s(eng.code) : "";
  const rc = called ? s(eng.result_code) : "";
  const r1 = iaJsonList(called ? eng.results : []).filter((r) => r && typeof r === "object" && s(r.movement_key) === "R1")[0] || null;
  const transient = called && (code === "409" || code === "" || (code === "400" && !rc));
  const out = { code: code, result_code: rc, message: called ? (s(eng.message) || s(eng.msg)).slice(0, 4000) : "", r1Code: r1 ? s(r1.code) : "", r1Message: r1 ? s(r1.message) : "",
    r1Price: r1 ? s(r1.unit_price) : "", needOps: transient ? "YES" : "NO" };
  return out;
};
const res = commitI3Ans({ needCall: [{{node:code_node_IACi3plan.data.needCall}}][0] }, { code: [{{node:workflow_node_IACi3.data.code}}][0], result_code: [{{node:workflow_node_IACi3.data.result_code}}][0],
  message: [{{node:workflow_node_IACi3.data.message}}][0], msg: [{{node:workflow_node_IACi3.data.msg}}][0], results: [{{node:workflow_node_IACi3.data.results}}][0] });
console.log("commit I3 answer", JSON.stringify(res));
return res;
