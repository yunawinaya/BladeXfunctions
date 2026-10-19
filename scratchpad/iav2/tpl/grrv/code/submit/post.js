// GR_REVERT_SUBMIT - Post: the queue rows - the receipt's lock (gd_publish_step GRC|<gr> / LOCK|<n>, result_ref = the
// idempotency key; unique: a concurrent twin fails its run) and the REVERT_GR job (QUEUED but not due for 2 minutes, so no
// worker takes it before the receipt is Processing under it; due.js makes it due after the read-back)
const submitPost = function submitPost(guard, entry, gate) {
  if (s(gate.route) !== "GO") return answer("STOP", s(gate.code) || "400", s(gate.message) || "the gate did not answer", { lockRows: [], jobRows: [] });
  const request = { v: 1, source: guard.source, uid: guard.uid, previousStatus: entry.grStatus, grId: guard.grId, grNo: entry.grNo };
  return answer("QUEUE", "200", "queued", {
    lockRows: [{ job_id: "GRC|" + guard.grId, organization_id: entry.organizationId, step_name: "LOCK|" + entry.lockN, step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow,
      result_ref: guard.key }],
    jobRows: [{ organization_id: entry.organizationId, plant_id: entry.plantId, command: "REVERT_GR", idempotency_key: guard.key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: dbAddSeconds(entry.dbNow, 120),
      request_payload: JSON.stringify(request), causation_id: guard.grId, correlation_id: "GR|" + guard.grId, line_count: num(gate.lineCount) || entry.lineCount, queued_at: entry.dbNow }],
  });
};
const res = submitPost([{{node:code_node_VSguard.data}}][0], [{{node:code_node_VSentry.data}}][0], [{{node:code_node_VSgate.data}}][0]);
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message }));
return res;
