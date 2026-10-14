// INVENTORY_BULK_APPLY lock release plan: this operation's rows only (owner cleared first, then GIVE adds the token back)
const s = (v) => (v === undefined || v === null ? "" : String(v));
const op = s([{{node:code_node_IBguard.data.operationKey}}][0]);
const rows = [{{node:sql_node_IBrel.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
let dbNow = "";
for (const r of list) if (r && !dbNow && r.db_now) dbNow = s(r.db_now);
const clearRows = [];
for (const r of list) {
  if (!r || s(r.owner_operation_id) !== op || !/^[0-9]{1,20}$/.test(s(r.id))) continue;
  if (Number(r.free_token) !== 0) continue;
  clearRows.push({ id: s(r.id), owner_operation_id: "", last_owner_operation_id: op, last_released_at: dbNow, lock_version: (Number(r.lock_version) || 0) + 1 });
}
const batches = [];
for (let i = 0; i < clearRows.length; i += 250) batches.push({ from: i });
return { clearRows: clearRows, batches: batches, plusIds: clearRows.map((r) => r.id), needRelease: clearRows.length ? "YES" : "NO" };
