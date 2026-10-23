// GD_BULK_COMMIT - P7F: Item last_transaction_date = the save's time for every material of the delivery, as classic's
// code_node_62FzZA2e (an ISO string), once per job with P7E; up to 12 parallel lanes (10-23)
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((r) => r);
const date = new Date().toISOString();
const seen = new Set();
for (const r of list([{{node:code_node_P7Eplan0.data.latestRows}}][0])) {
  const m = String(r.material_id === undefined || r.material_id === null ? "" : r.material_id).trim();
  if (/^[0-9]{1,19}$/.test(m)) seen.add(m);
}
const ids = Array.from(seen);
const per = Math.max(250, Math.ceil(ids.length / 12));
const out = { count: String(ids.length) };
for (let k = 0; k < 12; k++) {
  const rows = ids.slice(k * per, (k + 1) * per).map((id) => ({ id: id, last_transaction_date: date }));
  out["lane" + k] = rows;
  out["has" + k] = rows.length ? "YES" : "NO";
}
console.log("publish P7F item dates", JSON.stringify({ materials: ids.length, lanes: Math.ceil(ids.length / per) }));
return out;
