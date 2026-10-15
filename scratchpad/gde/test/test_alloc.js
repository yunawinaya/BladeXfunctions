// test_alloc.js <fixture.json>...: the save-time auto allocation, lifted.
//  GA:   geGlobalAllocation (GLOBAL_ALLOCATION v34: Normalise Item, the balance / pending / HU / own-reserved searches, Execute
//        Allocation) on each recorded GLOBAL_ALLOCATION run's own reads answers exactly what that run returned
//  LOOP: geAllocLoop (GOODS_DELIVERY's if_xiZFVXy2 loop: getCurrentRowData, Global Allocation Params, GLOBAL_ALLOCATION, Get
//        Batch ID / No, process Allocation Result, updateRowInTableGd) in the recorded head context, its GLOBAL_ALLOCATION
//        reads the recorded runs' rows, ends on the table the run cached (get_cache_node_wiBIs4cB)
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv.splice(process.argv.indexOf("--mutate"), 2)[1] : "";
const MUT = {
  own_filter: ["alloc_edit.js", "s(r.target_gd_id) === s(p.currentDocId)", "true"],
  pending_gate: ["alloc_edit.js", "if (num(p.isPending) === 1) {", "if (false) {"],
  tracker: ["alloc_edit.js", "tracker = __v(\"node:code_node_56IOJIBu.data.updatedTracker\")", "tracker = {}"],
};
let src = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
let alloc = fs.readFileSync(D + "/code/prepare/alloc_edit.js", "utf8");
if (mutate) { if (alloc.indexOf(MUT[mutate][1]) < 0) throw new Error("mutant " + mutate + " does not apply"); alloc = alloc.replace(MUT[mutate][1], MUT[mutate][2]); }
const sb = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(src + "\n" + alloc, sb);
const call = (expr, vars) => { Object.assign(sb, vars); return JSON.parse(JSON.stringify(vm.runInContext(expr, sb))); };
// the platform's JSON numbers: a decimal 3.0 and 3 are one value; compare canonically
const canon = (v) => JSON.stringify(v, (k, x) => (typeof x === "number" ? Number(x.toFixed(8)) : x));
let failed = 0, cases = 0;
const it = (name, f) => { cases++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 400)); } };

const outputs = (run) => {
  const o = {};
  for (const x of P(run.nodes_data || "[]")) if (x.node_id && o[x.node_id] === undefined) { try { o[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ } }
  return o;
};
const rowsOf = (v) => (v && Array.isArray(v.data) ? v.data : Array.isArray(v) ? v : []);
const readsOf = (o) => ({ items: rowsOf(o.sql_node_ItemAlloc), itemBalances: rowsOf(o.search_node_mb8Vv8fZ), batchBalances: rowsOf(o.search_node_ARAmvXyd),
  pending: rowsOf(o.search_node_BOywHct7), huAllocated: rowsOf(o.search_node_WGl1NGSu), ownReserved: rowsOf(o.search_node_OwnReserved01) });
const paramsOf = (run) => { const rq = P(run.request_json_data || "{}"); return rq.workflowparams || rq.request_json || {}; };

for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!(fx.alloc || []).length) continue;
  const name = file.split("/").pop().replace(".json", "") + " " + fx.doc_no;
  const v33 = fx.alloc.some((k) => BigInt(k.id) < 2100857434313719810n);
  // GA: each recorded GLOBAL_ALLOCATION run on its own reads
  fx.alloc.forEach((k, i) => {
    it(name + " GA " + (i + 1) + (v33 ? " (ran v33)" : ""), () => {
      const o = outputs(k);
      const got = call("geGlobalAllocation(__P, __A)", { __P: paramsOf(k), __A: readsOf(o) });
      const want = o.code_node_hDa6pSw5;
      assert.ok(want, "no recorded Execute Allocation output");
      assert.strictEqual(canon({ code: got.code, message: got.message, allocationData: got.allocationData }), canon({ code: want.code, message: want.message, allocationData: want.allocationData }));
    });
  });
  // LOOP: the head context as recorded up to the loop, the GLOBAL_ALLOCATION reads of every recorded run together
  it(name + " LOOP", () => {
    const head = outputs(fx.head);
    const ctx = {};
    for (const [k, v] of Object.entries(head)) ctx["node:" + k] = { data: v };
    for (const [k, v] of Object.entries(P(fx.head.request_json_data).workflowparams || {})) ctx["workflowparams:" + k] = v;
    // the classic loop's own searches as recorded (their filters are re-applied by the loop)
    const A = { uoms: rowsOf(head.search_node_pltmkkw3), bins: rowsOf(head.search_node_nbpWEAFx), huItems: rowsOf(head.search_node_D8ZGHKZI), hus: rowsOf(head.search_node_l8oiJ60B),
      items: [], itemBalances: [], batchBalances: [], pending: [], huAllocated: [], ownReserved: [], batches: fx.batches || [] };
    for (const k of fx.alloc) { const r = readsOf(outputs(k)); for (const key of Object.keys(r)) A[key] = A[key].concat(r[key]); }
    const got = call("__withContext(__C, () => geAllocLoop(__A))", { __C: ctx, __A: A });
    assert.ok(!got.stop, "stopped: " + JSON.stringify(got.stop));
    // the cache hands the table back as the JSON text it stored (code_node_ymugKpln parses either)
    const want = typeof head.get_cache_node_wiBIs4cB === "string" ? P(head.get_cache_node_wiBIs4cB) : head.get_cache_node_wiBIs4cB;
    assert.strictEqual(canon(got.tableGD), canon(want));
  });
}

// ---- synthetic cases: what the recordings never reach (Drafts: no own reservations, no Pending, one row per material)
const M = "2070758892513914881", PL = "1123598813738675202", ORG = "1123598813738675201";
const item = { id: M, material_code: "T", item_batch_management: 0, stock_control: 1, uom_conversion_json: "[]", default_bin_json: "[]" };
const bal = (unres, res) => ({ id: "3000000000000000001", material_id: M, location_id: "4000000000000000001", plant_id: PL, organization_id: ORG, unrestricted_qty: unres, reserved_qty: res,
  balance_quantity: unres + res, create_time: "2026-01-01 00:00:00.000" });
const params = (o) => Object.assign({ material_id: M, quantity: 5, plant_id: PL, organization_id: ORG, allocationType: "GD", allocationStrategy: "RANDOM", isPending: 0, parent_line_id: "",
  existingAllocationData: [], huData: [], huPriority: "Loose First", currentDocId: "5000000000000000001", enforceStockCheck: 1, includeReservedQty: 1, orderUomId: "", splitPolicy: "ALLOW_SPLIT",
  lineMaterials: [M], allowMixedItem: 1 }, o || {});
it("GA: only this delivery's own Allocated rows make reserved stock claimable (another delivery's never)", () => {
  const own = (gd, q) => ({ id: "6" + gd.slice(1), material_id: M, target_gd_id: gd, plant_id: PL, status: "Allocated", bin_location: "4000000000000000001", reserved_qty: q });
  const A = { items: [item], itemBalances: [bal(0, 10)], ownReserved: [own("5000000000000000001", 3), own("5000000000000000002", 7)] };
  const r = call("geGlobalAllocation(__P, __A)", { __P: params(), __A: A });
  assert.strictEqual(String(r.code), "400", "5 asked, 3 claimable: " + JSON.stringify(r).slice(0, 200));
  assert.strictEqual(String(call("geGlobalAllocation(__P, __A)", { __P: params({ quantity: 3 }), __A: A }).code), "200");
});
it("GA: an SO line's Pending stock is allocatable when isPending (its search runs)", () => {
  const pend = { id: "7000000000000000001", material_id: M, parent_line_id: "8000000000000000001", plant_id: PL, status: "Pending", bin_location: "4000000000000000001", open_qty: 4, reserved_qty: 4 };
  const A = { items: [item], itemBalances: [bal(0, 4)], pending: [pend] };
  const r = call("geGlobalAllocation(__P, __A)", { __P: params({ quantity: 4, isPending: 1, parent_line_id: "8000000000000000001", includeReservedQty: 0 }), __A: A });
  assert.strictEqual(String(r.code), "200", JSON.stringify(r).slice(0, 300));
});
it("LOOP: two rows of one material share one balance - the second sees the first's allocation (the tracker)", () => {
  const fx = JSON.parse(fs.readFileSync(process.argv.slice(2).find((f) => f.indexOf("2104739742077489153") >= 0), "utf8"));
  const head = outputs(fx.head);
  const ctx = {};
  for (const [k, v] of Object.entries(head)) ctx["node:" + k] = { data: v };
  const wp = P(fx.head.request_json_data).workflowparams || {};
  for (const [k, v] of Object.entries(wp)) ctx["workflowparams:" + k] = v;
  // the recorded row twice: one more line of the same material asking for the same 1
  const pre = JSON.parse(JSON.stringify(head.code_node_kJx9p9Nh));
  const r0 = pre.rowsNeedingAllocation[0];
  const table = JSON.parse(JSON.stringify(wp.allData.table_gd));
  table.push(JSON.parse(JSON.stringify(table[r0.rowIndex])));
  pre.rowsNeedingAllocation.push(Object.assign({}, r0, { rowIndex: table.length - 1 }));
  pre.totalRowsToAllocate = pre.rowsNeedingAllocation.length;
  ctx["node:code_node_kJx9p9Nh"] = { data: pre };
  ctx["workflowparams:allData"] = Object.assign({}, wp.allData, { table_gd: table });
  const o = outputs(fx.alloc[0]);
  const one = Object.assign({}, rowsOf(o.search_node_mb8Vv8fZ)[0], { unrestricted_qty: 1, reserved_qty: 0, balance_quantity: 1 });
  const A = { uoms: rowsOf(head.search_node_pltmkkw3), bins: rowsOf(head.search_node_nbpWEAFx), huItems: [], hus: [], items: rowsOf(o.sql_node_ItemAlloc), itemBalances: [one],
    batchBalances: [], pending: [], huAllocated: [], ownReserved: [], batches: [] };
  const got = call("__withContext(__C, () => geAllocLoop(__A))", { __C: ctx, __A: A });
  assert.ok(got.stop && got.stop.code === "400", "the second row must find nothing left: " + JSON.stringify(got).slice(0, 200));
});
console.log(JSON.stringify({ mutant: mutate || null, cases, failed }));
process.exit(failed ? 1 : 0);
