// PICKING_ASYNC_SUBMIT - Decide: the Picking, its setup and its jobs -> CREATE the job (+ the Picking lock), RETURN the job
// this key already made, NOT_ELIGIBLE (the form runs the old save instead) or REJECT (a message, nothing written).
// Stage switches: a case whose stage is off goes back to the old save.
const ASYNC_PICKING_ENABLED = true;
const STAGE = { FULL_PICKING: true, LOADING_BAY: false, BIN_MOVES: false, AUTO_COMPLETE_GD: false, PICKING_PLAN: false };
const LOCK_STALE_SEC = 900;
const submitDecide = function submitDecide(guard, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const n = (v) => Number(v) || 0;
  const f = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r)[0] || {};
  const base = { route: "REJECT", jobRows: [], needJob: "NO", lockRows: [], needLock: "NO", result_code: "400", result_message: "", job_id: "", job_status: "" };
  const reject = (why) => Object.assign({}, base, { result_message: why });
  const old = (why) => Object.assign({}, base, { route: "NOT_ELIGIBLE", result_code: "NOT_ELIGIBLE", result_message: why });
  const keyJob = s(f.key_job).split("|");
  if (keyJob[0]) return Object.assign({}, base, { route: "RETURN", result_code: "200", result_message: "already submitted", job_id: keyJob[0], job_status: keyJob[1] || "" });
  if (!ASYNC_PICKING_ENABLED) return old("the background save is switched off");
  if (!s(f.id) || String(f.is_deleted) === "1") return reject("Picking not found");
  if (s(f.organization_id) !== guard.organizationId) return reject("the Picking belongs to another organization");
  const status = s(f.to_status);
  if (status === "Completed") return reject("Picking is already completed");
  if (status === "Cancelled") return reject("Picking is cancelled. Unable to process picking.");
  if (status === "Draft") return old("a Draft Picking is completed by the classic save");
  const openJob = s(f.open_job).split("|");
  if (openJob[0]) {
    if (openJob[1] === "REQUIRES_REVIEW") return reject("A previous confirmation of this Picking stopped half-way and is under review (job " + openJob[0] + "). Please contact support before picking again.");
    return reject("This Picking is still being confirmed in the background (job " + openJob[0] + "). Wait a moment, then reopen it.");
  }
  if (n(f.is_processing) === 1 && n(f.lock_age_sec) <= LOCK_STALE_SEC) return reject("Picking is under processing. Please try again later.");
  if (s(f.picking_after) === "Sales Order" && !STAGE.PICKING_PLAN) return old("Picking Plan pickings use the classic save");
  if (n(f.allow_full_picking) === 1 && !STAGE.FULL_PICKING) return old("Full Picking uses the classic save");
  if ((n(f.setup_loading_bay) === 1 || n(f.is_loading_bay) === 1) && !STAGE.LOADING_BAY) return old("Loading Bay uses the classic save");
  if (n(f.auto_completed_gd) === 1 && !STAGE.AUTO_COMPLETE_GD) return old("Auto Complete GD uses the classic save");
  if (guard.operation === "PICK_ALL_REMAINING" && n(f.moved_rows) > 0 && !STAGE.BIN_MOVES) return old(n(f.moved_rows) + " line(s) move stock to another bin or batch: the classic save");
  const dbNow = s(f.db_now);
  return Object.assign({}, base, {
    route: "CREATE",
    jobRows: [{ organization_id: guard.organizationId, plant_id: s(f.plant_id), command: "CONFIRM_PICKING", idempotency_key: guard.idempotencyKey, job_status: "QUEUED", progress_percent: 0, progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, request_payload: guard.request, picking_id: guard.pickingId, picking_no: s(f.to_id), line_count: guard.lineCount, queued_at: dbNow }],
    needJob: "YES", lockRows: [{ id: guard.pickingId, is_processing: 1 }], needLock: "YES", result_code: "200", result_message: "queued", job_status: "QUEUED",
  });
};
const guard = [{{node:code_node_PSguard.data}}][0];
const res = submitDecide(guard, [{{node:sql_node_PSfacts.data}}][0]);
console.log("submit decide", JSON.stringify({ route: res.route, code: res.result_code, message: res.result_message, job: res.job_id }));
return res;
