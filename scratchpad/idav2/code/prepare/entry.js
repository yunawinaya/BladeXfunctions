// IDA_V2_PREPARE - Entry (tpl/iav2 prepare/entry.js): a VALIDATING COMPLETE_IDA job under a live lease -> its IDA|<id> and request
// an unreadable request has no prevStatus: REQUIRES_REVIEW, no unlock
const prepareEntry = function prepareEntry(guard, rows, uuid, jsAt) {
  const job = idaList(rows).filter((r) => r && idaS(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", idaId: "0", idempotencyKey: "", rowVersion: 0, attempts: 0, dbNow: "",
    jsAt: "", nonce: "", request: {}, action: "", prevStatus: "", saveAs: "", needRead: "NO", unlockRows: [], link: {}, result_code: "", result_message: "" };
  if (!job || String(job.is_deleted) === "1") return Object.assign(base, { result_code: "IDA_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (idaS(job.command) !== "COMPLETE_IDA") return Object.assign(base, { result_code: "IDA_INVALID_DATA", result_message: "job command is " + idaS(job.command) });
  if (idaS(job.job_status) !== "VALIDATING") {
    return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + idaS(job.job_status) + ": only a VALIDATING job is prepared" });
  }
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const req = idaParseJ(idaS(job.request_payload));
  const common = { jobId: idaS(job.id), organizationId: idaDigits(job.organization_id) ? idaS(job.organization_id) : "0", idempotencyKey: idaS(job.idempotency_key),
    rowVersion: Number(job.row_version) || 0, attempts: Number(job.attempt_count) || 0, dbNow: idaS(job.db_now), jsAt: String(jsAt || ""),
    nonce: (idaS(uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8) };
  const prev = req && typeof req === "object" ? idaS(req.prevStatus) : "";
  if (!idaPrevStatusOk(prev)) return Object.assign(base, common, { route: "REVIEW", result_code: "IDA_PREV_STATUS_UNKNOWN", result_message: IDA_TEXT.prevUnknown });
  const m = idaS(job.correlation_id).match(/^IDA\|([0-9]{1,20})$/);
  if (!m) {
    const stray = idaDigits(job.linked_ida) ? [{ id: idaS(job.linked_ida), item_disassembly_status: prev }] : [];
    // the link SUBMIT would have written (IA R8): STATUS then answers this IDA
    const no = ["", "issued", "draft"].indexOf(idaS(job.linked_ida_no)) < 0 ? idaS(job.linked_ida_no) : "";
    const link = stray.length ? { correlation_id: idaCorrelation(stray[0].id), causation_id: stray[0].id,
      request_payload: JSON.stringify(Object.assign({}, req, { idaId: stray[0].id, idaNo: no, issuedNo: no && idaS(job.linked_ida_no_type) !== "-9999" ? no : "" })) } : {};
    return Object.assign(base, common, { route: "FAIL", prevStatus: prev, unlockRows: stray, link: link, request: req, result_code: "IDA_INVALID_REQUEST",
      result_message: IDA_TEXT.unlinked });
  }
  return Object.assign(base, common, { route: "GO", idaId: m[1], request: req, action: idaS(req.action), prevStatus: prev, saveAs: idaS(req.saveAs), needRead: "YES",
    result_message: idaS(req.action) + " Item Disassembly " + (idaS(req.idaNo) || m[1]) });
};
const guard = [{{node:code_node_DPguard.data}}][0];
const res = prepareEntry(guard, [{{node:sql_node_DPjob.data}}][0], [{{system:uuid}}][0], Date.now());
console.log("prepare entry", JSON.stringify({ route: res.route, ida: res.idaId, action: res.action, result: res.result_code, message: res.result_message }));
return res;
