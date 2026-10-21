// IA_V2_COMMIT - I1 check: exactly one Batch row of ours (adopted, or read back after the insert) -> the receipt's re-PLAN with
// that batch_id and unit_price 0 (catches the batch-balance DUPLICATE_BALANCE PREPARE's batch-less PLAN skips); two -> FAILED,
// both soft-deleted; none -> retry, then FAILED
const commitI1Check = function commitI1Check(entry, decide, backRows) {
  const base = Object.assign({ route: "GO", ours: [], batchId: "", batchNumber: "", needPlan: "NO", planKey: "", planMovements: [], keys: ["R1"], jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_IA" }, END_EMPTY);
  const d = decide || {};
  const idt = d.identity || {};
  const ours = s(d.needInsert) === "YES" ? oursOf(backRows, idt, entry.jobId) : list(d.ours).map(s).filter(digits);
  if (ours.length > 1) return Object.assign(base, failNoWrite(entry, "IA_BATCH_FAILED", MSG.batchTwice, "the Batch row " + s(idt.batch_number) + " was inserted twice (" + ours.join(", ") + "): nothing was moved", ours));
  if (!ours.length) {
    const why = "the Batch row " + s(idt.batch_number) + " did not read back after its insert";
    if (num(entry.attempts) >= MAX_RETRIES) return Object.assign(base, failNoWrite(entry, "IA_BATCH_FAILED", MSG.batchMissing, why + " (after " + num(entry.attempts) + " retries): nothing was moved", []));
    return Object.assign(base, stepEnd(entry, "I1_BATCH", why, false));
  }
  const mv = Object.assign({}, d.r1 || {}, { batch_id: ours[0], unit_price: 0 });
  return Object.assign(base, { ours: ours, batchId: ours[0], batchNumber: s(idt.batch_number), needPlan: "YES", planKey: s(d.opKeyR), planMovements: [mv],
    result_message: "Batch row " + ours[0] + " (" + s(idt.batch_number) + "): re-PLAN of the receipt" });
};
const res = commitI1Check([{{node:code_node_IACentry.data}}][0], [{{node:code_node_IACi1decide.data}}][0], [{{node:sql_node_IACi1back.data}}][0]);
console.log("commit I1 check", JSON.stringify({ route: res.route, ours: res.ours, plan: res.needPlan, result: res.result_code, message: res.result_message }));
return res;
