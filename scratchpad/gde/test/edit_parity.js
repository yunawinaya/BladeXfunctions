// edit_parity.js <fixture.json> [...]: code/prepare/chain_edit.js on a recorded GOODS_DELIVERY Edit + Save as Created run,
// with the RECORDED code of every node (the run's own version) and the recorded reads and request. Passes when
//  - every node the chain runs and the run recorded has the recorded output (clock values masked), and
//  - the chain ran exactly the recorded code nodes of the path (none missing, none extra), and
//  - the chain's emulated read-back of the GD write equals the recorded get_node_Cef6vdH4 / get_node_ZaAPFTIP.
// Fixtures: test/fetch_fixtures.py (session scratchpad). Exit 1 on any difference.
// --alloc: only the runs with save-time auto allocation (fixtures with "alloc", test/fetch_alloc.py), the loop run in-process
// (code/prepare/alloc_edit.js) on set-based reads made of the recorded GLOBAL_ALLOCATION reads, instead of the cached table.
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const ALLOC = process.argv.indexOf("--alloc") >= 0 ? (process.argv.splice(process.argv.indexOf("--alloc"), 1), true) : false;
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const norm = (s) => s.replace(/"update_time":"[^"]*"/g, "\"update_time\":\"<T>\"").replace(/"update_user":"[^"]*"/g, "\"update_user\":\"<U>\"")
  .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<ISO>").replace(/_17\d{11}/g, "_<MS>").replace(/"17\d{11}"/g, "<MS>").replace(/:17\d{11}([,}\]])/g, ":<MS>$1")
  .replace(/"(created_at|updated_at)":"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d"/g, '"$1":"<NOW>"');
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const rewrite = (code) => code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => "__v(" + JSON.stringify(k) + ")");
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
// nodes the chain does not run by design: notifications (disabled loops), GD_UNUSED_FN_NEW's movement-loop prep, the
// auto-allocation loop body (its result is the cached table), Branch 4 (Picking Plan only)
const NOT_OURS = new Set(["code_node_5oTXzIic", "code_node_HFhAptI0", "code_node_2SqoLlxd", "code_node_SqL4Tv8v", "code_node_aay7z3VT", "code_node_Htpcyp8t",
  "code_node_1Ya3sACY", "code_node_hifFKzmo", "code_node_56IOJIBu", "code_node_OBz5tEws", "code_node_xVqrs3Yi", "code_node_PkHdrIds", "code_node_6YcpKK5A", "code_node_gUADQXoM"]);
// the set-based allocation reads (alloc_edit.js's A): the loop's own searches as the head ran them, every recorded
// GLOBAL_ALLOCATION run's reads (one row per id, as one SQL read returns it), the batch numbers
const allocReads = (fx, rec) => {
  const rows = (v) => (v && Array.isArray(v.data) ? v.data : Array.isArray(v) ? v : []);
  const A = { uoms: rows(rec.search_node_pltmkkw3), bins: rows(rec.search_node_nbpWEAFx), huItems: rows(rec.search_node_D8ZGHKZI), hus: rows(rec.search_node_l8oiJ60B),
    items: [], itemBalances: [], batchBalances: [], pending: [], huAllocated: [], ownReserved: [], batches: fx.batches || [] };
  const from = { items: "sql_node_ItemAlloc", itemBalances: "search_node_mb8Vv8fZ", batchBalances: "search_node_ARAmvXyd", pending: "search_node_BOywHct7",
    huAllocated: "search_node_WGl1NGSu", ownReserved: "search_node_OwnReserved01" };
  for (const k of fx.alloc) {
    const o = {};
    for (const x of P(k.nodes_data || "[]")) if (x.node_id && o[x.node_id] === undefined) { try { o[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ } }
    for (const [key, node] of Object.entries(from)) for (const r of rows(o[node])) if (!A[key].some((y) => String(y.id) === String(r.id))) A[key].push(r);
  }
  return A;
};
let total = { same: 0, diff: 0, notRecorded: 0, fixtures: 0, failed: 0 };
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  if (ALLOC && !(fx.alloc || []).length) continue;
  total.fixtures++;
  const rec = {}, codes = [], recCode = new Set(), readNodes = {}, calleeReads = {};
  for (const src of [fx.head, fx.unused, fx.reorder]) {
    if (!src) continue;
    for (const n of JSON.parse(src.nodes_data || "[]")) {
      if (!n.node_id || rec[n.node_id] !== undefined) continue;
      try { rec[n.node_id] = P(n.response_json_data || "{}").data; } catch (e) { rec[n.node_id] = undefined; }
      if (src === fx.head && /^(search|sql|get)-node$/.test(n.node_type || "")) readNodes[n.node_id] = rec[n.node_id];
      if (src === fx.unused && /^(search|sql|get)-node$/.test(n.node_type || "")) calleeReads[n.node_id] = rec[n.node_id];
      if (n.node_type === "code-node" && n.request_json_data) {
        const rq = P(n.request_json_data);
        codes.push({ id: n.node_id, code: rewrite(rq.code), decl: (rq.responseConfig || []).map((r) => [r.name, r.bsonType]) });
        if (src !== fx.reorder) recCode.add(n.node_id);
      }
    }
  }
  // GLOBAL_ALLOCATION's code nodes, each recorded run's own version (the callee runs in-process in --alloc)
  if (ALLOC) for (const k of fx.alloc) for (const n of P(k.nodes_data || "[]")) if (n.node_type === "code-node" && n.request_json_data) {
    const rq = P(n.request_json_data);
    codes.push({ id: n.node_id, code: rewrite(rq.code), decl: (rq.responseConfig || []).map((r) => [r.name, r.bsonType]) });
  }
  const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(R + "scratchpad/gdc/lift/runtime.js", "utf8"), sb);
  vm.runInContext("const __CTXS = []; const __wc = __withContext; __withContext = function (c, f) { __CTXS.push(c); return __wc(c, f); };", sb);
  // the head's trace has no loop-body nodes: in --alloc those five come from the lift (GOODS_DELIVERY v242), nothing else
  if (ALLOC) vm.runInContext(fs.readFileSync(D + "/lift/lifted_edit.js", "utf8") + "\nconst __LOOP = ['code_node_aay7z3VT', 'code_node_Htpcyp8t', 'code_node_1Ya3sACY', 'code_node_hifFKzmo', 'code_node_56IOJIBu'];"
    + "\nfor (const k of Object.keys(__N)) if (__LOOP.indexOf(k) < 0) delete __N[k];", sb);
  vm.runInContext(fs.readFileSync(R + "scratchpad/gdc/code/prepare/chain.js", "utf8") + "\n" + fs.readFileSync(D + "/code/prepare/alloc_edit.js", "utf8")
    + "\n" + fs.readFileSync(D + "/code/prepare/chain_edit.js", "utf8") + "\nthis.geChain = geChain;", sb);
  sb.__CODES = codes;
  vm.runInContext('for (const c of __CODES) __N[c.id] = { decl: c.decl, fn: new Function("const console = __QUIET;\\n" + c.code) };', sb);
  const req = P(fx.head.request_json_data);
  const params = req.workflowparams || {};
  const g = (id, dflt) => (rec[id] === undefined ? dflt : rec[id]);
  const S0 = { total: 0, count: 0, data: [] }, G0 = { count: 0, data: {} };
  sb.__IN = {
    params, tenantId: fx.tenant_id, uuid: "test-uuid", lenient: true, kinds: KINDS, extraReads: readNodes, calleeExtraReads: calleeReads,
    // the after-image base: the stored GD as read (recorded only for a stored-Created edit)
    stored: rec["get_node_xTRvHWB8"] && rec["get_node_xTRvHWB8"].data && rec["get_node_xTRvHWB8"].data.id ? rec["get_node_xTRvHWB8"].data : null,
    reads: {
      linkage: g("search_gr_linkage", S0), its: g("search_gr_its", S0), grSo: g("search_gr_so", S0),
      pickingSetup: g("get_node_iFPuvJX2", G0), itemFlags: g("sql_node_ItemFlags", []), packingSetup: g("get_packing_setup", G0),
      allocTable: ALLOC ? undefined : rec["get_cache_node_wiBIs4cB"], alloc: ALLOC ? allocReads(fx, rec) : undefined,
      gd: g("get_node_xTRvHWB8", G0), pick: g("get_pick_for_reconcile", G0), activePickings: g("search_node_NBAQ9gsj", S0),
      binNames: g("search_bin_names", S0), checkRequired: rec["workflow_node_0jaUJbQD"], creditLimit: rec["workflow_node_sUYtl9dZ"],
      soLines: g("search_node_SOLine8kQ2", S0), cleanupSoLines: g("search_node_DnZIKKVH", S0), soHeaders: g("search_node_FVhsTRDu", S0),
      pickingFormat: g("get_node_zna6o03F", G0),
      itemDatas: g("sql_node_ItemDatas", []), allocated: g("search_node_r3NiR6B7", S0), pending: g("search_node_QdY1FLLA", S0),
      // the recorded read-back of the GD write: downstream nodes run on exactly what the platform returned
      afterGd: rec["get_node_Cef6vdH4"] || rec["get_node_ZaAPFTIP"],
    },
  };
  let res;
  const label = path.basename(file).slice(0, 19) + " " + fx.doc_no + " " + fx.stored_status;
  try { res = vm.runInContext("geChain(__IN)", sb); } catch (e) { console.log(label, "THREW", e.message, "|", e.stack.split("\n").slice(0, 3).join(" | ")); total.failed++; continue; }
  const ctx = Object.assign({}, ...vm.runInContext("__CTXS", sb));
  const lines = [];
  for (const id of res.ran) {
    if (!(id in rec) || rec[id] === undefined) { total.notRecorded++; continue; }
    const mine = ctx["node:" + id] ? ctx["node:" + id].data : undefined;
    if (mine === undefined) continue;
    const a = norm(JSON.stringify(canon(mine))), b = norm(JSON.stringify(canon(rec[id])));
    if (a === b) { total.same++; continue; }
    total.diff++;
    const paths = [];
    const walk = (x, y, p) => {
      if (paths.length > 5 || JSON.stringify(x) === JSON.stringify(y)) return;
      if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + "." + k);
      } else paths.push(`${p}: ${JSON.stringify(x)?.slice(0, 70)} | rec ${JSON.stringify(y)?.slice(0, 70)}`);
    };
    walk(JSON.parse(a), JSON.parse(b), "");
    lines.push(`   DIFF ${id}:\n      ` + paths.join("\n      "));
  }
  // the path: every recorded code node of the head + callee is run by the chain, and the chain runs no other code node
  const ranSet = new Set(res.ran);
  const missing = [...recCode].filter((id) => !ranSet.has(id) && !NOT_OURS.has(id));
  const extra = res.ran.filter((id) => !recCode.has(id) && rec[id] === undefined && id !== "code_node_f8qELJUF" && id !== "code_node_PkMerge");
  if (missing.length) lines.push("   NOT RUN (recorded): " + missing.join(", "));
  if (extra.length) lines.push("   RAN (not recorded): " + extra.join(", "));
  // the emulated read-back against the recorded one
  const recAfter = rec["get_node_Cef6vdH4"] || rec["get_node_ZaAPFTIP"];
  if (recAfter && recAfter.data && res.afterImage) {
    // the placeholders the chain minted stand for what the platform assigned: the inserted lines' ids (by position) and the number
    const flat = (g) => (g.table_gd || []).flatMap((r) => [r].concat(r.children || []));
    const mine = JSON.parse(JSON.stringify(res.afterImage)), recd = flat(recAfter.data);
    const map = {};
    flat(mine).forEach((r, i) => { if ((res.minted.lines || []).includes(r.id) && recd[i]) map[r.id] = String(recd[i].id); });
    for (const r of flat(mine)) { if (map[r.id]) r.id = map[r.id]; if (map[r.parent_id]) r.parent_id = map[r.parent_id]; }
    if (res.minted.number) mine.delivery_no = recAfter.data.delivery_no;
    res.afterImage = mine;
    const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); for (const k of ["update_time", "update_user", "create_time", "create_user"]) delete c[k]; return c; };
    if (norm(JSON.stringify(canon(strip(res.afterImage)))) !== norm(JSON.stringify(canon(strip(recAfter.data))))) {
      const A = strip(res.afterImage), B = strip(recAfter.data);
      for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
        if (k === "table_gd") {
          const fa = (A.table_gd || []).flatMap((r) => [r].concat(r.children || [])), fb = (B.table_gd || []).flatMap((r) => [r].concat(r.children || []));
          if (fa.length !== fb.length) lines.push(`   after.table_gd: ${fa.length} rows | rec ${fb.length}`);
          for (let i = 0; i < Math.min(fa.length, fb.length); i++)
            for (const c of new Set([...Object.keys(fa[i]), ...Object.keys(fb[i])]))
              // a recording from before return_qty became decimal reads it back as text: same value, other era
              if (c !== "children" && JSON.stringify(canon(fa[i][c])) !== JSON.stringify(canon(fb[i][c])) && !(KINDS.line[c] && KINDS.line[c][0] === "dec" && Number(fa[i][c]) === Number(fb[i][c]))) lines.push(`   after.table_gd[${i}].${c}: ${JSON.stringify(fa[i][c])?.slice(0, 70)} | rec ${JSON.stringify(fb[i][c])?.slice(0, 70)}`);
        }
        else if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) lines.push(`   after.${k}: ${JSON.stringify(A[k])?.slice(0, 80)} | rec ${JSON.stringify(B[k])?.slice(0, 80)}`);
      }
    }
  }
  const bad = lines.length > 0;
  if (bad) total.failed++;
  console.log(`${bad ? "FAIL" : "ok  "} ${label} route=${res.route} ${res.code} ran=${res.ran.length}${res.message ? " msg=" + res.message.slice(0, 70) : ""}`);
  for (const l of lines.slice(0, 14)) console.log(l);
}
console.log(JSON.stringify(total));
process.exit(total.failed || total.diff ? 1 : 0);
