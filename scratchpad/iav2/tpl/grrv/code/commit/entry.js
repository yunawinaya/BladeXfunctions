// GR_REVERT_COMMIT - Entry: the job, its step rows, the manifest, the receipt's lock and the purchase-order locks -> what this
// run does (phase A = R0 revalidate + purchase-order locks, R1 inventory, then SPLIT; phase B = R2 costing, R3 documents,
// R4 purchase orders, R5 the receipt, then COMPLETED)
const commitEntry = function commitEntry(guard, jobRows, stepRows, payloadRows, grRows, lockRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  let r0Waits = 0;
  for (const r of list(stepRows)) {
    if (s(r.step_status) === "DONE") done[s(r.step_name)] = true;
    if (/^R0_WAIT\|/.test(s(r.step_name))) r0Waits++;
  }
  const gr = list(grRows)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: String(Date.now()), jobId: guard.jobId, organizationId: "0", grId: "0", grNo: "", plantId: "0", prevStatus: "", idempotencyKey: "",
    jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", partPrefix: "", manifest: {}, poLocks: {}, poIdsSql: "0", grNoSql: "", jitter: 0, r0Waits: r0Waits,
    jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", freeRows: [], needFree: "NO",
    needR0: "NO", needR1: "NO", needR2: "NO", needR3: "NO", needR4: "NO", needR5: "NO", result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("GRV_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("GRV_INVALID_DATA", "job is deleted");
  if (!digits(job.organization_id)) return answer("GRV_INVALID_DATA", "job organization is not an id");
  if (s(job.command) !== "REVERT_GR") return answer("GRV_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_REVERT"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": GR_REVERT_COMMIT works on READY_TO_COMMIT / COMMITTING_REVERT only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_REVERT" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_REVERT" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  let m = null;
  try {
    m = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  } catch (e) {
    m = null;
  }
  const PARTS = ["ENGINE", "COST", "DOCS", "PO", "CHECK"];
  const prev = s(job.prev_status);
  const valid = m && s(m.job_id) === guard.jobId && digits(m.gr_id) && s(job.correlation_id) === "GR|" + s(m.gr_id) && m.parts && PARTS.every((k) => Array.isArray(m.parts[k]) && m.parts[k].length)
    && Array.isArray(m.po_ids) && m.po_ids.every((x) => digits(x)) && ["Completed", "Received"].indexOf(prev) >= 0;
  const poIds = valid ? m.po_ids.map(s) : [];
  const entry = { jobId: guard.jobId, organizationId: s(job.organization_id), grId: valid ? s(m.gr_id) : "0", grNo: valid ? s(m.gr_no) : "", plantId: valid && digits(m.plant_id) ? s(m.plant_id) : "0",
    prevStatus: prev, dbNow: dbNow, jsAt: String(Date.now()), attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0, poLocks: poLockState(lockRows), poIdsSql: idsSql(poIds),
    grNoSql: valid ? s(m.gr_no).replace(/\\/g, "\\\\").replace(/'/g, "''") : "", r0Waits: r0Waits, jitter: parseInt(s(guard.nonce).slice(0, 4) || "0", 16) % 5 };
  // before R1 the receipt can go back to its status before the submit - when it is Processing under this job's lock
  const lockMine = s(gr.gr_status) === "Processing" && s(gr.lock_ref) !== "" && s(gr.lock_ref) === s(job.idempotency_key) && s(gr.gr_v2_job_id) === guard.jobId;
  entry.unlockOk = !done.R1_INVENTORY && lockMine ? "YES" : "NO";
  if (!valid) {
    if (!done.R1_INVENTORY) return Object.assign({}, base, entry, failNoWrite(entry, "GRV_INVALID_DATA", "the prepared payload is missing or is not this job's: no stock was moved"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "the prepared payload is missing or is not this job's after the stock was moved", true), { route: "REVIEW" });
  }
  if (!done.R1_INVENTORY && !lockMine) return Object.assign({}, base, entry, failNoWrite(entry, "GRV_NOT_LOCKED", "the Goods Receiving is no longer Processing under this job: no stock was moved"), { route: "FAIL" });
  const phase = done.R1_INVENTORY ? "B" : "A";
  const c = m.counts || {};
  const claim = jobRow(entry, { job_status: "COMMITTING_REVERT", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 85),
    progress_message: phase === "A" ? "Taking back the stock of " + num(c.lines) + " line(s)" : "Restoring costing, documents and purchase orders", attempt_count: entry.attempts,
    row_version: entry.rowVersion + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null,
    lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, idempotencyKey: s(job.idempotency_key), partPrefix: "P|" + s(m.nonce).replace(/[^0-9A-Za-z]/g, "") + "|", manifest: m,
    jobRows: [claim], needJobUpd: "YES",
    needR0: phase === "A" && !done.R0_REVALIDATE ? "YES" : "NO",
    needR1: phase === "A" ? "YES" : "NO",
    needR2: phase === "B" && !done.R2_COSTING && num(c.fifo) + num(c.waDelete) + num(c.waRestate) > 0 ? "YES" : "NO",
    needR3: phase === "B" && !done.R3_DOCS && num(c.putaway) + num(c.transit) + num(c.qi) + num(c.batches) > 0 ? "YES" : "NO",
    needR4: phase === "B" && !done.R4_PO && num(c.poLines) + num(c.onOrder) > 0 ? "YES" : "NO",
    needR5: phase === "B" && !done.R5_FINISH ? "YES" : "NO",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_REVERT",
  });
};
const guard = [{{node:code_node_VCguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_VCjob.data}}][0], [{{node:sql_node_VCsteps.data}}][0], [{{node:sql_node_VCpayload.data}}][0], [{{node:sql_node_VCgr.data}}][0], [{{node:sql_node_VCpolock.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, r0: res.needR0, r1: res.needR1, r2: res.needR2, r3: res.needR3, r4: res.needR4, r5: res.needR5, unlock: res.unlockOk, locks: res.poLocks, result: res.result_code, message: res.result_message }));
return res;
