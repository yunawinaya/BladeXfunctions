// IA_REVERT_V2_PREPARE - Entry: the VALIDATING REVERT_IA job and its request (prevStatus Completed only, else REVIEW)
const prepareEntry = function prepareEntry(guard, rows, uuid) {
  const job = iaList(rows).filter((r) => r && iaS(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", iaId: "0", idempotencyKey: "", rowVersion: 0, dbNow: "", jsAt: String(Date.now()),
    nonce: "", request: {}, prevStatus: "", result_code: "", result_message: "" };
  if (!job) return Object.assign(base, { result_code: "IA_RV_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (String(job.is_deleted) !== "0") return Object.assign(base, { result_code: "IA_RV_INVALID_DATA", result_message: "job is deleted" });
  if (iaS(job.command) !== "REVERT_IA") return Object.assign(base, { result_code: "IA_RV_INVALID_DATA", result_message: "job command is " + iaS(job.command) });
  if (iaS(job.job_status) !== "VALIDATING") return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + iaS(job.job_status) + ": only a VALIDATING job is prepared" });
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const common = { jobId: iaS(job.id), organizationId: iaS(job.organization_id), idempotencyKey: iaS(job.idempotency_key), rowVersion: Number(job.row_version) || 0, dbNow: iaS(job.db_now),
    jsAt: String(Date.now()), nonce: (iaS(uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8) };
  const req = iaParseJ(iaS(job.request_payload));
  const m = iaS(job.correlation_id).match(/^IA\|([0-9]{1,20})$/);
  const ok = m && req && typeof req === "object" && iaS(req.iaId) === m[1] && iaS(req.action) === "REVERT" && /^IM1:/.test(iaS(req.movesFingerprint)) && iaDigits(common.organizationId);
  // unreadable request: the status to restore is unknown -> REVIEW (ruling 4)
  if (!ok) return Object.assign(base, common, { route: "REVIEW", iaId: m ? m[1] : "0", result_code: "IA_RV_PREV_STATUS_UNKNOWN", result_message: "the job's request could not be read" });
  const prev = iaS(req.prevStatus);
  if (!iaRvPrevStatusOk(prev)) {
    return Object.assign(base, common, { route: "REVIEW", iaId: m[1], request: req, prevStatus: prev, result_code: "IA_RV_PREV_STATUS_UNKNOWN", result_message: IA_TEXT.prevUnknown });
  }
  return Object.assign(base, common, { route: "GO", iaId: m[1], request: req, prevStatus: prev, result_message: "revert Item Assembly " + (iaS(req.iaNo) || m[1]) });
};
const guard = [{{node:code_node_IVPguard.data}}][0];
const res = prepareEntry(guard, [{{node:sql_node_IVPjob.data}}][0], [{{system:uuid}}][0]);
console.log("prepare entry", JSON.stringify({ route: res.route, ia: res.iaId, prev: res.prevStatus, result: res.result_code, message: res.result_message }));
return res;
