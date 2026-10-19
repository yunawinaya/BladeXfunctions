// IA_REVERT_V2_WORKER - Before publish: decided from the job row alone - READY_TO_COMMIT under this run's lease, or
// COMMITTING_REVERT with no live lease (resume) -> the ONE IA_REVERT_V2_COMMIT call
const workerMid = function workerMid(guard, own, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) || own.dbNow : own.dbNow;
  const job = list.filter((r) => s(r.id))[0] || null;
  const base = { route: "END", dbNow: dbNow, jobId: own.jobId, jobStatus: job ? s(job.job_status) : "", result_message: "" };
  if (!job || ["PREPARE", "PUBLISH", "RESUME"].indexOf(own.route) < 0) return base;
  const status = s(job.job_status);
  if (own.route === "RESUME") return status === "COMMITTING_REVERT" && String(job.lease_live) !== "1" ? Object.assign(base, { route: "PUBLISH", result_message: "resume IA_REVERT_V2_COMMIT" }) : Object.assign(base, { result_message: "job is " + status + (String(job.lease_live) === "1" ? " with a live lease" : "") + ": no publish call" });
  if (status === "READY_TO_COMMIT" && s(job.lease_owner) === guard.leaseOwner) return Object.assign(base, { route: "PUBLISH", result_message: "publish" });
  if (status === "READY_TO_COMMIT" && !s(job.lease_owner)) return Object.assign(base, { result_message: "PREPARE parked the job (no lease, due " + s(job.next_attempt_at) + "): its COMMIT runs on the next tick" });
  return Object.assign(base, { result_message: "job is " + status + " (lease " + s(job.lease_owner) + "): no publish call" });
};
const guard = [{{node:code_node_RWguard.data}}][0];
const own = [{{node:code_node_RWown.data}}][0];
const res = workerMid(guard, own, [{{node:sql_node_RWmid.data}}][0]);
console.log("worker mid", JSON.stringify(res));
return res;
