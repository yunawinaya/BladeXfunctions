// INVENTORY_BULK_APPLY lock plan: the guard's keys + the COST key of each (material, plant) of an unpriced category move whose
// costing rows need migrating (sql_node_IBprobe, APPLY only), in lock order - still one ordered take
const s = (v) => (v === undefined || v === null ? "" : String(v));
const keys = [{{node:code_node_IBguard.data.lockKeys}}][0] || [];
const rows = [{{node:sql_node_IBprobe.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
const all = {};
for (const k of keys) all[k] = true;
let added = 0;
for (const r of list) {
  if (!r || !/^[0-9]{1,20}$/.test(s(r.m)) || !/^[0-9]{1,20}$/.test(s(r.p))) continue;
  const k = "COST|" + s(r.m) + "|" + s(r.p);
  if (!all[k]) {
    all[k] = true;
    added++;
  }
}
const out = Object.keys(all).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
return { lockKeys: out, lockKeysJson: JSON.stringify(out), costAdded: String(added) };
