// GR_REVERT_COMMIT - R2 lock verify: every COST key reads token 0 with this operation as owner -> HELD; a busy claim or a key
// not taken -> wait, not counted (what this operation holds is given back on the way out, as the engine answers 409)
const commitR2LockVerify = function commitR2LockVerify(entry, k, claim, rows) {
  if (s(claim.route) === "BUSY") return stepWait(entry, "R2_COSTING", "COST locks held by another operation: " + s(claim.busy), 5);
  const byKey = {};
  for (const r of list(rows)) if (s(r.lock_key)) byKey[s(r.lock_key).toUpperCase()] = r;
  const lost = list(k.keys).filter((key) => {
    const r = byKey[s(key).toUpperCase()];
    return !r || num(r.free_token) !== 0 || s(r.owner_operation_id) !== s(k.opKey);
  });
  if (lost.length) return stepWait(entry, "R2_COSTING", "COST locks not taken: " + lost.slice(0, 5).join(", "), 5);
  return Object.assign({}, END, { route: "HELD", needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_REVERT" });
};
const res = commitR2LockVerify([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCr2lkeys.data}}][0], [{{node:code_node_VCr2lclaim.data}}][0], [{{node:sql_node_VCr2lk3.data}}][0]);
console.log("commit R2 lock verify", JSON.stringify({ route: res.route, why: res.result_message }));
return res;
