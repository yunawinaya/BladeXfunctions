// IA_V2_COMMIT - I1 answer: the receipt re-PLAN's answer (code, result_code, R1's per-movement code) and whether the LABELS
// part is needed to word a refusal
const commitI1Ans = function commitI1Ans(input, eng) {
  const called = s(input.needPlan) === "YES";
  const code = called ? s(eng.code) : "";
  const rc = called ? s(eng.result_code) : "";
  const r1 = iaJsonList(called ? eng.results : []).filter((r) => r && typeof r === "object" && s(r.movement_key) === "R1")[0] || null;
  const r1Code = r1 ? s(r1.code) : "";
  const out = { code: code, result_code: rc, message: called ? (s(eng.message) || s(eng.msg)).slice(0, 4000) : "", r1Code: r1Code, r1Message: r1 ? s(r1.message) : "",
    needLabels: called && ((code === "400" && rc) || (code === "200" && r1Code !== "200")) ? "YES" : "NO" };
  return out;
};
const res = commitI1Ans({ needPlan: [{{node:code_node_IACi1check.data.needPlan}}][0] }, { code: [{{node:workflow_node_IACi1plan.data.code}}][0], result_code: [{{node:workflow_node_IACi1plan.data.result_code}}][0],
  message: [{{node:workflow_node_IACi1plan.data.message}}][0], msg: [{{node:workflow_node_IACi1plan.data.msg}}][0], results: [{{node:workflow_node_IACi1plan.data.results}}][0] });
console.log("commit I1 answer", JSON.stringify(res));
return res;
