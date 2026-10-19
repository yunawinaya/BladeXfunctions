// PUTAWAY_BULK_COMMIT - Entry: the job, its step rows, the manifest and the putaway's lock -> what this run does (phase A =
// P0 revalidate, P1 inventory, then SPLIT; phase B = P2 the putaway's lines / records / status, P3 the in-transit ledger,
// P4 the receipt's status + the putaway released, then COMPLETED), the lease claim
const commitEntry = function commitEntry(guard, jobRows, stepRows, payloadRows, toRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") done[s(r.step_name)] = true;
  const to = list(toRows)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: String(Date.now()), jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", toId: "0", toNo: "", grId: "0", idempotencyKey: "",
    jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", partPrefix: "", manifest: {}, jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO",
    needP0: "NO", needP1: "NO", needP2: "NO", needP3: "NO", needP4: "NO", result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("PWC_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("PWC_INVALID_DATA", "job is deleted");
  if (!digits(job.organization_id)) return answer("PWC_INVALID_DATA", "job organization is not an id");
  if (s(job.command) !== "COMPLETE_PUTAWAY") return answer("PWC_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_PUTAWAY"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": PUTAWAY_BULK_COMMIT works on READY_TO_COMMIT / COMMITTING_PUTAWAY only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_PUTAWAY" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_PUTAWAY" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  let m = null;
  try {
    m = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  } catch (e) {
    m = null;
  }
  const PARTS = ["ENGINE", "TO", "IT", "GR"];
  const valid = m && s(m.job_id) === guard.jobId && digits(m.to_id) && s(job.correlation_id) === "TO|" + s(m.to_id) && m.parts && PARTS.every((k) => Array.isArray(m.parts[k]) && m.parts[k].length);
  const entry = { jobId: guard.jobId, tenantId: guard.tenantId, organizationId: s(job.organization_id), toId: valid ? s(m.to_id) : "0", toNo: valid ? s(m.to_no) : "",
    grId: valid && digits(m.gr_id) ? s(m.gr_id) : "0", dbNow: dbNow, jsAt: String(Date.now()), attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0 };
  // before P1 the putaway can be released - when it is locked under this job's lock
  const lockMine = String(to.is_processing) === "1" && s(to.lock_ref) !== "" && s(to.lock_ref) === s(job.idempotency_key);
  entry.unlockOk = !done.P1_INVENTORY && lockMine ? "YES" : "NO";
  if (!valid) {
    if (!done.P1_INVENTORY) return Object.assign({}, base, entry, failNoWrite(entry, "PWC_INVALID_DATA", "the prepared payload is missing or is not this job's: no stock was moved"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "the prepared payload is missing or is not this job's after the stock was moved", true), { route: "REVIEW" });
  }
  if (!done.P1_INVENTORY && !lockMine) return Object.assign({}, base, entry, failNoWrite(entry, "PWC_NOT_LOCKED", "the putaway is no longer locked by this job: no stock was moved"), { route: "FAIL" });
  const phase = done.P1_INVENTORY ? "B" : "A";
  const c = m.counts || {};
  const claim = jobRow(entry, { job_status: "COMMITTING_PUTAWAY", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 85),
    progress_message: phase === "A" ? "Putting away " + num(c.rows) + " row(s)" : "Updating the putaway and the in-transit ledger", attempt_count: entry.attempts, row_version: entry.rowVersion + 1,
    error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, idempotencyKey: s(job.idempotency_key), partPrefix: "P|" + s(m.nonce).replace(/[^0-9A-Za-z]/g, "") + "|", manifest: m, jobRows: [claim], needJobUpd: "YES",
    needP0: phase === "A" && !done.P0_REVALIDATE ? "YES" : "NO",
    needP1: phase === "A" ? "YES" : "NO",
    needP2: phase === "B" && !done.P2_TO ? "YES" : "NO",
    needP3: phase === "B" && !done.P3_TRANSIT && num(c.itUpdates) + num(c.itCreates) > 0 ? "YES" : "NO",
    needP4: phase === "B" && !done.P4_FINISH ? "YES" : "NO",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_PUTAWAY",
  });
};
const guard = [{{node:code_node_PCguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_PCjob.data}}][0], [{{node:sql_node_PCsteps.data}}][0], [{{node:sql_node_PCpayload.data}}][0], [{{node:sql_node_PCto.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, p0: res.needP0, p1: res.needP1, p2: res.needP2, p3: res.needP3, p4: res.needP4, unlock: res.unlockOk, result: res.result_code, message: res.result_message }));
return res;
