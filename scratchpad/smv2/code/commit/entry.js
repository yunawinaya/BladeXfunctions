// LOT_V2_COMMIT - Entry: the job (+ its request: action, prevStatus, saveAs, fingerprints, SUBMIT's nonce), its L step rows,
// the manifest and the transfer's lock -> what this run does (phase A = L0 revalidate, L1 inventory, then SPLIT / PARK;
// phase B = L2 lines, L3 In Transit ledger, L4 header + Item dates, then COMPLETED) and the lease claim
const LOT_BUILT = __BUILT__;
const LOT_ACTIONS = ["DIRECT", "STAGE", "COMPLETE", "EDIT", "CANCEL"];
const commitEntry = function commitEntry(guard, jobRows, stepRows, payloadRows, lotFacts, sPartRows) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  for (const r of list(stepRows)) if (s(r.step_status) === "DONE") done[s(r.step_name)] = true;
  const lot = list(lotFacts)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: String(Date.now()), jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", lotId: "0", lotNo: "", action: "", prevStatus: "", saveAs: "",
    lineFingerprint: "", incomingFingerprint: "", lineCount: 0, idempotencyKey: "", jobStatus: job ? s(job.job_status) : "", rowVersion: job ? Number(job.row_version) || 0 : 0,
    attempts: job ? Number(job.attempt_count) || 0 : 0, leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", partPrefix: "", sPartPrefix: "", jobRows: [], needJobUpd: "NO",
    unlockRows: [], needUnlock: "NO", needL0: "NO", needL1: "NO", needL2: "NO", needL2Full: "NO", hasAlloc: "NO", needL3: "NO", needL4: "NO", result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("LOT_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("LOT_INVALID_DATA", "job is deleted");
  if (!digits(job.organization_id)) return answer("LOT_INVALID_DATA", "job organization is not an id");
  if (s(job.command) !== "SAVE_LOT") return answer("LOT_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_LOT"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": LOT_V2_COMMIT works on READY_TO_COMMIT / COMMITTING_LOT only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_LOT" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_LOT" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  const m = lotParseJ(s((list(payloadRows)[0] || {}).prepared_payload));
  const corr = s(job.correlation_id);
  const lotId = /^LOT\|[0-9]{1,20}$/.test(corr) ? corr.slice(4) : "0";
  const action = s(job.req_action);
  const PARTS = ["ENGINE", "LABELS", "IT", "HDR", "ITEMS"];
  // V2.1 bundles: PREPARE names an ALLOC part only when it auto-allocated rows (DIRECT / STAGE / COMPLETE / EDIT)
  const allocNames = m && typeof m === "object" && m.parts ? m.parts.ALLOC : undefined;
  const hasAlloc = Array.isArray(allocNames) && allocNames.length > 0;
  const sNonce = s(job.req_nonce);
  const valid = !!m && typeof m === "object" && s(m.job_id) === guard.jobId && lotId !== "0" && s(m.lot_id) === lotId && !!m.parts && PARTS.every((k) => Array.isArray(m.parts[k]) && m.parts[k].length)
    && /^[0-9A-Za-z]{1,16}$/.test(s(m.nonce)) && LOT_ACTIONS.indexOf(action) >= 0 && (allocNames === undefined || (hasAlloc && action !== "CANCEL"));
  const mLines = valid && s(m.lineCount) !== "" && isFinite(Number(m.lineCount)) ? Number(m.lineCount) : num(job.line_count);
  const entry = { jobId: guard.jobId, tenantId: guard.tenantId, organizationId: s(job.organization_id), lotId: lotId, lotNo: valid ? s(m.lot_no) : "", action: action,
    prevStatus: s(job.prev_status), saveAs: s(job.req_save_as), lineFingerprint: s(job.line_fp), incomingFingerprint: s(job.incoming_fp), lineCount: mLines,
    idempotencyKey: s(job.idempotency_key), dbNow: dbNow, jsAt: String(Date.now()), attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0, leaseUntil: s(job.lease_until) };
  // the job owns the transfer: Processing, its lot_v2_job_id, and the latest LOCK row carries the job's key (CONTRACT section 4)
  const keyed = lotId !== "0" && s(lot.lot_id) === lotId && s(lot.lock_ref) !== "" && s(lot.lock_ref) === entry.idempotencyKey && s(lot.lot_v2_job_id) === guard.jobId;
  const lockMine = keyed && s(lot.stock_movement_status) === "Processing";
  entry.unlockOk = !done.L1_INVENTORY && lockMine ? "YES" : "NO";
  const phase = done.L1_INVENTORY ? "B" : "A";
  if (!valid) {
    if (phase === "A") return Object.assign({}, base, entry, failNoWrite(entry, "LOT_INVALID_DATA", MSG.invalid, "the prepared payload is missing or is not this job's: no stock was moved"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "the prepared payload is missing or is not this job's after the stock was moved", true), { route: "REVIEW" });
  }
  if (phase === "A" && !lockMine) return Object.assign({}, base, entry, failNoWrite(entry, "LOT_NOT_LOCKED", MSG.notLocked, "the Location Transfer is " + s(lot.stock_movement_status) + " (job " + s(lot.lot_v2_job_id) + ", lock " + s(lot.lock_ref) + "): no stock was moved"), { route: "FAIL" });
  // COMPLETE / EDIT: SUBMIT's S|<nonce>|LINES part and incomingFingerprint must be there before any stock moves (L2 writes them)
  if (phase === "A" && ["COMPLETE", "EDIT"].indexOf(action) >= 0) {
    const pfx = "S|" + sNonce + "|LINES|";
    const mine = list(sPartRows).filter((r) => s(r.step_name).indexOf(pfx) === 0);
    const chars = mine.reduce((t, r) => t + num(r.chars), 0);
    if (!/^[0-9A-Za-z]{1,16}$/.test(sNonce) || !mine.length || chars <= 0 || !entry.incomingFingerprint) {
      return Object.assign({}, base, entry, failNoWrite(entry, "LOT_INVALID_REQUEST", MSG.badRequest, "the request's lines part " + pfx + " (" + mine.length + " row(s), " + chars + " chars) or its incomingFingerprint is missing: no stock was moved"), { route: "FAIL" });
    }
  }
  // after L1 the transfer stays this job's until L4 writes its final status (= saveAs)
  if (phase === "B" && !(keyed && (s(lot.stock_movement_status) === "Processing" || s(lot.stock_movement_status) === entry.saveAs))) {
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "after the stock moved the Location Transfer is " + s(lot.stock_movement_status) + " (job " + s(lot.lot_v2_job_id) + ", lock " + s(lot.lock_ref) + ")", true), { route: "REVIEW" });
  }
  const c = m.counts || {};
  const itCount = c.itCreates === undefined && c.itUpdates === undefined ? -1 : num(c.itCreates) + num(c.itUpdates);
  const needs = { L2: ["COMPLETE", "EDIT"].indexOf(action) >= 0 || hasAlloc, L3: itCount !== 0 };
  const missing = Object.keys(needs).filter((k) => needs[k] && LOT_BUILT.indexOf(k) < 0);
  if (missing.length) {
    const why = action + " needs step(s) " + missing.join(", ") + " that this LOT_V2_COMMIT does not have yet";
    if (phase === "A") return Object.assign({}, base, entry, failNoWrite(entry, "LOT_STEP_NOT_BUILT", MSG.notBuilt, why + ": no stock was moved"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", why + " after the stock moved", true), { route: "REVIEW" });
  }
  const claim = jobRow(entry, { job_status: "COMMITTING_LOT", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 85),
    progress_message: phase === "A" ? "Moving the stock of " + entry.lineCount + " line(s)" : "Saving the lines, the In Transit ledger and the header", attempt_count: entry.attempts,
    row_version: entry.rowVersion + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null, lease_owner: guard.leaseOwner,
    lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, partPrefix: "P|" + s(m.nonce) + "|", sPartPrefix: "S|" + (/^[0-9A-Za-z]{1,16}$/.test(sNonce) ? sNonce : "0") + "|", jobRows: [claim], needJobUpd: "YES",
    needL0: phase === "A" && !done.L0_REVALIDATE ? "YES" : "NO",
    needL1: phase === "A" ? "YES" : "NO",
    needL2: phase === "B" && needs.L2 && !done.L2_LINES ? "YES" : "NO",
    needL2Full: phase === "B" && hasAlloc && (action === "DIRECT" || action === "STAGE") && !done.L2_LINES ? "YES" : "NO", hasAlloc: hasAlloc ? "YES" : "NO",
    needL3: phase === "B" && needs.L3 && !done.L3_LEDGER ? "YES" : "NO",
    needL4: phase === "B" && !done.L4_FINISH ? "YES" : "NO",
    result_message: action + " phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_LOT",
  });
};
const guard = [{{node:code_node_LCguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_LCjob.data}}][0], [{{node:sql_node_LCsteps.data}}][0], [{{node:sql_node_LCpayload.data}}][0], [{{node:sql_node_LClot.data}}][0],
  [{{node:sql_node_LCsparts.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, action: res.action, l0: res.needL0, l1: res.needL1, l2: res.needL2, l3: res.needL3, l4: res.needL4, unlock: res.unlockOk, result: res.result_code, message: res.result_message }));
return res;
