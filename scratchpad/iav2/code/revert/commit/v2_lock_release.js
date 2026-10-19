// IA_REVERT_V2_COMMIT - V2 lock release: owner cleared, then GIVE (also rows a dead run cleared without its GIVE)
const commitV2LockRelease = function commitV2LockRelease(entry, rows) {
  const op = iaRvCostOwner(entry.jobId);
  let dbNow = "";
  for (const r of list(rows)) if (!dbNow && s(r.db_now)) dbNow = s(r.db_now);
  const held = list(rows).filter((r) => digits(r.id) && num(r.free_token) === 0);
  const clearRows = held.filter((r) => s(r.owner_operation_id) === op)
    .map((r) => ({ id: s(r.id), owner_operation_id: "", last_owner_operation_id: op, last_released_at: dbNow || endNow(entry), lock_version: num(r.lock_version) + 1 }));
  const cleared = held.filter((r) => !s(r.owner_operation_id) && s(r.last_owner_operation_id) === op).map((r) => s(r.id));
  const plusIds = clearRows.map((r) => r.id).concat(cleared);
  return { opKey: op, clearSlices: slicesOf(clearRows, 250), plusIds: plusIds, needRelease: plusIds.length ? "YES" : "NO" };
};
const res = commitV2LockRelease([{{node:code_node_IVCentry.data}}][0], [{{node:__REL_SQL__.data}}][0]);
console.log("commit V2 lock release", JSON.stringify({ release: res.needRelease, ids: res.plusIds.length }));
return res;
