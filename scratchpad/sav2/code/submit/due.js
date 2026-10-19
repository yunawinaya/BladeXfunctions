// SA_V2_SUBMIT - Due: the SA is Processing under this job (sa_v2_job_id), its latest SAC lock is this key, the job is QUEUED and
// linked (SA|<sa>) and every S part is there (read back) -> the job due now (its request is final: link wrote it). If this run
// ends before, the job falls due by itself 2 minutes after the insert (GR V2's race fix: a worker never takes a job whose SA is not
// Processing under it yet)
const submitDue = function submitDue(guard, entry, post, link, back) {
  const b = list(back)[0] || {};
  const ok = saQueuedOk(guard, post, b) && s(link.ok) === "YES";
  return { dueRows: ok ? [{ id: s(b.job_id), next_attempt_at: entry.dbNow }] : [], needDue: ok ? "YES" : "NO" };
};
const res = submitDue([{{node:code_node_SSguard.data}}][0], [{{node:code_node_SSentry.data}}][0], [{{node:code_node_SSpost.data}}][0], [{{node:code_node_SSlink.data}}][0],
  [{{node:sql_node_SSback.data}}][0]);
console.log("submit due", JSON.stringify({ due: res.needDue }));
return res;
