// LOT_V2_PREPARE - Entry: a VALIDATING SAVE_LOT job the worker holds (live lease); its correlation LOT|<id> -> the LOT; its request.
// No correlation (SUBMIT stopped before "link"): FAILED, the LOT it left Processing (lot_v2_job_id) back to prevStatus. A request
// whose prevStatus is not Draft / In Progress: REQUIRES_REVIEW, no unlock (CONTRACT.md section 2)
const prepareEntry = function prepareEntry(guard, rows, uuid) {
  const job = lotList(rows).filter((r) => r && lotS(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", lotId: "0", idempotencyKey: "", rowVersion: 0, attempts: 0, dbNow: "", nonce: "",
    request: {}, action: "", prevStatus: "", saveAs: "", unlockRows: [], result_code: "", result_message: "" };
  if (!job || String(job.is_deleted) === "1") return Object.assign(base, { result_code: "LOT_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (lotS(job.command) !== "SAVE_LOT") return Object.assign(base, { result_code: "LOT_INVALID_DATA", result_message: "job command is " + lotS(job.command) });
  if (lotS(job.job_status) !== "VALIDATING") return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + lotS(job.job_status) + ": only a VALIDATING job is prepared" });
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const req = lotParseJ(lotS(job.request_payload));
  const common = { jobId: lotS(job.id), organizationId: lotDigits(job.organization_id) ? lotS(job.organization_id) : "0", idempotencyKey: lotS(job.idempotency_key),
    rowVersion: Number(job.row_version) || 0, attempts: Number(job.attempt_count) || 0, dbNow: lotS(job.db_now), jsAt: String(Date.now()), nonce: (lotS(uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8) };
  const prev = req && typeof req === "object" ? lotS(req.prevStatus) : "";
  if (!lotPrevStatusOk(prev)) {
    return Object.assign(base, common, { route: "REVIEW", result_code: "LOT_PREV_STATUS_UNKNOWN", result_message: "Under review: the status to restore is unknown. Please contact support." });
  }
  const m = lotS(job.correlation_id).match(/^LOT\|([0-9]{1,20})$/);
  if (!m) {
    const stray = lotDigits(job.linked_lot) ? [{ id: lotS(job.linked_lot), stock_movement_status: prev }] : [];
    return Object.assign(base, common, { route: "FAIL", prevStatus: prev, unlockRows: stray, result_code: "LOT_INVALID_REQUEST",
      result_message: "The save stopped before the Location Transfer was linked to its job: please save it again." });
  }
  return Object.assign(base, common, { route: "GO", lotId: m[1], request: req, action: lotS(req.action), prevStatus: prev, saveAs: lotS(req.saveAs),
    result_message: lotS(req.action) + " Location Transfer " + (lotS(req.lotNo) || m[1]) });
};
const guard = [{{node:code_node_LPguard.data}}][0];
const res = prepareEntry(guard, [{{node:sql_node_LPjob.data}}][0], [{{system:uuid}}][0]);
console.log("prepare entry", JSON.stringify({ route: res.route, lot: res.lotId, action: res.action, result: res.result_code, message: res.result_message }));
return res;
