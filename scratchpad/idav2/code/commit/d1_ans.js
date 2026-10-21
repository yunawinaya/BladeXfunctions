// IDA_V2_COMMIT - D1 answer: the re-PLAN's code / result_code, every R result "200" or the first one that is not, and whether the
// LABELS part is needed to word a refusal
const commitD1Ans = function commitD1Ans(input, eng) {
  const called = s(input.needPlan) === "YES";
  const code = called ? s(eng.code) : "";
  const rc = called ? s(eng.result_code) : "";
  const by = {};
  for (const r of idaJsonList(called ? eng.results : [])) if (r && typeof r === "object") by[s(r.movement_key)] = r;
  const bad = list(input.keys).map(s).find((k) => !by[k] || s(by[k].code) !== "200");
  const r = bad === undefined ? null : by[bad] || null;
  const out = { code: code, result_code: rc, message: called ? (s(eng.message) || s(eng.msg)).slice(0, 4000) : "", allOk: called && code === "200" && bad === undefined ? "YES" : "NO",
    refusedKey: bad === undefined ? "" : bad, refusedCode: r ? s(r.code) : "", refusedMessage: r ? s(r.message) : bad === undefined ? "" : "no result for " + bad,
    needLabels: called && ((code === "400" && rc) || (code === "200" && bad !== undefined)) ? "YES" : "NO" };
  return out;
};
const res = commitD1Ans({ needPlan: [{{node:code_node_DCd1check.data.needPlan}}][0], keys: [{{node:code_node_DCd1check.data.keys}}][0] }, { code: [{{node:workflow_node_DCd1plan.data.code}}][0],
  result_code: [{{node:workflow_node_DCd1plan.data.result_code}}][0], message: [{{node:workflow_node_DCd1plan.data.message}}][0], msg: [{{node:workflow_node_DCd1plan.data.msg}}][0],
  results: [{{node:workflow_node_DCd1plan.data.results}}][0] });
console.log("commit D1 answer", JSON.stringify(res));
return res;
