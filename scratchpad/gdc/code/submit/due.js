// GD_COMPLETE_SUBMIT - Due: the GD is Processing under this job's lock (read back) -> the job due now. If this run ends
// before the write, the job falls due by itself 2 minutes after the insert
const submitDue = function submitDue(entry, post, back) {
  const b = list(back)[0] || {};
  const ok = s(b.job_id) && s(b.gd_status) === "Processing" && s(b.lock_ref) === s(post.idemKey) && s(b.job_status) === "QUEUED";
  return { dueRows: ok ? [{ id: s(b.job_id), next_attempt_at: entry.dbNow }] : [], needDue: ok ? "YES" : "NO" };
};
const res = submitDue([{{node:code_node_GSentry.data}}][0], [{{node:code_node_GSpost.data}}][0], [{{node:sql_node_GSback.data}}][0]);
console.log("submit due", JSON.stringify({ due: res.needDue }));
return res;
