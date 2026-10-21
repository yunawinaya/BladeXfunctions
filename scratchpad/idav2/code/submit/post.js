// IDA_V2_SUBMIT - Post: the queue rows (CONTRACT sections 3, 4, 7; a stored Draft's LOCK|n+1 goes first, then the job QUEUED 2 minutes ahead)
const submitPost = function submitPost(guard, entry, gate) {
  const empty = { lockRows: [], jobRows: [], needLock: "NO", isAdd: "NO", numberProps: "NO", numberIssued: "NO", request: "", moveCount: num(gate.moveCount) };
  if (s(gate.route) !== "GO") return answer("STOP", s(gate.code) || "400", s(gate.message) || "the gate did not answer", Object.assign(empty, { errorCode: s(gate.errorCode) }));
  const add = guard.pageStatus === "Add";
  const org = s(gate.organizationId);
  if (!digits(org)) return answer("STOP", "400", "The Item Disassembly has no organization.", Object.assign(empty, { errorCode: "IDA_INVALID_DATA" }));
  if (!s(entry.dbNow)) return answer("STOP", "500", IDA_TEXT.queueFailed, Object.assign(empty, { errorCode: "IDA_QUEUE_FAILED" }));
  const issued = s(gate.stockMovementNo) === "issued";
  // IA review 6: a stored Draft keeps the number an earlier COMPLETE_IDA job issued unless a COMPLETED job ran under it; -9999 writes the typed one
  const keep = !add && issued && num(entry.issuedByJob) > 0 && num(entry.completedUnder) === 0;
  const request = { v: 1, action: "DIRECT", prevStatus: s(entry.prevStatus), saveAs: "Completed", pageStatus: add ? "Add" : "Edit", idaId: add ? "" : guard.idaId,
    idaNo: add ? "" : s(entry.idaNo), issuedNo: "", lineFingerprint: "", organizationId: org, plantId: s(gate.plantId), lineCount: num(gate.lineCount),
    pickCount: num(gate.pickCount), moveCount: num(gate.moveCount), stockLines: num(gate.stockLines), nonStockLines: num(gate.nonStockLines), uid: guard.uid,
    source: guard.source, nonce: guard.nonce, parts: {} };
  if (!idaPrevStatusOk(request.prevStatus)) return answer("STOP", "400", "the status to restore is unknown", Object.assign(empty, { errorCode: "IDA_INVALID_DATA" }));
  const text = JSON.stringify(request);
  return answer("QUEUE", "200", "queued", {
    request: text,
    isAdd: add ? "YES" : "NO",
    numberProps: keep ? "NO" : "YES",
    numberIssued: issued && !keep ? "YES" : "NO",
    moveCount: request.moveCount,
    lockRows: add ? [] : [{ job_id: idaLockJob(guard.idaId), organization_id: org, step_name: "LOCK|" + num(entry.lockN), step_status: "LOCK", attempt_count: 0,
      started_at: entry.dbNow, result_ref: guard.key }],
    needLock: add ? "NO" : "YES",
    jobRows: [{ organization_id: org, plant_id: request.plantId, command: "COMPLETE_IDA", idempotency_key: guard.key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: idaDbAddSeconds(entry.dbNow, 600),
      request_payload: text, causation_id: add ? "" : guard.idaId, correlation_id: add ? "" : idaCorrelation(guard.idaId), line_count: request.moveCount,
      queued_at: entry.dbNow }],
  });
};
const res = submitPost([{{node:code_node_DSguard.data}}][0], [{{node:code_node_DSentry.data}}][0],
  { route: [{{node:code_node_DSgate.data.route}}][0], code: [{{node:code_node_DSgate.data.code}}][0], message: [{{node:code_node_DSgate.data.message}}][0],
    errorCode: [{{node:code_node_DSgate.data.errorCode}}][0], lineCount: [{{node:code_node_DSgate.data.lineCount}}][0], pickCount: [{{node:code_node_DSgate.data.pickCount}}][0],
    moveCount: [{{node:code_node_DSgate.data.moveCount}}][0], stockLines: [{{node:code_node_DSgate.data.stockLines}}][0],
    nonStockLines: [{{node:code_node_DSgate.data.nonStockLines}}][0], plantId: [{{node:code_node_DSgate.data.plantId}}][0],
    organizationId: [{{node:code_node_DSgate.data.organizationId}}][0], stockMovementNo: [{{node:code_node_DSgate.data.stockMovementNo}}][0] });
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message, add: res.isAdd, number: res.numberProps, lock: res.needLock }));
return res;
