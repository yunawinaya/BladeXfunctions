// INVENTORY_BULK_APPLY lock claim: keys in lock order; a key another operation holds, or whose lock row the seed could not
// create (another operation inserted it first) -> BUSY before any take; a key this operation already holds (a run that died) is kept
const s = (v) => (v === undefined || v === null ? "" : String(v));
const keys = [{{node:code_node_IBguard.data.lockKeys}}][0] || [];
const op = s([{{node:code_node_IBguard.data.operationKey}}][0]);
// held by it, or left by its own release between clearing the owner and GIVE (a run that died there)
const mine = (r) => s(r.owner_operation_id) === op || (s(r.owner_operation_id) === "" && s(r.last_owner_operation_id) === op);
const rows = [{{node:sql_node_IBlk2.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
const byKey = {};
let dbNow = "";
for (const r of list) {
  if (!r || !r.lock_key) continue;
  byKey[s(r.lock_key).toUpperCase()] = r;
  if (!dbNow && r.db_now) dbNow = s(r.db_now);
}
const take = [];
const busy = [];
for (const k of keys) {
  const r = byKey[k.toUpperCase()];
  if (!r || !/^[0-9]{1,20}$/.test(s(r.id))) {
    busy.push(k + " (lock row not created yet)");
    continue;
  }
  const t = Number(r.free_token);
  if (t === 1) take.push(s(r.id));
  else if (t === 0 && mine(r)) continue;
  else busy.push(k + (s(r.owner_operation_id) ? " (" + s(r.owner_operation_id) + ")" : ""));
}
const route = busy.length ? "BUSY" : take.length ? "TAKE" : "HELD";
if (route === "TAKE" && !dbNow) throw new Error("IBA_LOCK_INPUT: the lock read returned no db_now");
return { route: route, ids: take, claimedAt: dbNow, busy: busy.slice(0, 20).join(", "), busyCount: String(busy.length) };
