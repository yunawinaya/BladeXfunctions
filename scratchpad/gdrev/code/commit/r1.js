// GD_REVERT_COMMIT - R1 INVENTORY: INVENTORY_BULK_APPLY APPLY (all-or-nothing; GDR|<job> makes a re-run replay it).
// 200 -> DONE + the SPLIT hand-over (phase B in the next run); 400 -> FAILED, GD back to Completed (the engine wrote nothing);
// 409 lock busy -> wait for the other operation, then FAILED + GD back to Completed - only while this operation has no intent
// rows (IBA|I|*: with them it may have written, so retry -> review); anything else -> REQUIRES_REVIEW
const LOCK_WAIT_TRIES = 8;
const OWN_RUN_TRIES = 16;
const lockWait = function lockWait(entry, why) {
  const n = entry.attempts;
  return { route: "END", jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.min(300, 15 * Math.pow(2, n))), error_code: "GDR_LOCK_WAIT",
    error_message: ("R1_INVENTORY: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "R1_INVENTORY", why: why.slice(0, 2000), attempt: n + 1 }) })],
    needJobUpd: "YES", unlockRows: [], needUnlock: "NO", result_code: "GDR_STEP_RETRY",
    result_message: "R1_INVENTORY: the stock is locked by another operation - wait " + (n + 1) + " of " + LOCK_WAIT_TRIES, job_status: "COMMITTING_GD" };
};
const revertR1 = function revertR1(entry, guard, input, eng, ops) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "GDR_INVALID_DATA", "the inventory part of the prepared payload is missing");
  // a failed call (caught, 10-27): its run failed and answered nothing (10-26, Kenhin GD 2097 and LSH GD-2610-1473: a first-use lock
  // seed lost its race and the job sat under its 30-min lease). As a 409: retry with the lease released; past the tries, review once
  // it has intent rows, else nothing was written
  if (s(eng.crashed) === "YES") {
    const wrote = num((ops || {}).intents) > 0;
    const failed = "INVENTORY_BULK_APPLY failed (caught)" + (wrote ? ", with intent rows" : ", nothing written");
    if (entry.attempts >= LOCK_WAIT_TRIES) return wrote ? stepEnd(entry, "R1_INVENTORY", failed, true) : failNoWrite(entry, "GDR_INVENTORY_CALL_FAILED", "the inventory call kept failing: nothing was written, try again later");
    return lockWait(entry, failed);
  }
  const code = s(eng.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(eng.result_code) + (s(eng.message) ? ": " + s(eng.message) : "");
  if (code === "200") {
    const ok = stepOk(entry, "R1_INVENTORY", s(eng.result_code) + " " + s(eng.message), "inventory " + s(eng.result_code));
    ok.splitRows = [jobRow(entry, { progress_percent: 80, progress_message: "Stock returned; updating the reservations, sales orders and the delivery", lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    return ok;
  }
  if (code === "409") {
    // with intent rows this operation holds all its keys: the 409 is engine v12's "the same operation is still running" -> wait, then review
    const wrote = num((ops || {}).intents) > 0;
    // our own operation's earlier run (e.g. one that crashed) holds it until its heartbeat is 20 min old: wait that out, up to
    // 16 tries (about an hour, as GD_EDIT_COMMIT E1), then review, never FAILED - so a marker that never clears is seen
    const ownRun = s(eng.message).indexOf("the same operation is still running") >= 0;
    if (ownRun && entry.attempts >= OWN_RUN_TRIES) return stepEnd(entry, "R1_INVENTORY", why, true);
    if (entry.attempts >= LOCK_WAIT_TRIES && !ownRun) return wrote ? stepEnd(entry, "R1_INVENTORY", why, true) : failNoWrite(entry, "GDR_INVENTORY_LOCK_BUSY", "the stock of its items stayed locked by another operation (" + why.slice(0, 300) + "): nothing was written, revert it again later");
    return lockWait(entry, why);
  }
  if (code === "400") return failNoWrite(entry, "GDR_INVENTORY_" + (s(eng.result_code) || "FAILED"), why);
  return stepEnd(entry, "R1_INVENTORY", why, true);
};
const eng = { code: [{{node:workflow_node_RCr1.data.code}}][0], result_code: [{{node:workflow_node_RCr1.data.result_code}}][0], message: [{{node:workflow_node_RCr1.data.message}}][0], crashed: [{{node:code_node_RCr1crash.data.crashed}}][0] };
const res = revertR1([{{node:code_node_RCentry.data}}][0], [{{node:code_node_RCguard.data}}][0], { ok: [{{node:code_node_RCr1in.data.ok}}][0] }, eng, list([{{node:sql_node_RCr1ops.data}}][0])[0]);
console.log("commit R1", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
