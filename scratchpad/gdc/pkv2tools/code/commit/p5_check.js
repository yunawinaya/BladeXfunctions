// PICKING_BULK_COMMIT - P5 check: every Goods Delivery the chunks wrote for has its Packing (one live row per gd_id) -> P5
// DONE; a build failure or a missing Packing -> retry; two live Packings for one delivery -> REQUIRES_REVIEW
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
  const row = { id: entry.jobId, job_status: "COMMITTING_PICKING", progress_percent: 90, progress_message: "Updating the Packing (retrying)", attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.ceil(Math.min(30000, 2000 * Math.pow(2, n)) / 1000)), lease_owner: null, lease_expires_at: null, row_version: entry.rowVersion + 2, error_code: "PK_STEP_RETRY", error_message: step + ": " + why, error_details: JSON.stringify({ step: step, why: why, attempt: n + 1 }), finished_at: null };
  if (review || n >= MAX_RETRIES) {
    const msg = step + ": " + why + (review ? "" : " (after " + n + " retries)") + "; the Picking is saved, the Packing needs review";
    // the Picking itself is fully saved: its lock is released, only the Packing waits for review
    return { route: "END", jobRows: [Object.assign(row, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Picking saved; the Packing needs review", attempt_count: n, next_attempt_at: null, error_code: "PK_RECONCILIATION_MISMATCH", error_message: msg, finished_at: entry.dbNow })], needJobUpd: "YES", unlockRows: [{ id: entry.pickingId, is_processing: 0 }], needUnlock: "YES", result_code: "PK_RECONCILIATION_MISMATCH", result_message: msg, job_status: "REQUIRES_REVIEW" };
  }
  return { route: "END", jobRows: [row], needJobUpd: "YES", result_code: "PK_STEP_RETRY", result_message: step + ": " + why + " - retry " + (n + 1) + " of " + MAX_RETRIES, job_status: "COMMITTING_PICKING" };
};
const commitP5Check = function commitP5Check(entry, build, back) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const live = {};
  for (const r of (Array.isArray(back) ? back : back ? [back] : []).filter((x) => x && s(x.gd_id))) live[s(r.gd_id)] = Number(r.n) || 0;
  const want = s(build.expectSql).split(",").map((x) => x.replace(/'/g, "")).filter((x) => x && x !== "0");
  const base = { route: "OK", stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", result_code: "", result_message: "", job_status: "COMMITTING_PICKING" };
  if (s(build.route) !== "WRITE") return Object.assign(base, stepEnd(entry, "P5_PACKING", s(build.result_message), false));
  const twice = want.filter((g) => (live[g] || 0) > 1);
  if (twice.length) return Object.assign(base, stepEnd(entry, "P5_PACKING", "Goods Delivery " + twice.join(", ") + " has more than one live Packing", true));
  const missing = want.filter((g) => !live[g]);
  if (missing.length) return Object.assign(base, stepEnd(entry, "P5_PACKING", "no Packing found for Goods Delivery " + missing.join(", ") + " after the write", false));
  return Object.assign(base, { stepRows: [{ job_id: entry.jobId, organization_id: entry.organizationId, step_name: "P5_PACKING", step_status: "DONE", attempt_count: 1, started_at: entry.dbNow, finished_at: entry.dbNow, inventory_operation_id: "", result_ref: s(build.result_message).slice(0, 500), error_code: null, error_message: null }], needStep: "YES", result_message: s(build.result_message) });
};
const entry = [{{node:code_node_PCentry.data}}][0];
const res = commitP5Check(entry, [{{node:code_node_PCp5expect.data}}][0], [{{node:sql_node_PCp5back.data}}][0]);
console.log("commit P5 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
