// GR_COMPLETE_SUBMIT - Link (Add): the receipt read back by gr_v2_job_id -> its lock (GRC|<gr> / LOCK|1) and the job's
// correlation (GR|<gr>), causation and request (grId, grNo); due.js then makes it due
const submitLink = function submitLink(guard, entry, keys, grrow, backRows, jobAdded) {
  const g = list(backRows).filter((r) => digits(r.id));
  const job = list(jobAdded)[0] || {};
  if (g.length !== 1 || !digits(grrow.jobId)) return { ok: "NO", why: "the new Goods Receiving did not read back (" + g.length + " found)", lockRows: [], jobRows: [] };
  const grId = s(g[0].id);
  let request = {};
  try {
    request = JSON.parse(s(job.request_payload)) || {};
  } catch (e) {
    request = {};
  }
  request.grId = grId;
  request.grNo = s(g[0].gr_no);
  return {
    ok: "YES", why: "", grId: grId, grNo: s(g[0].gr_no),
    lockRows: [{ job_id: "GRC|" + grId, organization_id: keys.organizationId, step_name: "LOCK|1", step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow, result_ref: guard.key }],
    jobRows: [{ id: grrow.jobId, correlation_id: "GR|" + grId, causation_id: grId, request_payload: JSON.stringify(request) }],
  };
};
const res = submitLink([{{node:code_node_RSguard.data}}][0], [{{node:code_node_RSentry.data}}][0], [{{node:code_node_RSkeys.data}}][0], [{{node:code_node_RSgrrow.data}}][0],
  [{{node:sql_node_RSnew.data}}][0], [{{node:add_node_RSjob.data}}][0]);
console.log("submit link", JSON.stringify({ ok: res.ok, why: res.why, gr: res.grId, no: res.grNo }));
return res;
