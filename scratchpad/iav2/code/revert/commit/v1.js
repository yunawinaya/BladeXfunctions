// IA_REVERT_V2_COMMIT - V1: APPLY IAV|<job> (all or nothing, replayed on a rerun) -> PARK after an APPLY (one lock call per worker run, as a
// lock lives until the top-level run ends, prod 10-26: V2 takes its own keys in the next run), SPLIT only with nothing to take back; refusals as RV7
const commitV1 = function commitV1(entry, guard, input, ans, ops, labelRows) {
  if (s(input.ok) !== "YES") return failNoWrite(entry, "IA_RV_INVALID_DATA", RV_TEXT.invalid, s(input.why) + ": no stock was moved");
  const handOver = (ok, called) => {
    const park = called || Math.max(num(entry.movementCount), num(input.count)) > IA_PARK_PICKS;
    ok.splitRows = [jobRow(entry, park
      ? { progress_percent: 80, progress_message: "Stock taken back; restoring the costing rows", attempt_count: 0, next_attempt_at: entry.dbNow }
      : { progress_percent: 80, progress_message: "Stock taken back; restoring the costing rows", attempt_count: 0, lease_owner: "SPLIT|" + guard.nonce, lease_expires_at: entry.leaseUntil })];
    ok.needSplit = "YES";
    ok.path = park ? "PARK" : "SPLIT";
    return ok;
  };
  if (s(input.needCall) !== "YES") return handOver(stepOk(entry, "V1_INVENTORY", "no stock movement", "no stock to take back"), false);
  const code = s(ans.code);
  const why = "INVENTORY_BULK_APPLY answered " + (code || "nothing") + " " + s(ans.result_code) + (s(ans.message) ? ": " + s(ans.message) : "");
  if (code === "200") return handOver(stepOk(entry, "V1_INVENTORY", s(ans.result_code) + " " + s(ans.message), "inventory " + s(ans.result_code)), true);
  // a real refusal (a plan result_code): nothing was written -> FAILED + back to Completed with the LABELS-mapped message
  if (code === "400" && s(ans.result_code)) {
    const labels = iaJoinChunks(labelRows, entry.partPrefix + "LABELS|");
    const text = iaMapEngineMessage(s(ans.message), labels && typeof labels === "object" ? labels : {}, input.keys) || why;
    return failNoWrite(entry, "IA_RV_INVENTORY_" + s(ans.result_code), text, why);
  }
  // no intent row: nothing written, wait like a lock; with intents: retry (APPLY resumes its own intents)
  if (code === "409" || code === "" || code === "400") {
    // engine v12: this operation's earlier run is still alive (a resumed pass): wait it out even with intents; review once the waits
    // are spent, never FAILED (that run may still be writing)
    if (code === "409" && s(ans.message).indexOf("the same operation is still running") >= 0) {
      if (entry.attempts >= IA_LOCK_WAIT_TRIES) return stepEnd(entry, "V1_INVENTORY", why + " after " + entry.attempts + " waits", true);
      return lockWait(entry, why);
    }
    if (num((ops || {}).intents) > 0) return stepEnd(entry, "V1_INVENTORY", why, false);
    if (entry.attempts >= IA_LOCK_WAIT_TRIES) return failNoWrite(entry, "IA_RV_INVENTORY_LOCK_BUSY", IA_TEXT.lockBusy, why.slice(0, 1000) + ": nothing was moved");
    return lockWait(entry, why);
  }
  return stepEnd(entry, "V1_INVENTORY", why, true);
};
const res = commitV1([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCguard.data}}][0], { ok: [{{node:code_node_IVCv1in.data.ok}}][0], needCall: [{{node:code_node_IVCv1in.data.needCall}}][0],
  why: [{{node:code_node_IVCv1in.data.why}}][0], keys: [{{node:code_node_IVCv1in.data.keys}}][0], count: [{{node:code_node_IVCv1in.data.count}}][0] }, [{{node:code_node_IVCv1ans.data}}][0],
  list([{{node:sql_node_IVCv1ops.data}}][0])[0], [{{node:sql_node_IVCv1labels.data}}][0]);
console.log("commit V1", JSON.stringify({ route: res.route, path: res.path, result: res.result_code, message: res.result_message }));
return res;
