// IDA_V2_SUBMIT - Link: the IDA read back by ida_v2_job_id (exactly one; its FP_HEADER row gives the number) -> the request's idaId / idaNo /
// issuedNo / lineFingerprint; an Add's LOCK|1 + correlation
const submitLink = function submitLink(guard, entry, post, row, hdrRows, headerRows, lineRows) {
  const add = s(post.isAdd) === "YES";
  const g = list(hdrRows).filter((r) => obj(r) && digits(r.id));
  const h = idaRows(headerRows)[0] || {};
  const none = { ok: "NO", idaId: "", idaNo: "", request: s(post.request), lockRows: [], jobRows: [], needLink: "NO", needLock: "NO" };
  if (!digits(row.jobId) || g.length !== 1 || s(h.id) !== s(g[0].id) || (!add && s(g[0].id) !== guard.idaId)) {
    return Object.assign(none, { why: "the Item Disassembly did not read back (" + g.length + " found)" });
  }
  const idaId = s(g[0].id);
  const idaNo = s(h.stock_movement_no);
  const request = parseJson(post.request) || {};
  request.idaId = idaId;
  request.idaNo = idaNo;
  request.issuedNo = s(post.numberIssued) === "YES" ? idaNo : "";
  request.lineFingerprint = idaLineFingerprint(lineRows, headerRows);
  const text = JSON.stringify(request);
  return {
    ok: "YES", why: "", idaId: idaId, idaNo: idaNo, request: text, needLink: add ? "YES" : "NO", needLock: add ? "YES" : "NO",
    lockRows: add ? [{ job_id: idaLockJob(idaId), organization_id: s(request.organizationId), step_name: "LOCK|1", step_status: "LOCK", attempt_count: 0,
      started_at: entry.dbNow, result_ref: guard.key }] : [],
    jobRows: add ? [{ id: row.jobId, correlation_id: idaCorrelation(idaId), causation_id: idaId, request_payload: text }] : [],
  };
};
const res = submitLink([{{node:code_node_DSguard.data}}][0], [{{node:code_node_DSentry.data}}][0], [{{node:code_node_DSpost.data}}][0], [{{node:code_node_DSrow.data}}][0],
  [{{node:sql_node_DShdr.data}}][0], [{{node:sql_node_DSheader.data}}][0], [{{node:sql_node_DSlines.data}}][0]);
console.log("submit link", JSON.stringify({ ok: res.ok, why: res.why, ida: res.idaId, no: res.idaNo, link: res.needLink, lock: res.needLock }));
return res;
