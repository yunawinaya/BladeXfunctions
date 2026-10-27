// PICKING_ASYNC_SUBMIT - Decide: the Picking, its setup and its jobs -> CREATE the job (+ the Picking lock), RETURN the job
// this key already made, NOT_ELIGIBLE (the form runs the old save instead) or REJECT (a message, nothing written).
// Stage switches: a case whose stage is off goes back to the old save. 1c (LOADING_BAY, BIN_MOVES): sql_node_PSmove's rows.
const ASYNC_PICKING_ENABLED = true;
const STAGE = { FULL_PICKING: true, LOADING_BAY: true, BIN_MOVES: true, AUTO_COMPLETE_GD: true, PICKING_PLAN: false };
const LOCK_STALE_SEC = 900;
const MAX_MOVED_GDS = 25;
const MAX_MOVED_LINES = 500;
const submitDecide = function submitDecide(guard, rows, moveRows) {
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
  // a Goods Delivery this Picking names is being saved in the background (GD Edit V2 / GD Completed V2)
  if (s(f.gd_busy)) return reject("Goods Delivery " + s(f.gd_busy) + " is being saved in the background. Wait a moment, then try again.");
  if (status === "Draft") return old("a Draft Picking is completed by the classic save");
  const openJob = s(f.open_job).split("|");
  if (openJob[0]) {
    if (openJob[1] === "REQUIRES_REVIEW") return reject("A previous confirmation of this Picking stopped half-way and is under review (job " + openJob[0] + "). Please contact support before picking again.");
    return reject("This Picking is still being confirmed in the background (job " + openJob[0] + "). Wait a moment, then reopen it.");
  }
  if (n(f.is_processing) === 1 && n(f.lock_age_sec) <= LOCK_STALE_SEC) return reject("Picking is under processing. Please try again later.");
  if (s(f.picking_after) === "Sales Order" && !STAGE.PICKING_PLAN) return old("Picking Plan pickings use the classic save");
  if (n(f.allow_full_picking) === 1 && !STAGE.FULL_PICKING) return old("Full Picking uses the classic save");
  // Loading Bay is the setup's flag, as classic PICKING passes it (the Picking's own copy counts only while the stage is off)
  const bay = n(f.setup_loading_bay) === 1;
  if (!STAGE.LOADING_BAY && (bay || n(f.is_loading_bay) === 1)) return old("Loading Bay uses the classic save");
  if (bay && n(f.auto_completed_gd) === 1) return reject("Picking Setup has both Loading Bay and Auto Complete GD enabled. Auto Complete GD skips the Created state that the loading bay move depends on, which would strand the reserved stock at the source bin. Please turn off Auto Complete GD.");
  // Auto Complete GD (stage 1e): COMMIT P7 hands each fully picked delivery to GD Complete V2 and the desktop screen starts it.
  // The phone does not start it yet, so a phone confirm (PKC: / PKF: keys) stays classic until the app update
  const phone = /^PK[CF]:/.test(s(guard.idempotencyKey));
  if (n(f.auto_completed_gd) === 1 && (!STAGE.AUTO_COMPLETE_GD || phone))
    return old(STAGE.AUTO_COMPLETE_GD ? "Auto Complete GD on the phone uses the classic save until the app update" : "Auto Complete GD uses the classic save");
  const mv = (Array.isArray(moveRows) ? moveRows : moveRows ? [moveRows] : []).filter((r) => r);
  const R = mv.filter((r) => s(r.kind) === "R");
  const GDS = mv.filter((r) => s(r.kind) === "G");
  if (bay) {
    const missing = R.filter((r) => n(r.bay_bad) === 1).map((r) => s(r.label)).filter((x, i, a) => x && a.indexOf(x) === i);
    if (missing.length) return reject("Loading Bay is enabled but Target Location is missing (or the same as the source bin) on these picked items: " + missing.join(", ") + ". Set a loading bay bin on every picked line before completing.");
  }
  const moved = R.filter((r) => n(r.moved) === 1);
  if (moved.length) {
    if (!bay && !STAGE.BIN_MOVES) return old(moved.length + " line(s) move stock to another bin or batch: the classic save");
    if (n(f.allow_full_picking) === 1) return old("Full Picking with a bin / batch move uses the classic save");
    if (moved.some((r) => s(r.hu))) return old("a moved line is in a handling unit: the classic save");
    for (const g of GDS) {
      if (n(g.serial_items) > 0) return old("Goods Delivery " + s(g.delivery_no) + " has serial-numbered items: the classic save");
      if (n(g.select_picking) === 1) return old("Goods Delivery " + s(g.delivery_no) + " uses select picking: the classic save");
      if (n(g.linked) > 0) return old("Goods Delivery " + s(g.delivery_no) + " is linked to internal trading: the classic save");
    }
    if (GDS.length > MAX_MOVED_GDS) return reject("This confirmation moves stock on " + GDS.length + " deliveries; at most " + MAX_MOVED_GDS + " can be saved together. Confirm it in smaller Pickings.");
    const lines = GDS.reduce((k, g) => k + n(g.line_count), 0);
    if (lines > MAX_MOVED_LINES) return reject("Moving picked stock to another bin or batch is not available yet above " + MAX_MOVED_LINES + " delivery lines in one confirmation (these deliveries have " + lines + "). Nothing was saved.");
    const busy = GDS.find((g) => n(g.other_job) > 0);
    if (busy) return reject("Goods Delivery " + s(busy.delivery_no) + " is being confirmed on another Picking in the background. Wait a moment, then try again.");
  }
  const dbNow = s(f.db_now);
  // PREPARE moves stock only on a job these switches cleared (a stored target can appear after SUBMIT)
  let request = guard.request;
  try { request = JSON.stringify(Object.assign(JSON.parse(guard.request), { moves: (bay ? STAGE.LOADING_BAY : STAGE.BIN_MOVES) ? 1 : 0 })); } catch (e) { request = guard.request; }
  return Object.assign({}, base, {
    route: "CREATE",
    jobRows: [{ organization_id: guard.organizationId, plant_id: s(f.plant_id), command: "CONFIRM_PICKING", idempotency_key: guard.idempotencyKey, job_status: "QUEUED", progress_percent: 0, progress_message: "Queued for processing", attempt_count: 0, row_version: 0, cancel_requested: 0, request_payload: request, picking_id: guard.pickingId, picking_no: s(f.to_id), line_count: guard.lineCount, queued_at: dbNow }],
    needJob: "YES", lockRows: [{ id: guard.pickingId, is_processing: 1 }], needLock: "YES", result_code: "200", result_message: "queued", job_status: "QUEUED",
  });
};
const guard = [{{node:code_node_PSguard.data}}][0];
const res = submitDecide(guard, [{{node:sql_node_PSfacts.data}}][0], [{{node:sql_node_PSmove.data}}][0]);
console.log("submit decide", JSON.stringify({ route: res.route, code: res.result_code, message: res.result_message, job: res.job_id }));
return res;