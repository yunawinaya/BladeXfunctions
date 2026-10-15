// GD_EDIT_WORKER - Own: the job read back after the lease write - the state and lease must be this run's (an expired hold:
// still HELD, so a RELEASE / AMEND that won meanwhile leaves it alone)
const workerOwn = function workerOwn(guard, claim, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) || claim.dbNow : claim.dbNow;
  const job = list.filter((r) => s(r.id))[0] || null;
  const ending = claim.route === "EXHAUST" || claim.route === "EXPIRE";
  const base = { route: claim.route, dbNow: dbNow, jobId: claim.jobId, jobStatus: job ? s(job.job_status) : "", organizationId: claim.organizationId, gdId: claim.gdId, attempts: claim.attempts, failRows: claim.failRows, unlockRows: claim.unlockRows, pickUnlockRows: claim.pickUnlockRows || [], rowVersion: job ? Number(job.row_version) || 0 : 0, result_code: "", result_message: claim.result_message, job_status: job ? s(job.job_status) : "" };
  base.needFail = ending && (claim.failRows || []).length ? "YES" : "NO";
  base.needUnlock = ending && (claim.unlockRows || []).length ? "YES" : "NO";
  base.needPickUnlock = ending && (claim.pickUnlockRows || []).length ? "YES" : "NO";
  const lost = (code, message) => Object.assign(base, { route: "LOST", needFail: "NO", needUnlock: "NO", needPickUnlock: "NO", result_code: code, result_message: message });
  if (claim.route === "SKIP") return base;
  if (!job) return lost("GDE_INVALID_DATA", "job " + claim.jobId + " vanished after the claim");
  const status = s(job.job_status);
  const live = String(job.lease_live) === "1";
  if (claim.route === "RESUME" || (claim.route === "EXHAUST" && claim.jobStatus === "COMMITTING_GD")) {
    if (status !== "COMMITTING_GD") return lost("JOB_ILLEGAL_TRANSITION", "job is " + status + " after the claim: not resumed");
    if (live) return lost("JOB_ROW_VERSION_CONFLICT", "job lease is live for " + s(job.lease_owner) + ": not resumed");
    return base;
  }
  if (s(job.lease_owner) !== guard.leaseOwner) return lost("JOB_ROW_VERSION_CONFLICT", "the job's lease owner is " + s(job.lease_owner) + " after this run's lease write");
  const expect = claim.claimRows.length ? s(claim.claimRows[0].job_status) : status;
  if (status !== expect) return lost("JOB_ILLEGAL_TRANSITION", "job is " + status + " after the claim (expected " + expect + ")");
  return base;
};
const guard = [{{node:code_node_GWguard.data}}][0];
const claim = [{{node:code_node_GWclaim.data}}][0];
const res = workerOwn(guard, claim, [{{node:sql_node_GWown.data}}][0]);
console.log("worker own", JSON.stringify({ route: res.route, job: res.jobId, status: res.jobStatus, result: res.result_code, message: res.result_message }));
return res;
