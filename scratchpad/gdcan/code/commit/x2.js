// GD_CANCEL_COMMIT - X2 INVENTORY: INVENTORY_BULK_APPLY APPLY (all-or-nothing; GDX|<job> makes a re-run replay it).
// 200 -> DONE + the SPLIT hand-over (phase B in the next run); 400 -> FAILED, GD back to Created (the engine wrote nothing);
// 409 lock busy -> wait for the other operation, then FAILED + GD back to Created - only while this operation has no intent
// rows (IBA|I|*: with them it may have written, so retry -> review); anything else -> REQUIRES_REVIEW
const LOCK_WAIT_TRIES = 8;
const lockWait = function lockWait(entry, why) {
  const n = entry.attempts;
  return { route: "END", jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.min(300, 15 * Math.pow(2, n))), error_code: "GDX_LOCK_WAIT",
    error_message: ("X2_INVENTORY: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "X2_INVENTORY", why: why.slice(0, 2000), attempt: n + 1 }) })],
    needJobUpd: "YES", unlockRows: [], needUnlock: "NO", result_code: "GDX_STEP_RETRY",
    result_message: "X2_INVENTORY: the stock is locked by another operation - wait " + (n + 1) + " of " + LOCK_WAIT_TRIES, job_status: "COMMITTING_GD" };
};
const cancelX2 = function cancelX2(entry, guard, input, eng, ops) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "GDX_INVALID_DATA", "the inventory part of the prepared payload is missing");
  const code = s(eng.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(eng.result_code) + (s(eng.message) ? ": " + s(eng.message) : "");
  if (code === "200") {
    const ok = stepOk(entry, "X2_INVENTORY", s(eng.result_code) + " " + s(eng.message), "inventory " + s(eng.result_code));
    ok.splitRows = [jobRow(entry, { progress_percent: 80, progress_message: "Stock released; updating the sales orders, Pickings, Packings and the delivery", lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    return ok;
  }
  if (code === "409") {
    if (num((ops || {}).intents) > 0) return stepEnd(entry, "X2_INVENTORY", why, false);
    if (entry.attempts >= LOCK_WAIT_TRIES) return failNoWrite(entry, "GDX_INVENTORY_LOCK_BUSY", "the stock of its items stayed locked by another operation (" + why.slice(0, 300) + "): nothing was written, cancel it again later");
    return lockWait(entry, why);
  }
  if (code === "400") return failNoWrite(entry, "GDX_INVENTORY_" + (s(eng.result_code) || "FAILED"), why);
  return stepEnd(entry, "X2_INVENTORY", why, true);
};
const eng = { code: [{{node:workflow_node_XCx2.data.code}}][0], result_code: [{{node:workflow_node_XCx2.data.result_code}}][0], message: [{{node:workflow_node_XCx2.data.message}}][0] };
const res = cancelX2([{{node:code_node_XCentry.data}}][0], [{{node:code_node_XCguard.data}}][0], { ok: [{{node:code_node_XCx2in.data.ok}}][0] }, eng, list([{{node:sql_node_XCx2ops.data}}][0])[0]);
console.log("commit X2", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
