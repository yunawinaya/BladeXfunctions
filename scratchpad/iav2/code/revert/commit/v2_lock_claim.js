// IA_REVERT_V2_COMMIT - V2 lock claim (as INVENTORY_BULK_APPLY): a key another operation holds -> BUSY before any take
const commitV2LockClaim = function commitV2LockClaim(entry, k, rows) {
  const byKey = {};
  let dbNow = "";
  for (const r of list(rows)) {
    if (!s(r.lock_key)) continue;
    byKey[s(r.lock_key).toUpperCase()] = r;
    if (!dbNow && s(r.db_now)) dbNow = s(r.db_now);
  }
  const take = [];
  const busy = [];
  for (const key of list(k.keys)) {
    const r = byKey[s(key).toUpperCase()];
    if (!r || !digits(r.id)) busy.push(key + " (lock row not created yet)");
    else if (num(r.free_token) === 1) take.push(s(r.id));
    else if (num(r.free_token) !== 0 || s(r.owner_operation_id) !== s(k.opKey)) busy.push(key + " (" + (s(r.owner_operation_id) || "not given back by " + s(r.last_owner_operation_id)) + ")");
  }
  const route = busy.length ? "BUSY" : take.length ? "TAKE" : "HELD";
  return { route: route, needTake: route === "TAKE" ? "YES" : "NO", ids: route === "TAKE" ? take : [], claimedAt: dbNow || s(entry.dbNow), busy: busy.slice(0, 5).join(", ") };
};
const res = commitV2LockClaim([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCv2lkeys.data}}][0], [{{node:sql_node_IVCv2lk2.data}}][0]);
console.log("commit V2 lock claim", JSON.stringify({ route: res.route, take: res.ids.length, busy: res.busy }));
return res;
