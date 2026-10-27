// GD_EDIT_WORKER - Next publish: GD_EDIT_COMMIT ended SPLIT (COMMITTING_GD under a SPLIT| hand-over lease, no next attempt)
// -> call it again in this tick (phase B: lines, reservations, sales orders; phase C: Picking, header, after); decided from
// the job row alone
const workerSplitResume = function workerSplitResume(guard, mid, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) || mid.dbNow : mid.dbNow;
  const job = list.filter((r) => s(r.id))[0] || null;
  const base = { route: "END", dbNow: dbNow, jobId: mid.jobId, jobStatus: job ? s(job.job_status) : "", result_message: "" };
  if (s(mid.route) !== "PUBLISH" || !job) return Object.assign(base, { result_message: "no publish call in this iteration" });
  const split = s(job.job_status) === "COMMITTING_GD" && s(job.lease_owner).indexOf("SPLIT|") === 0 && !s(job.next_attempt_at);
  if (!split) return Object.assign(base, { result_message: "job is " + s(job.job_status) + (s(job.lease_owner) ? " (lease " + s(job.lease_owner) + ")" : "") + ": no further publish call" });
  return Object.assign(base, { route: "PUBLISH", result_message: "split: the next GD_EDIT_COMMIT call of this tick" });
};
const guard = [{{node:code_node_GEWguard2.data}}][0];
const mid = [{{node:code_node_GWmid.data}}][0];
const res = workerSplitResume(guard, mid, [{{node:sql_node_GWsplit.data}}][0]);
console.log("worker split", JSON.stringify(res));
return res;
