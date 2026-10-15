// PUTAWAY_ASYNC_SUBMIT - Post: the queue rows - the putaway's lock (gd_publish_step PWC|<to> / LOCK|<n>, result_ref = the
// idempotency key; unique: a concurrent twin fails its run), the COMPLETE_PUTAWAY job (QUEUED but not due for 2 minutes,
// so no worker takes it before the putaway is locked; due.js makes it due after the read-back) and is_processing 1
const submitPost = function submitPost(guard, entry, gate) {
  if (s(gate.route) !== "GO") return answer("STOP", s(gate.code) || "400", s(gate.message), { lockRows: [], jobRows: [], toRows: [] });
  const request = { v: 1, source: guard.request.source, uid: guard.uid, toId: guard.toId, toNo: entry.toNo, grId: entry.grId, confirmedBy: guard.confirmedBy,
    lines: guard.request.lines };
  return answer("QUEUE", "200", "queued", {
    lockRows: [{ job_id: "PWC|" + guard.toId, organization_id: entry.organizationId, step_name: "LOCK|" + entry.lockN, step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow,
      result_ref: guard.key }],
    jobRows: [{ organization_id: entry.organizationId, plant_id: entry.plantId, command: "COMPLETE_PUTAWAY", idempotency_key: guard.key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: dbAddSeconds(entry.dbNow, 120),
      request_payload: JSON.stringify(request), causation_id: guard.toId, correlation_id: "TO|" + guard.toId, line_count: num(gate.rowCount), queued_at: entry.dbNow }],
    toRows: [{ id: guard.toId, is_processing: 1 }],
  });
};
const res = submitPost([{{node:code_node_PSguard.data}}][0], [{{node:code_node_PSentry.data}}][0], [{{node:code_node_PSgate.data}}][0]);
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message }));
return res;
