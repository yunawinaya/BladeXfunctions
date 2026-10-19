// PICKING_BULK_COMMIT - P1 check: every planned record is stored exactly once (counted by this job's job_line_key) ->
// P1 DONE; fewer -> retry (the next run merges again and adds only the missing ones); a duplicate -> REQUIRES_REVIEW
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
const commitP1Check = function commitP1Check(entry, merge, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const r = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((x) => x)[0] || {};
  const want = Number(entry.plannedRecords) || 0;
  const have = Number(r.job_records) || 0;
  const keys = Number(r.job_keys) || 0;
  const base = { route: "OK", stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_PICKING" };
  if (s(merge.route) !== "WRITE") return Object.assign(base, stepEnd(entry, "P1_PICKING", s(merge.result_message) || "the Picking could not be read", false));
  if (have > keys) return Object.assign(base, stepEnd(entry, "P1_PICKING", (have - keys) + " record(s) of this job are stored twice", true));
  if (have !== want) return Object.assign(base, stepEnd(entry, "P1_PICKING", have + " of " + want + " record(s) found after the write", false));
  return Object.assign(base, { stepRows: [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: "P1_PICKING", step_status: "DONE", attempt_count: 1, started_at: entry.dbNow, finished_at: entry.dbNow, inventory_operation_id: "", result_ref: have + " record(s); Picking " + s(r.to_status), error_code: null, error_message: null }], needStep: "YES", result_message: have + " record(s) stored; Picking " + s(r.to_status) });
};
const entry = [{{node:code_node_PCentry.data}}][0];
const res = commitP1Check(entry, [{{node:code_node_PCp1merge.data}}][0], [{{node:sql_node_PCp1back.data}}][0]);
console.log("commit P1 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
