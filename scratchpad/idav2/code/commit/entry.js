// IDA_V2_COMMIT - Entry: the job (+ its request), its D step rows, the D1 intent, the manifest, the Item Disassembly's lock and both
// operations' engine rows -> what this run does (phase A = D0 revalidate, D1 Batch rows, D2 issue, then SPLIT / PARK; phase B = D3
// receipt, D4 lines / items / Completed, then COMPLETED) and the lease claim (CONTRACT.md sections 1, 3, 4, 5, 9; IA rulings 10 R2 / R4)
const IDA_PARTS = ["ENGINE_I", "ENGINE_R", "LABELS", "ITEMS"];
const opRowsOf = (rows) => {
  const o = list(rows)[0] || {};
  return num(o.intents) > 0 || num(o.review) > 0 || s(o.done_summary) !== "";
};
const commitEntry = function commitEntry(guard, jobRows, stepRows, intentRows, payloadRows, idaFacts, op1Rows, op2Rows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") done[s(r.step_name)] = { ref: s(r.result_ref), at: s(r.finished_at) };
  const ida = list(idaFacts)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: String(Date.now()), jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", plantId: "0", idaId: "0", idaNo: "",
    prevStatus: "", idempotencyKey: "", jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0,
    leaseUntil: job ? s(job.lease_until) : "", progress: 0, progressMessage: "", unlockOk: "NO", partPrefix: "", batchMode: "", needBatchRead: "NO", movementsI: 0, movementsR: 0,
    lineFingerprint: "", d2DoneAt: "", op1Wrote: "NO", op2Wrote: "NO", opWrote: "NO", waitFrom: "", hasIntent: "NO", skipNote: "", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO",
    batchDelSlices: [], needBatchDel: "NO", needOursRead: "NO", stepRows: [], needStep: "NO", needD0: "NO", needD1: "NO", needD2: "NO", needD3: "NO", needD4: "NO", result_code: "",
    result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("IDA_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("IDA_INVALID_DATA", "job is deleted");
  if (!digits(job.organization_id)) return answer("IDA_INVALID_DATA", "job organization is not an id");
  if (s(job.command) !== "COMPLETE_IDA") return answer("IDA_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_IDA"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": IDA_V2_COMMIT works on READY_TO_COMMIT / COMMITTING_IDA only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_IDA" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_IDA" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  const m = idaParseJ(s((list(payloadRows)[0] || {}).prepared_payload));
  const corr = s(job.correlation_id);
  const idaId = /^IDA\|[0-9]{1,20}$/.test(corr) ? corr.slice(4) : "0";
  const mp = m && typeof m === "object" && m.parts && typeof m.parts === "object" ? m.parts : {};
  const listed = (k) => Array.isArray(mp[k]) && mp[k].length > 0;
  // the manifest must be this job's plan (CONTRACT.md section 5); every reason it is not is collected
  const bad = [];
  let c = {};
  if (!m || typeof m !== "object") bad.push("the prepared payload is missing or unreadable");
  else {
    if (s(m.job_id) !== guard.jobId) bad.push("its job_id is " + s(m.job_id));
    if (idaId === "0" || !digits(m.ida_id) || s(m.ida_id) !== idaId) bad.push("its ida_id " + s(m.ida_id) + " is not the job's Item Disassembly (" + corr + ")");
    if (s(m.action) !== "DIRECT") bad.push("action " + (s(m.action) || "(none)"));
    if (!/^[0-9A-Za-z]{1,16}$/.test(s(m.nonce))) bad.push("no part nonce");
    if (["insert", "none"].indexOf(s(m.batchMode)) < 0) bad.push("batchMode " + (s(m.batchMode) || "(none)") + " (insert / none only)");
    const missing = IDA_PARTS.filter((k) => !listed(k));
    if (s(m.batchMode) === "insert" && !listed("BATCH")) missing.push("BATCH");
    if (missing.length) bad.push("part(s) " + missing.join(", ") + " missing");
    if (s(m.batchMode) !== "insert" && listed("BATCH")) bad.push("a BATCH part without batchMode insert");
    if (!/^DF1:/.test(s(m.lineFingerprint))) bad.push("no DF1 line fingerprint");
    if (s(m.organization_id) !== s(job.organization_id)) bad.push("its organization " + s(m.organization_id) + " is not the job's");
    c = m.counts && typeof m.counts === "object" ? m.counts : {};
    if (!(num(c.movementsI) >= 1) || !(num(c.movementsR) >= 1)) bad.push("counts.movementsI " + s(c.movementsI) + " / movementsR " + s(c.movementsR) + " (each operation needs a movement)");
  }
  const valid = bad.length === 0;
  const intent = idaJoinChunks(intentRows, "D1|I|");
  const phase = done.D2_ISSUE ? "B" : "A";
  const progress = phase === "A" ? 70 : done.D3_RECEIPT ? 85 : 75;
  const picks = valid ? num(c.movementsI) : 0;
  const d3 = done.D3_RECEIPT ? idaParseJ(done.D3_RECEIPT.ref) : null;
  const skipNote = d3 && typeof d3 === "object" ? skipNoteOf(d3.skipped, d3.skipped_count) : "";
  const op1 = opRowsOf(op1Rows);
  const op2 = opRowsOf(op2Rows);
  const entry = { jobId: guard.jobId, tenantId: guard.tenantId, organizationId: s(job.organization_id), plantId: valid && digits(m.plant_id) ? s(m.plant_id) : "0", idaId: idaId,
    idaNo: valid ? s(m.ida_no) || s(ida.stock_movement_no) : s(ida.stock_movement_no), prevStatus: s(job.prev_status), idempotencyKey: s(job.idempotency_key), dbNow: dbNow,
    // a READY_TO_COMMIT claim starts COMMIT's count at 0: PREPARE's retries must not shrink D1's retries or D2's lock waits
    jsAt: String(Date.now()), attempts: status === "READY_TO_COMMIT" ? 0 : Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0,
    // the job-sized lease (GR V2 leaseFor) from the DB clock; the SQL's 10 minutes when the manifest is unreadable
    // a PARK-size phase B gets the 5,400 s cap: a COMMIT B that outlives its lease is re-entered on the same engine operation
    leaseUntil: (valid && idaDbAddSeconds(dbNow, phase === "B" && num(c.movementsR) > IDA_PARK ? 5400 : idaLeaseSeconds(num(c.movementsI) + num(c.movementsR)))) || s(job.lease_until),
    progress: progress, progressMessage: phase === "A" ? "Issuing the item being disassembled (" + picks + " source pick" + (picks === 1 ? "" : "s") + ")" : done.D3_RECEIPT ? (P80 + skipNote).slice(0, 250) : P75,
    skipNote: skipNote,
    partPrefix: valid ? "P|" + s(m.nonce) + "|" : "", batchMode: valid ? s(m.batchMode) : "", needBatchRead: valid && s(m.batchMode) === "insert" ? "YES" : "NO",
    movementsI: valid ? num(c.movementsI) : 0, movementsR: valid ? num(c.movementsR) : 0, lineFingerprint: valid ? s(m.lineFingerprint) : "", d2DoneAt: done.D2_ISSUE ? done.D2_ISSUE.at : "",
    // R2 (extended to op 2): an engine row of either operation means stock may have moved - no phase-A failure may claim it did not
    op1Wrote: op1 ? "YES" : "NO", op2Wrote: op2 ? "YES" : "NO", opWrote: op1 || op2 ? "YES" : "NO",
    hasIntent: intent === undefined ? "BAD" : intent && typeof intent === "object" ? "YES" : "NO" };
  // R4: D3's wait window starts at its FIRST transient answer, carried in the job's error_details by D3's stepWait
  const wait = s(job.error_code) === "IDA_WAIT" ? idaParseJ(job.error_details) : null;
  entry.waitFrom = wait && typeof wait === "object" && s(wait.step) === "D3_RECEIPT" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s(wait.waitFrom)) ? s(wait.waitFrom) : "";
  // the job owns the IDA: Processing, its ida_v2_job_id, and the latest IDC| LOCK row carries the job's key (CONTRACT.md section 4)
  const keyed = idaId !== "0" && s(ida.ida_id) === idaId && s(ida.lock_ref) !== "" && s(ida.lock_ref) === entry.idempotencyKey && s(ida.ida_v2_job_id) === guard.jobId;
  const lockMine = keyed && s(ida.item_disassembly_status) === "Processing";
  entry.unlockOk = phase === "A" && lockMine ? "YES" : "NO";
  const fail = (code, message, why) => {
    const f = failNoWrite(entry, code, message, why, []);
    // a D1 intent of an earlier pass: its Batch rows are found (BATCH part + BATCH_OURS) before the failure is written
    const read = f.job_status === "FAILED" && entry.needBatchRead === "YES" && entry.hasIntent === "YES" ? "YES" : "NO";
    return Object.assign({}, base, entry, f, { route: "FAIL", phase: phase, needOursRead: read });
  };
  const review = (why) => Object.assign({}, base, entry, reviewEnd(entry, "ENTRY", "IDA_RECONCILIATION_MISMATCH", why), { route: "REVIEW", phase: phase });
  if (!valid) {
    if (phase === "A") return fail("IDA_INVALID_DATA", MSG.invalid, bad.join("; ") + ": nothing was moved");
    return review(bad.join("; ") + " after the source was issued");
  }
  const where = "(job " + s(ida.ida_v2_job_id) + ", lock " + s(ida.lock_ref) + ")";
  if (phase === "A" && !lockMine) return fail("IDA_NOT_LOCKED", IDA_TEXT.notLocked, "the Item Disassembly is " + (s(ida.item_disassembly_status) || "missing (deleted?)") + " " + where + ": nothing was moved");
  // after op 1 the IDA stays this job's until D4 writes Completed
  if (phase === "B" && !(keyed && (s(ida.item_disassembly_status) === "Processing" || s(ida.item_disassembly_status) === "Completed"))) {
    return review("after the source was issued the Item Disassembly is " + (s(ida.item_disassembly_status) || "missing (deleted?)") + " " + where);
  }
  if (phase === "B" && entry.batchMode === "insert" && !done.D1_BATCH) return review("D2_ISSUE is done without a D1_BATCH row");
  const claim = jobRow(entry, { job_status: "COMMITTING_IDA", progress_percent: progress, progress_message: entry.progressMessage, attempt_count: entry.attempts, row_version: entry.rowVersion + 1,
    error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, lease_owner: guard.leaseOwner, lease_expires_at: entry.leaseUntil });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, jobRows: [claim], needJobUpd: "YES",
    needD0: phase === "A" && !done.D0_REVALIDATE ? "YES" : "NO",
    needD1: phase === "A" && entry.batchMode === "insert" && !done.D1_BATCH ? "YES" : "NO",
    needD2: phase === "A" ? "YES" : "NO",
    needD3: phase === "B" && !done.D3_RECEIPT ? "YES" : "NO",
    needD4: phase === "B" && !done.D4_FINISH ? "YES" : "NO",
    result_message: "phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_IDA",
  });
};
const guard = [{{node:code_node_DCguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_DCjob.data}}][0], [{{node:sql_node_DCsteps.data}}][0], [{{node:sql_node_DCintent.data}}][0], [{{node:sql_node_DCpayload.data}}][0],
  [{{node:sql_node_DCida.data}}][0], [{{node:sql_node_DCop1.data}}][0], [{{node:sql_node_DCop2.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, d0: res.needD0, d1: res.needD1, d2: res.needD2, d3: res.needD3, d4: res.needD4, unlock: res.unlockOk, op: res.opWrote, waitFrom: res.waitFrom, result: res.result_code, message: res.result_message }));
return res;
