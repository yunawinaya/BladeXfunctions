// GR_COMPLETE_COMMIT - Entry: the job, its step rows, the manifest, the GR's lock and the purchase-order locks -> what this
// run does (phase A = C0 revalidate + purchase-order locks, C1 batches, C1B the generated batch numbers on the GR lines,
// C2 inventory, then SPLIT; phase B = C3 purchase orders, C4 putaway + in-transit ledger, C5 the receipt, then COMPLETED)
// a run's lease: 10 min + 0.6 s per stock movement (about twice the 0.14 s per lock key the engine took on dev, 2026-10-19),
// at most 90 min - it must outlast the engine call, or a re-kick runs the job a second time while this run still posts
const leaseFor = (dbNow, movements) => dbAddSeconds(dbNow, Math.min(5400, 600 + Math.ceil(0.6 * Math.max(0, Number(movements) || 0))));
const commitEntry = function commitEntry(guard, jobRows, stepRows, payloadRows, grRows, lockRows, batchRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  let c0Waits = 0;
  for (const r of list(stepRows)) {
    if (s(r.step_status) === "DONE") done[s(r.step_name)] = true;
    if (/^C0_WAIT\|/.test(s(r.step_name))) c0Waits++;
  }
  const gr = list(grRows)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: String(Date.now()), jobId: guard.jobId, organizationId: "0", grId: "0", grNo: "", plantId: "0", prevStatus: "", idempotencyKey: "",
    jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", partPrefix: "", manifest: {}, poLocks: {}, poIdsSql: "0", grNoSql: "", ourBatchIds: [], jitter: 0, c0Waits: c0Waits,
    jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", batchDelRows: [], needBatchDel: "NO", freeRows: [], needFree: "NO",
    needC0: "NO", needC1: "NO", needC1B: "NO", needC2: "NO", needC3: "NO", needC4: "NO", needC5: "NO", result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("GRC_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("GRC_INVALID_DATA", "job is deleted");
  if (!digits(job.organization_id)) return answer("GRC_INVALID_DATA", "job organization is not an id");
  if (s(job.command) !== "COMPLETE_GR") return answer("GRC_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_GR"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": GR_COMPLETE_COMMIT works on READY_TO_COMMIT / COMMITTING_GR only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_GR" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_GR" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  let m = null;
  try {
    m = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  } catch (e) {
    m = null;
  }
  const PARTS = ["BATCH", "ENGINE", "PO", "TO", "GR", "AFTER"];
  const valid = m && s(m.job_id) === guard.jobId && digits(m.gr_id) && s(job.correlation_id) === "GR|" + s(m.gr_id) && m.parts && PARTS.every((k) => Array.isArray(m.parts[k]) && m.parts[k].length)
    && Array.isArray(m.po_ids) && m.po_ids.every((x) => digits(x));
  const poIds = valid ? m.po_ids.map(s) : [];
  const entry = { jobId: guard.jobId, organizationId: s(job.organization_id), grId: valid ? s(m.gr_id) : "0", grNo: valid ? s(m.gr_no) : "", plantId: valid && digits(m.plant_id) ? s(m.plant_id) : "0",
    prevStatus: s(job.prev_status) || "Draft", dbNow: dbNow, jsAt: String(Date.now()), attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0, poLocks: poLockState(lockRows),
    poIdsSql: ["0"].concat(poIds).join(","), grNoSql: valid ? s(m.gr_no).replace(/\\/g, "\\\\").replace(/'/g, "''") : "",
    ourBatchIds: list(batchRows).map((r) => s(r.id)).filter(digits), c0Waits: c0Waits, jitter: parseInt(s(guard.nonce).slice(0, 4) || "0", 16) % 5 };
  // before C2 the receipt can go back to its status before the submit - when it is Processing under this job's lock
  const lockMine = s(gr.gr_status) === "Processing" && s(gr.lock_ref) !== "" && s(gr.lock_ref) === s(job.idempotency_key) && s(gr.gr_v2_job_id) === guard.jobId;
  entry.unlockOk = !done.C2_INVENTORY && lockMine ? "YES" : "NO";
  if (!valid) {
    if (!done.C2_INVENTORY) return Object.assign({}, base, entry, failNoWrite(entry, "GRC_INVALID_DATA", "the prepared payload is missing or is not this job's: no stock was moved"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "the prepared payload is missing or is not this job's after the stock was moved", true), { route: "REVIEW" });
  }
  if (!done.C2_INVENTORY && !lockMine) return Object.assign({}, base, entry, failNoWrite(entry, "GRC_NOT_LOCKED", "the Goods Receiving is no longer Processing under this job: no stock was moved"), { route: "FAIL" });
  const phase = done.C2_INVENTORY ? "B" : "A";
  const c = m.counts || {};
  const leaseUntil = leaseFor(dbNow, c.movements) || s(job.lease_until);
  const claim = jobRow(entry, { job_status: "COMMITTING_GR", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 85),
    progress_message: phase === "A" ? "Receiving " + num(c.lines) + " line(s)" : "Updating the purchase orders and the putaway", attempt_count: entry.attempts, row_version: entry.rowVersion + 1,
    error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, lease_owner: guard.leaseOwner, lease_expires_at: leaseUntil });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, idempotencyKey: s(job.idempotency_key), partPrefix: "P|" + s(m.nonce).replace(/[^0-9A-Za-z]/g, "") + "|", manifest: m, leaseUntil: leaseUntil,
    jobRows: [claim], needJobUpd: "YES",
    needC0: phase === "A" && !done.C0_REVALIDATE ? "YES" : "NO",
    needC1: phase === "A" && !done.C1_BATCHES && num(c.batches) > 0 ? "YES" : "NO",
    needC1B: phase === "A" && !done.C1B_LINES && num(c.autoBatches) > 0 ? "YES" : "NO",
    needC2: phase === "A" ? "YES" : "NO",
    needC3: phase === "B" && !done.C3_PO && num(c.poLines) + num(c.onOrder) > 0 ? "YES" : "NO",
    needC4: phase === "B" && !done.C4_PUTAWAY && (num(c.toLines) + num(c.inTransit) > 0) ? "YES" : "NO",
    needC5: phase === "B" && !done.C5_FINISH ? "YES" : "NO",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_GR",
  });
};
const guard = [{{node:code_node_RCguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_RCjob.data}}][0], [{{node:sql_node_RCsteps.data}}][0], [{{node:sql_node_RCpayload.data}}][0], [{{node:sql_node_RCgr.data}}][0], [{{node:sql_node_RCpolock.data}}][0], [{{node:sql_node_RCbatch.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, c0: res.needC0, c1: res.needC1, c1b: res.needC1B, c2: res.needC2, c3: res.needC3, c4: res.needC4, c5: res.needC5, unlock: res.unlockOk, locks: res.poLocks, result: res.result_code, message: res.result_message }));
return res;
