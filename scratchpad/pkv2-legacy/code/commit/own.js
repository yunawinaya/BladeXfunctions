// PICKING_BULK_COMMIT - Own: the job read back after the lease claim must be COMMITTING_PICKING under this run's lease
const commitOwn = function commitOwn(guard, entry, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const base = { route: "GO", jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, result_code: "", result_message: "lease ours" };
  if (!job) return Object.assign(base, { route: "LOST", result_code: "PK_INVALID_DATA", result_message: "job vanished after the lease claim" });
  if (s(job.job_status) !== "COMMITTING_PICKING" || s(job.lease_owner) !== guard.leaseOwner) return Object.assign(base, { route: "LOST", result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "after the lease claim the job is " + s(job.job_status) + " under " + s(job.lease_owner) + ": another run took it" });
  return base;
};
const guard = [{{node:code_node_PCguard.data}}][0];
const entry = [{{node:code_node_PCentry.data}}][0];
const res = commitOwn(guard, entry, [{{node:sql_node_PCown.data}}][0]);
console.log("commit own", JSON.stringify(res));
return res;
