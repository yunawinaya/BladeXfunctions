// IA_REVERT_V2_COMMIT - Entry: job, V steps, manifest, IA lock -> phase A (V0, V1) or B (V2-V4) + the lease
const RV_PARTS = ["ENGINE", "COST", "BATCH", "HDR", "LABELS"];
// fix wave R4: V2's COST wait window starts at its first busy wait (error_details.waitFrom while the job waits)
const v2WaitFrom = (job) => {
  const d = job && s(job.error_code) === "IA_RV_WAIT" ? iaParseJ(s(job.error_details)) : null;
  return d && typeof d === "object" && s(d.step) === "V2_COST" && /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(s(d.waitFrom)) ? s(d.waitFrom) : "";
};
const commitEntry = function commitEntry(guard, jobRows, stepRows, payloadRows, iaFacts, opRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  const finished = {};
  for (const r of list(stepRows)) {
    if (s(r.step_status) === "DONE") {
      done[s(r.step_name)] = true;
      finished[s(r.step_name)] = s(r.finished_at);
    }
  }
  const ia = list(iaFacts)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: String(Date.now()), jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", iaId: "0", iaNo: "", plantId: "0", prevStatus: "",
    idempotencyKey: "", movesFingerprint: "", movementCount: 0, costCount: 0, batchCount: 0, v1FinishedAt: "", opWrote: "NO", v2WaitFrom: "", progress: 70, progressMessage: "", jobStatus: job ? s(job.job_status) : "",
    rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0, leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", partPrefix: "",
    jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", needV0: "NO", needV1: "NO", needV2: "NO", needV3: "NO", needV4: "NO",
    result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("IA_RV_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("IA_RV_INVALID_DATA", "job is deleted");
  if (!digits(job.organization_id)) return answer("IA_RV_INVALID_DATA", "job organization is not an id");
  if (s(job.command) !== "REVERT_IA") return answer("IA_RV_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_REVERT"].indexOf(status) < 0) {
    return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": IA_REVERT_V2_COMMIT works on READY_TO_COMMIT / COMMITTING_REVERT only");
  }
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_REVERT" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") {
    return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  }
  if (status === "COMMITTING_REVERT" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  const m = iaParseJ(s((list(payloadRows)[0] || {}).prepared_payload));
  const corr = s(job.correlation_id);
  const iaId = /^IA\|[0-9]{1,20}$/.test(corr) ? corr.slice(3) : "0";
  const mp = m && typeof m === "object" && m.parts && typeof m.parts === "object" ? m.parts : {};
  // the manifest must be this job's plan (CONTRACT.md RV7 entry); every reason it is not is collected
  const bad = [];
  if (!m || typeof m !== "object") bad.push("the prepared payload is missing or unreadable");
  else {
    if (s(m.job_id) !== guard.jobId) bad.push("its job_id is " + s(m.job_id));
    if (iaId === "0" || s(m.ia_id) !== iaId) bad.push("its ia_id " + s(m.ia_id) + " is not the job's Item Assembly " + iaId);
    const missing = RV_PARTS.filter((k) => !(Array.isArray(mp[k]) && mp[k].length > 0));
    if (missing.length) bad.push("part(s) " + missing.join(", ") + " missing");
    if (!/^IM1:/.test(s(m.movesFingerprint))) bad.push("no IM1 movement fingerprint");
    if (!/^[0-9A-Za-z]{1,16}$/.test(s(m.nonce))) bad.push("no part nonce");
    if (!digits(m.plant_id) || !s(m.ia_no)) bad.push("no plant or Item Assembly number");
  }
  const valid = bad.length === 0;
  const c = valid && m.counts && typeof m.counts === "object" ? m.counts : {};
  const phase = done.V1_INVENTORY ? "B" : "A";
  const entry = { jobId: guard.jobId, tenantId: guard.tenantId, organizationId: s(job.organization_id), iaId: iaId, iaNo: valid ? s(m.ia_no) : s(ia.stock_movement_no),
    plantId: valid ? s(m.plant_id) : "0", prevStatus: s(job.prev_status), idempotencyKey: s(job.idempotency_key), movesFingerprint: valid ? s(m.movesFingerprint) : "",
    movementCount: num(c.movements), costCount: num(c.fifo) + num(c.waDelete) + num(c.waRestate), batchCount: num(c.batches), v1FinishedAt: finished.V1_INVENTORY || "",
    opWrote: num((list(opRows)[0] || {}).op_rows) > 0 ? "YES" : "NO", v2WaitFrom: v2WaitFrom(job),
    progress: phase === "A" ? 70 : 85, progressMessage: phase === "A" ? "Taking back the stock of " + num(c.movements) + " movement(s)" : "Restoring the costing rows, the batches and the Item Assembly",
    dbNow: dbNow, jsAt: String(Date.now()), attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0, leaseUntil: s(job.lease_until) };
  // owned = its ia_v2_job_id and the latest IAC| LOCK row carries the job's key (CONTRACT.md section 4)
  const keyed = iaId !== "0" && s(ia.ia_id) === iaId && s(ia.lock_ref) !== "" && s(ia.lock_ref) === entry.idempotencyKey && s(ia.ia_v2_job_id) === guard.jobId;
  const lockMine = keyed && s(ia.item_assembly_status) === "Processing";
  entry.unlockOk = phase === "A" && lockMine ? "YES" : "NO";
  const failA = (code, message, why) => {
    const r = failNoWrite(entry, code, message, why);
    return Object.assign({}, base, entry, r, { route: r.job_status === "FAILED" ? "FAIL" : "REVIEW" });
  };
  if (!valid) {
    if (phase === "A") return failA("IA_RV_INVALID_DATA", RV_TEXT.invalid, bad.join("; ") + ": no stock was moved");
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", bad.join("; ") + " after the stock was moved", true), { route: "REVIEW" });
  }
  const where = "(job " + (s(ia.ia_v2_job_id) || "none") + ", lock " + (s(ia.lock_ref) || "none") + ")";
  if (phase === "A" && !lockMine) {
    return failA("IA_RV_NOT_LOCKED", IA_TEXT.rvNotLocked, "the Item Assembly is " + (s(ia.item_assembly_status) || "missing") + " " + where + ": no stock was moved");
  }
  // after V1 the Item Assembly stays this job's until V4 writes Draft (V4 may have written it before a run ended)
  if (phase === "B" && !(keyed && ["Processing", "Draft"].indexOf(s(ia.item_assembly_status)) >= 0)) {
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "after the stock moved the Item Assembly is " + (s(ia.item_assembly_status) || "missing") + " " + where, true), { route: "REVIEW" });
  }
  const claim = jobRow(entry, { job_status: "COMMITTING_REVERT", progress_percent: Math.max(Number(job.progress_percent) || 0, entry.progress), attempt_count: entry.attempts,
    row_version: entry.rowVersion + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null,
    lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, partPrefix: "P|" + s(m.nonce) + "|", jobRows: [claim], needJobUpd: "YES",
    needV0: phase === "A" && !done.V0_REVALIDATE ? "YES" : "NO",
    needV1: phase === "A" ? "YES" : "NO",
    needV2: phase === "B" && !done.V2_COST && entry.costCount > 0 ? "YES" : "NO",
    needV3: phase === "B" && !done.V3_BATCH && entry.batchCount > 0 ? "YES" : "NO",
    needV4: phase === "B" && !done.V4_FINISH ? "YES" : "NO",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_REVERT",
  });
};
const guard = [{{node:code_node_IVCguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_IVCjob.data}}][0], [{{node:sql_node_IVCsteps.data}}][0], [{{node:sql_node_IVCpayload.data}}][0], [{{node:sql_node_IVCia.data}}][0],
  [{{node:sql_node_IVCops.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, v0: res.needV0, v1: res.needV1, v2: res.needV2, v3: res.needV3, v4: res.needV4, unlock: res.unlockOk, result: res.result_code, message: res.result_message }));
return res;
