// test_delta.js <fixture.json> [...]: the edit's delta (code/submit/delta.js: the form vs the GD as stored) applied back
// onto the stored GD (code/prepare/apply_delta.js) must plan exactly as the form's own data does: chain_edit.js on the
// LIFTED deployed code (lift/lifted_edit.js) with the recorded reads, run twice (allData = form, allData = stored ⊕
// delta), every node output compared. Also: the delta of the stored GD against itself is empty, and stored ⊕ delta
// reproduces the form's lines in the form's order. Stored-Created fixtures only (a Draft run records no stored GD).
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const norm = (s) => s.replace(/"(created_at|updated_at)":"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d"/g, '"$1":"<NOW>"').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<ISO>");
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", D + "/code/prepare/chain_edit.js",
  D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
const S0 = { total: 0, count: 0, data: [] }, G0 = { count: 0, data: {} };
let fails = 0, n = 0;
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const rec = {};
  for (const src of [fx.head, fx.unused]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_id && rec[x.node_id] === undefined) { try { rec[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ } }
  const stored = rec["get_node_xTRvHWB8"] && rec["get_node_xTRvHWB8"].data && rec["get_node_xTRvHWB8"].data.id ? rec["get_node_xTRvHWB8"].data : null;
  if (!stored || !fx.unused) continue;
  n++;
  const params = P(fx.head.request_json_data).workflowparams;
  const g = (id, d) => (rec[id] === undefined ? d : rec[id]);
  const runOnce = (allData) => {
    const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp,
      Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(1791880000000); } static now() { return 1791880000000; } } };
    vm.createContext(sb);
    vm.runInContext(SRC + "\nconst __CTXS = []; const __wc = __withContext; __withContext = function (c, f) { __CTXS.push(c); return __wc(c, f); };", sb);
    sb.__IN = { params: Object.assign({}, params, { allData }), tenantId: fx.tenant_id, uuid: "u", kinds: KINDS, stored,
      reads: { linkage: g("search_gr_linkage", S0), its: g("search_gr_its", S0), grSo: g("search_gr_so", S0), pickingSetup: g("get_node_iFPuvJX2", G0),
        itemFlags: g("sql_node_ItemFlags", []), packingSetup: g("get_packing_setup", G0), allocTable: rec["get_cache_node_wiBIs4cB"], gd: g("get_node_xTRvHWB8", G0),
        pick: g("get_pick_for_reconcile", G0), activePickings: g("search_node_NBAQ9gsj", S0), binNames: g("search_bin_names", S0), checkRequired: rec["workflow_node_0jaUJbQD"],
        soLines: g("search_node_SOLine8kQ2", S0), cleanupSoLines: g("search_node_DnZIKKVH", S0), soHeaders: g("search_node_FVhsTRDu", S0), pickingFormat: g("get_node_zna6o03F", G0),
        itemDatas: g("sql_node_ItemDatas", []), allocated: g("search_node_r3NiR6B7", S0), pending: g("search_node_QdY1FLLA", S0) } };
    const res = vm.runInContext("geChain(__IN)", sb);
    const ctx = Object.assign({}, ...vm.runInContext("__CTXS", sb));
    const outs = {};
    for (const id of res.ran) outs[id] = ctx["node:" + id] ? ctx["node:" + id].data : null;
    return { res, outs, sb };
  };
  const label = path.basename(file).slice(0, 19) + " " + fx.doc_no;
  try {
    const form = runOnce(params.allData);
    // the delta and its round trip, computed in a sandbox with the same code
    const sb = form.sb;
    sb.__F = params.allData; sb.__S = stored;
    const delta = vm.runInContext("geDelta(__F, __S, " + JSON.stringify(KINDS) + ")", sb);
    const none = vm.runInContext("geDelta(__S, __S, " + JSON.stringify(KINDS) + ")", sb);
    assert.deepStrictEqual([Object.keys(none.header).length, none.lines.length, none.added.length, none.removed.length], [0, 0, 0, 0], "stored vs itself is not empty");
    sb.__DL = delta;
    const rebuilt = vm.runInContext("geApplyDelta(__S, __DL, " + JSON.stringify(KINDS) + ")", sb);
    const ids = (g2) => (g2.table_gd || []).map((r) => (r.id || "+") + "[" + (r.children || []).map((c) => c.id || "+").join(",") + "]").join(" ");
    assert.strictEqual(ids(rebuilt), ids(params.allData), "line order / nesting differs");
    const viaDelta = runOnce(rebuilt);
    // compared as the database sees them: the form's UI-only keys (no column of their own, read by no lifted node: see
    // the ledger) dropped wherever they are echoed, "" / null / absent alike, a datetime's ".000" ignored
    const ui = new Set();
    for (const k of Object.keys(params.allData)) if (k !== "table_gd" && !KINDS.header[k]) ui.add(k);
    for (const r of (params.allData.table_gd || []).flatMap((x) => [x].concat(x.children || []))) for (const k of Object.keys(r)) if (k !== "children" && !KINDS.line[k]) ui.add(k);
    const dbView = (v) => {
      if (Array.isArray(v)) return v.map(dbView);
      if (v && typeof v === "object") {
        const o = {};
        for (const k of Object.keys(v).sort()) {
          if (ui.has(k)) continue;
          let x = dbView(v[k]);
          // a column's value as its column stores it: "10.000" and 10 are one decimal, 1 and "1" one text
          const kind = (KINDS.line[k] || KINDS.header[k] || [])[0];
          if (["dec", "int", "num"].includes(kind) && typeof x === "string" && x.trim() !== "" && !isNaN(Number(x))) x = Number(x);
          else if (kind === "str" && typeof x === "number") x = String(x);
          if (x !== null && x !== undefined && x !== "") o[k] = x;
        }
        return o;
      }
      if (typeof v === "string" && /^[\[{]/.test(v)) { try { return dbView(JSON.parse(v)); } catch (e) { /* plain text */ } }
      return typeof v === "string" ? v.replace(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.000$/, "$1") : v;
    };
    const diffs = [];
    if (form.res.route !== viaDelta.res.route) diffs.push("route " + form.res.route + " vs " + viaDelta.res.route);
    for (const id of new Set([...Object.keys(form.outs), ...Object.keys(viaDelta.outs)])) {
      const a = norm(JSON.stringify(dbView(form.outs[id]))), b = norm(JSON.stringify(dbView(viaDelta.outs[id])));
      if (a !== b) {
        const paths = [];
        const walk = (x, y, p) => {
          if (paths.length > 3 || JSON.stringify(x) === JSON.stringify(y)) return;
          if (x && y && typeof x === "object" && typeof y === "object") { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + "." + k); }
          else paths.push(p + ": " + JSON.stringify(x)?.slice(0, 50) + " | " + JSON.stringify(y)?.slice(0, 50));
        };
        walk(JSON.parse(a), JSON.parse(b), "");
        diffs.push(id + " {" + paths.join("; ") + "}");
      }
    }
    const w1 = norm(JSON.stringify(dbView(form.res.write))), w2 = norm(JSON.stringify(dbView(viaDelta.res.write)));
    if (w1 !== w2) diffs.push("GD write image");
    const size = JSON.stringify(delta).length;
    if (diffs.length) { fails++; console.log("FAIL", label, "delta", size, "chars; differs:", diffs.join(", ")); }
    else console.log("ok  ", label, "delta", size, "chars (header", Object.keys(delta.header).length, "lines", delta.lines.length, "added", delta.added.length, "removed", delta.removed.length + ")");
  } catch (e) { fails++; console.log("FAIL", label, e.message.split("\n")[0]); }
}
console.log(JSON.stringify({ fixtures: n, failed: fails }));
process.exit(fails || !n ? 1 : 0);
