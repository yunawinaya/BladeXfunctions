// GD_EDIT_SUBMIT - Ops: a Sales Order save's RELEASE / CANCEL_HELD of the job it holds on this GD (gd_id + cascade_ref). The
// worker's claim gate W0_CLAIM_<row_version> first: a worker claiming the same job fails one of the two inserts. RELEASE ->
// READY_TO_COMMIT due now + a RELEASE step row (GD_EDIT_COMMIT commits a held job only after it); CANCEL_HELD -> the hold
// ends now and the caller runs GD_EDIT_WORKER on the job (its EXPIRE path: CANCELLED, the GD and our Picking unlocked)
const submitOps = function submitOps(guard, rows) {
  const r = list(rows)[0] || {};
  const dbNow = s(r.db_now);
  const base = { route: "NONE", code: "200", message: "", jobId: "0", jobStatus: "", rowVersion: 0, claimRows: [], jobRows: [], stepRows: [], needStep: "NO" };
  if (!digits(r.job_id) || s(r.job_status) !== "HELD" || s(r.cascade_ref) !== guard.cascadeRef) return Object.assign(base, { message: "nothing is held on this delivery for " + guard.cascadeRef });
  const jobId = s(r.job_id), rv = num(r.row_version);
  if (num(r.gate_taken) > 0) return Object.assign(base, { route: "BUSY", code: "409", message: "the worker is on job " + jobId + " right now", jobId: jobId, jobStatus: "HELD" });
  const release = guard.operation === "RELEASE";
  const step = (name, ref) => ({ job_id: jobId, organization_id: s(r.organization_id), step_name: name, step_status: "DONE", attempt_count: 1, started_at: dbNow, inventory_operation_id: "",
    result_ref: ref, error_code: null, error_message: null });
  const job = { id: jobId, job_status: release ? "READY_TO_COMMIT" : "HELD", row_version: rv + 1, next_attempt_at: dbNow, lease_owner: null, lease_expires_at: null,
    progress_message: release ? "Released by its sales order save" : "Cancelled by its sales order save" };
  return Object.assign(base, { route: "WRITE", jobId: jobId, jobStatus: job.job_status, rowVersion: rv + 1, claimRows: [step("W0_CLAIM_" + rv, "SUB|" + guard.cascadeRef)], jobRows: [job],
    stepRows: release ? [step("RELEASE", guard.cascadeRef)] : [], needStep: release ? "YES" : "NO" });
};
// the answer: a write is only reported once it reads back
const submitOpsBack = function submitOpsBack(guard, ops, rows) {
  const b = list(rows)[0] || {};
  const res = (route, code, message, status) => ({ route: route, code: code, message: message, reason: "", command: "EDIT_GD", job_id: ops.jobId === "0" ? "" : s(ops.jobId), job_status: s(status),
    gd_id: s(guard.gdId), gd_no: "", line_count: "0", progress_percent: "0", progress_message: "", error_code: "", error_message: "", picking_reversal_note: "", credit_limit_note: "",
    cascade_ref: s(guard.cascadeRef), evidence: JSON.stringify({ v: 1, workflow: "GD_EDIT_SUBMIT", operation: s(guard.operation), route: route, code: code }) });
  if (ops.route !== "WRITE") return res(ops.route, ops.code, ops.message, ops.jobStatus);
  const atVersion = s(b.job_id) === s(ops.jobId) && num(b.row_version) === num(ops.rowVersion);
  if (guard.operation === "RELEASE")
    return atVersion && s(b.job_status) === "READY_TO_COMMIT" && num(b.released) > 0 ? res("RELEASED", "200", "released", b.job_status)
      : res("STOP", "500", "the release of job " + ops.jobId + " did not read back (" + s(b.job_status) + ")", b.job_status);
  return atVersion && s(b.job_status) === "HELD" && num(b.ended) === 1 ? res("CANCELLING", "200", "the hold ended: run GD_EDIT_WORKER on the job", b.job_status)
    : res("STOP", "500", "the cancel of job " + ops.jobId + " did not read back (" + s(b.job_status) + ")", b.job_status);
};
