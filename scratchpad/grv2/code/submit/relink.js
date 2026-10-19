// GR_COMPLETE_SUBMIT - Relink (Edit): the number the receipt carries after the write (a Draft's is issued there) into the job's
// request, before the job falls due - PREPARE checks the stored number against it
const submitRelink = function submitRelink(guard, back, jobAdded) {
  const b = list(back)[0] || {};
  const job = list(jobAdded)[0] || {};
  const none = { relinkRows: [], needRelink: "NO" };
  if (guard.pageStatus !== "Edit" || !digits(b.job_id) || s(b.job_id) !== s(job.id)) return none;
  const request = parseJ(job.request_payload);
  const no = s(b.gr_no);
  if (!request || typeof request !== "object" || !no || s(request.grNo) === no) return none;
  request.grNo = no;
  return { relinkRows: [{ id: s(b.job_id), request_payload: JSON.stringify(request) }], needRelink: "YES" };
};
const res = submitRelink([{{node:code_node_RSguard.data}}][0], [{{node:sql_node_RSback.data}}][0], [{{node:add_node_RSjob.data}}][0]);
console.log("submit relink", JSON.stringify({ relink: res.needRelink }));
return res;
