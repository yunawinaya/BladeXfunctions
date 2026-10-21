// IA_V2_COMMIT - Entry: the job (+ its request), its I step rows, the I1 intent, the manifest, the Item Assembly's lock and op 1's
// engine rows -> what this run does (phase A = I0 revalidate, I1 batch, I2 issue, then SPLIT / PARK; phase B = I3 receipt, I4
// items and Completed, then COMPLETED) and the lease claim (CONTRACT.md sections 4, 5, 9; ruling 10 R2 / R4)
const IA_PARTS = ["ENGINE_I", "ENGINE_R", "LABELS", "ITEMS"];
const commitEntry = function commitEntry(guard, jobRows, stepRows, intentRows, payloadRows, iaFacts, op1Rows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") done[s(r.step_name)] = { ref: s(r.result_ref), at: s(r.finished_at) };
  const ia = list(iaFacts)[0] || {};
  const op1 = list(op1Rows)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: String(Date.now()), jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", plantId: "0", iaId: "0", iaNo: "", parentItemId: "0",
    prevStatus: "", idempotencyKey: "", jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", progress: 0, progressMessage: "", unlockOk: "NO", partPrefix: "", batchMode: "", movementsI: 0, lineFingerprint: "", batchId: "", batchNumber: "",
    i2DoneAt: "", i2Called: "", op1Wrote: "NO", waitFrom: "", intent: null, hasIntent: "NO", needOursRead: "NO", oursItem: "0", oursOrg: "0", jobRows: [], needJobUpd: "NO", unlockRows: [],
    needUnlock: "NO", batchDelRows: [], needBatchDel: "NO", needI0: "NO", needI1: "NO", needI2: "NO", needI3: "NO", needI4: "NO", result_code: "", result_message: "",
    job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("IA_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("IA_INVALID_DATA", "job is deleted");
  if (!digits(job.organization_id)) return answer("IA_INVALID_DATA", "job organization is not an id");
  if (s(job.command) !== "COMPLETE_IA") return answer("IA_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_IA"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": IA_V2_COMMIT works on READY_TO_COMMIT / COMMITTING_IA only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_IA" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_IA" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  const m = iaParseJ(s((list(payloadRows)[0] || {}).prepared_payload));
  const corr = s(job.correlation_id);
  const iaId = /^IA\|[0-9]{1,20}$/.test(corr) ? corr.slice(3) : "0";
  const mp = m && typeof m === "object" && m.parts && typeof m.parts === "object" ? m.parts : {};
  const listed = (k) => Array.isArray(mp[k]) && mp[k].length > 0;
  // the manifest must be this job's plan (CONTRACT section 5); every reason it is not is collected
  const bad = [];
  if (!m || typeof m !== "object") bad.push("the prepared payload is missing or unreadable");
  else {
    if (s(m.job_id) !== guard.jobId) bad.push("its job_id is " + s(m.job_id));
    if (iaId === "0" || !digits(m.ia_id) || s(m.ia_id) !== iaId) bad.push("its ia_id " + s(m.ia_id) + " is not the job's Item Assembly (" + corr + ")");
    if (s(m.action) !== "DIRECT") bad.push("action " + (s(m.action) || "(none)"));
    if (!/^[0-9A-Za-z]{1,16}$/.test(s(m.nonce))) bad.push("no part nonce");
    if (["insert", "none"].indexOf(s(m.batchMode)) < 0) bad.push("batchMode " + (s(m.batchMode) || "(none)") + " (insert / none only)");
    const missing = IA_PARTS.filter((k) => !listed(k));
    if (s(m.batchMode) === "insert" && !listed("BATCH")) missing.push("BATCH");
    if (missing.length) bad.push("part(s) " + missing.join(", ") + " missing");
    if (s(m.batchMode) !== "insert" && listed("BATCH")) bad.push("a BATCH part without batchMode insert");
    if (!/^IF1:/.test(s(m.lineFingerprint))) bad.push("no IF1 line fingerprint");
    if (m.organization_id !== undefined && s(m.organization_id) !== s(job.organization_id)) bad.push("its organization " + s(m.organization_id) + " is not the job's");
  }
  const valid = bad.length === 0;
  const c = valid && m.counts && typeof m.counts === "object" ? m.counts : {};
  const i1 = done.I1_BATCH ? iaParseJ(done.I1_BATCH.ref) : null;
  const i2 = done.I2_ISSUE ? iaParseJ(done.I2_ISSUE.ref) : null;
  const intent = iaJoinChunks(intentRows, "I1|I|");
  const phase = done.I2_ISSUE ? "B" : "A";
  const progress = phase === "A" ? 70 : done.I3_RECEIPT ? 85 : 75;
  const picks = num(c.movementsI);
  const entry = { jobId: guard.jobId, tenantId: guard.tenantId, organizationId: s(job.organization_id), plantId: valid && digits(m.plant_id) ? s(m.plant_id) : "0", iaId: iaId,
    iaNo: valid ? s(m.ia_no) || s(ia.stock_movement_no) : s(ia.stock_movement_no), parentItemId: digits(ia.item_id) ? s(ia.item_id) : "0", prevStatus: s(job.prev_status),
    idempotencyKey: s(job.idempotency_key), dbNow: dbNow, jsAt: String(Date.now()), attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0, leaseUntil: s(job.lease_until),
    progress: progress, progressMessage: phase === "A" ? "Issuing the components (" + picks + " stock pick" + (picks === 1 ? "" : "s") + ")" : done.I3_RECEIPT ? P80 : P75,
    partPrefix: valid ? "P|" + s(m.nonce) + "|" : "", batchMode: valid ? s(m.batchMode) : "", movementsI: picks, lineFingerprint: valid ? s(m.lineFingerprint) : "",
    batchId: i1 && digits(i1.batch_id) ? s(i1.batch_id) : "", batchNumber: i1 ? s(i1.batch_number) : "", i2DoneAt: done.I2_ISSUE ? done.I2_ISSUE.at : "",
    i2Called: done.I2_ISSUE ? (i2 && s(i2.called) === "NO" ? "NO" : "YES") : "", intent: intent && typeof intent === "object" ? intent : null,
    hasIntent: intent === undefined ? "BAD" : intent && typeof intent === "object" ? "YES" : "NO",
    // R2: op 1 has engine rows (an intent or its DONE) -> stock may have moved, so no phase-A failure may claim it did not
    op1Wrote: num(op1.intents) > 0 || s(op1.done_summary) !== "" ? "YES" : "NO" };
  // R4: I3's wait window starts at its FIRST transient answer, carried in the job's error_details by I3's stepWait
  const wait = s(job.error_code) === "IA_WAIT" ? iaParseJ(job.error_details) : null;
  entry.waitFrom = wait && typeof wait === "object" && s(wait.step) === "I3_RECEIPT" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s(wait.waitFrom)) ? s(wait.waitFrom) : "";
  if (entry.intent) {
    entry.oursItem = digits(entry.intent.material_id) ? s(entry.intent.material_id) : "0";
    entry.oursOrg = digits(entry.intent.organization_id) ? s(entry.intent.organization_id) : "0";
  }
  // the job owns the IA: Processing, its ia_v2_job_id, and the latest IAC| LOCK row carries the job's key (CONTRACT section 4)
  const keyed = iaId !== "0" && s(ia.ia_id) === iaId && s(ia.lock_ref) !== "" && s(ia.lock_ref) === entry.idempotencyKey && s(ia.ia_v2_job_id) === guard.jobId;
  const lockMine = keyed && s(ia.item_assembly_status) === "Processing";
  entry.unlockOk = phase === "A" && lockMine ? "YES" : "NO";
  const ours = entry.batchId ? [entry.batchId] : [];
  const fail = (code, message, why) => {
    const f = failNoWrite(entry, code, message, why, ours);
    // an I1 that inserted without recording DONE: its row is found by the intent's identity before the failure is written
    const read = f.job_status === "FAILED" && !ours.length && entry.intent && entry.oursItem !== "0" && entry.oursOrg !== "0" ? "YES" : "NO";
    return Object.assign({}, base, entry, f, { route: "FAIL", phase: phase, needOursRead: read });
  };
  const review = (why) => Object.assign({}, base, entry, reviewEnd(entry, "ENTRY", "IA_RECONCILIATION_MISMATCH", why), { route: "REVIEW", phase: phase });
  if (!valid) {
    if (phase === "A") return fail("IA_INVALID_DATA", MSG.invalid, bad.join("; ") + ": no stock was moved");
    return review(bad.join("; ") + " after the components were issued");
  }
  const where = "(job " + s(ia.ia_v2_job_id) + ", lock " + s(ia.lock_ref) + ")";
  if (phase === "A" && !lockMine) return fail("IA_NOT_LOCKED", IA_TEXT.notLocked, "the Item Assembly is " + (s(ia.item_assembly_status) || "missing (deleted?)") + " " + where + ": no stock was moved");
  // after op 1 the IA stays this job's until I4 writes Completed
  if (phase === "B" && !(keyed && (s(ia.item_assembly_status) === "Processing" || s(ia.item_assembly_status) === "Completed"))) {
    return review("after the components were issued the Item Assembly is " + (s(ia.item_assembly_status) || "missing (deleted?)") + " " + where);
  }
  if (entry.batchMode === "insert" && done.I1_BATCH && !entry.batchId) return review("the I1_BATCH row names no batch id (" + done.I1_BATCH.ref.slice(0, 200) + ")");
  if (phase === "B" && entry.batchMode === "insert" && !done.I1_BATCH) return review("I2_ISSUE is done without an I1_BATCH row");
  const claim = jobRow(entry, { job_status: "COMMITTING_IA", progress_percent: progress, progress_message: entry.progressMessage, attempt_count: entry.attempts, row_version: entry.rowVersion + 1,
    error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, jobRows: [claim], needJobUpd: "YES",
    needI0: phase === "A" && !done.I0_REVALIDATE ? "YES" : "NO",
    needI1: phase === "A" && entry.batchMode === "insert" && !done.I1_BATCH ? "YES" : "NO",
    needI2: phase === "A" ? "YES" : "NO",
    needI3: phase === "B" && !done.I3_RECEIPT ? "YES" : "NO",
    needI4: phase === "B" && !done.I4_FINISH ? "YES" : "NO",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_IA",
  });
};
const guard = [{{node:code_node_IACguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_IACjob.data}}][0], [{{node:sql_node_IACsteps.data}}][0], [{{node:sql_node_IACintent.data}}][0], [{{node:sql_node_IACpayload.data}}][0],
  [{{node:sql_node_IACia.data}}][0], [{{node:sql_node_IACop1.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, i0: res.needI0, i1: res.needI1, i2: res.needI2, i3: res.needI3, i4: res.needI4, unlock: res.unlockOk, op1: res.op1Wrote, waitFrom: res.waitFrom, result: res.result_code, message: res.result_message }));
return res;
