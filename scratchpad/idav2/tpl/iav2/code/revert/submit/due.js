// IA_REVERT_V2_SUBMIT - Due: the read-back holds -> the job due now (else it falls due by itself after 2 minutes)
const submitDue = function submitDue(guard, entry, owner, keyJob) {
  const o = list(owner)[0] || {};
  const j = list(keyJob)[0] || {};
  const ok = rvQueuedOk(guard, o, j);
  return { dueRows: ok ? [{ id: s(j.job_id), next_attempt_at: entry.dbNow }] : [], needDue: ok ? "YES" : "NO" };
};
const res = submitDue([{{node:code_node_IVSguard.data}}][0], [{{node:code_node_IVSentry.data}}][0], [{{node:sql_node_IVSbackia.data}}][0], [{{node:sql_node_IVSbackjob.data}}][0]);
console.log("submit due", JSON.stringify({ due: res.needDue }));
return res;
