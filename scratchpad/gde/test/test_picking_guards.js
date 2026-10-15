// test_picking_guards.js: GD Edit V2 batch 2 - the Picking side refuses while a Goods Delivery it names is being saved in
// the background (gd_status Processing, or an open EDIT_GD / COMPLETE_GD job). Runs the code nodes of the three Picking
// workflows as the platform would (placeholders rendered as JSON) and checks the wiring of the new nodes:
// PICKING_ASYNC_SUBMIT (facts gd_busy -> decide REJECT), PICKING_LOOP (Data Preparation gdIdSql -> sql_node_GdBusy ->
// code_node_GdBusy -> IF Invalid), PICKING (size guard's line count + busy_no -> code_node_SizeGuard 400).
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const FILES = { submit: "Picking/AsyncV2/PICKING_ASYNC_SUBMIT.json", loop: "Picking/PickingLoopWorkflow.json", picking: "Picking/PickingProcessWorkflow.json",
  convert: "Bulk Actions/Sales & Distribution/Goods Delivery/GDConvertPickingWorkflow.json", lineConvert: "Bulk Actions/Sales & Distribution/Goods Delivery/GDLineConvertPickingWorkflow.json" };
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = {
  decide_off: ["if (s(f.gd_busy))", "if (false)"],
  digits_off: ["/^[0-9]{1,20}$/.test(String(id))", "true"],
  size_busy_off: ["if (busy.length > 0) {", "if (false) {"],
  conv_status_off: ["g.gd_status === \"Processing\"", "false"],
};
const load = (k) => {
  let s = fs.readFileSync(R + FILES[k], "utf8");
  if (mutate) {
    const [a, b] = MUT[mutate];
    const enc = (x) => JSON.stringify(x).slice(1, -1);   // the code lives JSON-encoded in the file
    if (s.indexOf(enc(a)) >= 0) s = s.split(enc(a)).join(enc(b));
  }
  return JSON.parse(s);
};
const nodes = (doc) => { const out = []; const walk = (l) => { for (const n of l || []) { out.push(n); walk(n.blocks); } }; walk(doc.nodes); return out; };
const node = (doc, id) => nodes(doc).filter((n) => n.id === id)[0];
const code = (n) => (n.data.script && n.data.script.code) || "";
const sql = (n) => (n.data.script && n.data.script.code) || "";
// a code node as the platform runs it: every {{...}} placeholder rendered as the JSON of its value
const run = (n, values) => {
  const body = code(n).replace(/\{\{([^}]+)\}\}/g, (m, k) => { if (!(k in values)) throw new Error(n.id + ": no value for " + k); return JSON.stringify(values[k]); });
  return new Function(body)();
};
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };
// Packing V2's COMPLETE_PACKING writes the GD's lines / reservations / stock in the background and never sets Processing
const BUSY_SQL = /g\.gd_status = 'Processing'[\s\S]*EXISTS[\s\S]*gd_async_job[\s\S]*'EDIT_GD', 'COMPLETE_GD', 'COMPLETE_PACKING'[\s\S]*CONCAT\('GD\|', g\.id\) COLLATE utf8mb4_general_ci[\s\S]*NOT IN \('COMPLETED', 'FAILED', 'CANCELLED'\)/;

const S = load("submit"), L = load("loop"), P = load("picking");

// ---- PICKING_ASYNC_SUBMIT
const facts = node(S, "sql_node_PSfacts"), decide = node(S, "code_node_PSdecide");
const guard = { tenantId: "711077", organizationId: "o1", idempotencyKey: "k1", pickingId: "p1", operation: "CONFIRM", request: "{}", lineCount: 3 };
const F = (x) => Object.assign({ db_now: "2026-10-15 17:00:00", id: "p1", to_id: "PI-1", to_status: "Created", is_deleted: 0, organization_id: "o1", plant_id: "pl1", is_processing: 0, is_loading_bay: 0, lock_age_sec: 5,
  picking_after: "Goods Delivery", allow_full_picking: "0", auto_completed_gd: "0", setup_loading_bay: "0", key_job: null, open_job: null, moved_rows: 0, gd_busy: null }, x || {});
const decideRun = (f) => run(decide, { "node:code_node_PSguard.data": guard, "node:sql_node_PSfacts.data": [f] });
it("submit: facts read the busy GD of the stored Picking (tenant-scoped, the busy predicate) and declare gd_busy", () => {
  assert.ok(/JSON_TABLE\(IF\(JSON_VALID\(t\.gd_no\), t\.gd_no, '\[\]'\)/.test(sql(facts)), "no gd_no JSON_TABLE");
  assert.ok(/g\.tenant_id = '\{\{node:code_node_PSguard\.data\.tenantId\}\}'/.test(sql(facts)) && /g\.id = CAST\(jt\.gid AS UNSIGNED\)/.test(sql(facts)));
  assert.ok(BUSY_SQL.test(sql(facts)), "busy predicate");
  assert.ok(facts.data.response_json.some((r) => r.name === "gd_busy"), "gd_busy undeclared");
});
it("submit: a busy GD -> REJECT with its number, nothing queued (before the Draft / stage routes)", () => {
  const r = decideRun(F({ gd_busy: "GD/20261015/018" }));
  assert.strictEqual(r.route, "REJECT"); assert.strictEqual(r.needJob, "NO"); assert.ok(/GD\/20261015\/018 is being saved in the background/.test(r.result_message), r.result_message);
  assert.strictEqual(decideRun(F({ gd_busy: "GD/1", to_status: "Draft" })).route, "REJECT");
});
it("submit: no busy GD -> CREATE as before; a replay of the same key still RETURNs its job", () => {
  assert.strictEqual(decideRun(F()).route, "CREATE");
  assert.strictEqual(decideRun(F({ gd_busy: "GD/1", key_job: "j9|QUEUED" })).route, "RETURN");
});

// ---- PICKING_LOOP: one check of every Picking in the confirm BEFORE the loop (mobile confirms several Pickings in one
// call: a refusal inside the loop would leave the earlier ones completed)
const top = L.nodes.map((x) => x.id);
const ids = node(L, "code_node_GdBusyIds"), busySql = node(L, "sql_node_GdBusy"), busyCode = node(L, "code_node_GdBusy"), ifBusy = node(L, "if_GdBusy");
it("loop: start -> ids -> sql -> verdict -> IF busy, before the loop; the loop is untouched", () => {
  assert.deepStrictEqual(top.slice(0, 5), ["start", "code_node_GdBusyIds", "sql_node_GdBusy", "code_node_GdBusy", "if_GdBusy"]);
  assert.ok(top.indexOf("loop_BIfi18oK") > top.indexOf("if_GdBusy"));
  assert.strictEqual(node(L, "if_tNNSBWyU").data.filter.list[0].prop, "node.code_node_hjAwTKzF.data.isInvalid", "IF Invalid changed");
});
const idsRun = (arrayData) => run(ids, { "workflowparams:arrayData": arrayData });
it("loop: the ids of every Picking's GDs, digits only, once each (or 0), declared", () => {
  assert.strictEqual(idsRun([{ gd_no: ["2110639610487418882", "x) OR (1=1"] }, { gd_no: [7, "2110639610487418882"] }, {}]).gdIdSql, "2110639610487418882,7");
  assert.strictEqual(idsRun([]).gdIdSql, "0");
  assert.strictEqual(idsRun(null).gdIdSql, "0");
  assert.deepStrictEqual(ids.data.response_json.map((r) => r.name), ["gdIdSql"]);
});
it("loop: sql_node_GdBusy reads this tenant's busy GD among those ids", () => {
  const q = sql(busySql);
  assert.ok(/g\.tenant_id = '\{\{system:tenantId\}\}'/.test(q) && /g\.id IN \(\{\{node:code_node_GdBusyIds\.data\.gdIdSql\}\}\)/.test(q) && BUSY_SQL.test(q), q);
  assert.deepStrictEqual(busySql.data.response_json.map((r) => r.name), ["gd_no"]);
});
const busyRun = (rows) => run(busyCode, { "node:sql_node_GdBusy.data": rows });
it("loop: a busy GD -> busy with its number (no 'under processing': mobile would auto-retry and say another picker)", () => {
  const b = busyRun([{ gd_no: "GD/20261015/018" }]);
  assert.strictEqual(b.busy, 1); assert.ok(/GD\/20261015\/018 is being saved in the background/.test(b.message), b.message);
  assert.ok(!/under processing/i.test(b.message));
  assert.strictEqual(busyRun({ gd_no: "GD/2" }).busy, 1, "one row as an object");
  assert.deepStrictEqual(busyRun([]), { busy: 0, message: "" });
  assert.deepStrictEqual(busyRun(null), { busy: 0, message: "" });
  assert.deepStrictEqual(busyCode.data.response_json.map((r) => r.name), ["busy", "message"]);
});
it("loop: IF busy answers code 400 + the message (what mobile and the form show), nothing else", () => {
  assert.strictEqual(ifBusy.data.filter.list[0].prop, "node.code_node_GdBusy.data.busy");
  assert.strictEqual(ifBusy.data.filter.list[0].operator, "numberEqual"); assert.strictEqual(ifBusy.data.filter.list[0].value, 1);
  const ret = ifBusy.blocks[0].blocks[0];
  assert.strictEqual(ret.type, "return-node");
  assert.deepStrictEqual(ret.data.response_value.list.map((x) => [x.prop, x.valueType, x.value]), [["code", "value", "400"], ["message", "field", "{{node:code_node_GdBusy.data.message}}"]]);
  assert.strictEqual((ifBusy.blocks[1].blocks || []).length, 0);
});

// ---- PICKING
const lineCount = node(P, "sql_node_GdLineCount"), size = node(P, "code_node_SizeGuard");
const sizeRun = (rows, opts) => run(size, { "node:sql_node_GdLineCount.data": rows, "node:get_node_Uj1uV9PU.data.data": { is_loading_bay: (opts || {}).bay ? 1 : 0 },
  "workflowparams:isForceComplete": (opts || {}).force ? 1 : 0, "node:code_node_iES7iMKA.data.anyTempChanged": 0 });
it("picking: the line count also reads each GD's busy number (tenant-scoped), declared", () => {
  const q = sql(lineCount);
  assert.ok(/AS busy_no/.test(q) && /g\.tenant_id = '\{\{system:tenantId\}\}'/.test(q) && /g\.id = goods_delivery_id/.test(q) && BUSY_SQL.test(q), q);
  assert.ok(/COUNT\(\*\) AS line_count/.test(q) && /GROUP BY goods_delivery_id/.test(q), "the line count changed");
  assert.ok(lineCount.data.response_json.some((r) => r.name === "busy_no"), "busy_no undeclared");
});
it("picking: a busy GD -> 400 with its number before anything is written; otherwise the size guard as before", () => {
  const b = sizeRun([{ gd_id: "1", line_count: "3", busy_no: "GD/20261015/018" }, { gd_id: "2", line_count: "2", busy_no: null }]);
  assert.strictEqual(b.code, "400"); assert.ok(/GD\/20261015\/018 is being saved in the background/.test(b.message), b.message);
  assert.deepStrictEqual(b.lineCounts, { 1: 3, 2: 2 });
  assert.strictEqual(sizeRun([{ gd_id: "1", line_count: "3", busy_no: null }]).code, "200");
  const big = sizeRun([{ gd_id: "1", line_count: "800", busy_no: "" }], { force: true });
  assert.strictEqual(big.code, "400"); assert.ok(/above 500 lines/.test(big.message), big.message);
});
// ---- SU: GD_Convert_Picking / SU: GD_Line_Convert_Picking: the run FAILS with the reason (an end node, code 400): mobile
// checks only the envelope's success before inserting the Picking itself, and an answer carrying data would be inserted
const C = load("convert"), LC = load("lineConvert");
for (const [label, doc, search, next] of [["convert", C, "search_node_IUyBiDce", "get_node_XlbxIscw"], ["line convert", LC, "search_node_rxIt49E4", "code_node_1loqHjR1"]]) {
  const ids = nodes(doc).map((x) => x.id);
  const check = node(doc, "code_node_ConvBusy"), ifc = node(doc, "if_ConvBusy");
  it(label + ": the GD search -> code_node_ConvBusy -> if_ConvBusy -> the mapping, in that order", () => {
    const top = doc.nodes.map((x) => x.id), i = top.indexOf(search);
    assert.deepStrictEqual(top.slice(i, i + 4), [search, "code_node_ConvBusy", "if_ConvBusy", next]);
  });
  const conv = (rows) => run(check, { ["node:" + search + ".data.data"]: rows });
  it(label + ": a Processing GD -> busy with its number; none -> not", () => {
    const b = conv([{ id: "1", delivery_no: "GD/1", gd_status: "Created" }, { id: "2", delivery_no: "GD/20261015/018", gd_status: "Processing" }]);
    assert.strictEqual(b.busy, 1); assert.ok(/GD\/20261015\/018 is being saved in the background/.test(b.message), b.message);
    assert.strictEqual(conv({ id: "2", delivery_no: "GD/2", gd_status: "Processing" }).busy, 1, "one record as an object");
    assert.deepStrictEqual(conv([{ id: "1", delivery_no: "GD/1", gd_status: "Created" }]), { busy: 0, message: "" });
    assert.deepStrictEqual(conv(null), { busy: 0, message: "" });
    assert.deepStrictEqual(check.data.response_json.map((r) => r.name), ["busy", "message"]);
  });
  it(label + ": busy -> an end node failing the run with code 400 and the message, no data", () => {
    assert.strictEqual(ifc.data.filter.list[0].prop, "node.code_node_ConvBusy.data.busy");
    const end = ifc.blocks[0].blocks[0];
    assert.strictEqual(end.type, "end-node"); assert.strictEqual(end.data.back_data_type, "Default"); assert.strictEqual(end.data.code, 400);
    assert.deepStrictEqual(end.data.msg, { type: "javascript", code: "{{node:code_node_ConvBusy.data.message}}" });
    assert.ok(!("response_value" in end.data) && !("return_data" in end.data));
    assert.strictEqual((ifc.blocks[1].blocks || []).length, 0);
  });
}

console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
process.exit(failed ? 1 : 0);
