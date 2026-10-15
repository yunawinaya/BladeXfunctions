// PUTAWAY_ASYNC_SUBMIT - Due: the putaway is locked under this job (is_processing 1, its latest lock is this key; read back)
// -> the job due now, carrying the putaway's update_time after this lock write (PREPARE refuses a putaway changed since)
const submitDue = function submitDue(guard, entry, post, back) {
  const b = list(back)[0] || {};
  const ok = digits(b.job_id) && String(b.is_processing) === "1" && s(b.lock_ref) === guard.key && s(b.job_status) === "QUEUED";
  let request = {};
  try {
    request = JSON.parse(s(((post.jobRows || [])[0] || {}).request_payload)) || {};
  } catch (e) {
    request = {};
  }
  request.recordedUpdateTime = s(b.update_time);
  return { dueRows: ok ? [{ id: s(b.job_id), next_attempt_at: entry.dbNow, request_payload: JSON.stringify(request) }] : [], needDue: ok ? "YES" : "NO" };
};
const res = submitDue([{{node:code_node_PSguard.data}}][0], [{{node:code_node_PSentry.data}}][0], [{{node:code_node_PSpost.data}}][0], [{{node:sql_node_PSback.data}}][0]);
console.log("submit due", JSON.stringify({ due: res.needDue }));
return res;
