// PICKING_BULK_COMMIT - Entry: the job, its DONE step rows and the prepared payload -> what this run does (phase A =
// P0 revalidate, P1 Picking, P3 GD lines (Full Picking: recounted from every Picking), P4 GD headers, then SPLIT; phase B =
// P5 Packing, P6 finish), the lease claim
const commitEntry = function commitEntry(guard, jobRows, stepRows, payloadRows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") done[s(r.step_name)] = s(r.id);
  const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jobId: guard.jobId, organizationId: "0", pickingId: "0", pickingNo: "",
    jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO",
    needP0: "NO", needP1: "NO", needP3: "NO", needP3fp: "NO", needP4: "NO", needP5: "NO", p3Passes: [], rowIdsSql: "0", gdIdsSql: "0", gdIdsAllSql: "0", gdLineIdsSql: "0",
    plannedRecords: 0, plannedGdLines: 0, packingRequired: "NO", result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("PK_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("PK_INVALID_DATA", "job is deleted");
  if (s(job.command) !== "CONFIRM_PICKING") return answer("PK_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_PICKING"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": PICKING_BULK_COMMIT works on READY_TO_COMMIT / COMMITTING_PICKING only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_PICKING" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_PICKING" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  const org = s(job.organization_id);
  const pickingId = s(job.picking_id);
  let p = null;
  try {
    p = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  } catch (e) {
    p = null;
  }
  const valid = p && s(p.job_id) === guard.jobId && s(p.picking_id) === pickingId && digits(pickingId) && Array.isArray(p.records) && p.row_patch && typeof p.row_patch === "object" && Array.isArray(p.gd_lines);
  const rv = Number(job.row_version) || 0;
  const row = { id: s(job.id), job_status: status, progress_percent: Number(job.progress_percent) || 0, progress_message: s(job.progress_message), attempt_count: Number(job.attempt_count) || 0, next_attempt_at: null, lease_owner: null, lease_expires_at: null, row_version: rv + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, started_at: s(job.started_at) || dbNow, finished_at: null };
  if (!valid) {
    if (status === "READY_TO_COMMIT" || !done.P1_PICKING && !done.P0_REVALIDATE) {
      const why = "prepared_payload is missing or is not this job's: nothing was written";
      return Object.assign({}, base, { route: "FAIL", organizationId: org, pickingId: pickingId, jobRows: [Object.assign({}, row, { job_status: "FAILED", progress_percent: 0, progress_message: "Not confirmed: the request could not be read", error_code: "PK_INVALID_DATA", error_message: why, finished_at: dbNow })], needJobUpd: "YES", unlockRows: digits(pickingId) ? [{ id: pickingId, is_processing: 0 }] : [], needUnlock: digits(pickingId) ? "YES" : "NO", result_code: "PK_INVALID_DATA", result_message: why, job_status: "FAILED" });
    }
    const why = "prepared_payload is missing or is not this job's after the Picking was written: under review";
    return Object.assign({}, base, { route: "REVIEW", organizationId: org, pickingId: pickingId, jobRows: [Object.assign({}, row, { job_status: "REQUIRES_REVIEW", progress_percent: 0, progress_message: "Under review: the confirmation stopped half-way", error_code: "PK_RECONCILIATION_MISMATCH", error_message: why, finished_at: dbNow })], needJobUpd: "YES", result_code: "PK_RECONCILIATION_MISMATCH", result_message: why, job_status: "REQUIRES_REVIEW" });
  }
  const rowIds = Object.keys(p.row_patch).filter(digits);
  const gdIds = (p.gd_ids || []).map(s).filter(digits);
  const gdIdsAll = (p.gd_ids_all || p.gd_ids || []).map(s).filter(digits);
  const gdLineIds = p.gd_lines.map((l) => s(l.id)).filter(digits);
  const phase = done.P4_GD_HEADERS ? "B" : "A";
  const fullPicking = Number(p.full_picking) === 1;
  const pk = p.packing || {};
  const packingRequired = Number(pk.required) === 1 && Number(pk.auto) === 1;
  const claim = Object.assign({}, row, { job_status: "COMMITTING_PICKING", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 90), progress_message: phase === "A" ? "Saving " + p.records.length + " picked line(s)" : "Updating the Packing", lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, {
    route: "GO", phase: phase, organizationId: org, pickingId: pickingId, pickingNo: s(p.picking_no), jobRows: [claim], needJobUpd: "YES",
    needP0: phase === "A" && !done.P0_REVALIDATE && !done.P1_PICKING ? "YES" : "NO",
    needP1: phase === "A" && !done.P1_PICKING ? "YES" : "NO",
    needP3: phase === "A" && !done.P3_GD_LINES && gdLineIds.length && !fullPicking ? "YES" : "NO",
    needP3fp: phase === "A" && !done.P3_GD_LINES && gdLineIds.length && fullPicking ? "YES" : "NO",
    p3Passes: [1, 2, 3, 4],
    needP4: phase === "A" && !done.P4_GD_HEADERS ? "YES" : "NO",
    needP5: phase === "B" && packingRequired && !done.P5_PACKING ? "YES" : "NO",
    rowIdsSql: rowIds.length ? rowIds.join(",") : "0", gdIdsSql: gdIds.length ? gdIds.join(",") : "0", gdIdsAllSql: gdIdsAll.length ? gdIdsAll.join(",") : "0", gdLineIdsSql: gdLineIds.length ? gdLineIds.join(",") : "0",
    plannedRecords: p.records.length, plannedGdLines: gdLineIds.length, packingRequired: packingRequired ? "YES" : "NO",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_PICKING",
  });
};
const guard = [{{node:code_node_PCguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_PCjob.data}}][0], [{{node:sql_node_PCsteps.data}}][0], [{{node:sql_node_PCpayload.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, p0: res.needP0, p1: res.needP1, p3: res.needP3, p3fp: res.needP3fp, p4: res.needP4, p5: res.needP5, result: res.result_code, message: res.result_message }));
return res;