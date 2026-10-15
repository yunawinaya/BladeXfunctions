// Harness (b) + chain: code/prepare/chain.js on recorded GOODS_RECEIVING "Save as Completed" runs, fed the run's own
// recorded reads (request, putaway setup, items, PO docs before the loop, the GR read-back, the generated batch numbers,
// the numbering rule) and the batches that existed before the run (today's DB rows older than the run).
// usage: TZ=Asia/Kuala_Lumpur node chain_parity.js <fixtures.jsonl> <sqldir> [...]
// Checks, per run:
//   nodes      every top-level node the chain ran that the run recorded: same output (the TO placeholder masked)
//   movements  each ADD_INVENTORY call the chain plans vs the ADD_INVENTORY run the completion made (request params,
//              itemData aside; a batch V2 creates in C1 maps to the batch the old add created)
//   prices     the engine's GRN price (grGrnPrice) vs the unitPrice / totalPrice that ADD_INVENTORY answered
//   poLines    the PO lines after the loop vs search_node_XqqoMDRs (received, outstanding, line status, created received)
//   caches     the putaway lines (get_cache_node_d6mMkXQd) and in-transit rows (get_cache_node_ITfinal) the loop built
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
// usage: TZ=Asia/Kuala_Lumpur node chain_parity.js <fixtures.jsonl> [...] [--written <written.json> ...]
//   written.json (fetch_written.py): the live batches with each GR's manual numbers; the ones older than the run existed
const args = process.argv.slice(2);
const writtenFiles = [];
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--written") writtenFiles.push(args[++i]);
  else files.push(args[i]);
}
const written = Object.assign({}, ...writtenFiles.map((f) => JSON.parse(fs.readFileSync(f, "utf8"))));
const BIG = /"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g;
const P = (t) => JSON.parse(String(t).replace(BIG, (m) => (m[0] === '"' ? m : '"' + m + '"')));
// key order is not data, also inside a JSON text a node returns (code_node_wMQADp4i's data): compare canonical JSON
const canon = (v) => {
  if (typeof v === "string" && /^[[{]/.test(v)) {
    try { return { __json: canon(P(v)) }; } catch (e) { return v; }
  }
  return Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
};
const mask = (s) => s.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<ISO>");
const numEq = (a, b) => (typeof a === "number" || typeof b === "number") && a !== "" && b !== "" && a !== null && b !== null && Number(a) === Number(b);

function sandbox() {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp };
  const RealDate = Date;
  let now = RealDate.now();
  function FakeDate(...a) {
    if (!(this instanceof FakeDate)) return new RealDate(now).toString();
    return a.length ? new RealDate(...a) : new RealDate(now);
  }
  FakeDate.now = () => now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  sb.Date = FakeDate;
  sb.__setNow = (t) => { now = t; };
  vm.createContext(sb);
  for (const f of ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js"]) vm.runInContext(fs.readFileSync(path.join(D, f), "utf8"), sb, { filename: f });
  vm.runInContext("this.grChain = grChain; this.grGrnPrice = grGrnPrice; this.grAdapt = grAdapt;", sb);
  return sb;
}
const sb = sandbox();
// the deployed (repo) source of each node: a run whose recorded top-level code differs ran an older version
const src = {};
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.type === "code-node" && o.data && o.data.script) src[o.id] = o.data.script.code;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(path.join(D, "..", "..", "Goods Receiving", "GRsaveWorkflow.json"), "utf8")));
const olderVersion = (r) => Object.entries(r.nodes).some(([id, n]) => n.code !== undefined && src[id] !== undefined && n.code !== src[id]);
const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children.map((c) => Object.assign({}, c)) : []));
const T = { runs: 0, olderVersion: 0, threw: 0, notPlanned: 0, nodes: { same: 0, diff: 0 }, movements: { same: 0, diff: 0, missing: 0, extra: 0 }, prices: { same: 0, diff: 0 },
  poLines: { same: 0, diff: 0 }, putawayCache: { same: 0, diff: 0 }, itCache: { same: 0, diff: 0 } };
const notes = [];
const note = (r, s) => notes.push(`${r.env} ${r.id} (${r.params.pageStatus}): ${s}`);

for (const file of files) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.exit !== "return_node_coSATlEf") continue;
    if (olderVersion(r)) { T.olderVersion++; continue; }
    T.runs++;
    const rec = (id) => (r.nodes[id] && r.nodes[id].resp ? r.nodes[id].resp.data : undefined);
    const grId = rec("code_node_UQWzCg37").id;
    // the batches that existed before this run (today's rows minus the ones this run or later ones made), in the
    // search-node order the adapter gives them
    const W = written[grId] || { batches: [] };
    const before = sb.grAdapt({ batches: (W.batches || []).map((j) => ({ j })) }).batches.filter((b) => BigInt(b.id) < BigInt(r.id));
    const poDocs = rec("search_node_nkWkBdXY") || { total: 0, count: 0, data: [] };
    const poLines = poDocs.data.flatMap((d) => flat(d.table_po));
    const readBack = r.params.pageStatus === "Add" ? (rec("add_node_nGMSu41b") || [])[0] : (rec("get_node_UeM3HpzR") || {}).data;
    const generated = JSON.parse((rec("get_cache_node_BGARRfinal") || "[]") || "[]").map((g) => g.batch_number);
    sb.__setNow((r.nodes.code_node_jo9g6Ldx && r.nodes.code_node_jo9g6Ldx.t0) || (r.nodes.code_node_2Cq2eMRb && r.nodes.code_node_2Cq2eMRb.t0) || r.t0);
    sb.__IN = {
      params: r.params, tenantId: r.tenant, uuid: "x",
      reads: {
        putawaySetup: rec("get_node_QBrFrLs9") || { count: 0, data: {} }, items: rec("search_node_BwcLu7r7"), poDocs: poDocs,
        origGR: rec("search_origGRMain"), loadingBay: rec("get_node_njg7cSUu"), putawayRule: rec("get_node_xUdzlNqh"),
        poLines: poLines, poHeaders: poDocs.data, onOrder: [], batches: before,
        readBack: () => readBack,
      },
      batchNumbers: (reqs) => reqs.map((q, i) => (generated[i] !== undefined ? { ok: true, batch_number: generated[i] } : { ok: false, message: "not recorded" })),
    };
    let res;
    try {
      res = vm.runInContext("grChain(__IN)", sb);
    } catch (e) {
      T.threw++;
      note(r, "THREW " + e.stack.split("\n").slice(0, 3).join(" | "));
      continue;
    }
    if (res.route !== "PLANNED") {
      T.notPlanned++;
      note(r, `route ${res.route} ${res.code} ${res.message}`);
      continue;
    }
    // new batches: the chain's refs -> the ids the old adds answered, in add order
    const adds = (r.adds || []).slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const mine = res.rows.filter((x) => x.movement);
    const refMap = {};
    mine.forEach((x, k) => {
      const a = adds[k];
      if (a && x.add && typeof x.add.batchId === "string" && x.add.batchId.startsWith("BATCHREF:") && a.resp && a.resp.data) refMap[x.add.batchId] = a.resp.data.batchId;
    });
    const unref = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v).replace(/"BATCHREF:[A-Z]\d+"/g, (m) => JSON.stringify(refMap[m.slice(1, -1)] || m.slice(1, -1))));
    // nodes
    const ctx = vm.runInContext("({})", sb);
    for (const id of res.ran) {
      if (["code_node_BatchGenPrep", "code_node_NormalizeBatch", "code_node_AppendBatch", "code_node_D9IbUV8t", "code_node_H4Eg0oEI", "code_node_W4nXz7Yb",
        "code_node_ip8w2l8k", "code_node_hRG2RgIm", "code_node_ngFX3hcL", "code_node_7kcbaray", "code_node_ITrow", "code_node_qtCEVR5x", "code_node_AeSdXE85"].includes(id)) continue;
      const recd = rec(id);
      if (recd === undefined) continue;
      const m2 = unref(res.ctx["node:" + id] ? res.ctx["node:" + id].data : null);
      let a = mask(JSON.stringify(canon(m2)));
      let b = mask(JSON.stringify(canon(recd)));
      if (id === "code_node_ITrows") {
        // the TO is C4's: the placeholder stands where the classic stamped the TO it had just added
        const to = rec("add_node_RTuMAGp5");
        const t0 = Array.isArray(to) ? to[0] : to;
        if (t0) a = a.split('"TOREF"').join(JSON.stringify(String(t0.id))).replace(new RegExp('"target_doc_no":' + JSON.stringify(String(t0.id)), "g"), '"target_doc_no":' + JSON.stringify(String(t0.to_id)));
      }
      if (a === b) T.nodes.same++;
      else {
        T.nodes.diff++;
        const out = [];
        const walk = (x, y, p) => {
          if (out.length > 6 || JSON.stringify(x) === JSON.stringify(y)) return;
          if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
            for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + "." + k);
          } else out.push(`${p}: ${JSON.stringify(x)?.slice(0, 80)} | rec ${JSON.stringify(y)?.slice(0, 80)}`);
        };
        walk(JSON.parse(a), JSON.parse(b), "");
        note(r, `node ${id}\n      ` + out.join("\n      "));
      }
    }
    // movements vs the ADD_INVENTORY runs
    for (let k = 0; k < Math.max(mine.length, adds.length); k++) {
      const x = mine[k];
      const a = adds[k];
      if (!x) { T.movements.missing++; note(r, `ADD_INVENTORY run ${k} has no planned movement`); continue; }
      if (!a) { T.movements.extra++; note(r, `planned movement ${k} has no ADD_INVENTORY run`); continue; }
      const want = Object.assign({}, a.params);
      delete want.itemData;
      const got = unref(x.movement);
      const diffs = [];
      for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
        const g = got[key];
        const w = want[key];
        if (JSON.stringify(g) === JSON.stringify(w) || numEq(g, w)) continue;
        diffs.push(`${key}: ${JSON.stringify(g)} | rec ${JSON.stringify(w)}`);
      }
      if (diffs.length) { T.movements.diff++; note(r, `movement ${k}: ` + diffs.join("; ")); }
      else T.movements.same++;
      // the price the old add answered
      const ans = a.resp && a.resp.data ? a.resp.data : {};
      if (x.add && x.add.code === "200" && ans.code === "200") {
        if (numEq(x.add.unitPrice, ans.unitPrice) && numEq(x.add.totalPrice, ans.totalPrice)) T.prices.same++;
        else { T.prices.diff++; note(r, `price ${k}: ${x.add.unitPrice} / ${x.add.totalPrice} | rec ${ans.unitPrice} / ${ans.totalPrice} (${x.price && x.price.method})`); }
      } else if (x.add && ans.code !== undefined && String(x.add.code) !== String(ans.code)) { T.prices.diff++; note(r, `add code ${k}: ${x.add.code} | rec ${ans.code}`); }
    }
    // PO lines after the loop
    const after = rec("search_node_XqqoMDRs");
    if (after) {
      const recLines = {};
      for (const d of after.data) for (const l of flat(d.table_po)) recLines[l.id] = l;
      const live = vm.runInContext("__v('node:search_node_XqqoMDRs.data')", sb) || null;
      const mineLines = {};
      for (const d of (res.ctx["node:search_node_XqqoMDRs"] ? res.ctx["node:search_node_XqqoMDRs"].data.data : [])) for (const l of flat(d.table_po)) mineLines[l.id] = l;
      for (const id of Object.keys(mineLines)) {
        const m = mineLines[id];
        const w = recLines[id];
        if (!w) continue;
        const bad = ["received_qty", "outstanding_quantity", "line_status", "created_received_qty"].filter((c) => !(m[c] === w[c] || numEq(m[c], w[c]) || (m[c] === undefined && w[c] === undefined)));
        if (bad.length) { T.poLines.diff++; note(r, `PO line ${id}: ` + bad.map((c) => `${c} ${JSON.stringify(m[c])} | rec ${JSON.stringify(w[c])}`).join("; ")); }
        else T.poLines.same++;
      }
    }
    // the loop's caches
    for (const [id, key, label] of [["get_cache_node_d6mMkXQd", "putawayCache", "putaway lines"], ["get_cache_node_ITfinal", "itCache", "in-transit rows"]]) {
      const recd = rec(id);
      if (recd === undefined) continue;
      const m = unref(res.ctx["node:" + id] ? JSON.parse(res.ctx["node:" + id].data) : []);
      const w = JSON.parse(recd || "[]");
      if (JSON.stringify(canon(m)) === JSON.stringify(canon(w))) T[key].same++;
      else { T[key].diff++; note(r, `${label}: ${JSON.stringify(canon(m)).slice(0, 300)}\n      rec ${JSON.stringify(canon(w)).slice(0, 300)}`); }
    }
  }
}
console.log(JSON.stringify(T, null, 0));
for (const n of notes.slice(0, Number(process.env.SHOW || 40))) console.log("  " + n);
