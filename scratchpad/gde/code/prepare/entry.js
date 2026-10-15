// GD_EDIT_PREPARE - Entry: an EDIT_GD job the worker holds (VALIDATING under a live lease); its request -> the GD and the ids
// the edit brings (the reads cover the GD as stored AND the edit). A request that cannot be read fails the job.
const prepareEntry = function prepareEntry(guard, rows, uuid) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
  const job = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r && s(r.id))[0] || null;
  const base = { route: "NOOP", jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", gdId: "0", idempotencyKey: "", rowVersion: 0, dbNow: "", nonce: "", request: {},
    deltaMaterialIdsSql: "0", deltaSoLineIdsSql: "0", deltaSoLineIdsQuoted: "'0'", deltaSoIdsSql: "0", deltaAllocMaterialIdsSql: "0", deltaAllocLineIdsSql: "0", result_code: "", result_message: "" };
  if (!job) return Object.assign(base, { result_code: "GDE_INVALID_DATA", result_message: "job " + guard.jobId + " not found" });
  if (s(job.command) !== "EDIT_GD") return Object.assign(base, { result_code: "GDE_INVALID_DATA", result_message: "job command is " + s(job.command) });
  if (s(job.job_status) !== "VALIDATING") return Object.assign(base, { result_code: "JOB_ILLEGAL_TRANSITION", result_message: "job is " + s(job.job_status) + ": only a VALIDATING job is prepared" });
  if (String(job.lease_live) !== "1") return Object.assign(base, { result_code: "JOB_ROW_VERSION_CONFLICT", result_message: "the worker's lease on the job has expired: not prepared" });
  const common = { jobId: s(job.id), organizationId: s(job.organization_id), idempotencyKey: s(job.idempotency_key), rowVersion: Number(job.row_version) || 0, dbNow: s(job.db_now), nonce: s(uuid).replace(/[^0-9A-Za-z]/g, "").slice(0, 8) };
  let req = null;
  try { req = JSON.parse(s(job.request_payload)); } catch (e) { req = null; }
  const gdId = req && typeof req === "object" ? s(req.gd_id) : "";
  if (!digits(gdId) || s(job.correlation_id) !== "GD|" + gdId || !digits(common.organizationId) || !req.delta || !Array.isArray(req.delta.layout)) {
    return Object.assign(base, common, { route: "FAIL", result_code: "GDE_INVALID_REQUEST", result_message: "the job's request could not be read" });
  }
  const rows2 = (req.delta.added || []).concat((req.delta.lines || []).map((l) => l.cells || {}));
  const ids = (k) => [...new Set(rows2.map((r) => s(r[k])).filter(digits))];
  const soIds = new Set(ids("line_so_id"));
  const hso = (req.delta.header || {}).so_id;
  for (const x of Array.isArray(hso) ? hso : hso ? [hso] : []) if (digits(x)) soIds.add(s(x));
  const sl = ids("so_line_item_id");
  const sql = (a) => (a.length ? a.join(",") : "0");
  return Object.assign(base, common, { route: "GO", gdId: gdId, request: req, deltaMaterialIdsSql: sql(ids("material_id")), deltaSoLineIdsSql: sql(sl),
    deltaSoLineIdsQuoted: sl.length ? sl.map((x) => "'" + x + "'").join(",") : "'0'", deltaSoIdsSql: sql([...soIds]), result_message: "edit Goods Delivery " + s(req.gd_no || gdId) },
    geAllocIds(req.delta.added, req.delta.lines));
};
