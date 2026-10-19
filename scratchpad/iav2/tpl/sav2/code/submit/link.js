// SA_V2_SUBMIT - Link: the SA this job wrote, read back by sa_v2_job_id -> saId, saNo, issuedNo (the number this submit made the
// platform issue: written with the number props and the fill-back's 'issued'), DIRECT: lineFingerprint of the STORED lines
// (= incomingFingerprint); written into the job's request with its correlation SA|<sa> / causation BEFORE it is made due. DIRECT /
// REVIEW also get the new SA's lock (SAC|<sa> / LOCK|1); REVIEW then writes its S|..|SC parts. Nothing is linked when the read-back
// does not show exactly this job's SA (the answer is then STOP 500 and the job falls due by itself; PREPARE releases it)
const submitLink = function submitLink(guard, entry, post, numberIssued, row, hdrRows, lineRows) {
  const act = s(entry.action);
  const none = { ok: "NO", saId: "", saNo: "", request: s(post.request), lockRows: [], jobRows: [], needLink: "NO", needLock: "NO", needScParts: "NO" };
  const g = list(hdrRows).filter((r) => digits(r.id));
  if (!digits(row.jobId) || g.length !== 1 || (act === "COMPLETE" && s(g[0].id) !== guard.saId)) {
    return Object.assign(none, { why: "the Stock Adjustment did not read back (" + g.length + " found)" });
  }
  const saId = s(g[0].id);
  const saNo = s(g[0].adjustment_no);
  const request = parseJson(post.request) || {};
  request.saId = saId;
  request.saNo = saNo;
  request.issuedNo = s(post.numberProps) === "YES" && s(numberIssued) === "YES" ? saNo : "";
  if (act === "DIRECT") {
    request.lineFingerprint = saLineFingerprint(lineRows);
    request.incomingFingerprint = request.lineFingerprint;
  }
  const text = JSON.stringify(request);
  const created = act === "DIRECT" || act === "REVIEW";
  return {
    ok: "YES", why: "", saId: saId, saNo: saNo, request: text, needLink: "YES", needLock: created ? "YES" : "NO",
    lockRows: created ? [{ job_id: "SAC|" + saId, organization_id: s(request.organizationId), step_name: "LOCK|1", step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow,
      result_ref: guard.key }] : [],
    needScParts: act === "REVIEW" && num(post.partCount) > 0 && num(row.partCount) === num(post.partCount) ? "YES" : "NO",
    jobRows: [{ id: row.jobId, correlation_id: "SA|" + saId, causation_id: saId, request_payload: text }],
  };
};
const res = submitLink([{{node:code_node_SSguard.data}}][0], [{{node:code_node_SSentry.data}}][0], [{{node:code_node_SSpost.data}}][0],
  [{{node:code_node_SSgate.data.numberIssued}}][0], { jobId: [{{node:code_node_SSrow.data.jobId}}][0], partCount: [{{node:code_node_SSrow.data.partCount}}][0] },
  [{{node:sql_node_SShdr.data}}][0], [{{node:sql_node_SSlines.data}}][0]);
console.log("submit link", JSON.stringify({ ok: res.ok, why: res.why, sa: res.saId, no: res.saNo, link: res.needLink, lock: res.needLock, parts: res.needScParts }));
return res;
