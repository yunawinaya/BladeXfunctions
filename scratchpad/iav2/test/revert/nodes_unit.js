// Unit cases of IA_REVERT_V2_PREPARE's entry / ready nodes and IA_REVERT_V2_SUBMIT's guard / entry / post / row / due / result
// nodes (step functions without their platform tails). usage: node nodes_unit.js
const H = require("./_harness");
const X = require("./_rows");
const ok = H.ok;
const J = (o) => JSON.stringify(o);

// ---------------------------------------------------------------- PREPARE entry
{
  const sb = H.loadSteps(["code/revert/prepare/entry.js"], ["prepareEntry"]);
  const E = (row, uuid) => H.fromBox(sb.prepareEntry(H.intoBox(sb, { jobId: X.JOB, tenantId: "000000" }), H.intoBox(sb, row ? [row] : []), uuid || "abcdef0123456789"));
  const req = { v: 1, action: "REVERT", prevStatus: "Completed", iaId: "2120000000000000001", iaNo: "IA-1", movesFingerprint: "IM1:3:0123456789abcdef" };
  const job = (o) => Object.assign({ db_now: "2026-10-19 12:00:00", id: X.JOB, organization_id: "1123598813738675201", command: "REVERT_IA", job_status: "VALIDATING", lease_owner: "WRK|x",
    lease_live: 1, row_version: 4, attempt_count: 0, idempotency_key: X.KEY, correlation_id: "IA|2120000000000000001", request_payload: J(req), is_deleted: 0 }, o || {});
  let r = E(job());
  ok(r.route === "GO" && r.iaId === "2120000000000000001" && r.prevStatus === "Completed" && r.nonce === "abcdef01" && r.request.movesFingerprint === req.movesFingerprint, "entry GO", r);
  ok(E(null).route === "NOOP" && E(job({ command: "COMPLETE_IA" })).route === "NOOP" && E(job({ job_status: "QUEUED" })).route === "NOOP" && E(job({ lease_live: 0 })).route === "NOOP",
    "entry NOOP: no job / another command / not VALIDATING / lease expired");
  r = E(job({ request_payload: "{bad" }));
  ok(r.route === "REVIEW" && r.result_code === "IA_RV_PREV_STATUS_UNKNOWN", "entry: an unreadable request -> REVIEW (ruling 4: a FAILED would strand the IA)", r);
  r = E(job({ correlation_id: "IA|999" }));
  ok(r.route === "REVIEW" && r.result_code === "IA_RV_PREV_STATUS_UNKNOWN", "entry: request iaId != correlation -> REVIEW", r);
  r = E(job({ request_payload: J(Object.assign({}, req, { prevStatus: "Draft" })) }));
  ok(r.route === "REVIEW" && r.result_code === "IA_RV_PREV_STATUS_UNKNOWN", "entry: prevStatus not Completed -> REVIEW (no default)", r);
  r = E(job({ request_payload: J(Object.assign({}, req, { prevStatus: undefined })) }));
  ok(r.route === "REVIEW", "entry: no prevStatus -> REVIEW", r);
}

// ---------------------------------------------------------------- PREPARE ready
{
  const sb = H.loadSteps(["code/revert/prepare/ready.js"], ["prepareReady"]);
  const R = (e, p, g) => H.fromBox(sb.prepareReady(H.intoBox(sb, e), H.intoBox(sb, p), H.intoBox(sb, g || {})));
  const e = { route: "GO", jobId: X.JOB, iaId: "2120000000000000001", rowVersion: 4, dbNow: "2026-10-19 12:00:00", jsAt: String(Date.now()), prevStatus: "Completed" };
  const labels = { M1: { item_code: "FG-1", item_name: "Assembly", bin: "FG-01", bin_id: "9", category: "Blocked", side: "out" },
    M2: { item_code: "RM-1", item_name: "Part 1", bin: "A1-01", bin_id: "8", category: "Unrestricted", side: "in" } };
  const plan = { route: "READY", code: "200", message: "Planned 2", payload: J({ v: 1 }), lineCount: 2, movementCount: 2, unlockOk: 1, details: "", needPlan: "YES", labels: labels, keys: ["M1", "M2"] };
  let r = R(e, plan, { code: "200", result_code: "OK", message: "Planned 2 movements", results: [{ movement_key: "M1", code: "200" }, { movement_key: "M2", code: "200" }] });
  ok(r.route === "OK" && r.needReady === "YES" && r.needParts === "YES" && r.readyRows[0].job_status === "READY_TO_COMMIT" && r.readyRows[0].progress_percent === 60
    && r.readyRows[0].prepared_payload === plan.payload && r.readyRows[0].line_count === 2 && r.readyRows[0].row_version === 5 && r.needUnlock === "NO", "ready: PLAN 200, all results 200 -> READY_TO_COMMIT", r);
  // fix wave R7: the engine's results as the platform may hand them on - JSON text instead of an array
  const okRes = [{ movement_key: "M1", code: "200" }, { movement_key: "M2", code: "200" }];
  r = R(e, plan, { code: "200", result_code: "OK", message: "Planned 2 movements", results: J(okRes) });
  ok(r.route === "OK" && r.readyRows[0].job_status === "READY_TO_COMMIT", "R7 ready: results as JSON text, all 200 -> READY_TO_COMMIT (same as the array)", r);
  r = R(e, plan, { code: "200", result_code: "OK", results: J([okRes[0], { movement_key: "M2", code: "401", message: "Skipping inventory update for item (stock control = 0)" }]) });
  ok(r.result_code === "IA_RV_PLAN_SKIPPED" && r.needUnlock === "YES", "R7 ready: results as JSON text with a '401' -> IA_RV_PLAN_SKIPPED (same as the array)", r);
  r = R(e, plan, { code: "200", result_code: "OK", results: "not json" });
  ok(r.result_code === "IA_RV_PLAN_FAILED" && /0 of 2/.test(r.result_message), "R7 ready: unreadable results text -> IA_RV_PLAN_FAILED (0 of 2), never READY", r.result_message);
  r = R(e, plan, { code: "200", result_code: "OK", results: [{ movement_key: "M1", code: "200" }, { movement_key: "M2", code: "401", message: "Skipping inventory update for item (stock control = 0)" }] });
  ok(r.result_code === "IA_RV_PLAN_SKIPPED" && r.jobRows[0].job_status === "FAILED" && r.jobRows[0].error_message === "Skipping inventory update for item (stock control = 0) - RM-1, into bin A1-01 (Unrestricted): nothing was moved."
    && r.needUnlock === "YES" && r.unlockRows[0].item_assembly_status === "Completed" && r.jobRows[0].lease_owner === null, "ready: a '401' result -> IA_RV_PLAN_SKIPPED, mapped, + Completed again", r);
  r = R(e, plan, { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement M1)" });
  ok(r.result_code === "IA_RV_INVENTORY_INSUFFICIENT" && r.jobRows[0].error_message === "Insufficient quantity - FG-1, bin FG-01 (Blocked)" && r.needUnlock === "YES",
    "ready: PLAN 400 -> IA_RV_INVENTORY_<code> with the LABELS-mapped message, unlock", r.jobRows[0]);
  r = R(e, plan, { code: "400", result_code: "REQUEST_INVALID", message: "movements[1] location_id must be digits" });
  ok(r.jobRows[0].error_message === "location_id must be digits - RM-1, into bin A1-01 (Unrestricted)", "ready: a guard refusal by index is mapped too", r.jobRows[0].error_message);
  r = R(e, plan, {});
  ok(r.result_code === "IA_RV_PLAN_FAILED" && /answered nothing/.test(r.jobRows[0].error_message) && r.needUnlock === "YES", "ready: no answer -> IA_RV_PLAN_FAILED, unlock", r);
  r = R(e, plan, { code: "200", results: [{ movement_key: "M1", code: "200" }] });
  ok(r.result_code === "IA_RV_PLAN_FAILED" && /1 of 2/.test(r.result_message), "ready: fewer results than movements -> IA_RV_PLAN_FAILED", r.result_message);
  r = R(e, Object.assign({}, plan, { needPlan: "NO", movementCount: 0 }), {});
  ok(r.route === "OK" && r.needReady === "YES", "ready: nothing to move (header only) -> READY without a PLAN", r);
  r = R(e, { route: "FAIL", code: "IA_RV_CONFLICTS", message: "Revert blocked: x", details: J({ step: "IA_REVERT_V2_PREPARE", conflicts: [{ type: "t" }] }), unlockOk: 1 });
  ok(r.result_code === "IA_RV_CONFLICTS" && JSON.parse(r.jobRows[0].error_details).conflicts.length === 1 && r.needUnlock === "YES" && r.jobRows[0].progress_message === "Not reverted: Revert blocked: x",
    "ready: plan FAIL -> FAILED with its details + Completed again", r);
  r = R(e, { route: "FAIL", code: "IA_RV_NOT_LOCKED", message: "x", unlockOk: 0 });
  ok(r.result_code === "IA_RV_NOT_LOCKED" && r.needUnlock === "NO", "ready: not locked -> FAILED, no unlock", r);
  r = R(Object.assign({}, e, { prevStatus: "Draft" }), { route: "FAIL", code: "IA_RV_CONFLICTS", message: "x", unlockOk: 1 });
  ok(r.job_status === "REQUIRES_REVIEW" && r.result_code === "IA_RV_PREV_STATUS_UNKNOWN" && r.needUnlock === "NO", "ready: owned but prevStatus unknown -> REQUIRES_REVIEW, no unlock", r);
  r = R(Object.assign({}, e, { route: "REVIEW", result_message: "x" }), { route: "FAIL" });
  ok(r.job_status === "REQUIRES_REVIEW" && r.needUnlock === "NO", "ready: entry REVIEW -> REQUIRES_REVIEW", r);
  r = R(Object.assign({}, e, { route: "NOOP", result_code: "JOB_ILLEGAL_TRANSITION" }), {});
  ok(r.route === "NOOP" && r.needJobUpd === "NO" && r.needUnlock === "NO", "ready: NOOP writes nothing", r);
}

// ---------------------------------------------------------------- SUBMIT guard / entry / post / row / due / result
{
  const files = ["code/revert/submit/_common.js", "code/revert/submit/guard.js", "code/revert/submit/entry.js", "code/revert/submit/post.js", "code/revert/submit/iarow.js",
    "code/revert/submit/due.js", "code/revert/submit/result.js"];
  const sb = H.loadSteps(files, ["submitGuard", "submitEntry", "submitPost", "submitIaRow", "submitDue", "submitResult"]);
  const F = (name, ...a) => H.fromBox(sb[name](...a.map((x) => H.intoBox(sb, x))));
  const IA = "2120000000000000001";
  const ORG = "1123598813738675201";
  const form = { id: IA, item_assembly_status: "Completed", stock_movement_no: "IA-1", organization_id: ORG };
  const G = (o) => F("submitGuard", Object.assign({ operation: "SUBMIT", iaId: IA, key: "IAV:" + ORG + ":" + IA + ":ab12", source: "LIST", minPicks: "50", form: form, tenantId: "000000",
    uid: "7", uuid: "0123456789abcdef" }, o || {}));
  let g = G();
  ok(g.route === "CONTINUE" && g.minPicks === 50 && g.formStatus === "Completed" && g.formOrg === ORG && g.source === "LIST" && g.nonce === "01234567", "guard ok", g);
  ok(G({ operation: "DELETE" }).route === "REJECT" && G({ iaId: "x" }).route === "REJECT" && G({ key: "short" }).route === "REJECT" && G({ minPicks: "5x" }).route === "REJECT"
    && G({ form: null }).route === "REJECT" && G({ form: { item_assembly_status: "Completed" } }).route === "REJECT" && G({ tenantId: "" }).route === "REJECT",
  "guard rejects: operation / ia_id / key / min_picks / no row / no row organization / no tenant");
  ok(G({ operation: "STATUS", key: "", form: null }).route === "CONTINUE" && G({ minPicks: "" }).minPicks === 0, "guard: STATUS needs no key or row; absent min_picks = 0");
  g = G();
  const job = (o) => J(Object.assign({ id: "2121", command: "REVERT_IA", job_status: "QUEUED", correlation_id: "IA|" + IA, progress_percent: 0, progress_message: "Queued", error_code: null,
    error_message: null, line_count: 60, action: "REVERT", ia_no: "IA-1" }, o || {}));
  const facts = (o) => [Object.assign({ db_now: "2026-10-19 12:00:00", key_job: null, ia_id: IA, stock_movement_no: "IA-1", item_assembly_status: "Completed", posted_status: "Unposted",
    organization_id: ORG, plant_id: "1123598813738675202", no_type: null, ia_v2_job_id: null, ia_lock: null, open_jobs: null, last_job: null, link_job: null }, o || {})];
  let e = F("submitEntry", g, facts());
  ok(e.route === "GO" && e.lockN === 1 && e.iaNo === "IA-1" && e.plantId === "1123598813738675202", "entry GO (LOCK|1)", e);
  e = F("submitEntry", g, facts({ ia_lock: J({ step: "LOCK|4", ref: "IA:x:y:z", young: 0, job: "COMPLETED" }) }));
  ok(e.route === "GO" && e.lockN === 5, "entry GO after an old lock -> LOCK|5", e);
  e = F("submitEntry", g, facts({ key_job: job({ job_status: "VALIDATING" }) }));
  ok(e.route === "STATUS" && e.jobId === "2121" && e.jobStatus === "VALIDATING" && e.jobAction === "REVERT", "entry: this key has a job -> its STATUS", e);
  e = F("submitEntry", G({ operation: "STATUS", key: "" }), facts({ last_job: job({ command: "COMPLETE_IA", action: "DIRECT", job_status: "FAILED" }) }));
  ok(e.route === "STATUS" && e.jobAction === "DIRECT" && e.jobStatus === "FAILED", "STATUS: the IA's latest job of either command", e);
  e = F("submitEntry", G({ operation: "STATUS", key: "" }), facts());
  ok(e.route === "STATUS" && e.jobStatus === "NONE" && e.message === "no background revert", "STATUS: no job -> NONE (IA_TEXT.rvNoJob)", e);
  e = F("submitEntry", g, facts({ ia_id: null }));
  ok(e.route === "STOP" && e.code === "400" && e.errorCode === "IA_RV_NOT_FOUND", "entry: no stored IA -> STOP IA_RV_NOT_FOUND", e);
  e = F("submitEntry", g, facts({ open_jobs: "[" + job({ command: "COMPLETE_IA", job_status: "COMMITTING_IA" }) + "]" }));
  ok(e.route === "BUSY" && e.code === "409" && e.errorCode === "IA_RV_BUSY" && e.message === "This Item Assembly is being processed in the background - please wait for it to finish.",
    "entry: an open COMPLETE_IA job -> BUSY", e);
  e = F("submitEntry", g, facts({ open_jobs: "[" + job({ job_status: "REQUIRES_REVIEW" }) + "]" }));
  ok(e.route === "BUSY" && e.errorCode === "IA_RV_UNDER_REVIEW" && e.message === "Its last revert stopped half-way and is under review: please contact support.",
    "entry: a REQUIRES_REVIEW revert job -> BUSY IA_RV_UNDER_REVIEW, the revert's wording (IA_TEXT.rvUnderReview)", e);
  e = F("submitEntry", g, facts({ open_jobs: "[" + job({ command: "COMPLETE_IA", action: "DIRECT", job_status: "REQUIRES_REVIEW" }) + "]" }));
  ok(e.route === "BUSY" && e.errorCode === "IA_RV_UNDER_REVIEW" && e.message === "Its last completion stopped half-way and is under review: please contact support.",
    "entry: a REQUIRES_REVIEW completion job -> BUSY IA_RV_UNDER_REVIEW, the completion's wording", e);
  e = F("submitEntry", g, facts({ item_assembly_status: "Processing" }));
  ok(e.route === "BUSY" && e.errorCode === "IA_RV_BUSY", "entry: stored Processing -> BUSY", e);
  e = F("submitEntry", g, facts({ ia_lock: J({ step: "LOCK|2", ref: "IA:other:key:1", young: 1, job: null }) }));
  ok(e.route === "BUSY", "entry: a young lock of another key, its job not inserted yet -> BUSY", e);
  e = F("submitEntry", g, facts({ ia_lock: J({ step: "LOCK|2", ref: g.key, young: 1, job: null }) }));
  ok(e.route === "GO" && e.lockN === 3, "entry: a young lock of THIS key (its job missing) does not block", e);
  e = F("submitEntry", g, facts({ item_assembly_status: "Draft" }));
  ok(e.route === "STALE" && e.code === "409" && e.errorCode === "IA_RV_STALE" && /it is now Draft/.test(e.message), "entry: the row says Completed, the IA is Draft -> STALE", e);
  e = F("submitEntry", g, facts());
  const gate = { route: "GO", liveRows: 60, liveOut: 59, liveIn: 1, movesFingerprint: "IM1:60:00", prevStatus: "Completed" };
  const p = F("submitPost", g, e, gate);
  const req = JSON.parse(p.jobRows[0].request_payload);
  ok(p.route === "QUEUE" && p.lockRows[0].job_id === "IAC|" + IA && p.lockRows[0].step_name === "LOCK|1" && p.lockRows[0].result_ref === g.key && p.lockRows[0].step_status === "LOCK",
    "post: the lock row IAC|<ia> / LOCK|1 = the key", p.lockRows[0]);
  ok(p.jobRows[0].command === "REVERT_IA" && p.jobRows[0].job_status === "QUEUED" && p.jobRows[0].next_attempt_at === "2026-10-19 12:02:00" && p.jobRows[0].correlation_id === "IA|" + IA
    && p.jobRows[0].causation_id === IA && p.jobRows[0].line_count === 60 && p.jobRows[0].plant_id === "1123598813738675202" && p.jobRows[0].idempotency_key === g.key,
  "post: the REVERT_IA job, QUEUED 2 minutes ahead, IA|<id>, line_count = live rows", p.jobRows[0]);
  ok(req.action === "REVERT" && req.prevStatus === "Completed" && req.iaId === IA && req.iaNo === "IA-1" && req.liveRows === 60 && req.liveOut === 59 && req.liveIn === 1 && req.movesFingerprint === "IM1:60:00"
    && req.source === "LIST" && req.uid === "7" && req.nonce === "01234567" && J(req.parts) === "{}" && req.organizationId === ORG, "post: the request payload (CONTRACT.md RV3)", req);
  ok(F("submitPost", g, e, { route: "NOT_ELIGIBLE", code: "300", message: "classic", errorCode: "IA_RV_NOT_ELIGIBLE" }).route === "STOP", "post: no queue without GO");
  const row = F("submitIaRow", g, [{ id: "2122" }]);
  ok(row.ok === "YES" && J(row.iaRows) === J([{ id: IA, item_assembly_status: "Processing", ia_v2_job_id: "2122" }]), "row: Processing + ia_v2_job_id", row);
  ok(F("submitIaRow", g, []).ok === "NO", "row: no job inserted -> nothing to lock");
  const owner = (o) => [Object.assign({ ia_id: IA, item_assembly_status: "Processing", ia_v2_job_id: "2122", stock_movement_no: "IA-1", lock_ref: g.key }, o || {})];
  const kj = (o) => [Object.assign({ job_id: "2122", job_status: "QUEUED", command: "REVERT_IA", correlation_id: "IA|" + IA, line_count: 60 }, o || {})];
  let d = F("submitDue", g, e, owner(), kj());
  ok(d.needDue === "YES" && d.dueRows[0].id === "2122" && d.dueRows[0].next_attempt_at === "2026-10-19 12:00:00", "due: read back Processing under this job and lock -> due now", d);
  ok(F("submitDue", g, e, owner({ lock_ref: "other" }), kj()).needDue === "NO" && F("submitDue", g, e, owner({ ia_v2_job_id: "9" }), kj()).needDue === "NO"
    && F("submitDue", g, e, owner(), kj({ command: "COMPLETE_IA" })).needDue === "NO", "due: another lock / job link / command -> not due");
  let res = F("submitResult", g, e, p, { owner: owner(), job: kj() });
  ok(res.route === "QUEUED" && res.code === "200" && res.job_id === "2122" && res.terminal === "NO" && res.ia_no === "IA-1" && res.line_count === "60" && res.action === "REVERT"
    && JSON.parse(res.evidence).route === "QUEUED", "result QUEUED", res);
  res = F("submitResult", g, e, p, { owner: owner({ item_assembly_status: "Completed" }), job: kj() });
  ok(res.route === "STOP" && res.code === "500" && res.error_code === "IA_RV_QUEUE_FAILED" && res.message === "The revert could not be queued: please try again.", "result: no read-back -> STOP 500 (IA_TEXT.rvQueueFailed)", res);
  res = F("submitResult", G({ iaId: "x" }), null, G({ iaId: "x" }), null);
  ok(res.route === "INVALID" && res.code === "400" && res.error_code === "IA_RV_INVALID_REQUEST", "result INVALID", res);
  e = F("submitEntry", G({ operation: "STATUS", key: "" }), facts());
  res = F("submitResult", G({ operation: "STATUS", key: "" }), e, e, null);
  ok(res.route === "STATUS" && res.job_status === "NONE" && res.terminal === "YES", "result STATUS NONE is terminal", res);
}
H.done("prepare / submit node units");
