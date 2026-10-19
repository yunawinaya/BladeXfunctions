// LOT_V2_SUBMIT - Link. DIRECT / STAGE: the LOT read back by lot_v2_job_id (+ its lines, FP_LINES) -> lotId, lotNo, issuedNo
// (the number this submit made the platform issue), lineFingerprint of the STORED lines, written into the job's request (and
// its correlation / causation) BEFORE it is made due; an Add also gets its lock (SMLT|<lot> / LOCK|1). COMPLETE / EDIT /
// CANCEL: the request was final at the insert (their lines were read before the writes)
const submitLink = function submitLink(guard, entry, post, numberIssued, row, hdrRows, lineRows) {
  const add = s(post.isAdd) === "YES";
  const full = entry.action === "DIRECT" || entry.action === "STAGE";
  if (!full) {
    return { ok: digits(row.jobId) ? "YES" : "NO", why: "", lotId: guard.lotId, lotNo: entry.lotNo, request: s(post.request), lockRows: [], jobRows: [], needLink: "NO",
      needLock: "NO" };
  }
  const g = list(hdrRows).filter((r) => digits(r.id));
  const none = { ok: "NO", lotId: "", lotNo: "", request: s(post.request), lockRows: [], jobRows: [], needLink: "NO", needLock: "NO" };
  if (g.length !== 1 || !digits(row.jobId) || (!add && s(g[0].id) !== guard.lotId)) return Object.assign(none, { why: "the Location Transfer did not read back (" + g.length + " found)" });
  const lotId = s(g[0].id);
  const lotNo = s(g[0].stock_movement_no);
  const request = parseJson(post.request) || {};
  request.lotId = lotId;
  request.lotNo = lotNo;
  request.issuedNo = s(post.numberProps) === "YES" && s(numberIssued) === "YES" ? lotNo : "";
  request.lineFingerprint = lotLineFingerprint(lineRows);
  const text = JSON.stringify(request);
  return {
    ok: "YES", why: "", lotId: lotId, lotNo: lotNo, request: text, needLink: "YES", needLock: add ? "YES" : "NO",
    lockRows: add ? [{ job_id: "SMLT|" + lotId, organization_id: request.organizationId, step_name: "LOCK|1", step_status: "LOCK", attempt_count: 0, started_at: entry.dbNow,
      result_ref: guard.key }] : [],
    jobRows: [{ id: row.jobId, correlation_id: "LOT|" + lotId, causation_id: lotId, request_payload: text }],
  };
};
const res = submitLink([{{node:code_node_LSguard.data}}][0], [{{node:code_node_LSentry.data}}][0], [{{node:code_node_LSpost.data}}][0],
  [{{node:code_node_LSgate.data.numberIssued}}][0], [{{node:code_node_LSrow.data}}][0], [{{node:sql_node_LShdr.data}}][0], [{{node:sql_node_LSlines.data}}][0]);
console.log("submit link", JSON.stringify({ ok: res.ok, why: res.why, lot: res.lotId, no: res.lotNo, link: res.needLink, lock: res.needLock }));
return res;
