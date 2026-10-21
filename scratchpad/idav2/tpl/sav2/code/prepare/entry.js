// SA_V2_PREPARE - Entry (de-LOT-ed copy of smv2 prepare/entry.js): a VALIDATING COMPLETE_SA job the worker holds (live lease); its
// correlation SA|<id> -> the Stock Adjustment; its request (source, action, prevStatus, the review's Stock Count). No correlation
// (SUBMIT stopped before "link"): FAILED, and the SA it left Processing (sa_v2_job_id = this job, no later lock: the job SQL's
// linked_sa) back to prevStatus. A prevStatus other than Draft / Cancelled: REQUIRES_REVIEW, no unlock (CONTRACT.md section 2).
// Nothing else unlocks before the plan has proved this job owns the SA (the lock check).
const prepareEntry = function prepareEntry(guard, rows, uuid) {
  const job = saList(rows).filter((r) => r && saS(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", saId: "0", scId: "0", idempotencyKey: "", rowVersion: 0, attempts: 0, dbNow: "",
    nonce: "", request: {}, action: "", source: "", prevStatus: "", saveAs: "", unlockRows: [], result_code: "", result_message: "" };
  if (!job || String(job.is_deleted) === "1") return Object.assign(base, { result_code: "SA_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (saS(job.command) !== "COMPLETE_SA") return Object.assign(base, { result_code: "SA_INVALID_DATA", result_message: "job command is " + saS(job.command) });
  if (saS(job.job_status) !== "VALIDATING") {
    return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + saS(job.job_status) + ": only a VALIDATING job is prepared" });
  }
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const req = saParseJ(saS(job.request_payload));
  const common = { jobId: saS(job.id), organizationId: saDigits(job.organization_id) ? saS(job.organization_id) : "0", idempotencyKey: saS(job.idempotency_key),
    rowVersion: Number(job.row_version) || 0, attempts: Number(job.attempt_count) || 0, dbNow: saS(job.db_now), nonce: (saS(uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8) };
  const prev = req && typeof req === "object" ? saS(req.prevStatus) : "";
  if (!saPrevStatusOk(prev)) {
    return Object.assign(base, common, { route: "REVIEW", result_code: "SA_PREV_STATUS_UNKNOWN", result_message: "Under review: the status to restore is unknown. Please contact support." });
  }
  const m = saS(job.correlation_id).match(/^SA\|([0-9]{1,20})$/);
  if (!m) {
    const stray = saDigits(job.linked_sa) ? [{ id: saS(job.linked_sa), stock_adjustment_status: prev }] : [];
    return Object.assign(base, common, { route: "FAIL", prevStatus: prev, unlockRows: stray, result_code: "SA_INVALID_REQUEST",
      result_message: "The save stopped before the Stock Adjustment was linked to its job: please save it again." });
  }
  const source = saS(req.source);
  const scId = source === "REVIEW" ? (saDigits(req.scId) ? saS(req.scId) : "0") : "0";
  return Object.assign(base, common, { route: "GO", saId: m[1], scId: scId, request: req, action: saS(req.action), source: source, prevStatus: prev, saveAs: saS(req.saveAs),
    result_message: saS(req.action) + " Stock Adjustment " + (saS(req.saNo) || m[1]) });
};
const guard = [{{node:code_node_SPguard.data}}][0];
const res = prepareEntry(guard, [{{node:sql_node_SPjob.data}}][0], [{{system:uuid}}][0]);
console.log("prepare entry", JSON.stringify({ route: res.route, sa: res.saId, sc: res.scId, action: res.action, result: res.result_code, message: res.result_message }));
return res;
