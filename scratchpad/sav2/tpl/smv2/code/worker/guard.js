// LOT_V2_WORKER - Guard: optional job_id (digits: this job only), session tenant, this run's lease owner WRK|<nonce>.
// Called by the form after a submit and by the list's mounted kick (no Quartz): drains up to 5 due SAVE_LOT jobs.
// Ownership of a job = the CLAIM GATE (unique gd_publish_step W0_CLAIM_<row_version>); the lease is the liveness timer.
const workerGuard = function workerGuard(input) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const inp = input || {};
  const jobId = s(inp.jobId) || "0";
  const tenantId = s(inp.systemTenantId);
  const nonce = (s(inp.uuid).replace(/[^0-9a-fA-F]/g, "").toLowerCase() + "000000000000000000000000").slice(0, 24);
  const bad = (why) => ({ route: "REJECT", jobId: "0", tenantId: "0", nonce: nonce, leaseOwner: "WRK|" + nonce, result_code: "LOT_INVALID_DATA", result_message: why });
  if (!/^[0-9]{1,20}$/.test(jobId)) return bad("job_id: digits only (or empty to poll)");
  if (!/^[0-9]{1,20}$/.test(tenantId)) return bad("no session tenant");
  return { route: "CONTINUE", jobId: jobId, tenantId: tenantId, nonce: nonce, leaseOwner: "WRK|" + nonce, result_code: "", result_message: "" };
};
const res = workerGuard({ jobId: [{{workflowparams:job_id}}][0], systemTenantId: [{{system:tenantId}}][0], uuid: [{{system:uuid}}][0] });
console.log("worker guard", JSON.stringify(res));
return res;
