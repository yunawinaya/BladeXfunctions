// IDA_V2_WORKER - Plan: the due jobs (at most 5) -> the loop's items, the run start
const workerItem = function workerItem(row) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const dead = String(row.dead_lease) === "1";
  const claimed = s(row.claim_id) !== "";
  return { jobId: s(row.id), organizationId: s(row.organization_id), grId: s(row.gr_id), prevStatus: s(row.prev_status), jobStatus: s(row.job_status), progressPercent: Number(row.progress_percent) || 0, progressMessage: s(row.progress_message), attempts: Number(row.attempt_count) || 0, nextAttemptAt: row.next_attempt_at || null, leaseOwner: row.lease_owner || null, leaseExpiresAt: row.lease_expires_at || null, deadLease: dead ? "YES" : "NO", deadOwner: dead ? s(row.lease_owner) : "", deadClaim: claimed && String(row.claim_live) !== "1" ? "YES" : "NO", claimOwner: claimed ? s(row.claim_owner) : "", rowVersion: Number(row.row_version) || 0, errorCode: row.error_code || null, errorMessage: row.error_message || null, errorDetails: row.error_details || null, leaseLive: String(row.lease_live) === "1" ? "YES" : "NO", dueNow: String(row.due_now) === "1" ? "YES" : "NO", gateClosed: String(row.claim_live) === "1" ? "a live worker claim row W0_CLAIM_" + s(row.row_version) + " of " + s(row.claim_owner) : "" };
};
const workerPlan = function workerPlan(guard, rows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter((r) => r);
  const dbNow = list.length ? s(list[0].db_now) : "";
  const items = list.filter((r) => s(r.id)).map(workerItem);
  const ids = items.map((i) => i.jobId).filter((x) => /^[0-9]{1,20}$/.test(x));
  return { route: items.length ? "WORK" : "IDLE", dbNow: dbNow, runStart: dbNow, items: items, count: items.length, jobIdsSql: ids.length ? ids.join(",") : "0", result_code: "", result_message: items.length ? items.length + " due job(s)" : "no due job" };
};
const guard = [{{node:code_node_RWguard.data}}][0];
const res = workerPlan(guard, [{{node:sql_node_RWpoll.data}}][0]);
console.log("worker plan", JSON.stringify({ route: res.route, count: res.count, jobs: res.items.map((i) => i.jobId + ":" + i.jobStatus + (i.deadLease === "YES" ? ":deadLease" : "") + (i.deadClaim === "YES" ? ":deadClaim" : "")) }));
return res;
