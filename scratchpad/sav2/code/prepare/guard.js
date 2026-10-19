// SA_V2_PREPARE - Guard: job_id (digits), session tenant
const prepareGuard = function prepareGuard(input) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const jobId = s(input.jobId);
  const tenantId = s(input.systemTenantId);
  const bad = (why) => ({ route: "REJECT", jobId: "0", tenantId: "0", result_code: "SA_INVALID_DATA", result_message: why });
  if (!/^[0-9]{1,20}$/.test(jobId)) return bad("job_id: digits only");
  if (!/^[0-9]{1,20}$/.test(tenantId)) return bad("no session tenant");
  return { route: "CONTINUE", jobId: jobId, tenantId: tenantId, result_code: "", result_message: "" };
};
const res = prepareGuard({ jobId: [{{workflowparams:job_id}}][0], systemTenantId: [{{system:tenantId}}][0] });
console.log("prepare guard", JSON.stringify(res));
return res;
