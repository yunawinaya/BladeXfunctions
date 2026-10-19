// SA_V2_COMMIT - A2 INVENTORY: INVENTORY_BULK_APPLY APPLY (all-or-nothing; SAC|<job> replays on a re-run).
// 200 (also REPLAYED) or no movement -> DONE + the hand-over: SPLIT (the worker calls phase B in this tick) or, above 1,000
// entries, PARK (due now, no lease: the next tick resumes); attempt_count back to 0 either way (lock waits are not failures).
// 409, no answer, or a 400 without a result_code (the platform's envelope of a run that died) -> intent rows ? retry (review once
// the retries are spent) : 8 waits (15 s x 2^n, max 5 min) then FAILED + unlock; 400 with a result_code -> FAILED + unlock with
// the LABELS-mapped message (code SA_INVENTORY_<engine code>); 500 (the engine's REQUIRES_REVIEW) or another code -> REQUIRES_REVIEW
const SA_PARK_ENTRIES = 1000;
const commitA2 = function commitA2(entry, guard, input, ans, ops, labelRows) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "SA_INVALID_DATA", MSG.invalid, s(input.why) + ": no stock was moved");
  const handOver = (ok) => {
    const park = Math.max(num(entry.entryCount), num(input.count)) > SA_PARK_ENTRIES;
    ok.splitRows = [jobRow(entry, park
      ? { progress_percent: 80, progress_message: "Stock moved; the Stock Count and the Stock Adjustment are updated next", attempt_count: 0, next_attempt_at: entry.dbNow }
      : { progress_percent: 80, progress_message: "Stock moved; updating the Stock Count and the Stock Adjustment", attempt_count: 0, lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    ok.path = park ? "PARK" : "SPLIT";
    return ok;
  };
  if (s(input.needCall) !== "YES") return handOver(stepOk(entry, "A2_INVENTORY", "no stock movement", "no stock to move"));
  const code = s(ans.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(ans.result_code) + (s(ans.message) ? ": " + s(ans.message) : "");
  if (code === "200") return handOver(stepOk(entry, "A2_INVENTORY", s(ans.result_code) + " " + s(ans.message), "inventory " + s(ans.result_code)));
  // a real refusal (a plan result_code): nothing was written -> FAILED + unlock with the LABELS-mapped message
  if (code === "400" && s(ans.result_code)) {
    const labels = saJoinChunks(labelRows, entry.partPrefix + "LABELS|");
    const text = saMapEngineMessage(s(ans.message), labels && typeof labels === "object" ? labels : {}, input.keys) || why;
    return failNoWrite(entry, "SA_INVENTORY_" + s(ans.result_code), text, why);
  }
  // a 409, NO answer (a child's failure does not abort the parent; its node data may be null) or a 400 without a result_code
  // (the platform's envelope of an engine run that died, e.g. a duplicate Lock Key seed on the first concurrent use of a key).
  // No intent row: nothing was written -> wait like a lock (8 waits, then FAILED + unlock). With intent rows the engine may
  // have written: retry - the next APPLY resumes / replays its own intents - and REQUIRES_REVIEW only once the retries are spent
  if (code === "409" || code === "" || code === "400") {
    if (num((ops || {}).intents) > 0) return stepEnd(entry, "A2_INVENTORY", why, false);
    if (entry.attempts >= LOCK_WAIT_TRIES) return failNoWrite(entry, "SA_INVENTORY_LOCK_BUSY", MSG.lockBusy, why.slice(0, 1000) + ": nothing was moved");
    return lockWait(entry, why);
  }
  // 500 (the engine's own REQUIRES_REVIEW) or any other code: review at once
  return stepEnd(entry, "A2_INVENTORY", why, true);
};
const res = commitA2([{{node:code_node_SACentry.data}}][0], [{{node:code_node_SACguard.data}}][0], { ok: [{{node:code_node_SACa2in.data.ok}}][0], needCall: [{{node:code_node_SACa2in.data.needCall}}][0],
  why: [{{node:code_node_SACa2in.data.why}}][0], keys: [{{node:code_node_SACa2in.data.keys}}][0], count: [{{node:code_node_SACa2in.data.count}}][0] }, [{{node:code_node_SACa2ans.data}}][0],
  list([{{node:sql_node_SACa2ops.data}}][0])[0], [{{node:sql_node_SACa2labels.data}}][0]);
console.log("commit A2", JSON.stringify({ route: res.route, path: res.path, result: res.result_code, message: res.result_message }));
return res;
