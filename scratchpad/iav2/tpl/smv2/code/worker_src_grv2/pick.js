// GR_COMPLETE_WORKER - Pick: this iteration's job (the cache index) from the tick's FRESH read; SKIP after the budget,
// when no longer due, under a live lease or a live claim row; else the claim gate rows (a dead claim: row_version + 1 first)
//@include _common.js
const workerPick = function workerPick(guard, plan, tickRows, indexRaw) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const rows = (Array.isArray(tickRows) ? tickRows : tickRows ? [tickRows] : []).filter((r) => r);
  const tick = rows[0] || {};
  const dbNow = s(tick.db_now) || s(plan.dbNow);
  const index = indexRaw === undefined || indexRaw === null || indexRaw === "" ? 0 : parseInt(String(indexRaw), 10) || 0;
  const planned = (plan.items || [])[index] || null;
  const t = (x) => {
    const m = String(x || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : NaN;
  };
  const elapsed = isNaN(t(plan.runStart)) || isNaN(t(dbNow)) ? 0 : Math.max(0, Math.round((t(dbNow) - t(plan.runStart)) / 1000));
  const base = { route: "SKIP", index: index, nextIndex: index + 1, dbNow: dbNow, leaseUntil: s(tick.lease_until), elapsed: elapsed, jobId: "0", organizationId: "0", grId: "0", item: null, rvBase: 0, rvRows: [], needRvUpd: "NO", claimName: "", claimRows: [], needClaimAdd: "NO", result_message: "" };
  if (!planned) return Object.assign(base, { result_message: "no item at index " + index });
  const fresh = rows.filter((r) => s(r.id) === planned.jobId)[0] || null;
  if (!fresh) return Object.assign(base, { jobId: planned.jobId, organizationId: planned.organizationId, result_message: "job " + planned.jobId + " is gone from the fresh read: skipped" });
  const item = workerItem(fresh);
  const out = Object.assign(base, { jobId: item.jobId, organizationId: item.organizationId, grId: item.grId, item: item });
  if (index > 0 && elapsed > PKC.worker_budget_seconds) return Object.assign(out, { result_message: "budget: " + elapsed + " s since the run start: job " + item.jobId + " is left for the next tick" });
  if (PKC.states.indexOf(item.jobStatus) < 0) return Object.assign(out, { result_message: "job " + item.jobId + " is " + item.jobStatus + " now: skipped" });
  if (item.leaseLive === "YES") return Object.assign(out, { result_message: "job " + item.jobId + " has a live lease of " + s(item.leaseOwner) + ": skipped" });
  if (item.dueNow !== "YES") return Object.assign(out, { result_message: "job " + item.jobId + " is not due before " + s(item.nextAttemptAt) + ": skipped" });
  if (item.gateClosed) return Object.assign(out, { result_message: "job " + item.jobId + ": " + item.gateClosed + " - skipped" });
  const rv = item.rowVersion;
  const dead = item.deadClaim === "YES";
  const rvBase = dead ? rv + 1 : rv;
  const name = "W0_CLAIM_" + rvBase;
  const counted = dead ? Math.min(item.attempts + 1, PKC.retry.max_retries) : item.attempts;
  return Object.assign(out, { route: "CLAIM", rvBase: rvBase, rvRows: dead ? [{ id: item.jobId, row_version: rvBase, attempt_count: counted }] : [], needRvUpd: dead ? "YES" : "NO", claimName: name, claimRows: [{ job_id: item.jobId, organization_id: item.organizationId, step_name: name, step_status: "DONE", attempt_count: 1, started_at: dbNow, inventory_operation_id: "", result_ref: guard.leaseOwner, error_code: null, error_message: null }], needClaimAdd: "YES", result_message: (dead ? "dead claim of " + item.claimOwner + " moved past (retry " + counted + "); " : "") + "claim " + name });
};
const workerItem = function workerItem(row) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const dead = String(row.dead_lease) === "1";
  const claimed = s(row.claim_id) !== "";
  return { jobId: s(row.id), organizationId: s(row.organization_id), grId: s(row.gr_id), prevStatus: s(row.prev_status) || "Draft", jobStatus: s(row.job_status), progressPercent: Number(row.progress_percent) || 0, progressMessage: s(row.progress_message), attempts: Number(row.attempt_count) || 0, nextAttemptAt: row.next_attempt_at || null, leaseOwner: row.lease_owner || null, leaseExpiresAt: row.lease_expires_at || null, deadLease: dead ? "YES" : "NO", deadOwner: dead ? s(row.lease_owner) : "", deadClaim: claimed && String(row.claim_live) !== "1" ? "YES" : "NO", claimOwner: claimed ? s(row.claim_owner) : "", rowVersion: Number(row.row_version) || 0, errorCode: row.error_code || null, errorMessage: row.error_message || null, errorDetails: row.error_details || null, leaseLive: String(row.lease_live) === "1" ? "YES" : "NO", dueNow: String(row.due_now) === "1" ? "YES" : "NO", gateClosed: String(row.claim_live) === "1" ? "a live worker claim row W0_CLAIM_" + s(row.row_version) + " of " + s(row.claim_owner) : "" };
};
const guard = [{{node:code_node_RWguard.data}}][0];
const plan = [{{node:code_node_RWplan.data}}][0];
const res = workerPick(guard, plan, [{{node:sql_node_RWtick.data}}][0], {{node:get_cache_RWidx.data}});
console.log("worker pick", JSON.stringify({ route: res.route, index: res.index, job: res.jobId, elapsed: res.elapsed, claim: res.claimName, rvUpd: res.needRvUpd, message: res.result_message }));
return res;
