// GD_COMPLETE_SUBMIT - Post: CREDIT_LIMIT_CHECK's answer (402 block / 403 override unless auto), then 405 / 406 / 407, the
// quantity 400s and 412, as GOODS_DELIVERY returns them; else the queue rows: the GD's lock (gd_publish_step GDC|<gd> /
// LOCK|<n>, unique: a concurrent twin fails its run), the COMPLETE_GD job (QUEUED but not due for 2 minutes, so no worker
// takes it before the GD is Processing; due.js makes it due right after), the GD Processing
const submitPost = function submitPost(guard, entry, gate, cl) {
  const p = gate.post || {};
  const stop = (code, message) => answer("STOP", code, message, { lockRows: [], jobRows: [], gdRows: [], idemKey: "" });
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
  // if_uFjpcRq_, if_DOQqD6Aa, if_DDiEWnn5 (force complete never gets here: entry.js), if_eVsLIYSh
  if (num(p.pickingRequired) === 1 && num(p.skipPicking) === 0) {
    if (!s(p.fillPickingStatus) || s(p.fillPickingStatus) === "Not Created") return stop("405", "Save Goods Delivery as Created or create Picking manually to start picking process.");
    if (s(p.rollupPickingStatus) !== "Completed") return stop("406", "Picking is not being completed yet. \nProceeding will force complete picking process.\n\nWould you like to proceed?");
  }
  if (num(p.packingSetups) > 0 && s(p.packingStatus) !== "Completed" && num(p.skipPicking) === 0) return stop("407", "Packing process must be completed first.");
  // if_9DC5Lah8, if_SoLineGone, if_I5UTovzN, if_si_gate
  if (num(p.itemNotFound) === 1) return stop("400", "Material not found or has been deleted");
  if (num(p.soLineMissing) === 1) return stop("400", s(p.soLineMissingMessage));
  if (s(p.validationMessage)) return stop("400", p.validationMessage);
  if (num(p.siConfirm) === 412) return stop("412", s(p.siMsg));
  const key = "GDC|" + entry.gdId + "|" + entry.lockN;
  const request = { v: 1, gd_id: entry.gdId, gd_no: entry.gdNo, source: guard.source, submitted_by: guard.uid, answers: guard.answers, header: {},
    line_overrides: gate.overrides || {}, cl_note: clNote };
  return answer("QUEUE", "200", "queued", {
    idemKey: key,
    lockRows: [{ job_id: "GDC|" + entry.gdId, organization_id: entry.organizationId, step_name: "LOCK|" + entry.lockN, step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow, result_ref: key }],
    jobRows: [{ organization_id: entry.organizationId, plant_id: entry.plantId, command: "COMPLETE_GD", idempotency_key: key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: dbAddSeconds(entry.dbNow, 120), request_payload: JSON.stringify(request),
      causation_id: guard.causationId || guard.source, correlation_id: "GD|" + entry.gdId, line_count: num(entry.lineCount), queued_at: entry.dbNow }],
    gdRows: [{ id: entry.gdId, gd_status: "Processing" }],
  });
};
const res = submitPost([{{node:code_node_GSguard.data}}][0], [{{node:code_node_GSentry.data}}][0], [{{node:code_node_GSgate.data}}][0], [{{node:workflow_node_GScl.data}}][0]);
console.log("submit post", JSON.stringify({ route: res.route, code: res.code, message: res.message, key: res.idemKey }));
return res;
