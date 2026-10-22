// GD_EDIT_WORKER - Claim: after the claim row is ours - the lease WRK|<nonce> (QUEUED -> VALIDATING), a dead lease or dead
// claim counted as a retry; exhausted after max_retries (pre-commit -> FAILED, the GD back to its stored status and our
// Picking lock released; COMMITTING_GD -> REQUIRES_REVIEW). An expired hold (a cascade's HELD job its SO save never
// released) -> CANCELLED with the same unlocks: nothing was written for it.
//@include _common.js
const workerClaim = function workerClaim(guard, pick) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const item = pick.item;
  const base = { route: "SKIP", dbNow: pick.dbNow, jobId: pick.jobId, jobStatus: item ? item.jobStatus : "", organizationId: pick.organizationId, gdId: pick.gdId, rowVersion: pick.rvBase, attempts: item ? item.attempts : 0, claimRows: [], needClaim: "NO", failRows: [], unlockRows: [], pickUnlockRows: [], exhausted: "NO", result_code: "", result_message: pick.result_message, job_status: item ? item.jobStatus : "" };
  if (pick.route !== "CLAIM" || !item) return base;
  const status = item.jobStatus;
  const dead = item.deadLease === "YES" || item.deadClaim === "YES";
  const attempts = item.attempts;
  const rv = pick.rvBase;
  const exhausted = dead && attempts >= PKC.retry.max_retries;
  const counted = dead && !exhausted ? attempts + 1 : attempts;
  const unlock = /^[0-9]{1,20}$/.test(s(pick.gdId)) && s(pick.gdId) !== "0" ? [{ id: s(pick.gdId), gd_status: item.storedStatus }] : [];
  const pickUnlock = item.pickId ? [{ id: item.pickId, is_processing: 0 }] : [];
  const row = { id: item.jobId, job_status: status, progress_percent: item.progressPercent, progress_message: item.progressMessage, attempt_count: counted, next_attempt_at: item.nextAttemptAt, lease_owner: item.leaseOwner, lease_expires_at: item.leaseExpiresAt, row_version: rv + 1, error_code: item.errorCode, error_message: item.errorMessage, error_details: item.errorDetails, finished_at: null };
  const why = (dead ? "dead " + (item.deadLease === "YES" ? "lease of " + item.deadOwner : "claim of " + item.claimOwner) + ": " : "") + (exhausted ? "retries exhausted (" + attempts + " of " + PKC.retry.max_retries + ")" : dead ? "retry " + counted + " of " + PKC.retry.max_retries : "");
  if (status === "COMMITTING_GD") {
    const out = Object.assign(base, { attempts: counted, exhausted: exhausted ? "YES" : "NO", claimRows: dead && !exhausted ? [row] : [], needClaim: dead && !exhausted ? "YES" : "NO" });
    if (exhausted) {
      const reason = "the run saving this edit died " + attempts + " times after it started writing; nothing is retried, the Goods Delivery stays Processing";
      return Object.assign(out, { route: "EXHAUST", failRows: [Object.assign({}, row, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the save stopped half-way", error_code: "GDE_RECONCILIATION_MISMATCH", error_message: reason, error_details: JSON.stringify({ step: "GD_EDIT_WORKER", why: reason, dead_lease_owner: item.deadOwner, dead_claim_owner: item.claimOwner, attempts: attempts }), lease_owner: null, lease_expires_at: null, next_attempt_at: null, finished_at: pick.dbNow, row_version: rv + 2 })], result_code: "GDE_RECONCILIATION_MISMATCH", result_message: reason, job_status: "REQUIRES_REVIEW" });
    }
    return Object.assign(out, { route: "RESUME", result_message: (why ? why + "; " : "") + "resume GD_EDIT_COMMIT" });
  }
  if (status === "HELD") {
    // the hold's end is its next_attempt_at (GD_EDIT_PREPARE parks the job for 15 minutes); the lease write first, so a
    // late RELEASE / AMEND that moved the job meanwhile is seen by own.js and nothing is written
    const lease = Object.assign({}, row, { lease_owner: guard.leaseOwner, lease_expires_at: pick.leaseUntil });
    // a Picking force complete's hold (PICKING_FC) also ends when that force complete has ended (the poll makes it due)
    const fc = s(item.heldBy) === "PICKING_FC";
    const reason = (fc ? "the force complete that held this edit did not release it (it ended, or its hold ran out at " : "the sales order save that held this edit did not release it before ")
      + s(item.nextAttemptAt) + (fc ? ")" : "") + ": cancelled, nothing was written";
    return Object.assign(base, { route: "EXPIRE", attempts: counted, claimRows: [lease], needClaim: "YES",
      failRows: [Object.assign({}, lease, { job_status: "CANCELLED", progress_percent: 0, progress_message: fc ? "Cancelled: the force complete that held this edit did not release it" : "Cancelled: the sales order save that held this edit did not finish", error_code: "GDE_HOLD_EXPIRED", error_message: reason, error_details: JSON.stringify({ step: "GD_EDIT_WORKER", why: reason }), lease_owner: null, lease_expires_at: null, next_attempt_at: null, finished_at: pick.dbNow, row_version: rv + 2 })],
      unlockRows: unlock, pickUnlockRows: pickUnlock, result_code: "GDE_HOLD_EXPIRED", result_message: reason, job_status: "CANCELLED" });
  }
  if (["QUEUED", "VALIDATING", "READY_TO_COMMIT"].indexOf(status) < 0) return Object.assign(base, { result_message: "job is " + status + ": not a worker state" });
  const toValidating = status === "QUEUED";
  const claim = Object.assign({}, row, { job_status: toValidating ? "VALIDATING" : status, progress_percent: toValidating ? Math.max(item.progressPercent, 10) : item.progressPercent, progress_message: toValidating ? "Validating" : item.progressMessage, lease_owner: guard.leaseOwner, lease_expires_at: pick.leaseUntil });
  const claimed = Object.assign(base, { attempts: counted, claimRows: [claim], needClaim: "YES", exhausted: exhausted ? "YES" : "NO" });
  if (exhausted) {
    const reason = "the run that owned the job died " + attempts + " times before the edit was saved (max_retries " + PKC.retry.max_retries + "); nothing was written";
    return Object.assign(claimed, { route: "EXHAUST", failRows: [Object.assign({}, claim, { job_status: "FAILED", progress_message: "Not saved: temporary failures persisted", error_code: "GDE_TRANSIENT_RETRIES_EXHAUSTED", error_message: "Temporary failures persisted; not saved: " + reason, error_details: JSON.stringify({ step: "GD_EDIT_WORKER", why: reason, attempts: attempts }), lease_owner: null, lease_expires_at: null, finished_at: pick.dbNow, row_version: rv + 2 })], unlockRows: unlock, pickUnlockRows: pickUnlock, result_code: "GDE_TRANSIENT_RETRIES_EXHAUSTED", result_message: reason, job_status: "FAILED" });
  }
  return Object.assign(claimed, { route: status === "READY_TO_COMMIT" ? "PUBLISH" : "PREPARE", result_message: (why ? why + "; " : "") + "claim " + status + (toValidating ? " -> VALIDATING" : "") });
};
const guard = [{{node:code_node_GEWguard.data}}][0];
const pick = [{{node:code_node_GWpick.data}}][0];
const res = workerClaim(guard, pick);
console.log("worker claim", JSON.stringify({ route: res.route, job: res.jobId, status: res.jobStatus, attempts: res.attempts, write: res.needClaim, message: res.result_message }));
return res;
