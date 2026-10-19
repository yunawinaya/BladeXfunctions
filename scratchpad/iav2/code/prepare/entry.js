// IA_V2_PREPARE - Entry (tpl/sav2 prepare/entry.js): a VALIDATING COMPLETE_IA job under a live lease -> its IA|<id> and request
// an unreadable request has no prevStatus: REQUIRES_REVIEW, no unlock
const prepareEntry = function prepareEntry(guard, rows, uuid, jsAt) {
  const job = iaList(rows).filter((r) => r && iaS(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", iaId: "0", idempotencyKey: "", rowVersion: 0, attempts: 0, dbNow: "",
    jsAt: "", nonce: "", request: {}, action: "", prevStatus: "", saveAs: "", needRead: "NO", unlockRows: [], link: {}, result_code: "", result_message: "" };
  if (!job || String(job.is_deleted) === "1") return Object.assign(base, { result_code: "IA_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (iaS(job.command) !== "COMPLETE_IA") return Object.assign(base, { result_code: "IA_INVALID_DATA", result_message: "job command is " + iaS(job.command) });
  if (iaS(job.job_status) !== "VALIDATING") {
    return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + iaS(job.job_status) + ": only a VALIDATING job is prepared" });
  }
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const req = iaParseJ(iaS(job.request_payload));
  const common = { jobId: iaS(job.id), organizationId: iaDigits(job.organization_id) ? iaS(job.organization_id) : "0", idempotencyKey: iaS(job.idempotency_key),
    rowVersion: Number(job.row_version) || 0, attempts: Number(job.attempt_count) || 0, dbNow: iaS(job.db_now), jsAt: String(jsAt || ""),
    nonce: (iaS(uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8) };
  const prev = req && typeof req === "object" ? iaS(req.prevStatus) : "";
  if (!iaPrevStatusOk(prev)) return Object.assign(base, common, { route: "REVIEW", result_code: "IA_PREV_STATUS_UNKNOWN", result_message: IA_TEXT.prevUnknown });
  const m = iaS(job.correlation_id).match(/^IA\|([0-9]{1,20})$/);
  if (!m) {
    const stray = iaDigits(job.linked_ia) ? [{ id: iaS(job.linked_ia), item_assembly_status: prev }] : [];
    // the link SUBMIT would have written (R8): STATUS then answers this IA
    const no = ["", "issued", "draft"].indexOf(iaS(job.linked_ia_no)) < 0 ? iaS(job.linked_ia_no) : "";
    const link = stray.length ? { correlation_id: iaCorrelation(stray[0].id), causation_id: stray[0].id,
      request_payload: JSON.stringify(Object.assign({}, req, { iaId: stray[0].id, iaNo: no, issuedNo: no && iaS(job.linked_ia_no_type) !== "-9999" ? no : "" })) } : {};
    return Object.assign(base, common, { route: "FAIL", prevStatus: prev, unlockRows: stray, link: link, request: req, result_code: "IA_INVALID_REQUEST",
      result_message: "The completion stopped before the Item Assembly was linked to its job: please complete it again." });
  }
  return Object.assign(base, common, { route: "GO", iaId: m[1], request: req, action: iaS(req.action), prevStatus: prev, saveAs: iaS(req.saveAs), needRead: "YES",
    result_message: iaS(req.action) + " Item Assembly " + (iaS(req.iaNo) || m[1]) });
};
const guard = [{{node:code_node_IPguard.data}}][0];
const res = prepareEntry(guard, [{{node:sql_node_IPjob.data}}][0], [{{system:uuid}}][0], Date.now());
console.log("prepare entry", JSON.stringify({ route: res.route, ia: res.iaId, action: res.action, result: res.result_code, message: res.result_message }));
return res;
