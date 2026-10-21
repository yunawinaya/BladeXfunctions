// IDA_V2_COMMIT - D2 answer: op 1's answer and the extra read the decision needs. A 409, NO answer, or a 400 WITHOUT a result_code
// (the platform's envelope of an engine run that died) reads op 1's intent rows; a 400 with a result_code reads the LABELS part. The
// per-movement results are never read here, only the summary
const commitD2Ans = function commitD2Ans(input, eng) {
  const called = s(input.ok) === "YES";
  const code = called ? s(eng.code) : "";
  const rc = called ? s(eng.result_code) : "";
  const transient = code === "409" || code === "" || (code === "400" && !rc);
  const sum = called ? idaParseJ(eng.summary) : null;
  const out = { code: code, result_code: rc, message: called ? (s(eng.message) || s(eng.msg)).slice(0, 4000) : "", summary: sum && typeof sum === "object" ? sum : {},
    need409: called && transient ? "YES" : "NO", need400: called && code === "400" && rc ? "YES" : "NO" };
  return out;
};
const res = commitD2Ans({ ok: [{{node:code_node_DCd2in.data.ok}}][0] }, { code: [{{node:workflow_node_DCd2.data.code}}][0], result_code: [{{node:workflow_node_DCd2.data.result_code}}][0],
  message: [{{node:workflow_node_DCd2.data.message}}][0], msg: [{{node:workflow_node_DCd2.data.msg}}][0], summary: [{{node:workflow_node_DCd2.data.summary}}][0] });
console.log("commit D2 answer", JSON.stringify(res));
return res;
