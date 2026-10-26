// GD_EDIT_COMMIT - E1 INVENTORY: INVENTORY_BULK_APPLY APPLY of the ENGINE part (all-or-nothing; GDE|<job> makes a re-run
// replay it). An edit that moves no stock (header, remarks, a no-op) skips the call. GD_COMPLETE_COMMIT v5's C2 rules:
// 200 -> DONE + the SPLIT hand-over; 400 -> FAILED (the engine wrote nothing): the GD back to its stored status, a Draft's
// number put back; 409 lock busy -> wait, then FAILED, only while the operation has no intent rows (IBA|I|*); anything else
// -> REQUIRES_REVIEW. Engine v12: a 409 with intent rows (or its "the same operation is still running") is our own APPLY from
// a run that died mid-write, held up to 20 min: it waits the same ~23 min, then REQUIRES_REVIEW - never FAILED. A failed
// (caught) call is a 409 too.
const LOCK_WAIT_TRIES = 8;
const OWN_RUN_TRIES = 16;
const commitE1In = function commitE1In(entry, eng) {
  const ok = eng && s(eng.operation_key) === "GDE|" + entry.jobId && Array.isArray(eng.movements);
  if (!ok) return { ok: "NO", needCall: "NO", operationKey: "", movements: [] };
  const draft = eng.movements.some((m) => m.trx_no === "#GDE-DELIVERY-NO#");
  if (draft && !s(entry.number)) return { ok: "NO", needCall: "NO", operationKey: "", movements: [], why: "the delivery's number was not issued (E0N)" };
  const movements = draft ? eng.movements.map((m) => Object.assign({}, m, { trx_no: m.trx_no === "#GDE-DELIVERY-NO#" ? entry.number : m.trx_no })) : eng.movements;
  return { ok: "YES", needCall: movements.length ? "YES" : "NO", operationKey: eng.operation_key, movements: movements };
};
const commitE1 = function commitE1(entry, guard, input, eng, ops, e0nIntentRows) {
  const restore = joinChunks(e0nIntentRows, "E0N|I|") || null;
  if (s(input.ok) !== "YES") return failNoWrite(entry, "GDE_INVALID_DATA", s(input.why) || "the inventory part of the prepared payload is missing", restore);
  const split = (ok) => {
    ok.splitRows = [jobRow(entry, { progress_percent: 80, progress_message: "Stock saved; saving the lines, reservations and sales orders", lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    return ok;
  };
  if (s(input.needCall) !== "YES") return split(stepOk(entry, "E1_INVENTORY", "no stock movement", "no stock to move"));
  // a counted wait with the lease released (jobRow), the job due again after the backoff
  const lockWait = (why, what) => {
    const n = entry.attempts;
    return Object.assign({}, END_EMPTY, { route: "END", jobRows: [jobRow(entry, { attempt_count: n + 1, next_attempt_at: dbAddSeconds(entry.dbNow, Math.min(300, 15 * Math.pow(2, n))), error_code: "GDE_LOCK_WAIT",
      error_message: ("E1_INVENTORY: " + why).slice(0, 1000), error_details: JSON.stringify({ step: "E1_INVENTORY", why: why.slice(0, 2000), attempt: n + 1 }) })],
      needJobUpd: "YES", result_code: "GDE_STEP_RETRY", result_message: "E1_INVENTORY: " + what + " - wait " + (n + 1) + " of " + LOCK_WAIT_TRIES, job_status: "COMMITTING_GD" });
  };
  // a failed call (caught by try_catch_GXe1, 10-27): its run failed and answered nothing (10-26, Kenhin GD 2097 and LSH
  // GD-2610-1473: a first-use lock seed lost its race and the job sat under its lease). As a 409, decided from the intent rows
  // read after the call: past the waits, review once it has intent rows, else nothing was written
  if (s(eng.crashed) === "YES") {
    const wrote = num((ops || {}).intents) > 0;
    const failed = "INVENTORY_BULK_APPLY failed (caught)" + (wrote ? ", with intent rows" : ", nothing written");
    if (entry.attempts >= LOCK_WAIT_TRIES) return wrote ? stepEnd(entry, "E1_INVENTORY", failed, true) : failNoWrite(entry, "GDE_INVENTORY_CALL_FAILED", "the inventory call kept failing: nothing was written, save it again later", restore);
    return lockWait(failed, "the inventory call failed");
  }
  const code = s(eng.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(eng.result_code) + (s(eng.message) ? ": " + s(eng.message) : "");
  if (code === "200") return split(stepOk(entry, "E1_INVENTORY", s(eng.result_code) + " " + s(eng.message), "inventory " + s(eng.result_code)));
  if (code === "409") {
    // our own run's marker is held 20 min after its last heartbeat (a caught crash leaves one): it waits on past the usual
    // tries, so a crash after earlier waits does not run out inside the hold; review only far beyond it
    const ownRun = /^the same operation is still running/.test(s(eng.message));
    const own = ownRun || num((ops || {}).intents) > 0;
    const tries = ownRun ? OWN_RUN_TRIES : LOCK_WAIT_TRIES;
    if (entry.attempts >= tries && own) return stepEnd(entry, "E1_INVENTORY", why, true);
    if (entry.attempts >= tries) return failNoWrite(entry, "GDE_INVENTORY_LOCK_BUSY", "the stock of its items stayed locked by another operation (" + why.slice(0, 300) + "): nothing was written, save it again later", restore);
    return lockWait(why, ownRun ? "the inventory operation is still held by its earlier run" : "the stock is locked by another operation");
  }
  if (code === "400") return failNoWrite(entry, "GDE_INVENTORY_" + (s(eng.result_code) || "FAILED"), why, restore);
  return stepEnd(entry, "E1_INVENTORY", why, true);
};
