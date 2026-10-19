// IA_V2_SUBMIT - Post: GENERATE_BATCH's number, then the queue rows (CONTRACT sections 3, 4, 7; a stored Draft's LOCK|n+1 goes first)
const IA_BATCH_EMPTY = "Could not generate a batch number. Check the Batch Number Configuration for this item.";
const submitPost = function submitPost(guard, entry, gate, batchOut) {
  const empty = { lockRows: [], jobRows: [], needLock: "NO", isAdd: "NO", numberProps: "NO", numberIssued: "NO", batchNo: "", request: "", lineCount: num(gate.lineCount) };
  if (s(gate.route) !== "GO") return answer("STOP", s(gate.code) || "400", s(gate.message) || "the gate did not answer", Object.assign(empty, { errorCode: s(gate.errorCode) }));
  const needBatch = s(gate.needBatch) === "YES";
  const batchNo = needBatch && obj(batchOut) ? s(batchOut.batch_number) : "";
  if (needBatch && !batchNo) return answer("STOP", "400", IA_BATCH_EMPTY, Object.assign(empty, { errorCode: "IA_BATCH_FAILED" }));
  const add = guard.pageStatus === "Add";
  const org = s(gate.organizationId);
  if (!digits(org)) return answer("STOP", "400", "The Item Assembly has no organization.", Object.assign(empty, { errorCode: "IA_INVALID_DATA" }));
  if (!s(entry.dbNow)) return answer("STOP", "500", IA_TEXT.queueFailed, Object.assign(empty, { errorCode: "IA_QUEUE_FAILED" }));
  const issued = s(gate.stockMovementNo) === "issued";
  // review 6: a stored Draft keeps the number an earlier COMPLETE_IA job issued unless a COMPLETED job ran under it; -9999 writes the typed one
  const keep = !add && issued && num(entry.issuedByJob) > 0 && num(entry.completedUnder) === 0;
  const request = { v: 1, action: "DIRECT", prevStatus: s(entry.prevStatus), saveAs: "Completed", pageStatus: add ? "Add" : "Edit", iaId: add ? "" : guard.iaId,
    iaNo: add ? "" : s(entry.iaNo), issuedNo: "", lineFingerprint: "", organizationId: org, plantId: s(gate.plantId), lineCount: num(gate.lineCount),
    pickCount: num(gate.pickCount), nonStockLines: num(gate.nonStockLines), movementCount: num(gate.movementCount), uid: guard.uid, source: guard.source,
    nonce: guard.nonce, parts: {} };
  if (!iaPrevStatusOk(request.prevStatus)) return answer("STOP", "400", "the status to restore is unknown", Object.assign(empty, { errorCode: "IA_INVALID_DATA" }));
  const text = JSON.stringify(request);
  return answer("QUEUE", "200", "queued", {
    request: text,
    isAdd: add ? "YES" : "NO",
    numberProps: keep ? "NO" : "YES",
    numberIssued: issued && !keep ? "YES" : "NO",
    batchNo: batchNo,
    lineCount: request.lineCount,
    lockRows: add ? [] : [{ job_id: iaLockJob(guard.iaId), organization_id: org, step_name: "LOCK|" + num(entry.lockN), step_status: "LOCK", attempt_count: 0,
      started_at: entry.dbNow, result_ref: guard.key }],
    needLock: add ? "NO" : "YES",
    jobRows: [{ organization_id: org, plant_id: request.plantId, command: "COMPLETE_IA", idempotency_key: guard.key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: iaDbAddSeconds(entry.dbNow, 120),
      request_payload: text, causation_id: add ? "" : guard.iaId, correlation_id: add ? "" : iaCorrelation(guard.iaId), line_count: request.pickCount,
      queued_at: entry.dbNow }],
  });
};
const res = submitPost([{{node:code_node_ISguard.data}}][0], [{{node:code_node_ISentry.data}}][0],
  { route: [{{node:code_node_ISgate.data.route}}][0], code: [{{node:code_node_ISgate.data.code}}][0], message: [{{node:code_node_ISgate.data.message}}][0],
    errorCode: [{{node:code_node_ISgate.data.errorCode}}][0], lineCount: [{{node:code_node_ISgate.data.lineCount}}][0], pickCount: [{{node:code_node_ISgate.data.pickCount}}][0],
    nonStockLines: [{{node:code_node_ISgate.data.nonStockLines}}][0], movementCount: [{{node:code_node_ISgate.data.movementCount}}][0],
    plantId: [{{node:code_node_ISgate.data.plantId}}][0], organizationId: [{{node:code_node_ISgate.data.organizationId}}][0],
    stockMovementNo: [{{node:code_node_ISgate.data.stockMovementNo}}][0], needBatch: [{{node:code_node_ISgate.data.needBatch}}][0] },
  [{{node:workflow_node_ISbatch.data}}][0]);
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message, add: res.isAdd, number: res.numberProps, batch: res.batchNo, lock: res.needLock }));
return res;
