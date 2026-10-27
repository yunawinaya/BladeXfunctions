// IA_V2_COMMIT - I1 BATCH: the receipt re-PLAN with our batch_id. 200 + R1 "200" -> DONE {batch_id, batch_number}; any other
// R1 code (e.g. "401", the parent no longer stock-controlled) -> FAILED IA_PLAN_SKIPPED; 400 -> FAILED IA_INVENTORY_<code>
// (PREPARE's mapping, LABELS-worded); no answer -> retry, then FAILED; a failure soft-deletes our Batch row
const commitI1 = function commitI1(entry, check, ans, labelRows) {
  const ours = list(check.ours).map(s).filter(digits);
  const code = s(ans.code);
  const rc = s(ans.result_code);
  const why = engineWhy("the receipt re-PLAN (" + s(check.planKey) + ")", ans);
  const labels = () => {
    const l = iaJoinChunks(labelRows, entry.partPrefix + "LABELS|");
    return l && typeof l === "object" ? l : {};
  };
  // an output split (plan 10-27): every group's Batch row id by number (batch_ids), the first one as batch_id
  const split = check.batchIds && typeof check.batchIds === "object" && Object.keys(check.batchIds).length ? check.batchIds : null;
  if (code === "200" && s(ans.r1Code) === "200") {
    const ref = Object.assign({ batch_id: s(check.batchId), batch_number: s(check.batchNumber) }, split ? { batch_ids: split } : {});
    return Object.assign(stepOk(entry, "I1_BATCH", JSON.stringify(ref), split ? Object.keys(split).length + " Batch rows (" + Object.values(split).join(", ") + ")" :
      "Batch row " + s(check.batchNumber) + " (" + s(check.batchId) + ")"), { batchId: s(check.batchId), batchIds: split || {} });
  }
  // the refused receipt by its own key (an output split's R2..Rn too), the planned receipts for the engine's movements[i] (review 10-27)
  const k = s(ans.r1Key) || "R1";
  const keys = list(check.keys).map(s).filter((x) => x);
  if (code === "200") {
    const text = iaMapEngineMessage((s(ans.r1Message) || k + " answered " + (s(ans.r1Code) || "nothing")) + " (movement " + k + ")", labels(), keys.length ? keys : ["R1"]);
    return Object.assign(failNoWrite(entry, "IA_PLAN_SKIPPED", text + ": nothing was moved.", why + "; " + k + " " + (s(ans.r1Code) || "missing"), ours), { batchId: "" });
  }
  if (code === "400" && rc) {
    return Object.assign(failNoWrite(entry, "IA_INVENTORY_" + rc, iaMapEngineMessage(s(ans.message), labels(), keys.length ? keys : ["R1"]) || why, why, ours), { batchId: "" });
  }
  if (code === "409" || code === "" || code === "400") {
    if (num(entry.attempts) >= MAX_RETRIES) return Object.assign(failNoWrite(entry, "IA_PLAN_FAILED", MSG.planFailed, why + " (after " + num(entry.attempts) + " retries)", ours), { batchId: "" });
    return Object.assign(stepEnd(entry, "I1_BATCH", why, false), { batchId: "" });
  }
  return Object.assign(failNoWrite(entry, "IA_PLAN_FAILED", "The completion could not be prepared: " + why, why, ours), { batchId: "" });
};
const res = commitI1([{{node:code_node_IACentry.data}}][0], [{{node:code_node_IACi1check.data}}][0], [{{node:code_node_IACi1ans.data}}][0], [{{node:sql_node_IACi1labels.data}}][0]);
console.log("commit I1", JSON.stringify({ route: res.route, batch: res.batchId, result: res.result_code, message: res.result_message }));
return res;
