// IA_REVERT_V2_SUBMIT - Post: the IA's lock row LOCK|<n+1> first (a concurrent twin fails), then the job, due in 2 min
const submitPost = function submitPost(guard, entry, gate) {
  const empty = { lockRows: [], jobRows: [] };
  if (s(gate.route) !== "GO") return answer("STOP", s(gate.code) || "400", s(gate.message) || "the gate did not answer", Object.assign(empty, { errorCode: s(gate.errorCode) }));
  const request = { v: 1, action: "REVERT", prevStatus: s(gate.prevStatus), iaId: guard.iaId, iaNo: s(entry.iaNo), organizationId: s(entry.organizationId), plantId: s(entry.plantId),
    liveRows: num(gate.liveRows), liveOut: num(gate.liveOut), liveIn: num(gate.liveIn), movesFingerprint: s(gate.movesFingerprint), uid: guard.uid, source: guard.source, nonce: guard.nonce,
    parts: {} };
  return answer("QUEUE", "200", "queued", {
    lockRows: [{ job_id: iaLockJob(guard.iaId), organization_id: request.organizationId, step_name: "LOCK|" + num(entry.lockN), step_status: "LOCK", attempt_count: 0,
      started_at: entry.dbNow, finished_at: null, inventory_operation_id: "", result_ref: guard.key, error_code: null, error_message: null }],
    jobRows: [{ organization_id: request.organizationId, plant_id: request.plantId, command: "REVERT_IA", idempotency_key: guard.key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: iaDbAddSeconds(entry.dbNow, 120),
      request_payload: JSON.stringify(request), causation_id: guard.iaId, correlation_id: iaCorrelation(guard.iaId), line_count: request.liveRows, queued_at: entry.dbNow }],
  });
};
const res = submitPost([{{node:code_node_IVSguard.data}}][0], [{{node:code_node_IVSentry.data}}][0], [{{node:code_node_IVSgate.data}}][0]);
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message }));
return res;
