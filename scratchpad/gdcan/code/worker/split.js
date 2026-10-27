// GD_CANCEL_WORKER - Second publish: GD_CANCEL_COMMIT ended SPLIT (COMMITTING_GD under a SPLIT| hand-over lease,
// no next attempt) -> call it again in this tick for the Packing and the finish; decided from the job row alone
const workerSplitResume = function workerSplitResume(guard, mid, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) || mid.dbNow : mid.dbNow;
  const job = list.filter((r) => s(r.id))[0] || null;
  const base = { route: "END", dbNow: dbNow, jobId: mid.jobId, jobStatus: job ? s(job.job_status) : "", result_message: "" };
  if (s(mid.route) !== "PUBLISH" || !job) return Object.assign(base, { result_message: "no publish call in this iteration" });
  const split = s(job.job_status) === "COMMITTING_GD" && s(job.lease_owner).indexOf("SPLIT|") === 0 && !s(job.next_attempt_at);
  if (!split) return Object.assign(base, { result_message: "job is " + s(job.job_status) + (s(job.lease_owner) ? " (lease " + s(job.lease_owner) + ")" : "") + ": no second publish call" });
  return Object.assign(base, { route: "PUBLISH", result_message: "split after the stock moved: the second GD_CANCEL_COMMIT call of this tick" });
};
const guard = [{{node:code_node_XWguard3.data}}][0];
const mid = [{{node:code_node_XWmid.data}}][0];
const res = workerSplitResume(guard, mid, [{{node:sql_node_XWsplit.data}}][0]);
// one stock call per run (LSH 2026-10-26 20:40, two sweeps froze 30 min): a run keeps every key it took until it ends, so once
// it has called the commit it takes no further job; the next tick or a job's own run takes them
const pick = [{{node:code_node_XWpick.data}}][0];
res.nextIndex = String((mid && mid.route) || "").trim() === "PUBLISH" ? 9999 : Number(pick && pick.nextIndex) || 0;
console.log("worker split", JSON.stringify(res));
return res;
