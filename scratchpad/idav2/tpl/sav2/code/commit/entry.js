// SA_V2_COMMIT - Entry: the job (+ its request: action, source, prevStatus, edited, scId), its A step rows, the manifest and
// the Stock Adjustment's lock -> what this run does (phase A = A0 revalidate, A1 lines, A2 inventory, then SPLIT / PARK;
// phase B = A3 Stock Count, A4 items + reorder + Completed, then COMPLETED) and the lease claim
const SA_SOURCE_OF = { DIRECT: "FORM", COMPLETE: "FORM", REVIEW: "REVIEW" };
const SA_PARTS = ["ENGINE", "LABELS", "HDR", "ITEMS", "REORDER"];
const commitEntry = function commitEntry(guard, jobRows, stepRows, payloadRows, saFacts) {
  const jobs = list(jobRows);
  const job = jobs.filter((r) => s(r.id))[0] || null;
  const dbNow = jobs.length ? s(jobs[0].db_now) : "";
  const done = {};
  const tried = {};
  for (const r of list(stepRows)) {
    if (s(r.step_status) === "DONE") done[s(r.step_name)] = true;
    if (s(r.step_status) === "TRY") tried[s(r.step_name)] = true;
  }
  const sa = list(saFacts)[0] || {};
  const base = {
    route: "NO_WRITE", phase: "", dbNow: dbNow, jsAt: String(Date.now()), jobId: guard.jobId, tenantId: guard.tenantId, organizationId: "0", saId: "0", saNo: "", scId: "0", action: "", source: "", prevStatus: "",
    lineFingerprint: "", incomingFingerprint: "", scFingerprint: "", scAfterFingerprint: "", entryCount: 0, idempotencyKey: "", jobStatus: job ? s(job.job_status) : "",
    rowVersion: job ? Number(job.row_version) || 0 : 0, attempts: job ? Number(job.attempt_count) || 0 : 0, leaseUntil: job ? s(job.lease_until) : "", unlockOk: "NO", partPrefix: "",
    doneReorder: "NO", triedA1: "NO", a0ScId: "0", jobRows: [], needJobUpd: "NO", unlockRows: [], needUnlock: "NO", needA0: "NO", needA1: "NO", needA2: "NO", needA3R: "NO", needA3P: "NO", needA4: "NO",
    result_code: "", result_message: "", job_status: job ? s(job.job_status) : "",
  };
  const answer = (code, why) => Object.assign({}, base, { result_code: code, result_message: why });
  if (!job) return answer("SA_INVALID_DATA", "job " + guard.jobId + " not found in tenant " + guard.tenantId);
  if (String(job.is_deleted) !== "0") return answer("SA_INVALID_DATA", "job is deleted");
  if (!digits(job.organization_id)) return answer("SA_INVALID_DATA", "job organization is not an id");
  if (s(job.command) !== "COMPLETE_SA") return answer("SA_INVALID_DATA", "job command is " + s(job.command));
  const status = s(job.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_SA"].indexOf(status) < 0) return answer(status === "COMPLETED" ? "" : "JOB_ILLEGAL_TRANSITION", "job is " + status + ": SA_V2_COMMIT works on READY_TO_COMMIT / COMMITTING_SA only");
  // a SPLIT| lease is the hand-over to the next run, not a foreign holder
  if (status === "COMMITTING_SA" && s(job.lease_owner) && s(job.lease_owner) !== guard.leaseOwner && s(job.lease_owner).indexOf("SPLIT|") !== 0 && String(job.lease_live) === "1") return answer("JOB_ROW_VERSION_CONFLICT", "job lease is held by " + s(job.lease_owner) + " until " + s(job.lease_expires_at));
  if (status === "COMMITTING_SA" && String(job.due) === "0") return answer("", "job is not due before " + s(job.next_attempt_at) + " (backoff)");
  const m = saParseJ(s((list(payloadRows)[0] || {}).prepared_payload));
  const corr = s(job.correlation_id);
  const saId = /^SA\|[0-9]{1,20}$/.test(corr) ? corr.slice(3) : "0";
  const action = s(job.req_action);
  const source = s(job.req_source);
  const review = action === "REVIEW";
  const mp = m && typeof m === "object" && m.parts && typeof m.parts === "object" ? m.parts : {};
  const listed = (k) => Array.isArray(mp[k]) && mp[k].length > 0;
  const scId = m && typeof m === "object" && digits(m.sc_id) ? s(m.sc_id) : "0";
  // the manifest must be this job's plan (CONTRACT section 5); every reason it is not is collected
  const bad = [];
  if (!m || typeof m !== "object") bad.push("the prepared payload is missing or unreadable");
  else {
    if (s(m.job_id) !== guard.jobId) bad.push("its job_id is " + s(m.job_id));
    if (saId === "0" || s(m.sa_id) !== saId) bad.push("its sa_id " + s(m.sa_id) + " is not the job's Stock Adjustment " + saId);
    if (!SA_SOURCE_OF[action] || SA_SOURCE_OF[action] !== source || s(m.action) !== action) bad.push("action " + action + " / source " + source + " / manifest action " + s(m.action));
    if (!/^[0-9A-Za-z]{1,16}$/.test(s(m.nonce))) bad.push("no part nonce");
    const missing = SA_PARTS.filter((k) => !listed(k));
    if ((review || (action === "COMPLETE" && s(job.req_edited) === "1")) && !listed("SALINES")) missing.push("SALINES");
    if ((review || scId !== "0") && !listed("SC")) missing.push("SC");
    if (missing.length) bad.push("part(s) " + missing.join(", ") + " missing");
    if (listed("SC") && scId === "0") bad.push("an SC part without the manifest's sc_id");
    if (!/^SAF1:/.test(s(m.lineFingerprint)) || !/^SAF1:/.test(s(m.incomingFingerprint))) bad.push("no SAF1 line fingerprints");
    if (review && (scId !== s(job.req_sc_id) || !/^SCF1:/.test(s(m.scFingerprint)))) bad.push("the review's Stock Count " + scId + " (request " + s(job.req_sc_id) + ") or its SCF1 fingerprint");
  }
  const valid = bad.length === 0;
  const c = valid && m.counts && typeof m.counts === "object" ? m.counts : {};
  const entry = { jobId: guard.jobId, tenantId: guard.tenantId, organizationId: s(job.organization_id), saId: saId, saNo: valid ? s(m.sa_no) || s(sa.adjustment_no) : s(sa.adjustment_no),
    scId: valid ? scId : "0", action: action, source: source, prevStatus: s(job.prev_status), lineFingerprint: valid ? s(m.lineFingerprint) : "",
    incomingFingerprint: valid ? s(m.incomingFingerprint) : "", scFingerprint: valid ? s(m.scFingerprint) : "", scAfterFingerprint: valid ? s(m.scAfterFingerprint) : "",
    entryCount: num(c.entries) || num(c.movements), idempotencyKey: s(job.idempotency_key), dbNow: dbNow, jsAt: String(Date.now()), attempts: Number(job.attempt_count) || 0, rowVersion: Number(job.row_version) || 0,
    leaseUntil: s(job.lease_until) };
  // the job owns the Stock Adjustment: Processing, its sa_v2_job_id, and the latest SAC| LOCK row carries the job's key (CONTRACT section 4)
  const keyed = saId !== "0" && s(sa.sa_id) === saId && s(sa.lock_ref) !== "" && s(sa.lock_ref) === entry.idempotencyKey && s(sa.sa_v2_job_id) === guard.jobId;
  const lockMine = keyed && s(sa.stock_adjustment_status) === "Processing";
  entry.unlockOk = !done.A2_INVENTORY && lockMine ? "YES" : "NO";
  const phase = done.A2_INVENTORY ? "B" : "A";
  if (!valid) {
    if (phase === "A") return Object.assign({}, base, entry, failNoWrite(entry, "SA_INVALID_DATA", MSG.invalid, bad.join("; ") + ": no stock was moved"), { route: "FAIL" });
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", bad.join("; ") + " after the stock was moved", true), { route: "REVIEW" });
  }
  const where = "(job " + s(sa.sa_v2_job_id) + ", lock " + s(sa.lock_ref) + ")";
  if (phase === "A" && !lockMine) return Object.assign({}, base, entry, failNoWrite(entry, "SA_NOT_LOCKED", MSG.notLocked, "the Stock Adjustment is " + (s(sa.stock_adjustment_status) || "missing") + " " + where + ": no stock was moved"), { route: "FAIL" });
  // after A2 the Stock Adjustment stays this job's until A4 writes Completed
  if (phase === "B" && !(keyed && (s(sa.stock_adjustment_status) === "Processing" || s(sa.stock_adjustment_status) === "Completed"))) {
    return Object.assign({}, base, entry, stepEnd(entry, "ENTRY", "after the stock moved the Stock Adjustment is " + (s(sa.stock_adjustment_status) || "missing") + " " + where, true), { route: "REVIEW" });
  }
  const needA1 = review || (action === "COMPLETE" && listed("SALINES"));
  const claim = jobRow(entry, { job_status: "COMMITTING_SA", progress_percent: Math.max(Number(job.progress_percent) || 0, phase === "A" ? 70 : 85),
    progress_message: phase === "A" ? "Moving the stock of " + entry.entryCount + " entr" + (entry.entryCount === 1 ? "y" : "ies") : "Updating the Stock Count, the items and the Stock Adjustment",
    attempt_count: entry.attempts, row_version: entry.rowVersion + 1, error_code: job.error_code || null, error_message: job.error_message || null, error_details: job.error_details || null,
    lease_owner: guard.leaseOwner, lease_expires_at: s(job.lease_until) });
  return Object.assign({}, base, entry, {
    route: "GO", phase: phase, partPrefix: "P|" + s(m.nonce) + "|", doneReorder: done.A4_REORDER ? "YES" : "NO", triedA1: tried.A1_TRY ? "YES" : "NO", jobRows: [claim], needJobUpd: "YES",
    a0ScId: review ? scId : "0",
    needA0: phase === "A" && !done.A0_REVALIDATE ? "YES" : "NO",
    needA1: phase === "A" && needA1 && !done.A1_SA_LINES ? "YES" : "NO",
    needA2: phase === "A" ? "YES" : "NO",
    needA3R: phase === "B" && review && !done.A3_STOCK_COUNT ? "YES" : "NO",
    needA3P: phase === "B" && !review && listed("SC") && !done.A3_STOCK_COUNT ? "YES" : "NO",
    needA4: phase === "B" && !done.A4_FINISH ? "YES" : "NO",
    result_message: action + " phase " + phase + (Object.keys(done).length ? " (done: " + Object.keys(done).sort().join(", ") + ")" : ""), job_status: "COMMITTING_SA",
  });
};
const guard = [{{node:code_node_SACguard.data}}][0];
const res = commitEntry(guard, [{{node:sql_node_SACjob.data}}][0], [{{node:sql_node_SACsteps.data}}][0], [{{node:sql_node_SACpayload.data}}][0], [{{node:sql_node_SACsa.data}}][0]);
console.log("commit entry", JSON.stringify({ route: res.route, phase: res.phase, action: res.action, a0: res.needA0, a1: res.needA1, a2: res.needA2, a3: res.needA3R + "/" + res.needA3P, a4: res.needA4, unlock: res.unlockOk, result: res.result_code, message: res.result_message }));
return res;
