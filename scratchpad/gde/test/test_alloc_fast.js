// test_alloc_fast.js <k2 dir>: the save-time auto allocation (alloc_edit.js geAllocLoop) at 2,000 lines. <k2 dir>/reads.json =
// a live 2,000-line Draft's PREPARE reads (711077 Draft/GD/0003, test/run_sql.py), <k2 dir>/table_expected.json = the table the
// loop allocated before it was made fast (163.7 s in node; SUBMIT took 453 s on dev). The loop must give exactly that table, in
// well under the old time. The guard: the per-row lifted nodes read only what the loop hands them (a re-lift that reads more
// must fail here, not silently differ).
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const K2 = process.argv[2];
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };

const LIFT = fs.readFileSync(D + "/lift/lifted_edit.js", "utf8");
const body = (id) => { const i = LIFT.indexOf('__N["' + id + '"]'); const j = LIFT.indexOf('\n__N["', i + 10); return LIFT.slice(i, j < 0 ? undefined : j).replace(/\n\/\/ [^\n]*$/, ""); };
const reads = (id) => [...new Set((body(id).match(/__v\("([^"]+)"\)/g) || []).map((x) => x.slice(5, -2)))].sort();
it("guard: the per-row nodes read only what the loop hands them", () => {
  for (const id of ["code_node_aay7z3VT", "code_node_Htpcyp8t", "code_node_1Ya3sACY", "code_node_hifFKzmo", "code_node_56IOJIBu"]) {
    assert.ok(!/__v\((?!")/.test(body(id)), id + ": a computed __v key");
  }
  assert.deepStrictEqual(reads("code_node_aay7z3VT"), ["node:code_node_kJx9p9Nh.data.rowsNeedingAllocation", "node:get_cache_node_ih80ef3f.data"]);
  assert.deepStrictEqual(reads("code_node_Htpcyp8t"), ["node:code_node_aay7z3VT.data.currentRow", "node:code_node_kJx9p9Nh.data.rowsNeedingAllocation",
    "node:code_picking_defaults.data.effectiveSetup", "node:get_cache_node_QGhmYUxQ.data", "node:search_node_l8oiJ60B.data.data", "workflowparams:allData", "workflowparams:allData.gd_status"]);
  assert.deepStrictEqual(reads("code_node_1Ya3sACY"), ["node:workflow_node_NwRLmxNW.data"]);
  assert.deepStrictEqual(reads("code_node_hifFKzmo"), ["node:code_node_Htpcyp8t.data.huData", "node:code_node_Htpcyp8t.data.splitPolicy", "node:code_node_aay7z3VT.data.currentRow",
    "node:get_cache_node_6hmHAVwX.data", "node:get_cache_node_QGhmYUxQ.data", "node:search_node_nbpWEAFx.data.data", "node:search_node_pltmkkw3.data.data",
    "node:search_node_xc9mUWL8.data.data", "node:workflow_node_NwRLmxNW.data"]);
  assert.deepStrictEqual([...new Set(body("code_node_Htpcyp8t").match(/allData\.[A-Za-z_]+/g))].sort(), ["allData.gd_status", "allData.id", "allData.is_select_picking"]);
  assert.deepStrictEqual(body("code_node_Htpcyp8t").match(/rowsNeedingAllocation[.[][^;\n]*/g), ["rowsNeedingAllocation.map((r) => r.materialId),"]);
  assert.ok(/const rowsNeedingAllocation = __v\("node:code_node_kJx9p9Nh\.data\.rowsNeedingAllocation"\);/.test(body("code_node_Htpcyp8t")));
  assert.ok(/rowsNeedingAllocation\[index\]/.test(body("code_node_aay7z3VT")));
  // hifFKzmo reads the table only for a whole-HU policy with another material in the HU, and a bin only by id for its name
  const h = body("code_node_hifFKzmo");
  assert.deepStrictEqual(h.match(/.*allBinLocations.*/g).map((x) => x.trim()), ['const allBinLocations = __v("node:search_node_nbpWEAFx.data.data") || [];',
    "const bin = allBinLocations.find((b) => b.id === locationId);"]);
  assert.deepStrictEqual(h.match(/\bbin\.[A-Za-z_]+/g), ["bin.bin_location_combine"]);
  // the tracker: Htpcyp8t reads the row's material entry only; hifFKzmo copies it and sets that entry's row only
  assert.deepStrictEqual(body("code_node_Htpcyp8t").match(/allocationTracker\[[^\]]*\]/g), ["allocationTracker[currentRow.materialId]"]);
  assert.deepStrictEqual(h.match(/.*(allocationTracker|updatedTracker)\b.*/g).map((x) => x.trim()).filter((x) => !x.startsWith("__N[") && !/^(let allocationTracker = \{\};|allocationTracker = (JSON\.parse\(rawTracker\)|\{\}|rawTracker);)$/.test(x)),
    ["const updatedTracker = { ...allocationTracker };", "if (!updatedTracker[currentRow.materialId]) {", "updatedTracker[currentRow.materialId] = {};",
      "updatedTracker[currentRow.materialId][currentRow.rowIndex] = rowAllocations;", "updatedTracker: updatedTracker,"]);
  assert.strictEqual((h.match(/get_cache_node_6hmHAVwX/g) || []).length, 1);
  assert.ok(/if \(splitPolicy !== "ALLOW_SPLIT" && otherMaterialAllocs\.length > 0\) \{\s*const rawTableGD = __v\("node:get_cache_node_6hmHAVwX\.data"\);/.test(h));
  assert.deepStrictEqual(reads("code_node_56IOJIBu"), ["node:code_node_hifFKzmo.data", "node:get_cache_node_6hmHAVwX.data"]);
  // aay7z3VT takes row [index] and moves on by one (the loop hands row i alone at index 0)
  const a = body("code_node_aay7z3VT");
  for (const x of ["const index = currentIndexRaw ? parseInt(currentIndexRaw, 10) : 0;", "const currentRow = rowsNeedingAllocation[index];", "nextIndex: index + 1"]) assert.ok(a.includes(x), x);
  // 56IOJIBu touches flatGD[rowIndex] and the cross-line flatGD[lineIdx] only (the loop hands it just those rows, renumbered)
  const u = body("code_node_56IOJIBu");
  assert.deepStrictEqual([...new Set(u.match(/flatGD\[[^\]]+\]/g))].sort(), ["flatGD[lineIdx]", "flatGD[rowIndex]"]);
  for (const x of ["const rowIndex = allocationResult.rowIndex;", "if (flatGD[rowIndex]) {", "const lineIdx = parseInt(idx);", "if (!flatGD[lineIdx]) continue;", "tableGD: tableGD,",
    "updatedTracker: allocationResult.updatedTracker,"]) assert.ok(u.includes(x), x);
});

if (K2 && fs.existsSync(path.join(K2, "reads.json"))) {
  it("2,000 lines: the same table as before, in under 20 s", () => {
    const S = JSON.parse(fs.readFileSync(path.join(K2, "reads.json"), "utf8"));
    const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
    const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
    const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
      D + "/code/prepare/alloc_edit.js", D + "/code/prepare/alloc_ids.js", D + "/code/prepare/chain_edit.js", D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js",
      D + "/code/prepare/plan_edit.js", D + "/code/commit/so_edit.js", D + "/code/prepare/adapter_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const DECL = "const geAllocLoop = function geAllocLoop(A) {";
    const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
    vm.createContext(sb);
    vm.runInContext(SRC.replace(DECL, "const __loop0 = function geAllocLoop(A) {") + "\nconst GE_KINDS = " + JSON.stringify(KINDS) + ";" +
      "\nvar __loopMs = 0, __loopTable = null; const geAllocLoop = function (A) { const t = Date.now(); const r = __loop0(A); __loopMs += Date.now() - t; __loopTable = r.tableGD || null; return r; };", sb);
    sb.__S = S;
    const stored = vm.runInContext("geAdapt(__S)", sb).stored;
    const form = JSON.parse(JSON.stringify(stored));
    form.order_remark = (form.order_remark || "") + " (edited)";
    sb.__F = form; sb.__ST = JSON.parse(JSON.stringify(stored));
    const delta = vm.runInContext("geDelta(__F, __ST, GE_KINDS)", sb);
    const key = "GDE|" + stored.id + "|1";
    sb.__S2 = Object.assign({}, S, { hdr: S.hdr.map((r) => ({ j: r.j.replace(/"gd_status": "[^"]*"/, '"gd_status": "Processing"') })), lock: [{ step_name: "LOCK|1", result_ref: key }] });
    sb.__E = { jobId: "2110999999999999999", tenantId: "711077", nonce: "a1b2c3d4", idempotencyKey: key, gdId: String(stored.id), organizationId: String(stored.organization_id),
      request: { v: 1, source: "FORM", stored_status: "Draft", submitted_by: "1", picking_version: "", answers: { needCL: "required", continueZero: "", confirmPickReversal: "" }, delta } };
    const res = vm.runInContext("gePlan(__E, geAdapt(__S2), GE_KINDS)", sb);
    assert.strictEqual(res.route, "ENGINE", res.message);
    assert.strictEqual(res.movementCount, 4000);
    assert.strictEqual(JSON.stringify(sb.__loopTable), fs.readFileSync(path.join(K2, "table_expected.json"), "utf8"), "the allocated table differs");
    assert.ok(sb.__loopMs < 20000, "allocation loop took " + sb.__loopMs + " ms");
    console.log("   2,000-line allocation loop: " + sb.__loopMs + " ms");
  });
}
console.log((n - failed) + "/" + n + " passed");
process.exit(failed ? 1 : 0);
