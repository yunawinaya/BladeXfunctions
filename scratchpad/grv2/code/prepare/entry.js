// GR_COMPLETE_PREPARE - Entry: a COMPLETE_GR job the worker holds (VALIDATING under a live lease); its correlation -> the
// receipt. A job whose SUBMIT stopped before linking (no correlation) fails, its receipt (found by gr_v2_job_id) back to the
// status it had before the submit; a request that cannot be read fails the job
const prepareEntry = function prepareEntry(guard, rows, uuid) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", plantId: "0", grId: "0", idempotencyKey: "", rowVersion: 0, dbNow: "", nonce: "",
    request: {}, previousStatus: "", unlockRows: [], result_code: "", result_message: "" };
  if (!job) return Object.assign(base, { result_code: "GRC_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (s(job.command) !== "COMPLETE_GR") return Object.assign(base, { result_code: "GRC_INVALID_DATA", result_message: "job command is " + s(job.command) });
  if (s(job.job_status) !== "VALIDATING") return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + s(job.job_status) + ": only a VALIDATING job is prepared" });
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const common = { jobId: s(job.id), organizationId: s(job.organization_id), plantId: s(job.plant_id), idempotencyKey: s(job.idempotency_key), rowVersion: Number(job.row_version) || 0,
    dbNow: s(job.db_now), jsAt: String(Date.now()), nonce: s(uuid).replace(/[^0-9A-Za-z]/g, "").slice(0, 8) };
  let req = null;
  try {
    req = JSON.parse(s(job.request_payload));
  } catch (e) {
    req = null;
  }
  const prev = req && ["Draft", "Created"].indexOf(s(req.previousStatus)) >= 0 ? s(req.previousStatus) : "Draft";
  const m = s(job.correlation_id).match(/^GR\|([0-9]{1,20})$/);
  if (!m) {
    const stray = /^[0-9]{1,20}$/.test(s(job.linked_gr)) && s(job.linked_status) === "Processing";
    return Object.assign(base, common, { route: "FAIL", previousStatus: prev, unlockRows: stray ? [{ id: s(job.linked_gr), gr_status: prev }] : [],
      result_code: "GRC_INVALID_REQUEST", result_message: "the submit stopped before the Goods Receiving was linked to its job: please complete it again" });
  }
  if (!req || typeof req !== "object" || !/^[0-9]{1,20}$/.test(common.organizationId)) {
    return Object.assign(base, common, { route: "FAIL", previousStatus: prev, result_code: "GRC_INVALID_REQUEST", result_message: "the job's request could not be read" });
  }
  return Object.assign(base, common, { route: "GO", grId: m[1], request: req, previousStatus: prev, result_message: "complete Goods Receiving " + s(req.grNo || m[1]) });
};
const guard = [{{node:code_node_RPguard.data}}][0];
const res = prepareEntry(guard, [{{node:sql_node_RPjob.data}}][0], [{{system:uuid}}][0]);
console.log("prepare entry", JSON.stringify({ route: res.route, gr: res.grId, result: res.result_code, message: res.result_message }));
return res;
