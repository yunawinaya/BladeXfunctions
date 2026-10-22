// IDA_V2_COMMIT - D2 ISSUE: INVENTORY_BULK_APPLY APPLY of op 1 (IDC|<job>|I; all-or-nothing, replayed on a re-run). 200 (also
// REPLAYED; "401" skips inside it tolerated, as the classic) -> DONE + the hand-over: SPLIT (the worker calls phase B now) when both legs
// hold <= 1,000 movements, else PARK (due now, no lease: the next tick); attempt_count back to 0, progress 75. Engine v12's 409 "the same
// operation is still running" -> 8 lock waits (even with intent rows) then review; another 409, no answer, or a 400
// without a result_code -> op 1 intent rows ? retry (review once spent) : 8 lock waits then FAILED IDA_INVENTORY_LOCK_BUSY; 400 with a
// result_code -> FAILED (LABELS-worded); 500 or anything else -> REQUIRES_REVIEW. A FAILED exit reads ours (BATCH part + intent +
// BATCH_OURS) and soft-deletes them after the unlock
const commitD2 = function commitD2(entry0, guard, input, ans, ops, labelRows) {
  // D1 DONE in this pass reset the count (D1's write): the lock waits count from 0
  const entry = s(entry0.needD1) === "YES" ? Object.assign({}, entry0, { attempts: 0 }) : entry0;
  const hand = { splitRows: [], needSplit: "NO", path: "" };
  const fail = (code, message, why) => {
    const f = failNoWrite(entry, code, message, why, []);
    return Object.assign(hand, f, { needOursRead: f.job_status === "FAILED" && entry.needBatchRead === "YES" ? "YES" : "NO" });
  };
  if (s(input.ok) !== "YES") return fail("IDA_INVALID_DATA", MSG.invalid, s(input.why) + ": nothing was moved");
  const handOver = (ok) => {
    const park = Math.max(num(entry.movementsI), num(input.count)) > IDA_PARK || num(entry.movementsR) > IDA_PARK;
    ok.splitRows = [jobRow(entry, park ? { progress_percent: 75, progress_message: P75, attempt_count: 0, next_attempt_at: entry.dbNow }
      : { progress_percent: 75, progress_message: P75, attempt_count: 0, lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    ok.path = park ? "PARK" : "SPLIT";
    return ok;
  };
  const code = s(ans.code);
  const why = engineWhy("INVENTORY_BULK_APPLY (" + idaOpKey(entry.jobId, "I") + ")", ans);
  if (code === "200") {
    const sum = ans.summary && typeof ans.summary === "object" ? ans.summary : {};
    return handOver(Object.assign(hand, stepOk(entry, "D2_ISSUE", JSON.stringify({ called: "YES", code: code, result_code: s(ans.result_code), summary: sum }), "source issued (" + s(ans.result_code) + ", "
      + num(sum.movements) + " movement(s)" + (num(sum.skipped) ? ", " + num(sum.skipped) + " skipped" : "") + ")")));
  }
  if (code === "400" && s(ans.result_code)) {
    const labels = idaJoinChunks(labelRows, entry.partPrefix + "LABELS|");
    const text = idaMapEngineMessage(s(ans.message), labels && typeof labels === "object" ? labels : {}, input.keys) || why;
    return fail("IDA_INVENTORY_" + s(ans.result_code), text, why);
  }
  if (code === "409" || code === "" || code === "400") {
    // engine v12: this operation's earlier run is still alive (a resumed pass) - wait it out even with intent rows, review once the waits are spent
    if (code === "409" && s(ans.message).indexOf("the same operation is still running") >= 0) {
      if (num(entry.attempts) >= IDA_LOCK_WAIT_TRIES) return Object.assign(hand, stepEnd(entry, "D2_ISSUE", why + " after " + num(entry.attempts) + " waits", true));
      return Object.assign(hand, lockWait(entry, why));
    }
    if (num((ops || {}).intents) > 0) return Object.assign(hand, stepEnd(entry, "D2_ISSUE", why + " with " + num(ops.intents) + " intent row(s)", false));
    if (num(entry.attempts) >= IDA_LOCK_WAIT_TRIES) return fail("IDA_INVENTORY_LOCK_BUSY", IDA_TEXT.lockBusy, why.slice(0, 1000) + ": nothing was moved");
    return Object.assign(hand, lockWait(entry, why));
  }
  return Object.assign(hand, stepEnd(entry, "D2_ISSUE", why, true));
};
const res = commitD2([{{node:code_node_DCentry.data}}][0], [{{node:code_node_DCguard.data}}][0], { ok: [{{node:code_node_DCd2in.data.ok}}][0], why: [{{node:code_node_DCd2in.data.why}}][0],
  keys: [{{node:code_node_DCd2in.data.keys}}][0], count: [{{node:code_node_DCd2in.data.count}}][0] }, [{{node:code_node_DCd2ans.data}}][0], list([{{node:sql_node_DCd2ops.data}}][0])[0],
  [{{node:sql_node_DCd2labels.data}}][0]);
console.log("commit D2", JSON.stringify({ route: res.route, path: res.path, result: res.result_code, message: res.result_message }));
return res;
