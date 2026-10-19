// LOT_V2_SUBMIT - Due: the LOT is Processing under this job (lot_v2_job_id), its latest lock is this key, the job is QUEUED and
// a COMPLETE / EDIT's S parts are all there (read back) -> the job due now (its request is final: insert or link). If this run
// ends before, the job falls due by itself 2 minutes after the insert
const submitDue = function submitDue(guard, entry, post, link, back) {
  const b = list(back)[0] || {};
  const ok = lotQueuedOk(guard, post, b) && s(link.ok) === "YES";
  return { dueRows: ok ? [{ id: s(b.job_id), next_attempt_at: entry.dbNow }] : [], needDue: ok ? "YES" : "NO" };
};
const res = submitDue([{{node:code_node_LSguard.data}}][0], [{{node:code_node_LSentry.data}}][0], [{{node:code_node_LSpost.data}}][0], [{{node:code_node_LSlink.data}}][0],
  [{{node:sql_node_LSback.data}}][0]);
console.log("submit due", JSON.stringify({ due: res.needDue }));
return res;
