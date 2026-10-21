// INVENTORY_BULK_APPLY lock release plan: this operation's rows only (owner cleared first, then GIVE adds the token back); a row its
// own earlier release left between the two (owner empty, last owner = this operation) goes straight to GIVE
const s = (v) => (v === undefined || v === null ? "" : String(v));
const op = s([{{node:code_node_IBguard.data.operationKey}}][0]);
const rows = [{{node:sql_node_IBrel.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
let dbNow = "";
for (const r of list) if (r && !dbNow && r.db_now) dbNow = s(r.db_now);
const clearRows = [];
const plusIds = [];
for (const r of list) {
  if (!r || !/^[0-9]{1,20}$/.test(s(r.id)) || Number(r.free_token) !== 0) continue;
  if (s(r.owner_operation_id) === op) {
    clearRows.push({ id: s(r.id), owner_operation_id: "", last_owner_operation_id: op, last_released_at: dbNow, lock_version: (Number(r.lock_version) || 0) + 1 });
    plusIds.push(s(r.id));
  } else if (s(r.owner_operation_id) === "" && s(r.last_owner_operation_id) === op) plusIds.push(s(r.id));
}
const batches = [];
for (let i = 0; i < clearRows.length; i += 250) batches.push({ from: i });
return { clearRows: clearRows, batches: batches, plusIds: plusIds, needRelease: plusIds.length ? "YES" : "NO", dbNow: dbNow };
