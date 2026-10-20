// PICKING_ASYNC_WORKER - After the drive (Picking 1d): PICKING_FC_DRIVE stamps the job itself. Every delivery updated (FC_GDS,
// COMMITTING_PICKING, no live lease) -> the publish in this tick; the worker writes only when the drive answered without writing
// and the job is still READY_TO_COMMIT under this run's lease (a hard code -> FAILED + the Picking lock released; else a counted retry)
const PKC = {
  retry: { max_retries: 3, base_delay_ms: 2000, max_delay_ms: 30000 },
  worker_budget_seconds: 20,
  states: ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PICKING"],
  hard: ["PK_INVALID_REQUEST", "PK_INVALID_DATA", "PK_NOT_FOUND", "PK_STATUS", "PK_NOT_SUPPORTED", "PK_LINE_NOT_FOUND", "PK_GD_CLOSED", "PK_NOTHING_PICKED", "PK_NOTHING_LEFT", "PK_BUNDLE_SHORT", "PK_STALE", "JOB_ILLEGAL_TRANSITION",
    "PK_FC_NOT_IN_PROGRESS", "PK_FC_NO_RECORDS", "PK_FC_SHARED_LINE", "PK_FC_UOM", "PK_FC_OVERPICK", "PK_FC_GD_UNPICKED", "PK_FC_SETUP_CHANGED", "PK_FC_STALE", "PK_FC_GD_CHANGED", "PK_FC_GD_NOT_ELIGIBLE", "PK_FC_GD_REFUSED", "PK_FC_GD_FAILED", "PK_FC_FAILED"],
};
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const workerAfterDrive = function workerAfterDrive(guard, own, mid, resp, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) || mid.dbNow : mid.dbNow;
  const job = list.filter((r) => s(r.id))[0] || null;
  const r = resp || {};
  const base = { route: "END", dbNow: dbNow, jobId: mid.jobId, jobStatus: job ? s(job.job_status) : "", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", driveRoute: s(r.route), kick: s(r.kick), result_code: s(r.result_code), result_message: s(r.result_message), job_status: job ? s(job.job_status) : "" };
  if (!job) return Object.assign(base, { result_code: "PK_INVALID_DATA", result_message: "job vanished during the drive" });
  const status = s(job.job_status);
  if (status === "COMMITTING_PICKING" && Number(job.fc_gds) > 0 && String(job.lease_live) !== "1") return Object.assign(base, { route: "PUBLISH", result_message: "every delivery is updated: PICKING_BULK_COMMIT in this tick" });
  if (!(status === "READY_TO_COMMIT" && s(job.lease_owner) === guard.leaseOwner)) return base;
  const row = { id: s(job.id), job_status: status, progress_percent: Number(job.progress_percent) || 0, progress_message: s(job.progress_message), attempt_count: Number(job.attempt_count) || 0, next_attempt_at: job.next_attempt_at || null, lease_owner: job.lease_owner || null, lease_expires_at: job.lease_expires_at || null, row_version: (Number(job.row_version) || 0) + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, finished_at: job.finished_at || null };
  const hard = PKC.hard.indexOf(s(r.result_code)) >= 0 ? s(r.result_code) : "";
  const n = Number(job.attempt_count) || 0;
  if (hard || n >= PKC.retry.max_retries) {
    const code = hard || "PK_TRANSIENT_RETRIES_EXHAUSTED";
    const why = hard ? "PICKING_FC_DRIVE answered " + hard + " (" + s(r.result_message) + ") without saving" : "PICKING_FC_DRIVE answered without saving " + n + " times (max_retries " + PKC.retry.max_retries + ")";
    const unlock = /^[0-9]{1,20}$/.test(s(own.pickingId)) ? [{ id: s(own.pickingId), is_processing: 0 }] : [];
    return Object.assign(base, { jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_message: "Not force completed: it could not be started", error_code: code, error_message: why, error_details: JSON.stringify({ step: "PICKING_ASYNC_WORKER", why: why, attempts: n }), lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });
  }
  const delayMs = Math.min(PKC.retry.max_delay_ms, PKC.retry.base_delay_ms * Math.pow(2, n));
  return Object.assign(base, { jobRows: [Object.assign({}, row, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(dbNow, Math.ceil(delayMs / 1000)), lease_owner: null, lease_expires_at: null })], needJobUpd: "YES", result_code: "PK_TRANSIENT", result_message: "PICKING_FC_DRIVE answered without saving (" + s(r.result_message) + "): retry " + (n + 1) + " of " + PKC.retry.max_retries + " after " + delayMs + " ms" });
};
const guard = [{{node:code_node_PWguard.data}}][0];
const own = [{{node:code_node_PWown.data}}][0];
const mid = [{{node:code_node_PWmid.data}}][0];
const res = workerAfterDrive(guard, own, mid, [{{node:code_node_PWdriveResp.data}}][0], [{{node:sql_node_PWdriveBack.data}}][0]);
console.log("worker after drive", JSON.stringify({ route: res.route, status: res.jobStatus, drive: res.driveRoute, write: res.needJobUpd, result: res.result_code }));
return res;
