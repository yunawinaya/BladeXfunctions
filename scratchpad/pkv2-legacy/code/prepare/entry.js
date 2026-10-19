// PICKING_BULK_PREPARE - Entry: the job must be a CONFIRM_PICKING job the worker holds (VALIDATING under a live lease);
// its request -> the ids the set-based reads need. A request that cannot be read fails the job (FAILED, lock released).
const prepareEntry = function prepareEntry(guard, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", pickingId: "0", rowVersion: 0, dbNow: "", confirmedAt: "", request: {}, uomRowIdsSql: "0", result_code: "", result_message: "" };
  if (!job) return Object.assign(base, { result_code: "PK_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (s(job.command) !== "CONFIRM_PICKING") return Object.assign(base, { result_code: "PK_INVALID_DATA", result_message: "job command is " + s(job.command) });
  if (s(job.job_status) !== "VALIDATING") return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + s(job.job_status) + ": only a VALIDATING job is prepared" });
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const pickingId = s(job.picking_id);
  const common = { jobId: s(job.id), organizationId: s(job.organization_id), pickingId: /^[0-9]{1,20}$/.test(pickingId) ? pickingId : "0", rowVersion: Number(job.row_version) || 0, dbNow: s(job.db_now) };
  let req = null;
  try {
    req = JSON.parse(s(job.request_payload));
  } catch (e) {
    req = null;
  }
  if (!req || typeof req !== "object" || s(req.picking_id) !== pickingId || !/^[0-9]{1,20}$/.test(pickingId)) return Object.assign(base, common, { route: "FAIL", result_code: "PK_INVALID_REQUEST", result_message: "the job's request could not be read" });
  const uomRows = (Array.isArray(req.lines) ? req.lines : []).filter((l) => l && /^[0-9]{1,20}$/.test(s(l.pick_uom)) && /^[0-9]{1,20}$/.test(s(l.row_id))).map((l) => s(l.row_id));
  // DB datetimes are Malaysia time (UTC+8): confirmed_at as code_node_oHIIKfiw writes it
  const confirmedAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("T", " ");
  return Object.assign(base, common, { route: "GO", request: req, confirmedAt: confirmedAt, uomRowIdsSql: uomRows.length ? uomRows.join(",") : "0", result_message: "prepare " + s(req.operation) + " for Picking " + pickingId });
};
const guard = [{{node:code_node_PPguard.data}}][0];
const res = prepareEntry(guard, [{{node:sql_node_PPjob.data}}][0]);
console.log("prepare entry", JSON.stringify({ route: res.route, picking: res.pickingId, result: res.result_code, message: res.result_message }));
return res;
