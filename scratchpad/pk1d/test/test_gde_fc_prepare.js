// test_gde_fc_prepare.js <fixture.json>...: GD_EDIT_PREPARE for source PICKING_FC (Picking 1d, Task 7) on recorded runs
// (test_plan.js's harness). The force complete holds the Picking under ITS job: the edit must plan anyway, never adopt or
// release that lock; a removed line stays removed and a shrunk line carries its new quantity; the hold lasts 1800 s.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = R + "scratchpad/gde";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub, res: F.on_reserved_gd, pickItem: F.transfer_order_jz8m9w3h_sub, pickRec: F.transfer_order_vrqs3cmr_sub, pick: F.transfer_order };
const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", D + "/code/prepare/chain_edit.js",
  D + "/code/submit/_common.js", D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js", D + "/code/prepare/plan_edit.js", D + "/code/commit/so_edit.js",
  R + "scratchpad/pk1d/code/fc_fp.js", D + "/code/submit/fc.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
const READY = fs.readFileSync(D + "/code/prepare/ready.js", "utf8");
const S0 = { total: 0, count: 0, data: [] }, G0 = { count: 0, data: {} };
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0].slice(0, 240)); } };

// fixtures the GD Edit V2 baseline already records as drifted (parity FAIL: recorded 10-15, later guards / data changed) are skipped
const DRIFTED = new Set((fs.readFileSync(R + "scratchpad/pk1d/test/gde_baseline.txt", "utf8").match(/^parity FAIL (\d{19})/gm) || []).map((l) => l.slice(-19)));
let ran = 0;
for (const file of process.argv.slice(2)) {
  if (DRIFTED.has(path.basename(file).slice(0, 19))) continue;
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const rec = {}, recCallee = {}, recReorder = {};
  for (const [src, into] of [[fx.head, rec], [fx.unused, recCallee], [fx.reorder, recReorder]]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_id && into[x.node_id] === undefined) { try { into[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ } }
  const storedRec = rec["get_node_xTRvHWB8"] && rec["get_node_xTRvHWB8"].data && rec["get_node_xTRvHWB8"].data.id ? rec["get_node_xTRvHWB8"].data : null;
  if (!storedRec || !fx.unused || String(storedRec.gd_status) !== "Created") continue;
  const flat = (gd) => (gd.table_gd || []).flatMap((r) => [r].concat(r.children || []));
  // top-level stock lines only: a bundle's items are never shrunk on their own (fcPlan refuses a partly picked bundle)
  const stock = (storedRec.table_gd || []).filter((l) => l.material_id && !(l.children || []).length && Number(l.gd_qty) > 1 && (() => { try { return JSON.parse(l.temp_qty_data || "[]").length === 1; } catch (e) { return false; } })());
  if (!stock.length) continue;
  ran++;
  it("PREPARE PICKING_FC: " + path.basename(file).slice(0, 19) + " " + fx.doc_no + " plans under the force complete's Picking lock, removed stays removed", () => {
    const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp,
      Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(1791880000000); } static now() { return 1791880000000; } } };
    vm.createContext(sb);
    vm.runInContext(SRC, sb);
    const rewrite = (code) => code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => "__v(" + JSON.stringify(k) + ")");
    const codes = [];
    for (const src of [fx.head, fx.unused, fx.reorder]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_type === "code-node" && x.request_json_data) {
      const rq = P(x.request_json_data); codes.push({ id: x.node_id, code: rewrite(rq.code), decl: (rq.responseConfig || []).map((r) => [r.name, r.bsonType]) });
    }
    sb.__CODES = codes;
    vm.runInContext('for (const c of __CODES) __N[c.id] = { decl: c.decl, fn: new Function("const console = __QUIET;\\n" + c.code) };', sb);
    const g = (id, d) => (rec[id] === undefined ? d : rec[id]);
    // the force complete: line A shrinks by 1 at the same bin; line B (another stock line, if any) has nothing picked -> removed
    const A = stock[0], B = (storedRec.table_gd || []).filter((l) => l.material_id && String(l.id) !== String(A.id) && !(l.children || []).length)[0];
    const q = Number(A.gd_qty), e = JSON.parse(A.temp_qty_data)[0];
    const fp = (l) => JSON.parse(JSON.stringify(vm.runInContext("fcLineFingerprint(" + JSON.stringify(l) + ")", sb)));
    const cells = {}, base = {};
    cells[String(A.id)] = { picking_status: "Completed", is_force_complete: 1, plan_qty: q.toFixed(8), gd_qty: (q - 1).toFixed(8), base_qty: (Number(A.base_qty) * (q - 1) / q).toFixed(8),
      temp_qty_data: JSON.stringify([Object.assign({}, e, { gd_quantity: Number(e.gd_quantity) - 1 })]) };
    base[String(A.id)] = fp(A);
    const removed = B ? [String(B.id)] : [];
    if (B) base[String(B.id)] = fp(B);
    sb.__S = storedRec; sb.__PARTS = { cells, removed, base };
    const d = vm.runInContext("fcDelta(__S, __PARTS)", sb);
    assert.ok(d.ok, "fcDelta: " + d.code + " " + d.message);
    const stored = JSON.parse(JSON.stringify(storedRec)); stored.gd_status = "Processing";
    // the Picking: locked by the force complete's job (not by this edit), at some version this edit never recorded
    const pick = JSON.parse(JSON.stringify(g("get_pick_for_reconcile", G0)));
    if (pick && pick.data && pick.data.id) { pick.data.is_processing = 1; pick.data.update_time = "2026-10-20 10:00:00.000"; }
    const jobId = "2110999999999999999";
    sb.__E = { jobId, tenantId: fx.tenant_id, nonce: "a1b2c3d4", idempotencyKey: "GDE|" + storedRec.id + "|1", gdId: String(storedRec.id), organizationId: String(storedRec.organization_id),
      request: { v: 1, source: "PICKING_FC", stored_status: storedRec.gd_status, submitted_by: "1", picking_version: "", picking_id: "", hold: 1, cascade_ref: "PKFC|2112000000000000077",
        causation_job_id: "2112000000000000077", fcd_ref: "FCD|a1b2c3d4|0", answers: {}, delta: JSON.parse(JSON.stringify(d.delta)) } };
    sb.__R = { stored, lock: { step_name: "LOCK|1", result_ref: "GDE|" + storedRec.id + "|1" },
      linkage: g("search_gr_linkage", S0), pickingSetup: g("get_node_iFPuvJX2", G0), itemFlags: g("sql_node_ItemFlags", []), packingSetup: g("get_packing_setup", G0),
      pick, activePickings: g("search_node_NBAQ9gsj", S0), binNames: g("search_bin_names", S0), soLines: g("search_node_SOLine8kQ2", S0), cleanupSoLines: g("search_node_DnZIKKVH", S0),
      soHeaders: g("search_node_FVhsTRDu", S0), pickingFormat: g("get_node_zna6o03F", G0), itemDatas: recCallee["sql_node_ItemDatas"] || [], allocated: recCallee["search_node_r3NiR6B7"] || S0,
      pending: recCallee["search_node_QdY1FLLA"] || S0, extraReads: {}, calleeExtraReads: {} };
    for (const x of JSON.parse(fx.head.nodes_data)) if (/^(search|sql|get)-node$/.test(x.node_type || "") && !(x.node_id in sb.__R)) sb.__R.extraReads[x.node_id] = rec[x.node_id];
    for (const x of JSON.parse(fx.unused.nodes_data)) if (/^(search|sql|get)-node$/.test(x.node_type || "")) sb.__R.calleeExtraReads[x.node_id] = recCallee[x.node_id];
    sb.__K = KINDS;
    const res = JSON.parse(JSON.stringify(vm.runInContext("gePlan(__E, __R, __K)", sb)));
    assert.strictEqual(res.route, "ENGINE", "route " + res.route + " " + res.code + " " + res.message);
    assert.strictEqual(res.pickUnlockId, "", "a force complete's edit must never release the force complete's Picking lock");
    sb.__PT = res.parts;
    const applied = vm.runInContext("geApplyGdParts(__S, __PT, __K)", sb);
    const after = {};
    for (const l of flat(applied)) after[String(l.id)] = l;
    assert.strictEqual(Number(after[String(A.id)].gd_qty), q - 1, "line A's planned quantity");
    if (B) assert.ok(!after[String(B.id)], "line B was removed by the force complete and must stay removed");
  });
}
it("fixtures: at least one recorded Created GD to run on", () => assert.ok(ran > 0, "no usable fixture"));

// ready.js: a PICKING_FC hold lasts 1800 s with its own wording; a cascade's stays 900 s
const sbr = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Date };
vm.createContext(sbr);
vm.runInContext(fs.readFileSync(D + "/code/submit/_common.js", "utf8") + "\n" + READY, sbr);
const holdOf = (source) => {
  sbr.__A = [{ jobId: "1", dbNow: "2026-10-20 10:00:00", rowVersion: 1, request: { source, hold: 1, stored_status: "Created" } },
    { route: "ENGINE", message: "planned", payload: "{}", lineCount: 1, movementCount: 0, gdId: "9", unlockOk: 1, pickUnlockId: "" }, { code: "200" }];
  return JSON.parse(JSON.stringify(vm.runInContext("prepareReady(...__A)", sbr)));
};
it("ready: a PICKING_FC hold lasts 1800 s and names the force complete", () => {
  const r = holdOf("PICKING_FC");
  assert.strictEqual(r.holdRows[0].next_attempt_at, "2026-10-20 10:30:00"); assert.ok(/force complete/i.test(r.holdRows[0].progress_message), r.holdRows[0].progress_message);
});
it("ready: a cascade's hold is unchanged (900 s)", () => { assert.strictEqual(holdOf("CASCADE").holdRows[0].next_attempt_at, "2026-10-20 10:15:00"); });
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
