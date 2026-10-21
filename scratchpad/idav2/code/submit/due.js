// IDA_V2_SUBMIT - Due: the IDA Processing under this job's lock, the job QUEUED and linked -> due now with its final request (else it falls due in 120 s)
const submitDue = function submitDue(guard, entry, link, back) {
  const b = list(back)[0] || {};
  const ok = idaQueuedOk(guard, b) && s(link.ok) === "YES";
  return { dueRows: ok ? [{ id: s(b.job_id), next_attempt_at: entry.dbNow, request_payload: s(link.request) }] : [], needDue: ok ? "YES" : "NO" };
};
const res = submitDue([{{node:code_node_DSguard.data}}][0], [{{node:code_node_DSentry.data}}][0], [{{node:code_node_DSlink.data}}][0],
  idaBackRows([{{node:code_node_DSpost.data.isAdd}}][0], [{{node:sql_node_DSbackAdd.data}}][0], [{{node:sql_node_DSback.data}}][0]));
console.log("submit due", JSON.stringify({ due: res.needDue }));
return res;
