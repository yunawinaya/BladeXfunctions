// GD_COMPLETE_COMMIT - Entry: the job, its step rows, the manifest and the GD's lock -> what this run does (phase A = C0
// revalidate, C1 snapshot, C2 inventory, then SPLIT; phase B = C3 reservations, C3H handling units, C4 sales
// orders, C4P a Force Complete's Picking rows, C5 the GD, C6 item dates / reorder / auto-SI, then COMPLETED), the lease claim
const commitEntry = function commitEntry(guard, jobRows, stepRows, payloadRows, gdRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const jsAt = String(Date.now());
  const done = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") done[s(r.step_name)] = true;
  const gd = list(gdRows)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: jsAt, jobId: guard.jobId, organizationId: "0", gdId: "0", gdNo: "", idempotencyKey: "",
    jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", partPrefix: "", manifest: {}, jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO",
    needC0: "NO", needC1: "NO", needC2: "NO", needC3: "NO", needC3H: "NO", needC4: "NO", needC4P: "NO", needC5: "NO", needC6: "NO", doneC6Reorder: "NO", doneC6Si: "NO", force: "",
    result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("GDC_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("GDC_INVALID_DATA", "job is deleted");
  if (s(job.command) !== "COMPLETE_GD") return answer("GDC_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_GD"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": GD_COMPLETE_COMMIT works on READY_TO_COMMIT / COMMITTING_GD only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_GD" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_GD" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  let m = null;
  try {
    m = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  } catch (e) {
    m = null;
  }
  const PARTS = ["ENGINE", "RES", "SO", "PICK", "HU", "GD", "SNAP", "AFTER"];
  const valid = m && s(m.job_id) === guard.jobId && digits(m.gd_id) && s(job.correlation_id) === "GD|" + s(m.gd_id) && m.parts && PARTS.every((k) => Array.isArray(m.parts[k]) && m.parts[k].length);
  const entry = { jobId: guard.jobId, organizationId: s(job.organization_id), gdId: valid ? s(m.gd_id) : "0", dbNow: dbNow, jsAt: jsAt, attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0 };
  // before C2 the GD can go back to Created - when it is Processing under this job's lock
  const lockMine = s(gd.gd_status) === "Processing" && s(gd.lock_ref) !== "" && s(gd.lock_ref) === s(job.idempotency_key);
  entry.unlockOk = !done.C2_INVENTORY && lockMine ? "YES" : "NO";
  if (!valid) {
    if (!done.C2_INVENTORY) return Object.assign({}, base, entry, failNoWrite(entry, "GDC_INVALID_DATA", "the prepared payload is missing or is not this job's: nothing was written"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "the prepared payload is missing or is not this job's after the inventory was written", true), { route: "REVIEW" });
  }
  const phase = done.C2_INVENTORY ? "B" : "A";
  const c = m.counts || {};
  const claim = jobRow(entry, { job_status: "COMMITTING_GD", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 85), progress_message: phase === "A" ? "Delivering " + num(c.lines) + " line(s)" : "Updating the sales orders and the delivery", attempt_count: entry.attempts, row_version: entry.rowVersion + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, gdNo: s(m.gd_no), idempotencyKey: s(job.idempotency_key), partPrefix: "P|" + s(m.nonce) + "|", manifest: m,
    jobRows: [claim], needJobUpd: "YES",
    needC0: phase === "A" && !done.C0_REVALIDATE && !done.C1_SNAPSHOT ? "YES" : "NO",
    needC1: phase === "A" && !done.C1_SNAPSHOT ? "YES" : "NO",
    needC2: phase === "A" ? "YES" : "NO",
    needC3: phase === "B" && !done.C3_RESERVATIONS && num(c.reservation_updates) + num(c.reservation_creates) > 0 ? "YES" : "NO",
    needC3H: phase === "B" && !done.C3H_HU && num(c.hu) > 0 ? "YES" : "NO",
    needC4: phase === "B" && !done.C4_SO ? "YES" : "NO",
    needC4P: phase === "B" && num(m.force) === 1 && !done.C4P_PICKING ? "YES" : "NO",
    needC5: phase === "B" && !done.C5_GD ? "YES" : "NO",
    needC6: phase === "B" && !done.C6_AFTER ? "YES" : "NO",
    doneC6Reorder: done.C6_REORDER ? "YES" : "NO", doneC6Si: done.C6_SI ? "YES" : "NO", force: num(m.force) === 1 ? "Yes" : "",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_GD",
  });
};
const guard = [{{node:code_node_CCguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_CCjob.data}}][0], [{{node:sql_node_CCsteps.data}}][0], [{{node:sql_node_CCpayload.data}}][0], [{{node:sql_node_CCgd.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, c0: res.needC0, c1: res.needC1, c2: res.needC2, c3: res.needC3, c3h: res.needC3H, c4: res.needC4, c4p: res.needC4P, c5: res.needC5, c6: res.needC6, unlock: res.unlockOk, result: res.result_code, message: res.result_message }));
return res;
