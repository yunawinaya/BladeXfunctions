// PICKING_FC_DRIVE - Guard: job_id (digits), the caller's lease (the worker's WRK|<nonce>: DRIVE takes it over), session tenant,
// this run's lease owner DRV|<nonce>. Called by PICKING_ASYNC_WORKER only, for a force complete's job (Picking V2 stage 1d).
const driveGuard = function driveGuard(input) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const inp = input || {};
  const jobId = s(inp.jobId);
  const tenantId = s(inp.systemTenantId);
  const callerLease = s(inp.callerLease);
  const nonce = (s(inp.uuid).replace(/[^0-9a-fA-F]/g, "").toLowerCase() + "000000000000000000000000").slice(0, 24);
  const bad = (why) => ({ route: "REJECT", jobId: "0", tenantId: "0", nonce: nonce, leaseOwner: "DRV|" + nonce, callerLease: "", result_code: "PK_INVALID_REQUEST", result_message: why });
  if (!/^[0-9]{1,20}$/.test(jobId)) return bad("job_id: digits only");
  if (!/^[0-9]{1,20}$/.test(tenantId)) return bad("no session tenant");
  if (callerLease && !/^[A-Z]{3}\|[0-9a-f]{1,32}$/.test(callerLease)) return bad("lease_owner: the calling worker's lease (WRK|<nonce>) or empty");
  return { route: "CONTINUE", jobId: jobId, tenantId: tenantId, nonce: nonce, leaseOwner: "DRV|" + nonce, callerLease: callerLease, result_code: "", result_message: "" };
};
const res = driveGuard({ jobId: [{{workflowparams:job_id}}][0], callerLease: [{{workflowparams:lease_owner}}][0], systemTenantId: [{{system:tenantId}}][0], uuid: [{{system:uuid}}][0] });
console.log("drive guard", JSON.stringify(res));
return res;
