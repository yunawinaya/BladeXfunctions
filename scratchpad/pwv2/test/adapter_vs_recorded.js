// adapter_vs_recorded.js <runs.jsonl> <sqldir>: code/prepare/adapter.js on today's SQL rows of each recorded TO against
// what the recorded PUTAWAY run's nodes read: the stored TO (get_node_C64LC1sr), putaway_setup (get_node_ca2032Ub), the
// Item rows (code_node_PwItems / v33: search_node_6yzlT81I), the in-transit rows (code_node_PwTransit / v33:
// search_node_ITopen), the GR's TOs (search_node_SVMdNd3K) and QI lots (search_node_T5BGLPpK).
// <sqldir>/<env>_<to_id>.json from run_prepare_sql.py. Keys and value TYPES must match exactly; values are compared on the
// columns later flows do not change (a later confirmation, an In Progress save, setup / Item edits are not regressions).
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "code", "prepare", "adapter.js"), "utf8");
const pwAdapt = new Function(src + "\nreturn pwAdapt;")();
const [fixtures, sqldir] = process.argv.slice(2);
const ty = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
// written by later confirmations / saves: types compared, values not
const MUTABLE = new Set(["update_time", "update_user", "to_status", "is_processing", "pending_process_qty", "line_status", "putaway_qty",
  "target_location", "remark", "is_split", "parent_or_child", "storage_location", "target_inv_category", "status", "open_qty", "received_qty",
  "transit_qty", "received_date", "to_bin", "to_category", "target_doc_type", "target_doc_id", "target_doc_no", "target_doc_line_id",
  "receiving_insp_status", "previous_status", "assigned_to", "sub_tenant_id"]);
const tally = {};
const notes = [];
function cmp(label, mine, rec, opts) {
  const t = (tally[label] = tally[label] || { same: 0, diff: 0 });
  const out = [];
  const walk = (a, b, p, key) => {
    if (out.length > 12) return;
    if (ty(a) !== ty(b)) {
      if (opts.subset && a === undefined) return;
      if (MUTABLE.has(key) && (a === undefined || b === undefined)) return;
      out.push(`${p}: ${ty(a)} ${JSON.stringify(a)?.slice(0, 50)} | rec ${ty(b)} ${JSON.stringify(b)?.slice(0, 50)}`);
      return;
    }
    if (ty(a) === "object") {
      const keys = opts.subset ? Object.keys(a) : [...new Set([...Object.keys(a), ...Object.keys(b)])];
      for (const k of keys) {
        if (k === "children" || (opts.skip && opts.skip.has(k))) continue;
        if (!(k in b)) { if (!MUTABLE.has(k) && !opts.typesOnly) out.push(`${p}.${k}: only adapter (${JSON.stringify(a[k])?.slice(0, 50)})`); }
        else if (!(k in a)) { if (!MUTABLE.has(k) && !opts.typesOnly) out.push(`${p}.${k}: only recorded (${JSON.stringify(b[k])?.slice(0, 50)})`); }
        else walk(a[k], b[k], p + "." + k, k);
      }
    } else if (ty(a) === "array") {
      if (a.length !== b.length && !MUTABLE.has(key) && !opts.typesOnly) out.push(`${p}: ${a.length} items | rec ${b.length}`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${p}[${i}]`, key);
    } else if (a !== b && !MUTABLE.has(key) && !opts.typesOnly) out.push(`${p}: ${JSON.stringify(a)?.slice(0, 60)} | rec ${JSON.stringify(b)?.slice(0, 60)}`);
  };
  walk(mine, rec, "", "");
  if (out.length) { t.diff++; notes.push(`${opts.run} ${label}:\n      ` + out.join("\n      ")); }
  else t.same++;
}
const byId = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r]));
const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
let runs = 0;
const seen = new Set();
for (const line of fs.readFileSync(fixtures, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const toId = String(((r.params || {}).allData || {}).id || "");
  const f = path.join(sqldir, `${r.env}_${toId}.json`);
  if (!toId || !fs.existsSync(f)) continue;
  runs++;
  const A = pwAdapt(JSON.parse(fs.readFileSync(f, "utf8")));
  const run = `${r.env} ${r.id}`;
  const rec = (id) => (r.nodes[id] && r.nodes[id].resp ? r.nodes[id].resp.data : undefined);
  const st = rec("get_node_C64LC1sr");
  if (st && st.count && A.to.count) {
    const a = Object.assign({}, A.to.data);
    const b = Object.assign({}, st.data);
    const la = flat(a.table_putaway_item);
    const lb = flat(b.table_putaway_item);
    const ra = a.table_putaway_records;
    const rb = b.table_putaway_records;
    delete a.table_putaway_item; delete b.table_putaway_item; delete a.table_putaway_records; delete b.table_putaway_records;
    cmp("TO header vs get_node_C64LC1sr", a, b, { run });
    // lines: same ids, same order, same columns (static values)
    cmp("TO line ids/order vs get_node_C64LC1sr", la.map((x) => x.id), lb.map((x) => x.id), { run });
    const lbi = byId(lb);
    for (const x of la) if (lbi[x.id]) cmp("TO lines vs get_node_C64LC1sr", x, lbi[x.id], { run });
    // the tree: which rows are top-level, which children of which
    cmp("TO line tree vs get_node_C64LC1sr", (a.__t = A.to.data.table_putaway_item.map((x) => [x.id, (x.children || []).map((c) => c.id)])),
      st.data.table_putaway_item.map((x) => [x.id, (x.children || []).map((c) => c.id)]), { run });
    // records: those the run read (later runs add more) - same columns and values
    const rai = byId(flat(ra));
    let common = 0;
    for (const x of flat(rb)) if (rai[x.id]) { common++; cmp("TO records vs get_node_C64LC1sr", rai[x.id], x, { run }); }
    const missing = flat(rb).filter((x) => !rai[x.id]).length;
    if (missing) notes.push(`${run} records the run read but today's SQL lacks: ${missing} (of ${flat(rb).length})`);
  } else if (st && st.count && !A.to.count) notes.push(`${run} TO ${toId} no longer readable (deleted)`);
  const ps = rec("get_node_ca2032Ub");
  if (ps && ps.count && A.setup.count) cmp("setup vs get_node_ca2032Ub (adapter keys; types)", A.setup, ps, { run, subset: true, typesOnly: true });
  if (ps && A.setup.count !== undefined) cmp("setup id vs get_node_ca2032Ub", { count: A.setup.count, id: A.setup.data.id }, { count: ps.count, id: ps.data && ps.data.id }, { run });
  const pi = rec("code_node_PwItems");
  const si = rec("search_node_6yzlT81I");
  const recItems = pi ? pi.items : si ? si.data : null;
  if (recItems) {
    const ri = byId(recItems);
    for (const mine of A.items) if (ri[mine.id]) {
      cmp(pi ? "items vs code_node_PwItems (types)" : "items vs search_node_6yzlT81I (adapter keys; types)", mine, ri[mine.id], { run, subset: !pi, typesOnly: true });
    }
  }
  const pt = rec("code_node_PwTransit");
  const so = rec("search_node_ITopen");
  const recIt = pt ? pt.rows : so ? so.data : null;
  if (recIt) {
    const ri = byId(recIt);
    for (const mine of A.transit) if (ri[mine.id]) {
      cmp(pt ? "transit vs code_node_PwTransit" : "transit vs search_node_ITopen (adapter keys)", mine, ri[mine.id], { run, subset: !pt });
    }
    const gone = recIt.filter((x) => !A.transit.some((m) => m.id === x.id)).length;
    if (gone) notes.push(`${run} in-transit rows the run read but today's SQL lacks: ${gone} (of ${recIt.length})`);
  }
  const ot = rec("search_node_SVMdNd3K");
  if (ot) {
    const ri = byId(ot.data);
    for (const mine of A.others.data) if (ri[mine.id]) cmp("other TOs vs search_node_SVMdNd3K (adapter keys)", mine, ri[mine.id], { run, subset: true });
    const gone = ot.data.filter((x) => !A.others.data.some((m) => m.id === x.id)).length;
    if (gone) notes.push(`${run} TOs of the GR the run read but today's SQL lacks: ${gone} (of ${ot.data.length})`);
  }
  const qi = rec("search_node_T5BGLPpK");
  if (qi) {
    const ri = byId(qi.data);
    for (const mine of A.qi.data) if (ri[mine.id]) cmp("QI lots vs search_node_T5BGLPpK (adapter keys)", mine, ri[mine.id], { run, subset: true });
    if (qi.data.length !== A.qi.data.length) notes.push(`${run} QI lots: run read ${qi.data.length}, today ${A.qi.data.length}`);
  }
}
console.log("runs compared", runs);
for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(56)} same ${t.same}  different ${t.diff}`);
for (const n of notes.slice(0, Number(process.env.SHOW || 30))) console.log("  " + n);
