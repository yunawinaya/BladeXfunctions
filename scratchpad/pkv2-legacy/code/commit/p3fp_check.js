// PICKING_BULK_COMMIT - P3 check (Full Picking): the recount settled (a pass read the lines and found nothing to write) -> P3
// DONE; else retry (another Picking of the same GD lines kept changing them)
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
const commitP3fpCheck = function commitP3fpCheck(entry, raw) {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch (e) {
      v = null;
    }
  }
  const st = Array.isArray(v) && v.length >= 4 ? v.map((x) => Number(x) || 0) : [0, 0, 0, 0];
  const base = { route: "OK", stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_PICKING" };
  if (st[0] !== 1) return Object.assign(base, stepEnd(entry, "P3_GD_LINES", "the GD lines' recount had not settled after " + st[1] + " pass(es): another Picking of the same lines is being saved", false));
  const ref = st[2] + " GD line value(s) written in " + st[1] + " pass(es)" + (st[3] ? "; " + st[3] + " line(s) picked above the GD quantity" : "");
  return Object.assign(base, { stepRows: [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: "P3_GD_LINES", step_status: "DONE", attempt_count: 1, started_at: entry.dbNow, finished_at: entry.dbNow, inventory_operation_id: "", result_ref: ref, error_code: null, error_message: null }], needStep: "YES", result_message: ref });
};
const entry = [{{node:code_node_PCentry.data}}][0];
const res = commitP3fpCheck(entry, [{{node:get_cache_PCp3fpEnd.data}}][0]);
console.log("commit P3 check (Full Picking)", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
