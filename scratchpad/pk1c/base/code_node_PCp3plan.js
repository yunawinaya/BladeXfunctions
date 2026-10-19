// PICKING_BULK_COMMIT - P3 plan: the GD lines this pick touched -> picking_status (from PREPARE) and prev_temp_qty_data = the
// line's allocation as stored now (what code_node_iES7iMKA writes on a pick that moves nothing), in slices of <= 250 rows
const commitP3Plan = function commitP3Plan(payloadRows, facts) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const p = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  const fresh = {};
  for (const f of list(facts)) if (s(f.id)) fresh[s(f.id)] = f;
  const rows = [];
  const missing = [];
  for (const l of p.gd_lines) {
    const f = fresh[s(l.id)];
    if (!f) {
      missing.push(s(l.id));
      continue;
    }
    rows.push({ id: s(l.id), picking_status: s(l.picking_status), prev_temp_qty_data: f.temp_qty_data === null || f.temp_qty_data === undefined || f.temp_qty_data === "" ? "[]" : String(f.temp_qty_data) });
  }
  const batches = [];
  for (let i = 0; i * 250 < rows.length; i++) batches.push({ i: i, from: i * 250, to: Math.min(rows.length, (i + 1) * 250) });
  return { rows: rows, batches: batches, count: batches.length, total: rows.length, missing: missing.length, result_message: rows.length + " GD line(s) in " + batches.length + " slice(s)" + (missing.length ? "; " + missing.length + " line(s) no longer exist" : "") };
};
const res = commitP3Plan([{{node:sql_node_PCpayload.data}}][0], [{{node:sql_node_PCp3facts.data}}][0]);
console.log("commit P3 plan", JSON.stringify({ total: res.total, batches: res.count, missing: res.missing }));
return res;