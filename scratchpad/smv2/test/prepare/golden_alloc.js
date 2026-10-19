// V2.1 bundles, two checks on a recorded classic run that auto-allocated a bundle (fetch_alloc_run.py), with the BUILT
// LOT_V2_PREPARE plan node's own code (everything before its tail):
//   adapter  the run's LOT as stored today, rebuilt by lotAdaptDoc and walked by the lifted fillback, gives the flatLines the
//            classic's fillback gave on the client payload of that save (same rows, order, fields, picks; every child's
//            parent_fm_key = its parent's fm_key)
//   loop     lotAllocLoop on the run's payload, GLOBAL_ALLOCATION fed the very rows its recorded runs read, ends with the lines
//            the classic left in get_cache_node_LOTallocOut
// usage: TZ=Asia/Kuala_Lumpur node golden_alloc.js <fixture.json>
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");
const BUILT = path.join(__dirname, "..", "..", "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_PREPARE.json");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const F = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let plan = null;
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.id === "code_node_LPplan") plan = o.data.script.code;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(BUILT, "utf8")));
const defs = plan.slice(0, plan.indexOf("const entry = [{{node:code_node_LPentry.data}}][0];"));
assert.ok(defs.length > 1000 && !/\{\{/.test(defs), "the built plan node's definitions");
const sb = { console: { log() {}, error() {}, warn() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(defs + "\nthis.api = { lotAdaptDoc, lotAllocLoop, lotRows, lotParseJ, run: __run, ctx: __withContext };", sb);
const api = sb.api;
let failed = 0;
const check = (name, f) => {
  try {
    f();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + String(e.message || e).split("\n").slice(0, 6).join(" | ").slice(0, 900));
  }
};
const rec = F.recorded;
const recFlat = ((rec.code_node_yPlLXIZW || {}).data || {}).flatLines || [];
const KEYS = ["line_index", "item_selection", "quantity_uom", "location_id", "requested_qty", "item_bundle_id", "temp_qty_data", "total_quantity", "organization_id", "issuing_plant"];
const pick = (l) => Object.fromEntries(KEYS.map((k) => [k, l[k] === undefined || l[k] === null || l[k] === "" ? null : typeof l[k] === "number" || k === "line_index" ? Number(l[k]) : String(l[k])]));

if (F.stored) {
  check("adapter: the stored LOT, rebuilt as the client tree, gives the classic fillback's flatLines (" + recFlat.length + " lines)", () => {
    const doc = api.lotAdaptDoc(api.lotRows(F.stored.hdr)[0], api.lotRows(F.stored.lines), "In Progress");
    const out = api.ctx({ "workflowparams:allData": doc, "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": "Edit" }, () => api.run("code_node_yPlLXIZW"));
    const mine = out.flatLines;
    assert.strictEqual(mine.length, recFlat.length, "flat line count");
    assert.deepStrictEqual(mine.map(pick), recFlat.map(pick));
    // the tree: each child's parent_fm_key is its parent's fm_key, in the rebuilt document as in the payload
    const fmOf = {};
    for (const top of doc.stock_movement) fmOf[top.id] = top.fm_key;
    for (const top of doc.stock_movement) for (const c of top.children || []) assert.strictEqual(c.parent_fm_key, top.fm_key, "child " + c.id);
    assert.ok(mine.every((l) => !(l.item_bundle_id && !l.parent_fm_key)), "no bundle parent among the flat lines");
    assert.strictEqual(new Set(mine.map((l) => l.id)).size, mine.length, "every line keeps its stored id");
  });
}

check("loop: lotAllocLoop on the payload ends with the classic's get_cache_node_LOTallocOut (" + F.ga.length + " GLOBAL_ALLOCATION runs)", () => {
  const rows = (v) => (v && v.data && Array.isArray(v.data.data) ? v.data.data : v && Array.isArray(v.data) ? v.data : []);
  const uniq = (list) => {
    const seen = new Set();
    return list.filter((r) => (seen.has(String(r.id)) ? false : (seen.add(String(r.id)), true))).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  };
  const A = { items: uniq(F.ga.flatMap((g) => rows(g.reads.sql_node_ItemAlloc))), itemBalances: uniq(F.ga.flatMap((g) => rows(g.reads.search_node_mb8Vv8fZ))),
    batchBalances: uniq(F.ga.flatMap((g) => rows(g.reads.search_node_ARAmvXyd))), pending: [], huAllocated: [], ownReserved: [] };
  const all = F.params.allData;
  const scope = new Set(F.ga.map((g) => String(g.params.material_id)));
  sb.__A = A;
  sb.__scope = scope;
  sb.__where = { plant: String(all.issuing_operation_faci), org: String(all.organization_id) };
  sb.__ctx = { "workflowparams:allData": all, "workflowparams:saveAs": F.params.saveAs, "workflowparams:pageStatus": F.params.pageStatus, "system:uuid": "golden" };
  const t0 = Date.now();
  const res = vm.runInContext("__withContext(__ctx, () => lotAllocLoop(__A, __scope, __where))", sb);
  const ms = Date.now() - t0;
  if (F.exit === "return_node_LOTallocErr") {
    // the classic stopped on GLOBAL_ALLOCATION's 400: same stop, same message (PREPARE answers it as LOT_ALLOC_FAILED)
    const msg = String(((F.response || {}).data || F.response || {}).message || "");
    assert.strictEqual(res.route, "STOP", "route " + res.route);
    assert.strictEqual(res.message, msg);
    console.log("     stopped at row " + (res.done.length + 1) + " of the GLOBAL_ALLOCATION runs, as the classic: " + msg.slice(0, 160));
    return;
  }
  assert.strictEqual(res.route, "DONE", "route " + res.route + " " + (res.message || ""));
  let cache = (rec.get_cache_node_LOTallocOut || {}).data;
  if (typeof cache === "string") cache = api.lotParseJ(cache);
  assert.ok(Array.isArray(cache), "the recorded cache is an array");
  const canon = (v) => JSON.parse(JSON.stringify(v));
  assert.strictEqual(res.lines.length, cache.length, "line count");
  for (let i = 0; i < cache.length; i++) {
    for (const k of ["temp_qty_data", "total_quantity", "fm_key", "item_selection"]) assert.deepStrictEqual(canon(res.lines[i])[k], canon(cache[i])[k], "line " + i + " " + k);
  }
  assert.deepStrictEqual(canon(res.lines), canon(cache), "whole lines");
  console.log("     " + res.done.length + " rows allocated in " + ms + " ms; e.g. " + String(res.lines[res.done[0]].temp_qty_data).slice(0, 160));
});
console.log(failed ? failed + " FAILED" : "all passed");
process.exit(failed ? 1 : 0);
