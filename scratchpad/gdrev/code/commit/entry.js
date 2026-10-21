// GD_REVERT_COMMIT - Entry: the job, its step rows, the manifest and the GD's lock -> what this run does. Phase A = R0
// revalidate, R1 the stock (then SPLIT); phase B = R2 reservations, R3 sales orders, R4 the delivery (Created last: the
// unlock), then COMPLETED. A revert that moves no stock runs both phases in one run.
const revertEntry = function revertEntry(guard, jobRows, stepRows, payloadRows, gdRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const jsAt = String(Date.now());
  const done = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") done[s(r.step_name)] = true;
  const gd = list(gdRows)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: jsAt, jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", gdId: "0", gdNo: "", idempotencyKey: "",
    jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", siStatus: "", partPrefix: "", manifest: {}, jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO",
    needR0: "NO", needR1: "NO", needR2: "NO", needR3: "NO", needR4: "NO", result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("GDR_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("GDR_INVALID_DATA", "job is deleted");
  if (s(job.command) !== "REVERT_GD") return answer("GDR_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_GD"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": GD_REVERT_COMMIT works on READY_TO_COMMIT / COMMITTING_GD only");
  if (status === "COMMITTING_GD" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_GD" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  let m = null;
  try {
    m = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  } catch (e) {
    m = null;
  }
  const PARTS = ["ENGINE", "RES", "SO", "GD"];
  const valid = m && s(m.prepared_by) === "GD_REVERT_PREPARE" && s(m.job_id) === guard.jobId && digits(m.gd_id) && s(job.correlation_id) === "GD|" + s(m.gd_id) && m.parts &&
    PARTS.every((k) => Array.isArray(m.parts[k]) && m.parts[k].length);
  const c = (m && m.counts) || {};
  const moves = num(c.movements) > 0;
  const entry = { jobId: guard.jobId, organizationId: s(job.organization_id), gdId: valid ? s(m.gd_id) : "0", dbNow: dbNow, jsAt: jsAt, attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0 };
  // before the first write (R1's stock; R2's reservations when nothing moves) the GD can go back to Completed - when it is
  // Processing under this job's lock
  const lockMine = s(gd.gd_status) === "Processing" && s(gd.lock_ref) !== "" && s(gd.lock_ref) === s(job.idempotency_key);
  const written = Object.keys(done).some((k) => k !== "R0_REVALIDATE");
  entry.unlockOk = !written && lockMine ? "YES" : "NO";
  if (!valid) {
    if (!written) return Object.assign({}, base, entry, failNoWrite(entry, "GDR_INVALID_DATA", "the prepared payload is missing or is not this job's: nothing was written"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "the prepared payload is missing or is not this job's after the revert started writing", true), { route: "REVIEW" });
  }
  const B = done.R1_INVENTORY || !moves;
  const phase = B ? "B" : "A";
  const claim = jobRow(entry, { job_status: "COMMITTING_GD", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 85),
    progress_message: phase === "A" ? "Returning the stock of " + num(c.lines) + " line(s)" : "Updating the reservations, sales orders and the delivery", attempt_count: entry.attempts,
    row_version: entry.rowVersion + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null,
    lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  const yes = (b) => (b ? "YES" : "NO");
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, gdNo: s(m.gd_no), siStatus: s(gd.si_status), idempotencyKey: s(job.idempotency_key), partPrefix: "P|" + s(m.nonce) + "|", manifest: m,
    jobRows: [claim], needJobUpd: "YES",
    needR0: yes(!done.R1_INVENTORY && !written && !done.R0_REVALIDATE),
    needR1: yes(phase === "A" && moves),
    needR2: yes(B && !done.R2_RESERVATIONS && num(c.res) + num(c.frag) + num(c.pend) > 0),
    needR3: yes(B && !done.R3_SO && num(c.sol) + num(c.soh) > 0),
    needR4: yes(B && !done.R4_GD),
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_GD",
  });
};
const guard = [{{node:code_node_RCguard.data}}][0];
const res = revertEntry(guard, [{{node:sql_node_RCjob.data}}][0], [{{node:sql_node_RCsteps.data}}][0], [{{node:sql_node_RCpayload.data}}][0], [{{node:sql_node_RCgd.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, r0: res.needR0, r1: res.needR1, r2: res.needR2, r3: res.needR3, r4: res.needR4, unlock: res.unlockOk,
  result: res.result_code, message: res.result_message }));
return res;
