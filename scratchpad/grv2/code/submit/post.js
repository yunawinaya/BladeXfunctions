// GR_COMPLETE_SUBMIT - Post: after the gates, the queue rows. Edit: the receipt's lock (gd_publish_step GRC|<gr> / LOCK|<n>,
// result_ref = the idempotency key; unique: a concurrent twin fails its run) and the COMPLETE_GR job; Add: the job only (the
// lock follows the receipt's insert). The job is QUEUED but not due for 2 minutes, so no worker takes it before the receipt
// is Processing under it; due.js makes it due after the read-back. A Created receipt's reservation per PO line
// (code_node_origReserved, from the STORED lines) travels in the request: the form's lines replace them at the write.
const submitPost = function submitPost(guard, entry, keys, gate, storedLines) {
  const stop = (code, message) => answer("STOP", code, message, { lockRows: [], jobRows: [], needLock: "NO", previousStatus: "" });
  if (s(gate.route) !== "GO") return stop(s(gate.code) || "400", s(gate.message) || "the gate did not answer");
  const add = guard.pageStatus === "Add";
  const previousStatus = add ? "Draft" : entry.grStatus;
  const origReserved = {};
  if (previousStatus === "Created") {
    for (const r of list(storedLines)) {
      const o = parseJ(r.j) || {};
      if (o.is_split === "Yes" && o.parent_or_child === "Parent") continue;
      if (!digits(o.po_line_item_id)) continue;
      origReserved[s(o.po_line_item_id)] = q8((origReserved[s(o.po_line_item_id)] || 0) + parseFloat(o.received_qty || 0));
    }
  }
  const request = { v: 1, source: "FORM", uid: guard.uid, previousStatus: previousStatus, mode: add ? "ADD" : "EDIT", answers: guard.answers, origReserved: origReserved,
    grId: add ? "" : guard.grId, grNo: add ? "" : entry.grNo };
  return answer("QUEUE", "200", "queued", {
    previousStatus: previousStatus,
    lockRows: add ? [] : [{ job_id: "GRC|" + guard.grId, organization_id: keys.organizationId, step_name: "LOCK|" + entry.lockN, step_status: "LOCK", attempt_count: 0,
      started_at: entry.dbNow, result_ref: guard.key }],
    needLock: add ? "NO" : "YES",
    jobRows: [{ organization_id: keys.organizationId, plant_id: keys.plantId, command: "COMPLETE_GR", idempotency_key: guard.key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: dbAddSeconds(entry.dbNow, 120),
      request_payload: JSON.stringify(request), causation_id: add ? "" : guard.grId, correlation_id: add ? "" : "GR|" + guard.grId, line_count: num(keys.lineCount), queued_at: entry.dbNow }],
  });
};
const res = submitPost([{{node:code_node_RSguard.data}}][0], [{{node:code_node_RSentry.data}}][0], [{{node:code_node_RSkeys.data}}][0], [{{node:code_node_RSgate.data}}][0],
  [{{node:sql_node_RSstored.data}}][0]);
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message, previous: res.previousStatus }));
return res;
