// PICKING_FC_DRIVE - Stamp (after the loop, from a fresh read): the answer and the job's one write, the lease released.
// WAIT (edits to kick, or the budget): due again at once. DONE (FC_GDS): due at once for the publish. ABORTED (FC_ABORT, nothing
// held or in flight): FAILED + the Picking unlocked. REVIEW (FC_REVIEW, nothing held or in flight): REQUIRES_REVIEW, the Picking
// stays locked (deliveries may be committed)
const driveFinal = function driveFinal(entry, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const D = driveState(entry, rows);
  const a = fcNext(D.st);
  const n = entry.manifest.length;
  const dbNow = D.dbNow || s(entry.dbNow);
  const base = { route: "WAIT", kick: [], progress_message: "", jobRows: [], needJob: "NO", unlockRows: [], needUnlock: "NO", result_code: "", result_message: "", job_status: D.jobStatus };
  if (D.jobStatus !== "READY_TO_COMMIT" && D.jobStatus !== "COMMITTING_PICKING") return Object.assign(base, { route: "NONE", result_message: "job is " + D.jobStatus });
  const row = (x) => [Object.assign({ id: entry.jobId, job_status: D.jobStatus, progress_percent: 0, progress_message: "", attempt_count: 0, next_attempt_at: dbNow, lease_owner: null,
    lease_expires_at: null, row_version: D.rowVersion + 1, error_code: null, error_message: null, error_details: null, finished_at: null }, x)];
  const ref = (name) => { const t = s(D.refs[name]); const k = t.indexOf("|"); return k > 0 ? [t.slice(0, k), t.slice(k + 1)] : ["PK_FC_FAILED", t || "the force complete stopped"]; };
  const deliveries = (k) => k + " deliver" + (k === 1 ? "y" : "ies");
  if (a.kind === "ABORTED") {
    const [code, why] = ref("FC_ABORT");
    const m = ("Not force completed: " + why).slice(0, 250);
    return Object.assign(base, { route: "ABORTED", progress_message: m, jobRows: row({ job_status: "FAILED", progress_message: m, next_attempt_at: null, error_code: code, error_message: why,
      error_details: JSON.stringify({ step: "PICKING_FC_DRIVE", operation: "FORCE_COMPLETE" }), finished_at: dbNow }), needJob: "YES",
      unlockRows: /^[0-9]{1,20}$/.test(s(entry.pickingId)) ? [{ id: s(entry.pickingId), is_processing: 0 }] : [], needUnlock: /^[0-9]{1,20}$/.test(s(entry.pickingId)) ? "YES" : "NO",
      result_code: code, result_message: why, job_status: "FAILED" });
  }
  if (a.kind === "REVIEW_DONE") {
    const [code, why] = ref("FC_REVIEW");
    const m = ("Under review: the force complete stopped after " + D.committed + " of " + deliveries(n) + " (" + why + ")").slice(0, 250);
    return Object.assign(base, { route: "REVIEW", progress_message: m, jobRows: row({ job_status: "REQUIRES_REVIEW", progress_message: m, next_attempt_at: null, error_code: code,
      error_message: why, error_details: JSON.stringify({ step: "PICKING_FC_DRIVE", committed: D.committed, deliveries: n }), finished_at: dbNow }), needJob: "YES",
      result_code: code, result_message: why, job_status: "REQUIRES_REVIEW" });
  }
  if (a.kind === "DONE") {
    const m = "Deliveries updated: saving the Picking";
    return Object.assign(base, { route: "DONE", progress_message: m, jobRows: row({ progress_percent: 80, progress_message: m }), needJob: "YES", result_message: m });
  }
  // WAIT, or the budget ended the call before the next action: the edits to kick (the screen runs GD_EDIT_WORKER on each)
  const kick = a.kind === "WAIT" ? (a.kick || []).map(s) : D.kickAll;
  const m = D.steps.FC_ABORT ? "Not force completed: releasing the deliveries"
    : D.steps.FC_REVIEW ? "Stopping for review: releasing the deliveries not yet updated"
    : D.jobStatus === "READY_TO_COMMIT" ? "Preparing the deliveries: " + D.held + " of " + n + " ready"
    : "Updating delivery " + Math.min(n, D.committed + 1) + " of " + n;
  const pct = D.jobStatus === "READY_TO_COMMIT" ? 60 + Math.floor((10 * D.held) / Math.max(1, n)) : 70 + Math.floor((10 * D.committed) / Math.max(1, n));
  return Object.assign(base, { route: "WAIT", kick: kick, progress_message: m, jobRows: row({ progress_percent: pct, progress_message: m }), needJob: "YES",
    result_message: a.kind === "WAIT" ? m : "budget: " + m });
};
const res = driveFinal([{{node:code_node_DRentry.data}}][0], [{{node:sql_node_DRend.data}}][0]);
console.log("drive stamp", JSON.stringify({ route: res.route, kick: res.kick, status: res.job_status, result: res.result_code, message: res.result_message }));
return res;
