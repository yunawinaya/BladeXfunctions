// SA_V2_WORKER - After __WHICH__: SA_V2_COMMIT writes the job itself; the worker writes only when the call
// answered without writing and the job is still READY_TO_COMMIT under this run's lease (COMMIT claims the job before any
// write, so nothing was written: a hard code -> FAILED + the Stock Adjustment back to its status before the completion; no code -> counted retry)
//@include _common.js
const workerAfterPublish = function workerAfterPublish(guard, own, mid, resp, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) || mid.dbNow : mid.dbNow;
  const job = list.filter((r) => s(r.id))[0] || null;
  const r = resp || {};
  const base = { route: "END", dbNow: dbNow, jsAt: String(Date.now()), jobId: mid.jobId, jobStatus: job ? s(job.job_status) : "", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", publishRoute: s(r.path), result_code: s(r.result_code), result_message: s(r.result_message), job_status: job ? s(job.job_status) : "" };
  if (!job) return Object.assign(base, { result_code: "SA_INVALID_DATA", result_message: "job vanished during publish" });
  const status = s(job.job_status);
  if (!(status === "READY_TO_COMMIT" && s(job.lease_owner) === guard.leaseOwner)) return base;
  const row = { id: s(job.id), job_status: status, progress_percent: Number(job.progress_percent) || 0, progress_message: s(job.progress_message), attempt_count: Number(job.attempt_count) || 0, next_attempt_at: job.next_attempt_at || null, lease_owner: job.lease_owner || null, lease_expires_at: job.lease_expires_at || null, row_version: (Number(job.row_version) || 0) + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, finished_at: job.finished_at || null };
  const hard = PKC.hard.indexOf(s(r.result_code)) >= 0 ? s(r.result_code) : "";
  const n = Number(job.attempt_count) || 0;
  if (hard || n >= PKC.retry.max_retries) {
    const code = hard || "SA_TRANSIENT_RETRIES_EXHAUSTED";
    const why = hard ? "SA_V2_COMMIT answered " + hard + " (" + s(r.result_message) + ") without writing" : "SA_V2_COMMIT answered without writing " + n + " times (max_retries " + PKC.retry.max_retries + ")";
    const rel = saWorkerRelease(own.grId, own.prevStatus);
    const end = rel.result_code ? Object.assign({}, SA_REVIEW_PREV, { error_details: JSON.stringify({ step: "SA_V2_WORKER", why: why, prevStatus: own.prevStatus, attempts: n }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not completed: the completion could not be finished", error_code: code, error_message: hard ? s(r.result_message) || why : "Temporary failures persisted; not completed.", error_details: JSON.stringify({ step: "SA_V2_WORKER", why: why, attempts: n }) };
    return Object.assign(base, { jobRows: [Object.assign({}, row, end, { lease_owner: null, lease_expires_at: null, finished_at: endNow(base) })], needJobUpd: "YES", unlockRows: rel.unlockRows, needUnlock: rel.unlockRows.length ? "YES" : "NO", result_code: end.error_code, result_message: why, job_status: end.job_status });
  }
  const delayMs = Math.min(PKC.retry.max_delay_ms, PKC.retry.base_delay_ms * Math.pow(2, n));
  return Object.assign(base, { jobRows: [Object.assign({}, row, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(dbNow, Math.ceil(delayMs / 1000)), lease_owner: null, lease_expires_at: null })], needJobUpd: "YES", result_code: "SA_TRANSIENT", result_message: "SA_V2_COMMIT answered without writing (" + s(r.result_message) + "): retry " + (n + 1) + " of " + PKC.retry.max_retries + " after " + delayMs + " ms" });
};
const guard = [{{node:code_node_RWguard.data}}][0];
const own = [{{node:code_node_RWown.data}}][0];
const mid = [{{node:__MID__.data}}][0];
const res = workerAfterPublish(guard, own, mid, [{{node:__RESP__.data}}][0], [{{node:__BACK__.data}}][0]);
console.log("worker after __WHICH__", JSON.stringify({ route: res.route, status: res.jobStatus, publish: res.publishRoute, write: res.needJobUpd, result: res.result_code }));
return res;
