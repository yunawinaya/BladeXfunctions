// IDA_V2_COMMIT - D1 BATCH (rows 11-14): the re-PLAN of op 2 with our batch ids. 200 + every R "200" (or no re-PLAN: nothing inserts)
// -> DONE {"rows","inserted","adopted"}; an R result not "200" -> FAILED IDA_PLAN_SKIPPED; 400 with a result_code -> FAILED
// IDA_INVENTORY_<code> (both LABELS-worded); no answer / 409 / 400 without a code -> retry, after 3 FAILED IDA_PLAN_FAILED; anything
// else -> FAILED IDA_PLAN_FAILED. Every failure soft-deletes ours (the check's read-back)
const commitD1 = function commitD1(entry, check, ans, labelRows, counts) {
  const ours = list(check.ours).map(s).filter(digits);
  const ref = JSON.stringify({ rows: num(counts.rows), inserted: num(counts.inserted), adopted: num(counts.adopted) });
  if (s(check.needPlan) !== "YES") return stepOk(entry, "D1_BATCH", ref, s(check.result_message) || "Batch rows ready");
  const code = s(ans.code);
  const rc = s(ans.result_code);
  const keys = list(check.keys);
  const why = engineWhy("the receipt re-PLAN (" + s(check.planKey) + ")", ans);
  const labels = () => {
    const l = idaJoinChunks(labelRows, entry.partPrefix + "LABELS|");
    return l && typeof l === "object" ? l : {};
  };
  if (code === "200" && s(ans.allOk) === "YES") return stepOk(entry, "D1_BATCH", ref, "Batch rows ready (" + num(counts.inserted) + " inserted, " + num(counts.adopted) + " adopted), re-PLAN clean");
  if (code === "200") {
    const k = s(ans.refusedKey);
    const text = idaMapEngineMessage((s(ans.refusedMessage) || k + " answered " + (s(ans.refusedCode) || "nothing")) + " (movement " + k + ")", labels(), keys);
    return failNoWrite(entry, "IDA_PLAN_SKIPPED", text + ": nothing was moved.", why + "; " + k + " " + (s(ans.refusedCode) || "missing"), ours);
  }
  if (code === "400" && rc) return failNoWrite(entry, "IDA_INVENTORY_" + rc, idaMapEngineMessage(s(ans.message), labels(), keys) || why, why, ours);
  if (code === "409" || code === "" || code === "400") {
    if (num(entry.attempts) >= MAX_RETRIES) return failNoWrite(entry, "IDA_PLAN_FAILED", MSG.planFailed, why + " (after " + num(entry.attempts) + " retries)", ours);
    return stepEnd(entry, "D1_BATCH", why, false);
  }
  return failNoWrite(entry, "IDA_PLAN_FAILED", IDA_TEXT.planFailed(why), why, ours);
};
const res = commitD1([{{node:code_node_DCentry.data}}][0], { ours: [{{node:code_node_DCd1check.data.ours}}][0], needPlan: [{{node:code_node_DCd1check.data.needPlan}}][0],
  planKey: [{{node:code_node_DCd1check.data.planKey}}][0], keys: [{{node:code_node_DCd1check.data.keys}}][0], result_message: [{{node:code_node_DCd1check.data.result_message}}][0] },
  [{{node:code_node_DCd1ans.data}}][0], [{{node:sql_node_DCd1labels.data}}][0], { rows: [{{node:code_node_DCd1plan.data.planned}}][0], inserted: [{{node:code_node_DCd1decide.data.insertCount}}][0],
  adopted: [{{node:code_node_DCd1decide.data.adoptCount}}][0] });
console.log("commit D1", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
