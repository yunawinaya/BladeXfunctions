// IDA_V2_COMMIT - D3 answer: op 2's answer, every R result "200" or a tolerated "401" skip (the skipped keys), else the first other one,
// and whether it was transient (409, no answer, a 400 without a result_code): then op 2's intent rows are read for the record
const commitD3Ans = function commitD3Ans(input, eng) {
  const called = s(input.needCall) === "YES";
  const code = called ? s(eng.code) : "";
  const rc = called ? s(eng.result_code) : "";
  const by = {};
  for (const r of idaJsonList(called ? eng.results : [])) if (r && typeof r === "object") by[s(r.movement_key)] = r;
  const keys = list(input.keys).map(s);
  const skipped = keys.filter((k) => by[k] && s(by[k].code) === "401");
  const bad = keys.find((k) => !by[k] || (s(by[k].code) !== "200" && s(by[k].code) !== "401"));
  const r = bad === undefined ? null : by[bad] || null;
  const transient = called && (code === "409" || code === "" || (code === "400" && !rc));
  const out = { code: code, result_code: rc, message: called ? (s(eng.message) || s(eng.msg)).slice(0, 4000) : "", allOk: called && code === "200" && bad === undefined ? "YES" : "NO",
    skipped: called && code === "200" ? skipped : [], refusedKey: bad === undefined ? "" : bad, refusedCode: r ? s(r.code) : "", refusedMessage: r ? s(r.message) : bad === undefined ? "" : "no result for " + bad,
    needOps: transient ? "YES" : "NO" };
  return out;
};
const res = commitD3Ans({ needCall: [{{node:code_node_DCd3plan.data.needCall}}][0], keys: [{{node:code_node_DCd3plan.data.keys}}][0] }, { code: [{{node:workflow_node_DCd3.data.code}}][0],
  result_code: [{{node:workflow_node_DCd3.data.result_code}}][0], message: [{{node:workflow_node_DCd3.data.message}}][0], msg: [{{node:workflow_node_DCd3.data.msg}}][0],
  results: [{{node:workflow_node_DCd3.data.results}}][0] });
console.log("commit D3 answer", JSON.stringify(res));
return res;
