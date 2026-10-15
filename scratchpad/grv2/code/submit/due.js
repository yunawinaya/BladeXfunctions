// GR_COMPLETE_SUBMIT - Due: the receipt is Processing under this job (gr_v2_job_id) and its latest lock is this key (read
// back) -> the job due now. If this run ends before the write, the job falls due by itself 2 minutes after the insert
const submitDue = function submitDue(guard, entry, back) {
  const b = list(back)[0] || {};
  const ok = digits(b.job_id) && s(b.gr_status) === "Processing" && s(b.gr_v2_job_id) === s(b.job_id) && s(b.lock_ref) === guard.key && s(b.job_status) === "QUEUED"
    && /^GR\|[0-9]{1,20}$/.test(s(b.correlation_id));
  return { dueRows: ok ? [{ id: s(b.job_id), next_attempt_at: entry.dbNow }] : [], needDue: ok ? "YES" : "NO" };
};
const res = submitDue([{{node:code_node_RSguard.data}}][0], [{{node:code_node_RSentry.data}}][0], [{{node:sql_node_RSback.data}}][0]);
console.log("submit due", JSON.stringify({ due: res.needDue }));
return res;
