// LOT_V2_COMMIT - L1 INVENTORY: INVENTORY_BULK_APPLY APPLY (all-or-nothing; SMLT|<job> replays on a re-run).
// 200 (also REPLAYED) or no movement -> DONE + the hand-over: SPLIT (the worker calls phase B in this tick) or, above 1,000
// lines, PARK (due now, no lease: the next tick resumes); attempt_count back to 0 either way (lock waits are not failures).
// 409 -> intent rows ? retry -> review : 8 waits (15 s x 2^n, max 5 min) then FAILED + unlock; 400 -> FAILED + unlock with the
// LABELS-mapped message; anything else -> REQUIRES_REVIEW
const commitL1 = function commitL1(entry, guard, input, ans, ops, labelRows) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "LOT_INVALID_DATA", MSG.invalid, s(input.why) + ": no stock was moved");
  const handOver = (ok) => {
    const park = num(entry.lineCount) > 1000;
    ok.splitRows = [jobRow(entry, park
      ? { progress_percent: 80, progress_message: "Stock moved; the lines and the In Transit ledger are saved next", attempt_count: 0, next_attempt_at: entry.dbNow }
      : { progress_percent: 80, progress_message: "Stock moved; saving the lines, the In Transit ledger and the header", attempt_count: 0, lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    ok.path = park ? "PARK" : "SPLIT";
    return ok;
  };
  if (s(input.needCall) !== "YES") return handOver(stepOk(entry, "L1_INVENTORY", "no stock movement", "no stock to move"));
  const code = s(ans.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(ans.result_code) + (s(ans.message) ? ": " + s(ans.message) : "");
  if (code === "200") return handOver(stepOk(entry, "L1_INVENTORY", s(ans.result_code) + " " + s(ans.message), "inventory " + s(ans.result_code)));
  if (code === "409") {
    if (num((ops || {}).intents) > 0) return stepEnd(entry, "L1_INVENTORY", why, false);
    if (entry.attempts >= LOCK_WAIT_TRIES) return failNoWrite(entry, "LOT_INVENTORY_LOCK_BUSY", MSG.lockBusy, why.slice(0, 300) + ": nothing was moved");
    return lockWait(entry, why);
  }
  if (code === "400") {
    const labels = lotJoinChunks(labelRows, entry.partPrefix + "LABELS|");
    const text = lotMapEngineMessage(s(ans.message), labels && typeof labels === "object" ? labels : {}, input.keys) || why;
    return failNoWrite(entry, "LOT_INVENTORY_" + (s(ans.result_code) || "FAILED"), text, why);
  }
  return stepEnd(entry, "L1_INVENTORY", why, true);
};
const res = commitL1([{{node:code_node_LCentry.data}}][0], [{{node:code_node_LCguard.data}}][0], { ok: [{{node:code_node_LCl1in.data.ok}}][0], needCall: [{{node:code_node_LCl1in.data.needCall}}][0],
  why: [{{node:code_node_LCl1in.data.why}}][0], keys: [{{node:code_node_LCl1in.data.keys}}][0] }, [{{node:code_node_LCl1ans.data}}][0], list([{{node:sql_node_LCl1ops.data}}][0])[0],
  [{{node:sql_node_LCl1labels.data}}][0]);
console.log("commit L1", JSON.stringify({ route: res.route, path: res.path, result: res.result_code, message: res.result_message }));
return res;
