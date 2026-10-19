// IA_REVERT_V2_COMMIT - V2 lock verify: busy -> 5 s wait, not counted, until 1,800 s after V2's first wait -> COST_TIMEOUT
const commitV2LockVerify = function commitV2LockVerify(entry, k, claim, rows) {
  const from = s(entry.v2WaitFrom) || s(entry.dbNow);
  const waited = iaDbSeconds(from, entry.dbNow);
  const wait = (why) => (waited <= RV_COST_WAIT_S ? stepWait(entry, "V2_COST", why, 5, from)
    : stepEnd(entry, "V2_COST", why + " - still not held " + (isNaN(waited) ? "(no DB time)" : waited + " s after V2's first wait (" + from + ")"), true, "IA_RV_COST_TIMEOUT"));
  if (s(claim.route) === "BUSY") return wait("COST locks held by another operation: " + s(claim.busy));
  const byKey = {};
  for (const r of list(rows)) if (s(r.lock_key)) byKey[s(r.lock_key).toUpperCase()] = r;
  const lost = list(k.keys).filter((key) => {
    const r = byKey[s(key).toUpperCase()];
    return !r || num(r.free_token) !== 0 || s(r.owner_operation_id) !== s(k.opKey);
  });
  if (lost.length) return wait("COST locks not taken: " + lost.slice(0, 5).join(", "));
  return Object.assign({ route: "HELD" }, END_EMPTY, { jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_REVERT" });
};
const res = commitV2LockVerify([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCv2lkeys.data}}][0], [{{node:code_node_IVCv2lclaim.data}}][0], [{{node:sql_node_IVCv2lk3.data}}][0]);
console.log("commit V2 lock verify", JSON.stringify({ route: res.route, why: res.result_message }));
return res;
