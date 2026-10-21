// INVENTORY_BULK_APPLY lock verify: every key reads token 0 held by this operation (as claimed), else LOST
const s = (v) => (v === undefined || v === null ? "" : String(v));
const keys = [{{node:code_node_IBguard.data.lockKeys}}][0] || [];
const op = s([{{node:code_node_IBguard.data.operationKey}}][0]);
const mine = (r) => s(r.owner_operation_id) === op || (s(r.owner_operation_id) === "" && s(r.last_owner_operation_id) === op);
const rows = [{{node:sql_node_IBlk3.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
const byKey = {};
for (const r of list) if (r && r.lock_key) byKey[s(r.lock_key).toUpperCase()] = r;
const lost = [];
for (const k of keys) {
  const r = byKey[k.toUpperCase()];
  if (!r || Number(r.free_token) !== 0 || !mine(r)) lost.push(k);
}
const first = list.find((r) => r && r.db_now) || {};
return { route: lost.length ? "LOST" : "HELD", lost: lost.slice(0, 20).join(","), lostCount: String(lost.length), dbNow: s(first.db_now) };
