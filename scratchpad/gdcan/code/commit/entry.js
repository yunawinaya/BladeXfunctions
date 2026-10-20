// GD_CANCEL_COMMIT - Entry: the job, its step rows, the manifest and the GD's lock -> what this run does. Phase A = X0
// revalidate, X2 the stock (then SPLIT); phase B = X3 reservations, X4 sales orders, X4P Pickings, X4K Packings, X4H unpack,
// X5 numbers + movements, X6 the GD, X7 item dates + reorder, then COMPLETED. A cancel that moves no stock (a Production
// reservation keeps it Reserved) runs both phases in one run.
const cancelEntry = function cancelEntry(guard, jobRows, stepRows, payloadRows, gdRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const jsAt = String(Date.now());
  const done = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") done[s(r.step_name)] = true;
  const gd = list(gdRows)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: jsAt, jobId: guard.jobId, organizationId: "0", gdId: "0", gdNo: "", newNo: "", idempotencyKey: "",
    jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", partPrefix: "", manifest: {}, jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO",
    needX0: "NO", needX2: "NO", needX3: "NO", needX4: "NO", needX4P: "NO", needX4K: "NO", needX4H: "NO", needX5: "NO", needX6: "NO", needX7: "NO", doneX7Reorder: "NO",
    result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("GDX_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("GDX_INVALID_DATA", "job is deleted");
  if (s(job.command) !== "CANCEL_GD") return answer("GDX_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_GD"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": GD_CANCEL_COMMIT works on READY_TO_COMMIT / COMMITTING_GD only");
  if (status === "COMMITTING_GD" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_GD" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  let m = null;
  try {
    m = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  } catch (e) {
    m = null;
  }
  const PARTS = ["ENGINE", "RES", "SO", "GD", "PICK", "PACK", "HU", "NUM", "AFTER"];
  const valid = m && s(m.prepared_by) === "GD_CANCEL_PREPARE" && s(m.job_id) === guard.jobId && digits(m.gd_id) && s(job.correlation_id) === "GD|" + s(m.gd_id) && m.parts &&
    PARTS.every((k) => Array.isArray(m.parts[k]) && m.parts[k].length);
  const c = (m && m.counts) || {};
  const moves = num(c.movements) > 0;
  const entry = { jobId: guard.jobId, organizationId: s(job.organization_id), gdId: valid ? s(m.gd_id) : "0", dbNow: dbNow, jsAt: jsAt, attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0 };
  // before the first write (X2's stock; X3's reservations when nothing moves) the GD can go back to Created - when it is
  // Processing under this job's lock
  const lockMine = s(gd.gd_status) === "Processing" && s(gd.lock_ref) !== "" && s(gd.lock_ref) === s(job.idempotency_key);
  const written = Object.keys(done).some((k) => k !== "X0_REVALIDATE");
  entry.unlockOk = !written && lockMine ? "YES" : "NO";
  if (!valid) {
    if (!written) return Object.assign({}, base, entry, failNoWrite(entry, "GDX_INVALID_DATA", "the prepared payload is missing or is not this job's: nothing was written"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "the prepared payload is missing or is not this job's after the cancel started writing", true), { route: "REVIEW" });
  }
  const B = done.X2_INVENTORY || !moves;
  const phase = B ? "B" : "A";
  const claim = jobRow(entry, { job_status: "COMMITTING_GD", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 85),
    progress_message: phase === "A" ? "Releasing the stock of " + num(c.lines) + " line(s)" : "Updating the sales orders, Pickings, Packings and the delivery", attempt_count: entry.attempts,
    row_version: entry.rowVersion + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null,
    lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  const yes = (b) => (b ? "YES" : "NO");
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, gdNo: s(m.gd_no), newNo: s(m.new_no), idempotencyKey: s(job.idempotency_key), partPrefix: "P|" + s(m.nonce) + "|", manifest: m,
    jobRows: [claim], needJobUpd: "YES",
    needX0: yes(!done.X2_INVENTORY && !written && !done.X0_REVALIDATE),
    needX2: yes(phase === "A" && moves),
    needX3: yes(B && !done.X3_RESERVATIONS && num(c.reservation_updates) + num(c.reservation_creates) > 0),
    needX4: yes(B && !done.X4_SO),
    needX4P: yes(B && !done.X4P_PICKING && num(c.picking_rows) + num(c.picking_headers) > 0),
    needX4K: yes(B && !done.X4K_PACKING && num(c.packing_headers) + num(c.packing_lines) > 0),
    needX4H: yes(B && !done.X4H_UNPACK && num(c.boxes) + num(c.boxes_released) > 0),
    needX5: yes(B && !done.X5_NUMBERS),
    needX6: yes(B && !done.X6_GD),
    needX7: yes(B && !done.X7_AFTER),
    doneX7Reorder: yes(done.X7_REORDER),
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_GD",
  });
};
const guard = [{{node:code_node_XCguard.data}}][0];
const res = cancelEntry(guard, [{{node:sql_node_XCjob.data}}][0], [{{node:sql_node_XCsteps.data}}][0], [{{node:sql_node_XCpayload.data}}][0], [{{node:sql_node_XCgd.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, x0: res.needX0, x2: res.needX2, x3: res.needX3, x4: res.needX4, x4p: res.needX4P, x4k: res.needX4K,
  x4h: res.needX4H, x5: res.needX5, x6: res.needX6, x7: res.needX7, unlock: res.unlockOk, result: res.result_code, message: res.result_message }));
return res;
