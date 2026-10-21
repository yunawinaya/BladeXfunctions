// GD_REVERT_PREPARE - Entry: a REVERT_GD job the worker holds (VALIDATING under a live lease); its request -> the GD.
// A request that cannot be read fails the job.
const prepareEntry = function prepareEntry(guard, rows, uuid) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", gdId: "0", idempotencyKey: "", rowVersion: 0, dbNow: "", jsAt: "", nonce: "", request: {}, result_code: "", result_message: "" };
  if (!job) return Object.assign(base, { result_code: "GDR_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (s(job.command) !== "REVERT_GD") return Object.assign(base, { result_code: "GDR_INVALID_DATA", result_message: "job command is " + s(job.command) });
  if (s(job.job_status) !== "VALIDATING") return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + s(job.job_status) + ": only a VALIDATING job is prepared" });
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const common = { jobId: s(job.id), organizationId: s(job.organization_id), idempotencyKey: s(job.idempotency_key), rowVersion: Number(job.row_version) || 0, dbNow: s(job.db_now), jsAt: String(Date.now()), nonce: s(uuid).replace(/[^0-9A-Za-z]/g, "").slice(0, 8) };
  let req = null;
  try {
    req = JSON.parse(s(job.request_payload));
  } catch (e) {
    req = null;
  }
  const gdId = req && typeof req === "object" ? s(req.gd_id) : "";
  if (!/^[0-9]{1,20}$/.test(gdId) || s(job.correlation_id) !== "GD|" + gdId || !/^[0-9]{1,20}$/.test(common.organizationId)) {
    return Object.assign(base, common, { route: "FAIL", result_code: "GDR_INVALID_REQUEST", result_message: "the job's request could not be read" });
  }
  return Object.assign(base, common, { route: "GO", gdId: gdId, request: req, result_message: "revert Goods Delivery " + s(req.gd_no || gdId) });
};
const guard = [{{node:code_node_RPguard.data}}][0];
const res = prepareEntry(guard, [{{node:sql_node_RPjob.data}}][0], [{{system:uuid}}][0]);
console.log("prepare entry", JSON.stringify({ route: res.route, gd: res.gdId, result: res.result_code, message: res.result_message }));
return res;
