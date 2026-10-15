// Harness (b): code/prepare/adapter.js on today's SQL rows of each recorded run's receipt (run_prepare_sql.py --recorded:
// round 2 keyed on the id lists the run's grRvPrep recorded) against what the run's reads handed grRvPrep / grRvBuild (the
// variableMap of the code node that read them; the read node's own answer when that node did not run).
// usage: node adapter_vs_recorded.js <runs.jsonl> <dir of <env>_run_<id>.json>
// The receipts were reverted (and some completed again, cancelled or deleted) since, so: KEYS and value TYPES are compared on
// every row present in both; VALUES on the columns neither the revert nor a later completion changes; rows only one side
// has are counted, with the reason the run itself explains (a putaway the revert deleted, a movement written after it, ...).
// Projected reads (only the columns the lifted bodies read) are compared as a subset of the recorded row; sql-node decimals
// are compared as numbers (the columns went from 3 / 4 to 8 decimals in between), the scale change counted apart. The lines
// are read with the columns the bodies read (sql.py LINE): compared as a subset too.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "code", "prepare", "adapter.js"), "utf8");
const A = new Function(src + "\nreturn { rvAdapt1, rvAdapt2 };")();
const [fixtures, dir] = process.argv.slice(2);
const ty = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
const MUTABLE = new Set(["update_time", "update_user", "gr_status", "previous_status", "putaway_status", "pi_status", "return_status", "posted_status", "gr_v2_job_id",
  "gr_idem_key", "to_status", "is_processing", "line_status", "putaway_qty", "pending_process_qty", "status", "open_qty", "received_qty", "received_date",
  "target_doc_type", "target_doc_id", "target_doc_no", "target_doc_line_id", "to_bin", "to_category", "unrestricted_qty", "reserved_qty", "block_qty",
  "qualityinsp_qty", "intransit_qty", "balance_quantity", "po_status", "partially_received", "fully_received", "outstanding_quantity", "created_received_qty",
  "fifo_available_quantity", "cnt", "max_id", "latest", "wa_quantity", "wa_cost_price", "receiving_insp_status", "hu_status", "last_transaction_date",
  "table_putaway_records", "table_putaway_item", "item_batch_no", "manufacturing_date", "expired_date", "putaway_status", "sub_tenant_id"]);
const DEC = /^-?\d+\.\d+$/;
const tally = {};
const notes = [];
let scale = 0;
function cmp(label, mine, rec, opts) {
  const t = (tally[label] = tally[label] || { rows: 0, same: 0, diff: 0 });
  t.rows++;
  const out = [];
  const walk = (a, b, p, key) => {
    if (out.length > 10) return;
    if (opts.sql && typeof a === "string" && typeof b === "string" && DEC.test(a) && DEC.test(b) && a !== b) {
      if (Number(a) === Number(b)) {
        scale++;
        return;
      }
      if (!MUTABLE.has(key)) out.push(`${p}: ${a} | rec ${b}`);
      return;
    }
    if (ty(a) !== ty(b)) {
      if (MUTABLE.has(key) && (a === undefined || b === undefined)) return;
      if (opts.subset && a === undefined) return;
      out.push(`${p}: ${ty(a)} ${JSON.stringify(a)?.slice(0, 50)} | rec ${ty(b)} ${JSON.stringify(b)?.slice(0, 50)}`);
      return;
    }
    if (ty(a) === "object") {
      const keys = opts.subset ? Object.keys(a) : [...new Set([...Object.keys(a), ...Object.keys(b)])];
      for (const k of keys) {
        if (k === "children" || (opts.skip && opts.skip.has(k))) continue;
        if (!(k in b)) {
          if (!MUTABLE.has(k)) out.push(`${p}.${k}: only today (${JSON.stringify(a[k])?.slice(0, 50)})`);
        } else if (!(k in a)) {
          if (!MUTABLE.has(k) && !opts.subset) out.push(`${p}.${k}: only recorded (${JSON.stringify(b[k])?.slice(0, 50)})`);
        } else walk(a[k], b[k], p + "." + k, k);
      }
    } else if (ty(a) === "array") {
      if (a.length !== b.length && !MUTABLE.has(key)) out.push(`${p}: ${a.length} items | rec ${b.length}`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${p}[${i}]`, key);
    } else if (a !== b && !MUTABLE.has(key)) out.push(`${p}: ${JSON.stringify(a)?.slice(0, 60)} | rec ${JSON.stringify(b)?.slice(0, 60)}`);
  };
  walk(mine, rec, "", "");
  if (out.length) {
    t.diff++;
    notes.push(`${opts.run} ${label}:\n      ` + out.join("\n      "));
  } else t.same++;
}
const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
const byId = (rows) => Object.fromEntries((rows || []).map((r) => [String(r.id), r]));
const presence = {};
function rows(label, mine, rec, opts) {
  const mi = byId(mine);
  const ri = byId(rec);
  const p = (presence[label] = presence[label] || { both: 0, onlyToday: 0, onlyRecorded: 0 });
  for (const id of Object.keys(ri)) {
    if (!mi[id]) {
      p.onlyRecorded++;
      continue;
    }
    p.both++;
    const a = Object.assign({}, mi[id]);
    const b = Object.assign({}, ri[id]);
    for (const k of opts.nested || []) {
      rows(label + "." + k, flat(a[k]), flat(b[k]), Object.assign({}, opts, { nested: [] }));
      // the tree: which rows are top level, which are children of which
      const shape = (x) => (x || []).map((r) => [String(r.id), (r.children || []).map((c) => String(c.id))]);
      const sa = shape(a[k]).filter(([id]) => (b[k] || []).some((r) => String(r.id) === id));
      const sb = shape(b[k]).filter(([id]) => (a[k] || []).some((r) => String(r.id) === id));
      if (JSON.stringify(sa) !== JSON.stringify(sb)) notes.push(`${opts.run} ${label}.${k} tree differs: ${JSON.stringify(sa).slice(0, 120)} | rec ${JSON.stringify(sb).slice(0, 120)}`);
      delete a[k];
      delete b[k];
    }
    cmp(label, a, b, opts);
  }
  for (const id of Object.keys(mi)) if (!ri[id]) p.onlyToday++;
}
let runs = 0;
for (const line of fs.readFileSync(fixtures, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const f = path.join(dir, `${r.env}_run_${r.id}.json`);
  if (!fs.existsSync(f)) continue;
  runs++;
  const S = JSON.parse(fs.readFileSync(f, "utf8"));
  const A1 = A.rvAdapt1(S);
  const A2 = A.rvAdapt2(S);
  const run = `${r.env} ${r.id}`;
  const vars = Object.assign({}, (r.nodes.code_node_grRvPrep || {}).vars || {}, (r.nodes.code_node_grRvBuild || {}).vars || {});
  const read = (token, node, sub) => {
    if (token in vars) return vars[token];
    const n = r.nodes[node];
    if (!n || !n.resp || n.resp.data === undefined) return undefined;
    return sub ? (n.resp.data || {}).data : n.resp.data;
  };
  const opts = { run: run };
  const gr = read("node:get_node_grRvGr.data.data", "get_node_grRvGr", true);
  if (gr && gr.id && A1.gr.count) {
    const a = Object.assign({}, A1.gr.data);
    const b = Object.assign({}, gr);
    rows("GR lines (table_gr) vs get_node_grRvGr (LINE columns)", flat(a.table_gr), flat(b.table_gr), { run, subset: true });
    const shape = (x) => (x || []).map((l) => [String(l.id), (l.children || []).map((c) => String(c.id))]);
    if (JSON.stringify(shape(a.table_gr)) !== JSON.stringify(shape(b.table_gr))) notes.push(`${run} table_gr tree differs`);
    for (const k of ["table_gr"]) {
      delete a[k];
      delete b[k];
    }
    cmp("GR header vs get_node_grRvGr", a, b, opts);
  } else if (gr && gr.id) notes.push(`${run} the receipt is no longer readable (${S._vals && S._vals.grStatus ? S._vals.grStatus : "deleted"})`);
  rows("movements vs sql_node_grRvMovs", A1.movs, read("node:sql_node_grRvMovs.data", "sql_node_grRvMovs"), { run, sql: true });
  rows("putaway vs search_node_grRvPutaway", A1.putaway.data, read("node:search_node_grRvPutaway.data.data", "search_node_grRvPutaway", true), { run, subset: true, nested: ["table_putaway_item", "table_putaway_records"] });
  rows("QI lots vs search_node_grRvQi", A1.qi.data, read("node:search_node_grRvQi.data.data", "search_node_grRvQi", true), { run, subset: true });
  rows("in transit vs search_node_grRvTransit", A1.transit.data, read("node:search_node_grRvTransit.data.data", "search_node_grRvTransit", true), { run, subset: true });
  rows("batches vs search_node_grRvBatch", A1.batches.data, read("node:search_node_grRvBatch.data.data", "search_node_grRvBatch", true), { run, subset: true });
  if (r.nodes.code_node_grRvBuild) {
    const keyed = (rws) => (rws || []).map((x) => Object.assign({ id: x.id || [x.t, x.material_id, x.item_id, x.batch_id].join("|") }, x));
    rows("later vs sql_node_grRvLater (shape)", keyed(A2.later), keyed(read("node:sql_node_grRvLater.data", "sql_node_grRvLater")), { run, sql: true });
    rows("FIFO vs sql_node_grRvFifo", A2.fifo, read("node:sql_node_grRvFifo.data", "sql_node_grRvFifo"), { run, sql: true });
    rows("WA vs sql_node_grRvWa", A2.wa, read("node:sql_node_grRvWa.data", "sql_node_grRvWa"), { run, sql: true });
    rows("cost counts vs sql_node_grRvCostCounts", keyed(A2.costcounts), keyed(read("node:sql_node_grRvCostCounts.data", "sql_node_grRvCostCounts")), { run, sql: true });
    rows("invoices vs search_node_grRvPi", A2.pi.data, read("node:search_node_grRvPi.data.data", "search_node_grRvPi", true), { run, subset: true });
    rows("batch balances vs search_node_grRvBatchBal", A2.bbal.data, read("node:search_node_grRvBatchBal.data.data", "search_node_grRvBatchBal", true), { run, subset: true });
    rows("item balances vs search_node_grRvItemBal", A2.ibal.data, read("node:search_node_grRvItemBal.data.data", "search_node_grRvItemBal", true), { run, subset: true });
    rows("handling units vs search_node_grRvHu", A2.hu.data, read("node:search_node_grRvHu.data.data", "search_node_grRvHu", true), { run, subset: true, nested: ["table_hu_items"] });
    rows("POs vs search_node_grRvPo", A2.po.data, read("node:search_node_grRvPo.data.data", "search_node_grRvPo", true), { run, subset: true, nested: ["table_po"] });
    rows("on order vs search_node_grRvOnOrder", A2.oo.data, read("node:search_node_grRvOnOrder.data.data", "search_node_grRvOnOrder", true), { run, subset: true });
    rows("items vs search_node_grRvItems", A2.items.data, read("node:search_node_grRvItems.data.data", "search_node_grRvItems", true), { run, subset: true, nested: ["table_uom_conversion"] });
  }
}
console.log("runs compared", runs);
for (const [k, t] of Object.entries(tally)) {
  const p = presence[k] || {};
  console.log(`  ${k.padEnd(62)} rows compared ${String(t.rows).padStart(3)}: same ${String(t.same).padStart(3)}, different ${t.diff}` +
    (p.onlyToday || p.onlyRecorded ? `   (only recorded ${p.onlyRecorded || 0}, only today ${p.onlyToday || 0})` : ""));
}
for (const [k, p] of Object.entries(presence)) if (!tally[k]) console.log(`  ${k.padEnd(62)} no row in both   (only recorded ${p.onlyRecorded}, only today ${p.onlyToday})`);
console.log(`  sql-node decimals equal as numbers, different scale: ${scale}`);
for (const n of notes.slice(0, Number(process.env.SHOW || 40))) console.log("  " + n);
