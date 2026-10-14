// form_vs_stored.js <fixture.json> [...]: the CURRENT lifted chain (lift/lifted_prepare.js) on a recorded completion's
// reads, run twice - allData = the form's payload (old path) and allData = the stored GD (V2) - and the plans compared:
// GD write, SO line + header updates, reservations, movements, HU, picking records, item dates.
const fs = require("fs"), vm = require("vm"), path = require("path");
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const F = JSON.parse(fs.readFileSync(D + "/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const SRC = fs.readFileSync(D + "/lift/runtime.js", "utf8") + fs.readFileSync(D + "/lift/lifted_prepare.js", "utf8") + fs.readFileSync(D + "/code/prepare/chain.js", "utf8");

function runChain(params, reads, tenant) {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp,
               Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(1791880000000); } static now() { return 1791880000000; } } };
  vm.createContext(sb);
  vm.runInContext(SRC + "\nconst __CTXS = []; const __wc = __withContext; __withContext = function (c, f) { __CTXS.push(c); return __wc(c, f); };", sb);
  sb.__IN = { params, reads, tenantId: tenant, uuid: "u", kinds: KINDS };
  const res = vm.runInContext("gcChain(__IN)", sb);
  const ctx = Object.assign({}, ...vm.runInContext("__CTXS", sb));
  const d = (id) => (ctx["node:" + id] ? ctx["node:" + id].data : undefined);
  return {
    route: res.route + " " + res.code + " " + (res.message || "").slice(0, 60),
    write: res.write,
    soLines: d("code_node_UMQapdjk") && d("code_node_UMQapdjk").finalSOTable,
    soHeaders: d("code_node_lwB2FVe0") && d("code_node_lwB2FVe0").updatedSOList,
    reservedUpdates: d("code_node_QrF4F4Hx") && d("code_node_QrF4F4Hx").reservedRecordUpdates,
    reservedCreates: d("code_node_QrF4F4Hx") && d("code_node_QrF4F4Hx").reservedRecordCreates,
    movements: d("code_node_QrF4F4Hx") && d("code_node_QrF4F4Hx").inventoryMovements,
    hu: d("code_node_QrF4F4Hx") && d("code_node_QrF4F4Hx").huUpdates,
    picking: d("code_node_xVqrs3Yi"),
    itemDates: d("code_node_62FzZA2e"),
  };
}

let same = 0, differ = 0;
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const rec = {};
  for (const src of [fx.head, fx.unused]) if (src) for (const n of JSON.parse(src.nodes_data)) if (n.node_id && rec[n.node_id] === undefined) { try { rec[n.node_id] = P(n.response_json_data || "{}").data; } catch (e) {} }
  const g = (id, dflt) => (rec[id] === undefined ? dflt : rec[id]);
  const reads = {
    linkage: g("search_gr_linkage", { total: 0, count: 0, data: [] }), pickingSetup: g("get_node_iFPuvJX2", { count: 0, data: {} }),
    packingSetup: g("get_packing_setup", { count: 0, data: {} }), itemFlags: g("sql_node_ItemFlags", []), gd: g("get_node_xTRvHWB8", { count: 0, data: {} }),
    soLines: g("search_node_SOLine8kQ2", { total: 0, count: 0, data: [] }), soHeaders: g("search_node_FVhsTRDu", { total: 0, count: 0, data: [] }),
    itemDatas: g("sql_node_ItemDatas", []), allocated: g("search_node_r3NiR6B7", { total: 0, count: 0, data: [] }),
    pending: g("search_node_QdY1FLLA", { total: 0, count: 0, data: [] }), pickings: g("search_node_68C0TVzK", { total: 0, count: 0, data: [] }),
  };
  const req = P(fx.head.request_json_data).workflowparams || {};
  const form = runChain(req, reads, fx.tenant_id);
  const stored = runChain(Object.assign({}, req, { allData: JSON.parse(JSON.stringify(reads.gd.data)) }), reads, fx.tenant_id);
  const diffs = [];
  for (const k of Object.keys(form)) {
    if (k === "write") {
      const a = form.write || { header: {}, table_gd: [] }, b = stored.write || { header: {}, table_gd: [] };
      for (const c of new Set([...Object.keys(a.header), ...Object.keys(b.header)])) {
        const x = a.header[c] === "" ? null : a.header[c], y = b.header[c] === "" ? null : b.header[c];
        if (JSON.stringify(canon(x)) !== JSON.stringify(canon(y))) diffs.push(`write.${c}: form ${JSON.stringify(x)?.slice(0, 50)} | stored ${JSON.stringify(y)?.slice(0, 50)}`);
      }
      continue;
    }
    if (JSON.stringify(canon(form[k])) !== JSON.stringify(canon(stored[k]))) diffs.push(`${k}: form ${JSON.stringify(form[k])?.slice(0, 90)}\n        stored ${JSON.stringify(stored[k])?.slice(0, 90)}`);
  }
  const tag = diffs.length ? "DIFFER" : "SAME";
  diffs.length ? differ++ : same++;
  console.log(`${path.basename(file).slice(0, 19)} ${fx.doc_no} form=[${form.route}] stored=[${stored.route}] ${tag}`);
  for (const l of diffs.slice(0, 10)) console.log("   " + l);
}
console.log({ same, differ });
