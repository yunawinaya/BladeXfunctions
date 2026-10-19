// PICKING_BULK_COMMIT - P4 check: every GD header reads back with its planned picking_status -> P4 DONE and the SPLIT
// hand-over (the Packing and the finish run in the next PICKING_BULK_COMMIT run); else retry
const MAX_RETRIES = 3;
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
const stepEnd = function stepEnd(entry, step, why, review) {
  const n = entry.attempts;
  const row = { id: entry.jobId, job_status: "COMMITTING_PICKING", progress_percent: 70, progress_message: "Saving the picked lines (retrying)", attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)), lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: "PK_STEP_RETRY", error_message: step + ": " + why, error_details: JSON.stringify({ step: step, why: why, attempt: n + 1 }), finished_at: null };
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Picking stays locked for review";
    return { route: "END", jobRows: [Object.assign(row, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the confirmation stopped half-way", attempt_count: n, next_attempt_at: null, error_code: "PK_RECONCILIATION_MISMATCH", error_message: msg, finished_at: entry.dbNow })], needJobUpd: "YES", result_code: "PK_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" };
  }
  return { route: "END", jobRows: [row], needJobUpd: "YES", result_code: "PK_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_PICKING" };
};
const commitP4Check = function commitP4Check(guard, entry, plan, back) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const got = {};
  for (const r of (Array.isArray(back) ? back : back ? [back] : []).filter((x) => x && s(x.id))) got[s(r.id)] = s(r.picking_status);
  const rows = Array.isArray(plan.rows) ? plan.rows : [];
  const off = rows.filter((r) => got[s(r.id)] !== s(r.picking_status));
  const base = { route: "SPLIT", stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_PICKING" };
  if (off.length) return Object.assign(base, stepEnd(entry, "P4_GD_HEADERS", off.length + " of " + rows.length + " Goods Delivery header(s) do not read back their picking status", false));
  // the hand-over: a SPLIT| lease the next run may take at once (the worker calls it in the same tick)
  const split = { id: entry.jobId, job_status: "COMMITTING_PICKING", progress_percent: 85, progress_message: "Picking saved; finishing", attempt_count: entry.attempts, next_attempt_at: null, lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil, row_version: entry.rowVersion + 2, error_code: null, error_message: null, error_details: null, finished_at: null };
  return Object.assign(base, { stepRows: [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: "P4_GD_HEADERS", step_status: "DONE", attempt_count: 1, started_at: entry.dbNow, finished_at: entry.dbNow, inventory_operation_id: "", result_ref: s(plan.result_message).slice(0, 500), error_code: null, error_message: null }], needStep: "YES", jobRows: [split], needJobUpd: "YES", result_message: "GD headers: " + s(plan.result_message) });
};
const guard = [{{node:code_node_PCguard.data}}][0];
const entry = [{{node:code_node_PCentry.data}}][0];
const res = commitP4Check(guard, entry, [{{node:code_node_PCp4plan.data}}][0], [{{node:sql_node_PCp4back.data}}][0]);
console.log("commit P4 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;