// INVENTORY_BULK_APPLY read-back: every planned row holds its after-values, every new row exists, every movement is there once
const s = (v) => (v === undefined || v === null ? "" : String(v));
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const expect = [{{node:code_node_IBplan.data.expect}}][0] || {};
const creates = [{{node:code_node_IBplan.data.expectCreates}}][0] || [];
const reads = {
  item_balance: arr([{{node:sql_node_IBbalB.data}}][0]),
  item_batch_balance: arr([{{node:sql_node_IBbatchB.data}}][0]),
  fifo: arr([{{node:sql_node_IBfifoB.data}}][0]),
  wa: arr([{{node:sql_node_IBwaB.data}}][0]),
};
const mvRows = arr([{{node:sql_node_IBmvB.data}}][0]);
const bad = [];
const same = (row, want) => {
  for (const c of Object.keys(want || {})) {
    const a = want[c];
    if (c.indexOf("remark") === 0 || a === null || a === "" || isNaN(Number(a))) {
      if (s(a) !== s(row[c])) return false;
    } else if (Math.abs(q8(a) - q8(row[c])) > 1e-8) return false;
  }
  return true;
};
for (const t of Object.keys(reads)) {
  const byId = {};
  for (const r of reads[t]) byId[s(r.id)] = r;
  for (const pair of arr(expect[t])) {
    const row = byId[s(pair[0])];
    // a costing row the migration retired reads back as gone (the read-backs take is_deleted = 0 rows)
    if (pair[1] && Number(pair[1].is_deleted) === 1) {
      if (row) bad.push(t + " " + pair[0] + " still active");
      continue;
    }
    if (!row) bad.push(t + " " + pair[0] + " missing");
    else if (!same(row, pair[1])) bad.push(t + " " + pair[0] + " does not hold the planned values");
  }
}
for (const c of creates) {
  const rows = reads[c.table] || [];
  const norm = (k, v) => (k === "batch_id" && (v === null || v === undefined || s(v) === "0") ? "" : k === "fifo_sequence" ? String(parseInt(v || 0, 10)) : s(v));
  const hit = rows.some((r) => Object.keys(c.key).every((k) => norm(k, r[k]) === norm(k, c.key[k])) && same(r, c.values));
  if (!hit) bad.push(c.table + " new row " + JSON.stringify(c.key) + " missing");
}
const seen = {};
let dup = 0;
for (const r of mvRows) {
  const k = s(r.operation_effect_key);
  if (seen[k]) dup++;
  seen[k] = true;
}
const want = Number(expect.movements || 0);
if (Object.keys(seen).length !== want) bad.push("movements: " + Object.keys(seen).length + " of " + want);
if (dup) bad.push("movements: " + dup + " duplicated");
return { route: bad.length ? "REVIEW" : "DONE", problems: bad.slice(0, 15).join("; "), problemCount: String(bad.length) };
