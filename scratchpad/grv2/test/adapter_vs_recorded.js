// adapter_vs_recorded.js <fixtures.jsonl> <sqldir>: code/prepare/adapter.js on today's SQL rows of each recorded GR
// against what the recorded run's nodes read: the GR (get_node_UeM3HpzR, Edit runs), items (search_node_BwcLu7r7),
// PO docs (search_node_XqqoMDRs), putaway setup (get_node_QBrFrLs9), the Putaway numbering rule (get_node_xUdzlNqh),
// the loading-bay storage location (get_node_njg7cSUu). <sqldir>/<env>_<gr_id>.json from run_prepare_sql.py.
// Keys and value TYPES must match exactly (the adapter projects Items / PO / setup: only its own keys are compared);
// values are compared on the columns a completion does not change afterwards.
const fs = require("fs");
const path = require("path");
const grAdapt = new Function(fs.readFileSync(path.join(__dirname, "..", "code", "prepare", "adapter.js"), "utf8") + "\nreturn grAdapt;")();
const [fixtures, sqldir] = process.argv.slice(2);
const ty = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
// columns later flows rewrite (putaway, PI, returns, edits): types compared, values not
const MUTABLE = new Set(["update_time", "update_user", "gr_status", "putaway_status", "pi_status", "return_status", "posted_status", "invoice_qty",
  "created_return_qty", "return_quantity", "received_qty", "created_received_qty", "outstanding_quantity", "line_status", "po_status",
  "partially_received", "fully_received", "item_batch_no", "previous_status", "table_formula", "item_array", "predefined_data", "view_hu",
  "temp_hu_data", "is_serial_allocated", "pi_status", "posted_qty", "putaway_qty", "sub_tenant_id"]);
const tally = {};
const notes = [];
function cmp(label, mine, rec, opts) {
  const t = (tally[label] = tally[label] || { same: 0, diff: 0 });
  const out = [];
  const walk = (a, b, p, key) => {
    if (out.length > 12) return;
    if (ty(a) !== ty(b)) {
      if (opts.subset && a === undefined) return;
      out.push(`${p}: ${ty(a)} ${JSON.stringify(a)?.slice(0, 40)} | rec ${ty(b)} ${JSON.stringify(b)?.slice(0, 40)}`);
      return;
    }
    if (ty(a) === "object") {
      const keys = opts.subset ? Object.keys(a) : [...new Set([...Object.keys(a), ...Object.keys(b)])];
      for (const k of keys) {
        if (opts.skip && opts.skip.has(k)) continue;
        if (!(k in b)) { if (!(opts.mutableAbsent && MUTABLE.has(k)) && !opts.typesOnly) out.push(`${p}.${k}: only adapter (${JSON.stringify(a[k])?.slice(0, 40)})`); }
        else if (!(k in a)) { if (!(opts.mutableAbsent && MUTABLE.has(k)) && !opts.typesOnly) out.push(`${p}.${k}: only recorded (${JSON.stringify(b[k])?.slice(0, 40)})`); }
        else walk(a[k], b[k], p + "." + k, k);
      }
    } else if (ty(a) === "array") {
      if (a.length !== b.length) out.push(`${p}: ${a.length} rows | rec ${b.length}`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${p}[${i}]`, key);
    } else if (a !== b && !MUTABLE.has(key) && !opts.typesOnly) out.push(`${p}: ${JSON.stringify(a)?.slice(0, 50)} | rec ${JSON.stringify(b)?.slice(0, 50)}`);
  };
  walk(mine, rec, "", "");
  if (out.length) { t.diff++; notes.push(`${opts.run} ${label}:\n      ` + out.join("\n      ")); }
  else t.same++;
}
const byId = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r]));
let runs = 0;
for (const line of fs.readFileSync(fixtures, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.exit !== "return_node_coSATlEf") continue;
  const grId = r.nodes.code_node_UQWzCg37.resp.data.id;
  const f = path.join(sqldir, `${r.env}_${grId}.json`);
  if (!fs.existsSync(f)) continue;
  runs++;
  const A = grAdapt(JSON.parse(fs.readFileSync(f, "utf8")));
  const run = `${r.env} ${r.id} (${r.params.pageStatus})`;
  const rec = (id) => (r.nodes[id] && r.nodes[id].resp ? r.nodes[id].resp.data : undefined);
  const rb = rec("get_node_UeM3HpzR");
  // a GR deleted since reads as nothing today
  if (!A.gr.count) { tally.goneSince = (tally.goneSince || 0) + 1; continue; }
  if (rb && rb.count) cmp("gr vs get_node_UeM3HpzR", A.gr.data, rb.data, { run, mutableAbsent: true });
  const it = rec("search_node_BwcLu7r7");
  if (it) {
    const recItems = byId(it.data);
    for (const mine of A.items.data) {
      if (!recItems[mine.id]) continue;
      cmp("items vs search_node_BwcLu7r7 (adapter keys; types - Item master data changes)", mine, recItems[mine.id], { run, subset: true, typesOnly: true });
    }
  }
  const po = rec("search_node_XqqoMDRs");
  if (po) {
    const recPo = byId(po.data);
    for (const mine of A.poDocs.data) if (recPo[mine.id]) {
      cmp("PO docs vs search_node_XqqoMDRs (adapter keys; types)", mine, recPo[mine.id], { run, subset: true, typesOnly: true });
      cmp("PO docs vs search_node_XqqoMDRs (adapter keys; static values)", mine, recPo[mine.id], { run, subset: true, mutableAbsent: true });
    }
  }
  const ps = rec("get_node_QBrFrLs9");
  if (ps && ps.count && A.putawaySetup.count) cmp("putaway setup vs get_node_QBrFrLs9 (adapter keys; types - setup is edited)", A.putawaySetup, ps, { run, subset: true, typesOnly: true });
  const rule = rec("get_node_xUdzlNqh");
  if (rule) cmp("putaway rule vs get_node_xUdzlNqh (id)", { count: A.putawayRule.count, data: { id: A.putawayRule.data.id } }, { count: rule.count, data: { id: rule.data && rule.data.id } }, { run });
  const lb = rec("get_node_njg7cSUu");
  if (lb && lb.count && A.loadingBay.count) cmp("loading bay vs get_node_njg7cSUu (adapter keys; types)", A.loadingBay, lb, { run, subset: true, typesOnly: true });
}
console.log("runs compared", runs);
for (const [k, t] of Object.entries(tally)) console.log(typeof t === "number" ? `  ${k}: ${t}` : `  ${k.padEnd(50)} same ${t.same}  different ${t.diff}`);
for (const n of notes.slice(0, Number(process.env.SHOW || 30))) console.log("  " + n);
