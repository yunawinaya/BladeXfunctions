// GD_EDIT_SUBMIT - Post: CREDIT_LIMIT_CHECK's answer (402 block / 403 override unless the organisation overrides
// automatically), then the quantity 400s, as GOODS_DELIVERY returns them; else the queue rows: the GD's lock in the shared
// namespace (gd_publish_step GDC|<gd> / LOCK|<n>, unique: a concurrent submit fails its run), the EDIT_GD job (QUEUED but not
// due for 2 minutes, so no worker meets it before the GD is Processing; due.js makes it due), the GD Processing, its Picking
// locked (is_processing 1)
const submitPost = function submitPost(guard, entry, gate, cl) {
  const stop = (code, message) => answer("STOP", code, message, { lockRows: [], jobRows: [], gdRows: [], pickLockRows: [], needPickLock: "NO", idemKey: "" });
  let clNote = "";
  if (s(gate.needCL) === "required") {
    const r = cl || {};
    // if_XIiO9crD, code_node_60Bp11jY, if_cl_auto_override, code_cl_auto_note
    if (s(r.result) === "failed") {
      const message = r.message === undefined || r.message === null ? "" : String(r.message);
      if (message.indexOf("Block - ") !== -1) return stop("402", message);
      if (s(gate.clAutoOverride) !== "1") return stop("403", message);
      clNote = message.replace("Override - ", "");
    }
  }
  if (s(gate.qtyStop)) return stop("400", gate.qtyStop);
  const key = "GDE|" + entry.gdId + "|" + entry.lockN;
  // held for its caller: a Sales Order save (CASCADE) or a Picking force complete (PICKING_FC), released / cancelled by cascade_ref
  const held = guard.source === "CASCADE" || guard.source === "PICKING_FC";
  const request = { v: 1, gd_id: entry.gdId, gd_no: entry.gdNo, source: guard.source, stored_status: entry.storedStatus, submitted_by: guard.uid, answers: guard.answers,
    delta: gate.delta, picking_id: s(gate.pickingId), picking_version: "", hold: held ? 1 : 0, cascade_ref: held ? s(guard.cascadeRef) : "",
    causation_job_id: s(guard.causationJobId), fcd_ref: s(guard.fcdRef), notes: { pickingReversalNote: s(gate.pickingReversalNote), creditLimitNote: clNote } };
  return answer("QUEUE", "200", "queued", {
    idemKey: key, notes: request.notes,
    lockRows: [{ job_id: "GDC|" + entry.gdId, organization_id: entry.organizationId, step_name: "LOCK|" + entry.lockN, step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow, result_ref: key }],
    jobRows: [{ organization_id: entry.organizationId, plant_id: entry.plantId, command: "EDIT_GD", idempotency_key: key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: dbAddSeconds(entry.dbNow, 120), request_payload: JSON.stringify(request),
      causation_id: guard.source, correlation_id: "GD|" + entry.gdId, line_count: num(entry.lineCount), queued_at: entry.dbNow }],
    gdRows: [{ id: entry.gdId, gd_status: "Processing" }],
    pickLockRows: s(gate.pickingId) ? [{ id: s(gate.pickingId), is_processing: 1 }] : [], needPickLock: s(gate.pickingId) ? "YES" : "NO",
  });
};
