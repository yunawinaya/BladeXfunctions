// GR_REVERT_COMMIT - R2 lock seed: a lock row per COST key, inserted once (free_token 1), as INVENTORY_BULK_APPLY seeds them; a
// twin insert (another operation seeding the same key) fails this run, the job retries after its lease
const commitR2LockSeed = function commitR2LockSeed(entry, k, rows) {
  const have = {};
  const deleted = [];
  for (const r of list(rows)) {
    if (!s(r.lock_key)) continue;
    have[s(r.lock_key).toUpperCase()] = true;
    if (num(r.is_deleted) !== 0) deleted.push(s(r.lock_key));
  }
  if (deleted.length) throw new Error("GRV_LOCK_SEED: soft-deleted lock rows occupy " + deleted.join(","));
  const rowsToAdd = list(k.keys).filter((key) => !have[s(key).toUpperCase()]).map((key) => ({ organization_id: s(entry.organizationId), lock_key: key,
    balance_type: "COST", free_token: 1, lock_version: 0, owner_operation_id: "", last_owner_operation_id: "" }));
  return { addSlices: slicesOf(rowsToAdd, 250), needSeed: rowsToAdd.length ? "YES" : "NO" };
};
const res = commitR2LockSeed([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCr2lkeys.data}}][0], [{{node:sql_node_VCr2lk1.data}}][0]);
console.log("commit R2 lock seed", JSON.stringify({ seed: res.needSeed, slices: res.addSlices.length }));
return res;
