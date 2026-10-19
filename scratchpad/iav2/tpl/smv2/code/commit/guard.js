// LOT_V2_COMMIT - Guard: job_id (digits), session tenant, this run's lease owner PUB|<nonce>
const publishGuard = function publishGuard(input) {
  const inp = input || {};
  const jobId = s(inp.jobId);
  const tenantId = s(inp.systemTenantId);
  const nonce = (s(inp.uuid).replace(/[^0-9a-fA-F]/g, "").toLowerCase() + "000000000000000000000000").slice(0, 24);
  const bad = (why) => ({ route: "REJECT", jobId: "0", tenantId: "0", nonce: nonce, leaseOwner: "PUB|" + nonce, result_code: "LOT_INVALID_DATA", result_message: why });
  if (!digits(jobId)) return bad("job_id: digits only");
  if (!digits(tenantId)) return bad("no session tenant");
  return { route: "CONTINUE", jobId: jobId, tenantId: tenantId, nonce: nonce, leaseOwner: "PUB|" + nonce, result_code: "", result_message: "" };
};
const res = publishGuard({ jobId: [{{workflowparams:job_id}}][0], systemTenantId: [{{system:tenantId}}][0], uuid: [{{system:uuid}}][0] });
console.log("commit guard", JSON.stringify(res));
return res;
