// test_gde_fc_submit.js <fixture.json>...: GD_EDIT_SUBMIT's source PICKING_FC (Picking 1d, Task 6) on GD Edit V2's own sandbox
// (the sources test_submit.js loads, plus code/submit/fc.js and pk1d's shared fingerprint). Guard / entry / fc parts / post on
// hand-made facts; the gate on recorded runs (a classic-saved GD answers GO for a force complete that only closes its lines).
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = R + "scratchpad/gde";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
  D + "/code/prepare/chain_edit.js", D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js", D + "/code/prepare/adapter_edit.js",
  R + "scratchpad/gdc/code/submit/required.js", D + "/code/submit/_common.js", D + "/code/prepare/alloc_ids.js", R + "scratchpad/pk1d/code/fc_fp.js", D + "/code/submit/fc.js",
  D + "/code/submit/guard.js", D + "/code/submit/entry.js", D + "/code/submit/gate.js", D + "/code/submit/post.js", D + "/code/submit/due.js", D + "/code/submit/result.js",
  D + "/code/submit/held.js", D + "/code/submit/ops.js"].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "")).join("\n");
const mk = () => {
  const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(SRC + "\nconst GE_KINDS = " + JSON.stringify(KINDS) + ";", sb);
  return sb;
};
const sb0 = mk();
const call = (sb, fn, ...args) => { sb.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", sb))); };
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.stack || e).toString().split("\n")[0]); } };

const GD = "2100000000000000001", JOB = "2112000000000000077", PICK = "2112000000000000088";
const fcIn = (o) => Object.assign({ operation: "SUBMIT", gdId: GD, tenantId: "1", source: "PICKING_FC", uid: "7", cascadeRef: "PKFC|" + JOB, fcdRef: "FCD|a1b2c3d4|0",
  causationJobId: JOB, pickingId: PICK }, o || {});

// ---- guard
it("guard: PICKING_FC without fcd_ref is refused", () => { const r = call(sb0, "submitGuard", fcIn({ fcdRef: "" })); assert.strictEqual(r.route, "REJECT"); assert.ok(/fcd_ref/.test(r.message), r.message); });
it("guard: a malformed fcd_ref is refused", () => { assert.strictEqual(call(sb0, "submitGuard", fcIn({ fcdRef: "FCD|x|1" })).route, "REJECT"); });
it("guard: a cascade_ref that is not PKFC|<job> is refused", () => { assert.strictEqual(call(sb0, "submitGuard", fcIn({ cascadeRef: "SO|1|n1" })).route, "REJECT"); });
it("guard: the causing job must be digits", () => { assert.strictEqual(call(sb0, "submitGuard", fcIn({ causationJobId: "x" })).route, "REJECT"); });
it("guard: the Picking must be digits", () => { assert.strictEqual(call(sb0, "submitGuard", fcIn({ pickingId: "" })).route, "REJECT"); });
it("guard: a valid PICKING_FC submit carries its references and brings no new ids", () => {
  const r = call(sb0, "submitGuard", fcIn());
  assert.strictEqual(r.route, "CONTINUE"); assert.strictEqual(r.source, "PICKING_FC");
  assert.deepStrictEqual([r.fcdRef, r.causationJobId, r.pickingId, r.cascadeRef], ["FCD|a1b2c3d4|0", JOB, PICK, "PKFC|" + JOB]);
  assert.strictEqual(r.idLists.deltaMaterialIdsSql, "0"); assert.strictEqual(r.idLists.deltaSoLineIdsSql, "0");
});
it("guard: RELEASE / CANCEL_HELD by a PKFC reference still pass", () => {
  for (const op of ["RELEASE", "CANCEL_HELD"]) assert.strictEqual(call(sb0, "submitGuard", { operation: op, gdId: GD, tenantId: "1", cascadeRef: "PKFC|" + JOB }).route, "CONTINUE");
});

// ---- entry
const facts = (o) => [Object.assign({ db_now: "2026-10-20 10:00:00", gd_id: GD, delivery_no: "GD/1", gd_status: "Created", organization_id: "9", plant_id: "8", line_count: 3,
  last_lock: "LOCK|4", lock_job: "", open_jobs: "[]", pickings: JSON.stringify([{ id: PICK, to_id: "PI-1", to_status: "In Progress", is_processing: 1, lock_age_sec: 5 }]),
  open_pickings: JSON.stringify([{ id: JOB, picking_id: PICK, job_status: "READY_TO_COMMIT" }]), so_job: "" }, o || {})];
const g = () => call(sb0, "submitGuard", fcIn());
it("entry: the causing force complete's own open job and fresh Picking lock do not block it", () => {
  const r = call(sb0, "submitEntry", g(), facts()); assert.strictEqual(r.route, "GO", r.message); assert.strictEqual(r.lockN, 5);
});
it("entry: another open confirmation on a Picking of this GD is BUSY", () => {
  const r = call(sb0, "submitEntry", g(), facts({ open_pickings: JSON.stringify([{ id: JOB, picking_id: PICK, job_status: "READY_TO_COMMIT" }, { id: "2112000000000000099", picking_id: "2112000000000000098", job_status: "QUEUED" }]) }));
  assert.strictEqual(r.route, "BUSY");
});
it("entry: another Picking of this GD held by a device is BUSY", () => {
  const r = call(sb0, "submitEntry", g(), facts({ pickings: JSON.stringify([{ id: PICK, to_id: "PI-1", is_processing: 1, lock_age_sec: 5 }, { id: "2112000000000000098", to_id: "PI-2", is_processing: 1, lock_age_sec: 5 }]) }));
  assert.strictEqual(r.route, "BUSY");
});
it("entry: the causing force complete is no longer open -> STOP 409", () => {
  const r = call(sb0, "submitEntry", g(), facts({ open_pickings: "[]" })); assert.strictEqual(r.route, "STOP"); assert.strictEqual(r.code, "409");
});
it("entry: a FORM submit on the same facts is still BUSY (unchanged)", () => {
  const r = call(sb0, "submitEntry", { operation: "SUBMIT", gdId: GD, tenantId: "1", source: "FORM", uid: "7", answers: {} }, facts()); assert.strictEqual(r.route, "BUSY");
});

// ---- the parts and the delta
const stored0 = () => ({ id: GD, gd_status: "Created", table_gd: [
  { id: "11", material_id: "M1", gd_qty: "5.00000000", base_qty: "5.00000000", picking_status: "In Progress", temp_qty_data: JSON.stringify([{ location_id: "B1", batch_id: null, gd_quantity: 5 }]) },
  { id: "12", material_id: "M2", gd_qty: "4.00000000", base_qty: "4.00000000", picking_status: "Created", temp_qty_data: "[]" },
  { id: "13", material_id: "", item_bundle_id: "BUN", gd_qty: "1.00000000", base_qty: "1.00000000", picking_status: "In Progress", temp_qty_data: "[]",
    children: [{ id: "14", material_id: "M3", gd_qty: "2.00000000", base_qty: "2.00000000", picking_status: "In Progress", temp_qty_data: "[]" }] } ] });
const fpOf = (l) => vm.runInContext("fcLineFingerprint(" + JSON.stringify(l) + ")", sb0);
const parts0 = () => {
  const st = stored0();
  return { cells: { 11: { picking_status: "Completed", is_force_complete: 1, gd_qty: "3.00000000" } }, removed: ["12"],
    base: { 11: JSON.parse(JSON.stringify(fpOf(st.table_gd[0]))), 12: JSON.parse(JSON.stringify(fpOf(st.table_gd[1]))) } };
};
it("fcParts: the chunks join in step order and parse; garbage -> null", () => {
  const text = JSON.stringify(parts0());
  const rows = [{ step_name: "FCD|a1b2c3d4|0|001", result_ref: text.slice(20) }, { step_name: "FCD|a1b2c3d4|0|000", result_ref: text.slice(0, 20) }];
  assert.deepStrictEqual(call(sb0, "fcParts", rows), parts0());
  assert.strictEqual(call(sb0, "fcParts", [{ step_name: "FCD|a1b2c3d4|0|000", result_ref: "{nope" }]), null);
});
it("fcDelta: cells -> lines, the removed line leaves the layout, order and bundle nesting kept", () => {
  const r = call(sb0, "fcDelta", stored0(), parts0());
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.delta.lines, [{ id: "11", cells: { picking_status: "Completed", is_force_complete: 1, gd_qty: "3.00000000" }, drop: [] }]);
  assert.deepStrictEqual(r.delta.removed, ["12"]);
  assert.deepStrictEqual(r.delta.layout, [{ ref: "11", children: [] }, { ref: "13", children: ["14"] }]);
  assert.deepStrictEqual([r.delta.header, r.delta.dropHeader, r.delta.added], [{}, [], []]);
});
it("fcDelta: a line changed since PREPARE -> STOP 409 GDE_FC_STALE", () => {
  const st = stored0(); st.table_gd[0].gd_qty = "6.00000000";
  const r = call(sb0, "fcDelta", st, parts0()); assert.strictEqual(r.ok, false); assert.strictEqual(r.code, "409"); assert.ok(/^GDE_FC_STALE/.test(r.message), r.message);
});
it("fcDelta: a line no longer on the delivery -> GDE_FC_STALE", () => {
  const p = parts0(); p.removed = ["99"]; const r = call(sb0, "fcDelta", stored0(), p); assert.ok(/^GDE_FC_STALE/.test(r.message), r.message);
});
it("fcDelta: a cell outside the force complete's columns -> 400", () => {
  const p = parts0(); p.cells["11"].so_id = "1"; const r = call(sb0, "fcDelta", stored0(), p); assert.strictEqual(r.code, "400");
});
it("fcDelta: removing every line -> 400", () => {
  const p = { cells: {}, removed: ["11", "12", "13", "14"], base: {} }; assert.strictEqual(call(sb0, "fcDelta", stored0(), p).code, "400");
});
it("fcDelta: unreadable parts -> 400", () => { assert.strictEqual(call(sb0, "fcDelta", stored0(), null).code, "400"); });

// ---- post
const entryGo = { route: "GO", tenantId: "1", gdId: GD, gdNo: "GD/1", organizationId: "9", plantId: "8", lineCount: 3, dbNow: "2026-10-20 10:00:00", lockN: 5, storedStatus: "Created" };
const gateGo = { route: "GO", needCL: "not required", clAutoOverride: "0", qtyStop: "", delta: { header: {}, dropHeader: [], lines: [], added: [], removed: [], layout: [] }, pickingId: "", pickingReversalNote: "" };
it("post: a PICKING_FC submit is held under its PKFC reference and locks no Picking", () => {
  const r = call(sb0, "submitPost", g(), entryGo, gateGo, null);
  assert.strictEqual(r.route, "QUEUE");
  const req = JSON.parse(r.jobRows[0].request_payload);
  assert.deepStrictEqual([req.hold, req.cascade_ref, req.picking_id, req.causation_job_id, req.fcd_ref], [1, "PKFC|" + JOB, "", JOB, "FCD|a1b2c3d4|0"]);
  assert.strictEqual(r.jobRows[0].causation_id, "PICKING_FC");
  assert.deepStrictEqual([r.pickLockRows, r.needPickLock], [[], "NO"]);
});

// ---- the gate on recorded runs: a force complete that only closes the lines (Completed + plan_*) answers GO, two live Pickings
// do not refuse it, and a stale base stops it before the chain
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const rec = {}, recCallee = {};
  for (const [src, into] of [[fx.head, rec], [fx.unused, recCallee]]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_id && into[x.node_id] === undefined) { try { into[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ } }
  const stored = rec["get_node_xTRvHWB8"] && rec["get_node_xTRvHWB8"].data && rec["get_node_xTRvHWB8"].data.id ? rec["get_node_xTRvHWB8"].data : null;
  const resp = P(fx.head.response_json_data || "{}").data || {};
  if (!stored || String(resp.code || "") !== "200" || String(stored.gd_status) !== "Created") continue;
  it("gate PICKING_FC: " + path.basename(file).slice(0, 19) + " " + fx.doc_no + " closes its lines -> GO; stale base -> 409", () => {
    const sb = mk();
    const rewrite = (code) => code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => "__v(" + JSON.stringify(k) + ")");
    const codes = [];
    for (const src of [fx.head, fx.unused]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_type === "code-node" && x.request_json_data) { const rq = P(x.request_json_data); codes.push({ id: x.node_id, code: rewrite(rq.code), decl: (rq.responseConfig || []).map((r) => [r.name, r.bsonType]) }); }
    sb.__CODES = codes;
    vm.runInContext('for (const c of __CODES) __N[c.id] = { decl: c.decl, fn: new Function("const console = __QUIET;\\n" + c.code) };', sb);
    const gg = (id, d) => (rec[id] === undefined ? d : rec[id]);
    const S0 = { total: 0, count: 0, data: [] }, G0 = { count: 0, data: {} };
    const Rd = { stored, gd: { count: 1, data: stored }, pick: gg("get_pick_for_reconcile", G0), livePickings: [{ id: "a" }, { id: "b" }], linkage: gg("search_gr_linkage", S0), pickingSetup: gg("get_node_iFPuvJX2", G0),
      itemFlags: gg("sql_node_ItemFlags", []), packingSetup: gg("get_packing_setup", G0), activePickings: gg("search_node_NBAQ9gsj", S0), binNames: gg("search_bin_names", S0),
      soLines: gg("search_node_SOLine8kQ2", S0), cleanupSoLines: gg("search_node_DnZIKKVH", S0), soHeaders: gg("search_node_FVhsTRDu", S0), pickingFormat: gg("get_node_zna6o03F", G0),
      itemDatas: recCallee["sql_node_ItemDatas"] || [], allocated: recCallee["search_node_r3NiR6B7"] || S0, pending: recCallee["search_node_QdY1FLLA"] || S0, serialItems: [],
      allocTable: rec["get_cache_node_wiBIs4cB"], extraReads: {} };
    for (const x of JSON.parse(fx.head.nodes_data)) if (/^(search|sql|get)-node$/.test(x.node_type || "") && !(x.node_id in Rd)) Rd.extraReads[x.node_id] = rec[x.node_id];
    const lines = [].concat(...(stored.table_gd || []).map((l) => [l].concat(l.children || []))).filter((l) => l.material_id);
    const cells = {}, base = {};
    for (const l of lines) { cells[String(l.id)] = { picking_status: "Completed", is_force_complete: 1, plan_qty: Number(l.gd_qty || 0).toFixed(8) }; base[String(l.id)] = JSON.parse(JSON.stringify(vm.runInContext("fcLineFingerprint(" + JSON.stringify(l) + ")", sb))); }
    const gu = Object.assign(call(sb, "submitGuard", fcIn({ gdId: String(stored.id), tenantId: fx.tenant_id })), { fcParts: { cells, removed: [], base } });
    const en = { route: "GO", tenantId: fx.tenant_id, gdId: String(stored.id), gdNo: stored.delivery_no, organizationId: String(stored.organization_id), lineCount: 1, storedStatus: stored.gd_status };
    sb.__G = gu; sb.__E = en; sb.__R = Rd; sb.__F = null;
    const r = JSON.parse(JSON.stringify(vm.runInContext("submitGateOn(__G, __E, __R, __F, GE_KINDS)", sb)));
    assert.strictEqual(r.route, "GO", r.code + " " + r.message);
    assert.strictEqual(r.pickingId, "");
    assert.strictEqual(r.delta.lines.length, lines.length);
    const k = Object.keys(base)[0];
    sb.__G = Object.assign({}, gu, { fcParts: { cells, removed: [], base: Object.assign({}, base, { [k]: Object.assign({}, base[k], { gd_qty: "999.00000000" }) }) } });
    const st = JSON.parse(JSON.stringify(vm.runInContext("submitGateOn(__G, __E, __R, __F, GE_KINDS)", sb)));
    assert.deepStrictEqual([st.route, st.code], ["STOP", "409"]);
    // a force complete only decreases: no credit-limit check even where Created saves check it (full_cl_check 1, accounting on)
    const fullCl = (x) => { const y = JSON.parse(JSON.stringify(x || {})); for (const d of [].concat(y.data || [])) if (d && typeof d === "object") d.full_cl_check = 1; return y; };
    const acc = Object.assign({}, stored, { acc_integration_type: "AutoCount" });
    sb.__G = gu;
    sb.__R = Object.assign({}, Rd, { stored: acc, gd: { count: 1, data: acc }, pickingSetup: fullCl(Rd.pickingSetup) });
    for (const id of Object.keys(Rd.extraReads)) if (/setup|iFPuvJX2/i.test(id)) sb.__R.extraReads[id] = fullCl(Rd.extraReads[id]);
    const cl = JSON.parse(JSON.stringify(vm.runInContext("submitGateOn(__G, __E, __R, __F, GE_KINDS)", sb)));
    assert.deepStrictEqual([cl.route, cl.needCL, cl.clAutoOverride], ["GO", "not required", "0"], JSON.stringify([cl.route, cl.needCL, cl.clAutoOverride, cl.code, cl.message]));
  });
}
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
