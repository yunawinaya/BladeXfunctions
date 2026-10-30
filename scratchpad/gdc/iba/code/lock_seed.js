// INVENTORY_BULK_APPLY lock seed: a lock row per key, inserted once (free_token 1), as INVENTORY_APPLY_OPERATION seeds them
const s = (v) => (v === undefined || v === null ? "" : String(v));
const keys = [{{node:code_node_IBlkplan.data.lockKeys}}][0] || [];
const org = s([{{node:code_node_IBguard.data.organizationId}}][0]);
const rows = [{{node:sql_node_IBlk1.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
const have = {};
const deleted = [];
for (const r of list) {
  if (!r || r.lock_key === undefined || r.lock_key === null || r.lock_key === "") continue;
  have[s(r.lock_key).toUpperCase()] = true;
  if (Number(r.is_deleted || 0) !== 0) deleted.push(s(r.lock_key));
}
if (deleted.length) throw new Error("IBA_LOCK_SEED: soft-deleted lock rows occupy " + deleted.join(","));
const rowsToAdd = [];
for (const k of keys) {
  if (have[k.toUpperCase()]) continue;
  rowsToAdd.push({ organization_id: org, lock_key: k, balance_type: k.split("|")[0], free_token: 1, lock_version: 0, owner_operation_id: "", last_owner_operation_id: "" });
}
const batches = [];
for (let i = 0; i < rowsToAdd.length; i += 250) batches.push({ from: i });
return { rowsToAdd: rowsToAdd, batches: batches, needSeed: rowsToAdd.length ? "YES" : "NO" };
