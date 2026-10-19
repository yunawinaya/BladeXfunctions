// SA_V2_COMMIT - Own: the job read back after the lease claim must be COMMITTING_SA under this run's lease
const commitOwn = function commitOwn(guard, rows) {
  const job = list(rows).filter((r) => s(r.id))[0] || null;
  const base = { route: "GO", result_code: "", result_message: "lease ours" };
  if (!job) return Object.assign(base, { route: "LOST", result_code: "SA_INVALID_DATA", result_message: "job vanished after the lease claim" });
  if (s(job.job_status) !== "COMMITTING_SA" || s(job.lease_owner) !== guard.leaseOwner) return Object.assign(base, { route: "LOST", result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "after the lease claim the job is " + s(job.job_status) + " under " + s(job.lease_owner) + ": another run took it" });
  return base;
};
const res = commitOwn([{{node:code_node_SACguard.data}}][0], [{{node:sql_node_SACown.data}}][0]);
console.log("commit own", JSON.stringify(res));
return res;
