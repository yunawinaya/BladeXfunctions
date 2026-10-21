// IA_REVERT_V2_WORKER - After prepare: the job row decides - READY_TO_COMMIT -> publish; FAILED -> lease released (PREPARE
// put the Item Assembly back to its status before the revert); a job PREPARE left VALIDATING -> a hard code fails it (+ the lock released), else a counted retry
//@include _common.js
const workerAfterPrepare = function workerAfterPrepare(guard, own, resp, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) || own.dbNow : own.dbNow;
  const job = list.filter((r) => s(r.id))[0] || null;
  const r = resp || {};
  const base = { route: "END", dbNow: dbNow, jsAt: String(Date.now()), jobId: own.jobId, jobStatus: job ? s(job.job_status) : "", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", prepareResult: s(r.result_code), prepareMessage: s(r.result_message), result_code: "", result_message: "", job_status: job ? s(job.job_status) : "" };
  if (!job) return Object.assign(base, { result_code: "IA_RV_INVALID_DATA", result_message: "job vanished during prepare" });
  const status = s(job.job_status);
  const ours = s(job.lease_owner) === guard.leaseOwner;
  const row = { id: s(job.id), job_status: status, progress_percent: Number(job.progress_percent) || 0, progress_message: s(job.progress_message), attempt_count: Number(job.attempt_count) || 0, next_attempt_at: job.next_attempt_at || null, lease_owner: job.lease_owner || null, lease_expires_at: job.lease_expires_at || null, row_version: (Number(job.row_version) || 0) + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, finished_at: job.finished_at || null };
  if (status === "READY_TO_COMMIT") return Object.assign(base, { route: "PUBLISH", result_message: "prepared: " + s(r.result_message) });
  if (!ours) return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "job is " + status + " with lease owner " + s(job.lease_owner) + " after prepare: nothing written" });
  if (status === "FAILED" || status === "CANCELLED") return Object.assign(base, { jobRows: [Object.assign({}, row, { lease_owner: null, lease_expires_at: null })], needJobUpd: "YES", result_code: s(job.error_code), result_message: status + ": " + (s(job.error_message) || s(r.result_message)) });
  const hard = PKC.hard.indexOf(s(r.result_code)) >= 0 ? s(r.result_code) : "";
  const n = Number(job.attempt_count) || 0;
  if (hard || n >= PKC.retry.max_retries) {
    const code = hard || "IA_RV_TRANSIENT_RETRIES_EXHAUSTED";
    const why = hard ? "IA_REVERT_V2_PREPARE answered " + hard + " (" + s(r.result_message) + ") and left the job " + status : "IA_REVERT_V2_PREPARE left the job " + status + " " + n + " times (max_retries " + PKC.retry.max_retries + ")";
    const rel = iarvWorkerRelease(own.grId, own.prevStatus);
    const end = rel.result_code ? Object.assign({}, IARV_REVIEW_PREV, { error_details: JSON.stringify({ step: "IA_REVERT_V2_WORKER", why: why, prevStatus: own.prevStatus, attempts: n }) })
      : { job_status: "FAILED", progress_percent: 0, progress_message: "Not reverted: " + (s(r.result_message) || "the revert could not be prepared").slice(0, 200), error_code: code, error_message: hard ? s(r.result_message) || why : IA_TEXT.rvNotReverted, error_details: JSON.stringify({ step: "IA_REVERT_V2_WORKER", why: why, attempts: n }) };
    return Object.assign(base, { jobRows: [Object.assign({}, row, end, { lease_owner: null, lease_expires_at: null, finished_at: endNow(base) })], needJobUpd: "YES", unlockRows: rel.unlockRows, needUnlock: rel.unlockRows.length ? "YES" : "NO", result_code: end.error_code, result_message: why, job_status: end.job_status });
  }
  const delayMs = Math.min(PKC.retry.max_delay_ms, PKC.retry.base_delay_ms * Math.pow(2, n));
  return Object.assign(base, { jobRows: [Object.assign({}, row, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(dbNow, Math.ceil(delayMs / 1000)), lease_owner: null, lease_expires_at: null })], needJobUpd: "YES", result_code: "IA_RV_TRANSIENT", result_message: "IA_REVERT_V2_PREPARE left the job " + status + " without a code: retry " + (n + 1) + " of " + PKC.retry.max_retries + " after " + delayMs + " ms" });
};
const guard = [{{node:code_node_RWguard.data}}][0];
const own = [{{node:code_node_RWown.data}}][0];
const res = workerAfterPrepare(guard, own, [{{node:code_node_RWprepResp.data}}][0], [{{node:sql_node_RWprepBack.data}}][0]);
console.log("worker after prepare", JSON.stringify({ route: res.route, status: res.jobStatus, prepare: res.prepareResult, write: res.needJobUpd, unlock: res.needUnlock, result: res.result_code }));
return res;
