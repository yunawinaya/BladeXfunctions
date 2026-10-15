// GD_EDIT_COMMIT - Entry: the job, its step rows, the manifest, the GD's lock and the Picking -> what this run does:
// phase A = E0 revalidate, E0N a Draft's number, E1 inventory, then SPLIT; phase B = E2 lines, E3 reservations, E4 sales
// orders, then SPLIT; phase C = E5 Picking + stamps, E6 header (unlock), E7 reorder + item dates, then COMPLETED.
// A cascade job held for its Sales Order (request.hold) commits only after RELEASE.
const GE_PARTS = ["ENGINE", "GDL", "GDH", "RES", "SO", "PICK", "STAMP", "AFTER"];
const commitEntry = function commitEntry(guard, jobRows, stepRows, gdRows, pickRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {}, ref = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") { done[s(r.step_name)] = true; ref[s(r.step_name)] = s(r.result_ref); }
  const released = list(stepRows).some((r) => s(r.step_name) === "RELEASE");
  const gd = list(gdRows)[0] || {};
  const pk = list(pickRows)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jobId: guard.jobId, organizationId: "0", gdId: "0", gdNo: "", storedStatus: "Created", idempotencyKey: "",
    jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", pickUnlockOk: "NO", pickingId: "", pickVersion: "", number: "", partPrefix: "", manifest: {},
    jobRows: [], needJobUpd: "NO", needE0: "NO", needE0N: "NO", needE1: "NO", needE2: "NO", needE3: "NO", needE4: "NO", needE5: "NO", needE6: "NO", needE7: "NO",
    doneE7Reorder: "NO", result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("GDE_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("GDE_INVALID_DATA", "job is deleted");
  if (s(job.command) !== "EDIT_GD") return answer("GDE_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_GD"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": GD_EDIT_COMMIT works on READY_TO_COMMIT / COMMITTING_GD only");
  let req = null;
  try { req = JSON.parse(s(job.request_payload)); } catch (e) { req = null; }
  if (req && Number(req.hold) === 1 && !released) return answer("", "job is held for its Sales Order save (no RELEASE yet)");
  if (status === "COMMITTING_GD" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_GD" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  let m = null;
  try { m = JSON.parse(s(job.prepared_payload)); } catch (e) { m = null; }
  const valid = m && s(m.job_id) === guard.jobId && digits(m.gd_id) && s(job.correlation_id) === "GD|" + s(m.gd_id) && m.parts && GE_PARTS.every((k) => Array.isArray(m.parts[k]) && m.parts[k].length);
  const entry = { jobId: guard.jobId, organizationId: s(job.organization_id), gdId: valid ? s(m.gd_id) : "0", dbNow: dbNow, attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0,
    storedStatus: valid ? s(m.stored_status) || "Created" : "Created", leaseUntil: s(job.lease_until) };
  // the GD can go back to its stored status (and our Picking lock be released) only while nothing irreversible exists:
  // before E1 and with the latest lock ours; the Picking lock is ours while the Picking is still at the version we hold
  const lockMine = s(gd.gd_status) === "Processing" && s(gd.lock_ref) !== "" && s(gd.lock_ref) === s(job.idempotency_key);
  entry.unlockOk = !done.E1_INVENTORY && lockMine ? "YES" : "NO";
  const pickVersion = s(ref.E5_PICKING) || (req ? s(req.picking_version) : "");
  entry.pickingId = s(pk.id);
  entry.pickVersion = pickVersion;
  entry.pickUnlockOk = !done.E1_INVENTORY && s(pk.id) && pickVersion && Number(pk.is_processing) === 1 && s(pk.update_time) === pickVersion ? "YES" : "NO";
  if (!valid) {
    if (!done.E1_INVENTORY) return Object.assign({}, base, entry, failNoWrite(entry, "GDE_INVALID_DATA", "the prepared payload is missing or is not this job's: nothing was written"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "the prepared payload is missing or is not this job's after the inventory was written", true), { route: "REVIEW" });
  }
  const phase = !done.E1_INVENTORY ? "A" : !(done.E2_LINES && done.E3_RESERVATIONS && done.E4_SO) ? "B" : "C";
  const c = m.counts || {};
  const draftNumbering = s(m.stored_status) === "Draft";
  const claim = jobRow(entry, { job_status: "COMMITTING_GD", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : phase === "B" ? 80 : 90),
    progress_message: phase === "A" ? "Saving the stock of " + num(c.lines) + " line(s)" : phase === "B" ? "Saving the lines, reservations and sales orders" : "Saving the Picking and the delivery",
    attempt_count: entry.attempts, row_version: entry.rowVersion + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null,
    lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, gdNo: s(m.gd_no), idempotencyKey: s(job.idempotency_key), partPrefix: "P|" + s(m.nonce) + "|", manifest: m, number: s(ref.E0N_NUMBER),
    jobRows: [claim], needJobUpd: "YES",
    needE0: phase === "A" && !done.E0_REVALIDATE ? "YES" : "NO",
    needE0N: phase === "A" && draftNumbering && !done.E0N_NUMBER ? "YES" : "NO",
    needE1: phase === "A" ? "YES" : "NO",
    needE2: phase === "B" && !done.E2_LINES ? "YES" : "NO",
    needE3: phase === "B" && !done.E3_RESERVATIONS ? "YES" : "NO",
    needE4: phase === "B" && !done.E4_SO ? "YES" : "NO",
    needE5: phase === "C" && !done.E5_PICKING ? "YES" : "NO",
    needE6: phase === "C" && !done.E6_HEADER ? "YES" : "NO",
    needE7: phase === "C" && !done.E7_AFTER ? "YES" : "NO",
    doneE7Reorder: done.E7_REORDER ? "YES" : "NO",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_GD",
  });
};
