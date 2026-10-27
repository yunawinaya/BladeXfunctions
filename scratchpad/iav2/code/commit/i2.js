// IA_V2_COMMIT - I2 ISSUE: INVENTORY_BULK_APPLY APPLY of op 1 (IAC|<job>|I; all-or-nothing, replayed on a re-run).
// 200 (also REPLAYED; "401" skips inside it tolerated, as the classic) or no movement -> DONE + the hand-over: PARK (due now, no lease:
// the next run) after op 1 was called - one stock call per worker run, as a lock lives until the top-level run ends (prod 10-26) -,
// SPLIT (the worker calls phase B now) only when no stock was issued; attempt_count back to 0, progress 75.
// engine v12's 409 "the same operation is still running" -> 8 lock waits (even with intent rows) then review; another 409, no answer,
// or a 400 without a result_code -> intent rows ? retry (review once spent) : 8 lock waits then FAILED;
// 400 with a result_code -> FAILED (LABELS-worded); 500 or anything else -> REQUIRES_REVIEW. FAILED unlocks the IA and
// soft-deletes this job's Batch row (I1's)
const commitI2 = function commitI2(entry, guard, input, ans, ops, labelRows, i1) {
  // I1's Batch row(s): the entry's, else this pass's (one, or one per output split group)
  const ours = iaBatchIdsOf(entry).length ? iaBatchIdsOf(entry) : iaBatchIdsOf({}, i1);
  if (s(input.ok) !== "YES") return failNoWrite(entry, "IA_INVALID_DATA", MSG.invalid, s(input.why) + ": nothing was moved", ours);
  const handOver = (ok, called) => {
    const park = called || Math.max(num(entry.movementsI), num(input.count)) > IA_PARK_PICKS;
    ok.splitRows = [jobRow(entry, park ? { progress_percent: 75, progress_message: P75, attempt_count: 0, next_attempt_at: entry.dbNow }
      : { progress_percent: 75, progress_message: P75, attempt_count: 0, lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    ok.path = park ? "PARK" : "SPLIT";
    return ok;
  };
  if (s(input.needCall) !== "YES") return handOver(stepOk(entry, "I2_ISSUE", JSON.stringify({ called: "NO", movements: 0 }), "no stock pick to issue"), false);
  const code = s(ans.code);
  const why = engineWhy("INVENTORY_BULK_APPLY (" + iaOpKey(entry.jobId, "I") + ")", ans);
  if (code === "200") {
    const sum = ans.summary && typeof ans.summary === "object" ? ans.summary : {};
    return handOver(stepOk(entry, "I2_ISSUE", JSON.stringify({ called: "YES", code: code, result_code: s(ans.result_code), summary: sum }), "components issued (" + s(ans.result_code) + ", "
      + num(sum.movements) + " movement(s)" + (num(sum.skipped) ? ", " + num(sum.skipped) + " skipped" : "") + ")"), true);
  }
  if (code === "400" && s(ans.result_code)) {
    const labels = iaJoinChunks(labelRows, entry.partPrefix + "LABELS|");
    const text = iaMapEngineMessage(s(ans.message), labels && typeof labels === "object" ? labels : {}, input.keys) || why;
    return failNoWrite(entry, "IA_INVENTORY_" + s(ans.result_code), text, why, ours);
  }
  if (code === "409" || code === "" || code === "400") {
    // engine v12: this operation's earlier run is still alive (a resumed pass): wait it out even with intent rows; review once the
    // waits are spent, never FAILED (that run may still be writing)
    if (code === "409" && s(ans.message).indexOf("the same operation is still running") >= 0) {
      if (num(entry.attempts) >= IA_LOCK_WAIT_TRIES) return stepEnd(entry, "I2_ISSUE", why + " after " + num(entry.attempts) + " waits", true);
      return lockWait(entry, why);
    }
    if (num((ops || {}).intents) > 0) return stepEnd(entry, "I2_ISSUE", why + " with " + num(ops.intents) + " intent row(s)", false);
    if (num(entry.attempts) >= IA_LOCK_WAIT_TRIES) return failNoWrite(entry, "IA_INVENTORY_LOCK_BUSY", IA_TEXT.lockBusy, why.slice(0, 1000) + ": nothing was moved", ours);
    return lockWait(entry, why);
  }
  return stepEnd(entry, "I2_ISSUE", why, true);
};
const res = commitI2([{{node:code_node_IACentry.data}}][0], [{{node:code_node_IACguard.data}}][0], { ok: [{{node:code_node_IACi2in.data.ok}}][0], needCall: [{{node:code_node_IACi2in.data.needCall}}][0],
  why: [{{node:code_node_IACi2in.data.why}}][0], keys: [{{node:code_node_IACi2in.data.keys}}][0], count: [{{node:code_node_IACi2in.data.count}}][0] }, [{{node:code_node_IACi2ans.data}}][0],
  list([{{node:sql_node_IACi2ops.data}}][0])[0], [{{node:sql_node_IACi2labels.data}}][0], [{{node:code_node_IACi1.data}}][0]);
console.log("commit I2", JSON.stringify({ route: res.route, path: res.path, result: res.result_code, message: res.result_message }));
return res;
