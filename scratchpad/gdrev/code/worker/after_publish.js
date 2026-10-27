// GD_REVERT_WORKER - After __WHICH__: GD_REVERT_COMMIT writes the job itself; the worker writes only when the call
// answered without writing and the job is still READY_TO_COMMIT under this run's lease (COMMIT claims the job before any
// write, so nothing was saved: a hard code -> FAILED + the Goods Delivery back to Completed; no code -> counted retry)
//@include _common.js
const workerAfterPublish = function workerAfterPublish(guard, own, mid, resp, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) || mid.dbNow : mid.dbNow;
  const job = list.filter((r) => s(r.id))[0] || null;
  const r = resp || {};
  const base = { route: "END", dbNow: dbNow, jobId: mid.jobId, jobStatus: job ? s(job.job_status) : "", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", publishRoute: s(r.path), result_code: s(r.result_code), result_message: s(r.result_message), job_status: job ? s(job.job_status) : "" };
  if (!job) return Object.assign(base, { result_code: "GDR_INVALID_DATA", result_message: "job vanished during publish" });
  const status = s(job.job_status);
  if (!(status === "READY_TO_COMMIT" && s(job.lease_owner) === guard.leaseOwner)) return base;
  const row = { id: s(job.id), job_status: status, progress_percent: Number(job.progress_percent) || 0, progress_message: s(job.progress_message), attempt_count: Number(job.attempt_count) || 0, next_attempt_at: job.next_attempt_at || null, lease_owner: job.lease_owner || null, lease_expires_at: job.lease_expires_at || null, row_version: (Number(job.row_version) || 0) + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, finished_at: job.finished_at || null };
  const hard = PKC.hard.indexOf(s(r.result_code)) >= 0 ? s(r.result_code) : "";
  const n = Number(job.attempt_count) || 0;
  if (hard || n >= PKC.retry.max_retries) {
    const code = hard || "GDR_TRANSIENT_RETRIES_EXHAUSTED";
    const why = hard ? "GD_REVERT_COMMIT answered " + hard + " (" + s(r.result_message) + ") without saving" : "GD_REVERT_COMMIT answered without saving " + n + " times (max_retries " + PKC.retry.max_retries + ")";
    const unlock = /^[0-9]{1,20}$/.test(s(own.gdId)) ? [{ id: s(own.gdId), gd_status: "Completed" }] : [];
    return Object.assign(base, { jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_message: "Not reverted: the revert could not be saved", error_code: code, error_message: why, error_details: JSON.stringify({ step: "GD_REVERT_WORKER", why: why, attempts: n }), lease_owner: null, lease_expires_at: null, finished_at: dbNow })], needJobUpd: "YES", unlockRows: unlock, needUnlock: unlock.length ? "YES" : "NO", result_code: code, result_message: why, job_status: "FAILED" });
  }
  const delayMs = Math.min(PKC.retry.max_delay_ms, PKC.retry.base_delay_ms * Math.pow(2, n));
  return Object.assign(base, { jobRows: [Object.assign({}, row, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(dbNow, Math.ceil(delayMs / 1000)), lease_owner: null, lease_expires_at: null })], needJobUpd: "YES", result_code: "GDR_TRANSIENT", result_message: "GD_REVERT_COMMIT answered without saving (" + s(r.result_message) + "): retry " + (n + 1) + " of " + PKC.retry.max_retries + " after " + delayMs + " ms" });
};
const guard = [{{node:code_node_RWguard4.data}}][0];
const own = [{{node:code_node_RWown.data}}][0];
const mid = [{{node:__MID__.data}}][0];
const res = workerAfterPublish(guard, own, mid, [{{node:__RESP__.data}}][0], [{{node:__BACK__.data}}][0]);
console.log("worker after __WHICH__", JSON.stringify({ route: res.route, status: res.jobStatus, publish: res.publishRoute, write: res.needJobUpd, result: res.result_code }));
return res;
