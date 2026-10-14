// INVENTORY_BULK_APPLY lock verify: every key reads token 0 with this operation as owner, else LOST
const s = (v) => (v === undefined || v === null ? "" : String(v));
const keys = [{{node:code_node_IBguard.data.lockKeys}}][0] || [];
const op = s([{{node:code_node_IBguard.data.operationKey}}][0]);
const rows = [{{node:sql_node_IBlk3.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
const byKey = {};
for (const r of list) if (r && r.lock_key) byKey[s(r.lock_key).toUpperCase()] = r;
const lost = [];
for (const k of keys) {
  const r = byKey[k.toUpperCase()];
  if (!r || Number(r.free_token) !== 0 || s(r.owner_operation_id) !== op) lost.push(k);
}
return { route: lost.length ? "LOST" : "HELD", lost: lost.slice(0, 20).join(","), lostCount: String(lost.length) };
