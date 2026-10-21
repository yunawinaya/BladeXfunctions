// GD_REVERT_SUBMIT - Post: the queue rows: the GD's lock (gd_publish_step GDC|<gd> / LOCK|<n>, unique: a concurrent twin fails
// its run; the same lock GD Completed V2 and every GD writer honour), the REVERT_GD job (QUEUED but not due for 2 minutes, so no
// worker takes it before the GD is Processing; due.js makes it due after the re-check), the GD Processing
const revertPost = function revertPost(guard, entry) {
  const key = "GDC|" + entry.gdId + "|" + entry.lockN;
  const request = { v: 1, gd_id: entry.gdId, gd_no: entry.gdNo, source: guard.source, submitted_by: guard.uid };
  return answer("QUEUE", "200", "queued", {
    idemKey: key,
    lockRows: [{ job_id: "GDC|" + entry.gdId, organization_id: entry.organizationId, step_name: "LOCK|" + entry.lockN, step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow, result_ref: key }],
    jobRows: [{ organization_id: entry.organizationId, plant_id: entry.plantId, command: "REVERT_GD", idempotency_key: key, job_status: "QUEUED", progress_percent: 0,
      progress_message: "Queued for reverting", attempt_count: 0, row_version: 0, cancel_requested: 0, next_attempt_at: dbAddSeconds(entry.dbNow, 120),
      request_payload: JSON.stringify(request), causation_id: guard.source, correlation_id: "GD|" + entry.gdId, line_count: num(entry.lineCount), queued_at: entry.dbNow }],
    gdRows: [{ id: entry.gdId, gd_status: "Processing" }],
  });
};
// after the queue rows: a Packing V2 completion or a Picking V2 confirm that slipped in between the facts and the Processing
// write (their SUBMITs passed on a Completed GD) wins - the GD goes back to Completed and this job is CANCELLED, nothing else was
// written (bladexfunctions-79's ordering: Processing first, then the check). Else the job is due now.
const revertDue = function revertDue(entry, post, back) {
  const b = list(back)[0] || {};
  const mine = s(b.job_id) && s(b.gd_status) === "Processing" && s(b.lock_ref) === s(post.idemKey) && s(b.job_status) === "QUEUED";
  const racers = num(b.racers);
  if (mine && racers > 0) {
    return { route: "RACE", dueRows: [], needDue: "NO", undoJobRows: [{ id: s(b.job_id), job_status: "CANCELLED", progress_message: "Not reverted: a Packing or Picking of it started first",
      error_code: "GDR_BUSY", error_message: "a Packing completion or Picking confirmation of the delivery started just before the revert", finished_at: entry.dbNow }], needUndo: "YES",
      unlockRows: [{ id: entry.gdId, gd_status: "Completed" }] };
  }
  return { route: mine ? "DUE" : "LOST", dueRows: mine ? [{ id: s(b.job_id), next_attempt_at: entry.dbNow }] : [], needDue: mine ? "YES" : "NO", undoJobRows: [], needUndo: "NO", unlockRows: [] };
};
