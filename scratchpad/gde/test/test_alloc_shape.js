// test_alloc_shape.js <fixture.json>...: the auto allocation's SQL reads (test/alloc_rows.py -> ../gde-allocrows/), adapted by
// geAllocAdapt, against the rows the platform's searches returned in the recorded run, row by row (same id): every key the
// platform gave is there with the same type, and no key it left out is added. Values may have moved since the recording
// (quantities, update_time): those are listed, not failed, except on the keys that never change.
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const sb = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext([R + "scratchpad/gdc/code/prepare/adapter.js", D + "/code/prepare/adapter_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n"), sb);
const FIXED = new Set(["id", "material_id", "location_id", "batch_id", "plant_id", "organization_id", "create_time", "create_user", "handling_unit_id", "parent_line_id",
  "target_gd_id", "doc_type", "batch_number", "uom_name", "bin_name", "material_code", "uom_conversion_json", "default_bin_json", "item_batch_management", "stock_control",
  "expired_date", "manufacturing_date", "tenant_id"]);
// sub_tenant_id: the platform returns it when set (a recorded item_balance row has it); NULLs were backfilled on dev after most
// recordings, so it may be on one side only. The allocation never reads it.
const DRIFT = new Set(["sub_tenant_id"]);
const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
const outputs = (run) => {
  const o = {};
  for (const x of P(run.nodes_data || "[]")) if (x.node_id && o[x.node_id] === undefined) { try { o[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ } }
  return o;
};
const rowsOf = (v) => (v && Array.isArray(v.data) ? v.data : Array.isArray(v) ? v : []);
let bad = 0;
const report = {};
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const rowsFile = path.join(path.dirname(path.dirname(path.resolve(file))), "gde-allocrows", path.basename(file));
  if (!(fx.alloc || []).length || !fs.existsSync(rowsFile)) continue;
  sb.__S = JSON.parse(fs.readFileSync(rowsFile, "utf8")).rows;
  const A = JSON.parse(JSON.stringify(vm.runInContext("geAllocAdapt(__S)", sb)));
  const head = outputs(fx.head);
  const rec = { items: [], itemBalances: [], batchBalances: [], pending: [], huAllocated: [], ownReserved: [], uoms: rowsOf(head.search_node_pltmkkw3),
    bins: rowsOf(head.search_node_nbpWEAFx), huItems: rowsOf(head.search_node_D8ZGHKZI), hus: rowsOf(head.search_node_l8oiJ60B), batches: fx.batches || [] };
  const from = { items: "sql_node_ItemAlloc", itemBalances: "search_node_mb8Vv8fZ", batchBalances: "search_node_ARAmvXyd", pending: "search_node_BOywHct7",
    huAllocated: "search_node_WGl1NGSu", ownReserved: "search_node_OwnReserved01" };
  for (const k of fx.alloc) { const o = outputs(k); for (const [key, node] of Object.entries(from)) rec[key] = rec[key].concat(rowsOf(o[node])); }
  for (const key of Object.keys(rec)) {
    const r = (report[key] = report[key] || { matched: 0, onlyRecorded: 0, onlySql: 0, missing: {}, extra: {}, type: {}, moved: {}, fixedDiff: {} });
    const mine = new Map((A[key] || []).map((x) => [String(x.id), x]));
    const seen = new Set();
    for (const x of rec[key]) {
      const y = mine.get(String(x.id));
      if (!y) { r.onlyRecorded++; continue; }
      if (seen.has(String(x.id))) continue;
      seen.add(String(x.id));
      r.matched++;
      for (const c of Object.keys(x)) {
        if (!(c in y)) { if (!DRIFT.has(c)) r.missing[c] = (r.missing[c] || 0) + 1; continue; }
        if (typeOf(x[c]) !== typeOf(y[c])) { r.type[c] = typeOf(x[c]) + "|" + typeOf(y[c]) + " " + JSON.stringify(x[c]).slice(0, 40) + "|" + JSON.stringify(y[c]).slice(0, 40); continue; }
        if (c === "table_hu_items") {
          const ys = new Map((y[c] || []).map((i) => [String(i.id), i]));
          for (const i of x[c] || []) { const j = ys.get(String(i.id)); if (!j) { r.fixedDiff[c] = "item " + i.id + " missing"; continue; } if (Object.keys(i).sort().join() !== Object.keys(j).sort().join()) r.fixedDiff[c] = Object.keys(i).sort().join() + " | " + Object.keys(j).sort().join(); }
          continue;
        }
        // a datetime the platform prints without a .000 fraction: the allocation only parses it as a date
        if (typeof x[c] === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d/.test(x[c]) && Date.parse(x[c].replace(" ", "T")) === Date.parse(String(y[c]).replace(" ", "T"))) continue;
        if (JSON.stringify(x[c]) !== JSON.stringify(y[c])) {
          if (FIXED.has(c)) r.fixedDiff[c] = JSON.stringify(x[c]).slice(0, 60) + " | " + JSON.stringify(y[c]).slice(0, 60);
          else r.moved[c] = (r.moved[c] || 0) + 1;
        }
      }
      for (const c of Object.keys(y)) if (!(c in x) && !DRIFT.has(c)) r.extra[c] = (r.extra[c] || 0) + 1;
    }
    r.onlySql += [...mine.keys()].filter((id) => !seen.has(id)).length;
  }
}
for (const [key, r] of Object.entries(report)) {
  const fail = Object.keys(r.missing).length || Object.keys(r.extra).length || Object.keys(r.type).length || Object.keys(r.fixedDiff).length;
  if (fail) bad++;
  console.log((fail ? "FAIL " : "ok   ") + key + " " + JSON.stringify(r));
}
console.log(JSON.stringify({ kinds: Object.keys(report).length, failed: bad }));
process.exit(bad ? 1 : 0);
