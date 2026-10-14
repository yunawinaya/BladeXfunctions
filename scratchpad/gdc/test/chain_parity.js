// chain_parity.js <fixture.json> [...]: run code/prepare/chain.js on a recorded GOODS_DELIVERY "Save as Completed" run,
// with the RECORDED code of every node (same lift as lift.py) and the recorded reads and request; every node's output
// must equal the recorded one (clock values masked). Also checks gcAfterImage against the recorded read-back.
const fs = require("fs"), vm = require("vm"), path = require("path");
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const norm = (s) => s.replace(/"update_time":"[^"]*"/g, "\"update_time\":\"<T>\"").replace(/"update_user":"[^"]*"/g, "\"update_user\":\"<U>\"").replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<ISO>").replace(/_17\d{11}/g, "_<MS>").replace(/"17\d{11}"/g, "<MS>").replace(/:17\d{11}([,}\]])/g, ":<MS>$1");
// key order is not data: compare canonical JSON
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const rewrite = (code) => code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => "__v(" + JSON.stringify(k) + ")");
let total = { same: 0, diff: 0, notRecorded: 0 };
const F = JSON.parse(fs.readFileSync(D + "/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const rec = {}, recType = {}, codes = [];
  for (const src of [fx.head, fx.unused]) {
    if (!src) continue;
    for (const n of JSON.parse(src.nodes_data)) {
      if (!n.node_id || rec[n.node_id] !== undefined) continue;
      recType[n.node_id] = n.node_type;
      try { rec[n.node_id] = P(n.response_json_data || "{}").data; } catch (e) { rec[n.node_id] = undefined; }
      if (n.node_type === "code-node" && n.request_json_data) {
        const rq = P(n.request_json_data);
        codes.push({ id: n.node_id, code: rewrite(rq.code), decl: (rq.responseConfig || []).map((r) => [r.name, r.bsonType]) });
      }
    }
  }
  const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(D + "/lift/runtime.js", "utf8"), sb);
  // keep every context the chain enters (the head's and the callee's) for the comparison
  vm.runInContext("const __CTXS = []; const __wc = __withContext; __withContext = function (c, f) { __CTXS.push(c); return __wc(c, f); };", sb);
  vm.runInContext(fs.readFileSync(D + "/code/prepare/chain.js", "utf8") + "\nthis.gcChain = gcChain; this.gcAfterImage = gcAfterImage;", sb);
  sb.__CODES = codes;
  // recorded deployed code from our own dev traces, compiled inside the sandbox (the platform node itself never evals)
  vm.runInContext('for (const c of __CODES) __N[c.id] = { decl: c.decl, fn: new Function("const console = __QUIET;\\n" + c.code) };', sb);
  const req = P(fx.head.request_json_data);
  const params = req.workflowparams || {};
  const g = (id, dflt) => (rec[id] === undefined ? dflt : rec[id]);
  sb.__IN = {
    params, tenantId: fx.tenant_id, uuid: "test-uuid", lenient: true, kinds: KINDS,
    reads: {
      linkage: g("search_gr_linkage", { total: 0, count: 0, data: [] }),
      pickingSetup: g("get_node_iFPuvJX2", { count: 0, data: {} }),
      packingSetup: g("get_packing_setup", { count: 0, data: {} }),
      itemFlags: g("sql_node_ItemFlags", []),
      gd: g("get_node_xTRvHWB8", { count: 0, data: {} }),
      soLines: g("search_node_SOLine8kQ2", { total: 0, count: 0, data: [] }),
      soHeaders: g("search_node_FVhsTRDu", { total: 0, count: 0, data: [] }),
      itemDatas: g("sql_node_ItemDatas", []),
      allocated: g("search_node_r3NiR6B7", { total: 0, count: 0, data: [] }),
      pending: g("search_node_QdY1FLLA", { total: 0, count: 0, data: [] }),
      pickings: g("search_node_68C0TVzK", { total: 0, count: 0, data: [] }),
    },
  };
  let res;
  try { res = vm.runInContext("gcChain(__IN)", sb); } catch (e) { console.log(path.basename(file), fx.doc_no, "THREW", e.stack.split("\n").slice(0, 3).join(" | ")); total.diff++; continue; }
  const ctx = Object.assign({}, ...vm.runInContext("__CTXS", sb));
  const lines = [];
  for (const id of res.ran) {
    if (!(id in rec) || rec[id] === undefined) { total.notRecorded++; continue; }
    // GD_UNUSED_FN_NEW's nodes live in the callee context, which is gone; re-read from res
    const mine = ctx["node:" + id] ? ctx["node:" + id].data : undefined;
    if (mine === undefined) continue;
    const a = norm(JSON.stringify(canon(mine))), b = norm(JSON.stringify(canon(rec[id])));
    if (a === b) total.same++;
    else {
      total.diff++;
      const paths = [];
      const walk = (x, y, p) => {
        if (paths.length > 6) return;
        if (JSON.stringify(x) === JSON.stringify(y)) return;
        if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
          for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + "." + k);
        } else paths.push(`${p}: ${JSON.stringify(x)?.slice(0, 70)} | rec ${JSON.stringify(y)?.slice(0, 70)}`);
      };
      walk(JSON.parse(a), JSON.parse(b), "");
      lines.push(`   DIFF ${id}:\n      ` + paths.join("\n      "));
    }
  }
  const after = rec["get_node_Cef6vdH4"];
  let afterNote = "";
  if (after && after.data && res.write) {
    sb.__W = res.write;
    const mineAfter = vm.runInContext("gcAfterImage(__IN.reads.gd.data, __W, __IN.kinds)", sb);
    const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.update_time; delete c.update_user; return c; };
    afterNote = norm(JSON.stringify(canon(strip(mineAfter)))) === norm(JSON.stringify(canon(strip(after.data)))) ? " after-image SAME" : " after-image DIFF";
    if (afterNote.includes("DIFF")) {
      const A = strip(mineAfter), B = strip(after.data);
      for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
        if (k === "table_gd") {
          const ra = A.table_gd || [], rb = B.table_gd || [];
          if (ra.length !== rb.length) lines.push(`   after.table_gd: ${ra.length} rows | rec ${rb.length}`);
          const flat = (rows) => rows.flatMap((r) => [r, ...(r.children || [])]);
          const fa = flat(ra), fb = flat(rb);
          for (let i = 0; i < Math.min(fa.length, fb.length); i++)
            for (const c of new Set([...Object.keys(fa[i]), ...Object.keys(fb[i])]))
              if (c !== "children" && JSON.stringify(fa[i][c]) !== JSON.stringify(fb[i][c])) lines.push(`   after.table_gd[${i}].${c}: ${JSON.stringify(fa[i][c])?.slice(0, 60)} | rec ${JSON.stringify(fb[i][c])?.slice(0, 60)}`);
        } else if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) lines.push(`   after.${k}: ${JSON.stringify(A[k])?.slice(0, 90)} | rec ${JSON.stringify(B[k])?.slice(0, 90)}`);
      }
    }
  }
  console.log(`${path.basename(file).slice(0, 19)} ${fx.doc_no} route=${res.route} ${res.code} ran=${res.ran.length}${afterNote}${res.message ? " msg=" + res.message.slice(0, 80) : ""}`);
  for (const l of lines.slice(0, 12)) console.log(l);
}
console.log(total);
