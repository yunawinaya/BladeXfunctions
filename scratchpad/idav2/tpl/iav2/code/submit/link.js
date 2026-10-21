// IA_V2_SUBMIT - Link: the IA read back by ia_v2_job_id -> the request's iaId / iaNo / issuedNo / lineFingerprint; an Add's LOCK|1 + correlation
const submitLink = function submitLink(guard, entry, post, row, hdrRows, headerRows, lineRows) {
  const add = s(post.isAdd) === "YES";
  const g = list(hdrRows).filter((r) => obj(r) && digits(r.id));
  const none = { ok: "NO", iaId: "", iaNo: "", request: s(post.request), lockRows: [], jobRows: [], needLink: "NO", needLock: "NO" };
  if (!digits(row.jobId) || g.length !== 1 || (!add && s(g[0].id) !== guard.iaId)) return Object.assign(none, { why: "the Item Assembly did not read back (" + g.length + " found)" });
  const iaId = s(g[0].id);
  const iaNo = s(g[0].stock_movement_no);
  const request = parseJson(post.request) || {};
  request.iaId = iaId;
  request.iaNo = iaNo;
  request.issuedNo = s(post.numberIssued) === "YES" ? iaNo : "";
  request.lineFingerprint = iaLineFingerprint(lineRows, headerRows);
  const text = JSON.stringify(request);
  return {
    ok: "YES", why: "", iaId: iaId, iaNo: iaNo, request: text, needLink: add ? "YES" : "NO", needLock: add ? "YES" : "NO",
    lockRows: add ? [{ job_id: iaLockJob(iaId), organization_id: s(request.organizationId), step_name: "LOCK|1", step_status: "LOCK", attempt_count: 0,
      started_at: entry.dbNow, result_ref: guard.key }] : [],
    jobRows: add ? [{ id: row.jobId, correlation_id: iaCorrelation(iaId), causation_id: iaId, request_payload: text }] : [],
  };
};
const res = submitLink([{{node:code_node_ISguard.data}}][0], [{{node:code_node_ISentry.data}}][0], [{{node:code_node_ISpost.data}}][0], [{{node:code_node_ISrow.data}}][0],
  [{{node:sql_node_IShdr.data}}][0], [{{node:sql_node_ISheader.data}}][0], [{{node:sql_node_ISlines.data}}][0]);
console.log("submit link", JSON.stringify({ ok: res.ok, why: res.why, ia: res.iaId, no: res.iaNo, link: res.needLink, lock: res.needLock }));
return res;
