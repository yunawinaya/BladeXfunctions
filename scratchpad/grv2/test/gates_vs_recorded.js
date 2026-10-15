// gates_vs_recorded.js <fixtures.jsonl> [...]: chain.js grGates (SUBMIT's gates, in GOODS_RECEIVING's order) on each
// recorded "Save as Completed" request, with the reads that run recorded. A run that stopped at a gate (401 zero qty,
// 400 fill-back / required fields / location / category / over-receive) must STOP with the same code and text; a run
// that went past them must GO with the filled-back GR the run wrote (code_node_4r2Fv9G5's allData, gr_status = saveAs).
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
for (const f of ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js"]) vm.runInContext(fs.readFileSync(path.join(D, f), "utf8"), sb);
vm.runInContext("this.grGates = grGates;", sb);
const GATES = { return_node_u5UHUORU: "401 zero qty", return_node_ppZ80b7k: "400 fill-back", return_node_MPtSNcn9: "400 required", return_node_EUn0K7ou: "400 location",
  return_node_sDC0gvnL: "400 category", return_node_zdxuAqpz: "400 over-receive" };
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const T = {};
const notes = [];
const src = {};
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.type === "code-node" && o.data && o.data.script) src[o.id] = o.data.script.code;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(path.join(D, "..", "..", "Goods Receiving", "GRsaveWorkflow.json"), "utf8")));
const olderVersion = (r) => Object.entries(r.nodes).some(([id, n]) => n.code !== undefined && src[id] !== undefined && n.code !== src[id]);
const paths = (a, b, p, out) => {
  if (out.length > 5 || JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) paths(a[k], b[k], p + "." + k, out);
  } else out.push(`${p}: ${JSON.stringify(a)?.slice(0, 60)} | rec ${JSON.stringify(b)?.slice(0, 60)}`);
};
for (const file of process.argv.slice(2)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.exit === "return_node_GrSizeGuard") continue;
    if (olderVersion(r)) { T.olderVersion = (T.olderVersion || 0) + 1; continue; }
    const rec = (id) => (r.nodes[id] && r.nodes[id].resp ? r.nodes[id].resp.data : undefined);
    const p = r.params || {};
    sb.__G = { form: p.allData, pageStatus: p.pageStatus, continueZero: p.continueZero, skip_putaway: p.skip_putaway, tenantId: r.tenant,
      reads: { putawaySetup: rec("get_node_QBrFrLs9") || { count: 0, data: {} }, items: rec("search_node_BwcLu7r7") || { total: 0, count: 0, data: [] },
        poDocs: rec("search_node_nkWkBdXY") || { total: 0, count: 0, data: [] } } };
    const res = vm.runInContext("grGates(__G)", sb);
    const gate = GATES[r.exit];
    const key = gate || "passed the gates";
    const t = (T[key] = T[key] || { same: 0, diff: 0 });
    if (gate) {
      const want = (r.resp && r.resp.data) || {};
      if (res.route === "STOP" && String(res.code) === String(want.code) && String(res.message) === String(want.message)) t.same++;
      else { t.diff++; notes.push(`${r.env} ${r.id} ${gate}: mine ${res.route} ${res.code} ${JSON.stringify(res.message)?.slice(0, 120)} | rec ${want.code} ${JSON.stringify(want.message)?.slice(0, 120)}`); }
    } else {
      const fill = rec("code_node_4r2Fv9G5");
      if (!fill) continue;
      const want = JSON.parse(JSON.stringify(fill.allData));
      want.gr_status = fill.saveAs;
      const ok = res.route === "GO" && JSON.stringify(canon(res.allData)) === JSON.stringify(canon(want)) && res.saveAs === fill.saveAs &&
        JSON.stringify(canon(res.loopRows)) === JSON.stringify(canon(fill.loopRows));
      if (ok) t.same++;
      else {
        t.diff++;
        const out = [];
        paths(canon(res.allData), canon(want), "allData", out);
        notes.push(`${r.env} ${r.id} (exit ${r.exit}): mine ${res.route} ${res.code || ""} ${res.message || ""} saveAs ${res.saveAs} | rec saveAs ${fill.saveAs}\n      ` + out.join("\n      "));
      }
    }
  }
}
console.log(JSON.stringify(T));
for (const n of notes.slice(0, 30)) console.log("  " + n);
