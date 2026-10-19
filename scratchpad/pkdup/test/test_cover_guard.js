// test_cover_guard.js [--mutate <name>]: PICKING_LOOP's double-Picking guard. A Picking that goes live (an Add, or a Draft
// saved as Created / Completed) may not put a GD line on Pickings for more than its quantity: what OTHER live Pickings hold
// (open: qty_to_pick; Completed: their records' store_out_qty, as Convert to Picking counts it) + this call's quantity.
// Runs the new nodes' code as the platform would (placeholders rendered as JSON) and checks their wiring.
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const FILE = "Picking/PickingLoopWorkflow.json";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = {
  edit_all: ["p.to_status !== \"Draft\"", "false"],
  draft_add: ["saveAs !== \"Draft\" && ", ""],
  no_children: ["for (const c of Array.isArray(r.children) ? r.children : []) if (c) rows.push(c);", ""],
  no_cancel_skip: [" || r.line_status === \"Cancelled\"", ""],
  no_eps: ["+ EPS;", ";"],
  no_covered_req: ["covered > EPS && ", ""],
  own_off: ["AND t.id NOT IN ({{node:code_node_CoverIds.data.ownIdCsv}})", ""],
  draft_counts: ["NOT IN ('Completed', 'Cancelled', 'Draft')", "NOT IN ('Completed', 'Cancelled')"],
};
const load = () => {
  let s = fs.readFileSync(R + FILE, "utf8");
  if (mutate) {
    const [a, b] = MUT[mutate];
    const enc = (x) => JSON.stringify(x).slice(1, -1);   // the code lives JSON-encoded in the file
    if (s.indexOf(enc(a)) < 0) throw new Error("mutant anchor not found: " + mutate);
    s = s.split(enc(a)).join(enc(b));
  }
  return JSON.parse(s);
};
const nodes = (doc) => { const out = []; const walk = (l) => { for (const n of l || []) { out.push(n); walk(n.blocks); } }; walk(doc.nodes); return out; };
const node = (doc, id) => nodes(doc).filter((n) => n.id === id)[0];
const code = (n) => (n && n.data.script && n.data.script.code) || "";
const run = (n, values) => {
  const body = code(n).replace(/\{\{([^}]+)\}\}/g, (m, k) => { if (!(k in values)) throw new Error(n.id + ": no value for " + k); return JSON.stringify(values[k]); });
  return new Function(body)();
};
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 300)); } };

const L = load();
const top = L.nodes.map((x) => x.id);
const ids = node(L, "code_node_CoverIds"), ifCheck = node(L, "if_CoverCheck"), cover = node(L, "sql_node_Cover"), verdict = node(L, "code_node_Cover"), ifOver = node(L, "if_CoverOver");

// ---- wiring
it("top level: GD busy check -> CoverIds -> IF check, then the loop as before; the loop body is untouched", () => {
  const i = top.indexOf("if_GdBusy");
  assert.ok(i > 0, "if_GdBusy missing");
  assert.deepStrictEqual(top.slice(i, i + 4), ["if_GdBusy", "code_node_CoverIds", "if_CoverCheck", "code_node_uPSc7Syb"]);
  assert.ok(top.indexOf("loop_BIfi18oK") > top.indexOf("if_CoverCheck"));
  const loopIds = []; const walk = (l) => { for (const x of l || []) { loopIds.push(x.id); walk(x.blocks); } }; walk(node(L, "loop_BIfi18oK").blocks);
  assert.ok(loopIds.every((x) => !/Cover/.test(x)), "a guard node inside the loop");
});
it("IF check: true -> sql_node_Cover -> code_node_Cover -> IF over; false empty", () => {
  assert.strictEqual(ifCheck.type, "if");
  const f = ifCheck.data.filter.list[0];
  assert.deepStrictEqual([ifCheck.data.condition_type, f.prop, f.operator, f.valueType, f.value], ["ConditionRule", "node.code_node_CoverIds.data.check", "numberEqual", "value", 1]);
  assert.deepStrictEqual(ifCheck.blocks[0].blocks.map((x) => x.id), ["sql_node_Cover", "code_node_Cover", "if_CoverOver"]);
  assert.strictEqual((ifCheck.blocks[1].blocks || []).length, 0);
});
it("IF over: answers code 400 + the verdict's message (the form and the split flow show it), nothing written", () => {
  const f = ifOver.data.filter.list[0];
  assert.deepStrictEqual([ifOver.data.condition_type, f.prop, f.operator, f.value], ["ConditionRule", "node.code_node_Cover.data.over", "numberEqual", 1]);
  const ret = ifOver.blocks[0].blocks;
  assert.strictEqual(ret.length, 1); assert.strictEqual(ret[0].type, "return-node");
  assert.deepStrictEqual(ret[0].data.response_value.list.map((x) => [x.prop, x.valueType, x.value]), [["code", "value", "400"], ["message", "field", "{{node:code_node_Cover.data.message}}"]]);
  assert.strictEqual((ifOver.blocks[1].blocks || []).length, 0);
});
it("every new node's outputs are declared", () => {
  assert.deepStrictEqual(ids.data.response_json.map((r) => r.name), ["check", "lineIdCsv", "gdIdCsv", "ownIdCsv", "mine"]);
  assert.deepStrictEqual(cover.data.response_json.map((r) => r.name), ["gd_line_id", "gd_qty", "delivery_no", "item_name", "covered", "pickings"]);
  assert.deepStrictEqual(verdict.data.response_json.map((r) => r.name), ["over", "message"]);
  const keys = [ids, cover, verdict].flatMap((x) => x.data.response_json.map((r) => r.key));
  assert.strictEqual(new Set(keys).size, keys.length, "duplicate response_json key");
  assert.ok(keys.every((k) => /^[a-z0-9]{8}$/.test(k)), "keys are 8 chars");
});

// ---- code_node_CoverIds
const G1 = "2108394281340375041", L1 = "2108394281361346562", L2 = "2108394281365540865", L3 = "2108394281369735170";
const BUN = "2108394281369735999", KID = "2108394281369736000";
const idsRun = (arrayData, saveAs, pageStatus) => run(ids, { "workflowparams:arrayData": arrayData, "workflowparams:saveAs": saveAs, "workflowparams:pageStatus": pageStatus });
const pick = (x) => Object.assign({ gd_no: [G1], to_status: "", table_picking_items: [
  { row_type: "header", handling_unit_id: "77" },
  { gd_id: G1, gd_line_id: L1, qty_to_pick: 1 },
  { gd_id: G1, gd_line_id: L2, qty_to_pick: 7.5 },
  { gd_id: G1, gd_line_id: L2, qty_to_pick: "4.5" },
  { gd_id: G1, gd_line_id: L3, qty_to_pick: 2, line_status: "Cancelled" },
  { gd_id: G1, gd_line_id: BUN, qty_to_pick: 3, item_bundle_id: "9", children: [{ gd_id: G1, gd_line_id: KID, qty_to_pick: 6 }] },
  { gd_id: G1, gd_line_id: "x) OR (1=1", qty_to_pick: 5 },
  { gd_id: G1, gd_line_id: "2108394281369735998", qty_to_pick: 0 },
] }, x || {});
it("an Add: every GD line with its quantity summed over bins (children of a bundle included; headers, Cancelled rows, zero rows and non-digit ids skipped)", () => {
  const r = idsRun([pick()], "Created", "Add");
  assert.strictEqual(r.check, 1);
  assert.deepStrictEqual(r.mine, { [L1]: 1, [L2]: 12, [BUN]: 3, [KID]: 6 });
  assert.strictEqual(r.lineIdCsv, [L1, L2, BUN, KID].join(","));
  assert.strictEqual(r.gdIdCsv, G1); assert.strictEqual(r.ownIdCsv, "0");
});
it("a split call (several new Pickings): a line's quantity summed over all of them", () => {
  const a = { gd_no: [G1], table_picking_items: [{ gd_id: G1, gd_line_id: L1, qty_to_pick: 0.1 }] };
  const b = { gd_no: ["2108394281340375042"], table_picking_items: [{ gd_id: G1, gd_line_id: L1, qty_to_pick: 0.2 }, { gd_id: "2108394281340375042", gd_line_id: L2, qty_to_pick: 1 }] };
  const r = idsRun([a, b], "Created", "Add");
  assert.deepStrictEqual(r.mine, { [L1]: 0.3, [L2]: 1 });
  assert.strictEqual(r.gdIdCsv, G1 + ",2108394281340375042");
});
it("Save as Completed straight from Add is checked too", () => { assert.strictEqual(idsRun([pick()], "Completed", "Add").check, 1); });
it("a Draft saved as Created (Edit) is checked, its own id excluded from 'other Pickings'", () => {
  const r = idsRun([pick({ id: "2110000000000000001", to_status: "Draft" })], "Created", "Edit");
  assert.strictEqual(r.check, 1); assert.strictEqual(r.ownIdCsv, "2110000000000000001");
});
it("not checked (no read at all): mobile / form confirms of a live Picking, Draft saves, cancels, empty calls", () => {
  for (const [rows, saveAs, page] of [
    [[pick({ id: "1", to_status: "Created" })], "Completed", "Edit"],
    [[pick({ id: "1", to_status: "In Progress" })], "In Progress", "Edit"],
    [[pick({ id: "1", to_status: "Created" })], "Created", "Edit"],
    [[pick()], "Draft", "Add"],
    [[pick({ id: "1", to_status: "Draft" })], "Draft", "Edit"],
    [[pick({ id: "1", to_status: "Created" })], "Cancelled", "Edit"],
    [[], "Created", "Add"], [null, "Created", "Add"],
    [[{ gd_no: [G1], table_picking_items: [{ row_type: "header" }] }], "Created", "Add"],
  ]) {
    const r = idsRun(rows, saveAs, page);
    assert.strictEqual(r.check, 0, JSON.stringify([saveAs, page, rows && rows[0] && rows[0].to_status]));
    assert.strictEqual(r.lineIdCsv, "0", "no line read for " + JSON.stringify([saveAs, page]));
  }
  const e = idsRun(null, "Created", "Add");
  assert.deepStrictEqual([e.lineIdCsv, e.gdIdCsv, e.ownIdCsv], ["0", "0", "0"]);
});
it("a Picking Plan Picking (no GD lines) is not checked", () => {
  assert.strictEqual(idsRun([{ gd_no: [], to_no: ["5"], table_picking_items: [{ to_line_id: "6", qty_to_pick: 3 }] }], "Created", "Add").check, 0);
});

// ---- sql_node_Cover (static: the live checks are in sql_cover_live.py)
const q = code(cover);
it("sql: per GD line of this call, tenant-scoped, with what OTHER live Pickings hold", () => {
  assert.ok(/JSON_TABLE\(CONCAT\('\[', '\{\{node:code_node_CoverIds\.data\.lineIdCsv\}\}', '\]'\)/.test(q), "line ids");
  assert.ok(/gl\.id = l\.lid AND gl\.tenant_id = '\{\{system:tenantId\}\}'/.test(q), "GD lines tenant");
  assert.strictEqual((q.match(/t\.tenant_id = '\{\{system:tenantId\}\}'/g) || []).length, 2, "both Picking reads tenant-scoped");
  assert.strictEqual((q.match(/AND t\.id NOT IN \(\{\{node:code_node_CoverIds\.data\.ownIdCsv\}\}\)/g) || []).length, 2, "own Pickings excluded in both");
  assert.strictEqual((q.match(/JSON_OVERLAPS\(t\.gd_no, CAST\(CONCAT\('\[', '\{\{node:code_node_CoverIds\.data\.gdIdCsv\}\}', '\]'\) AS JSON\)\)/g) || []).length, 2, "gd ids as numbers");
  assert.strictEqual((q.match(/JSON_ARRAYAGG\(CAST\(d\.id AS CHAR\)\)/g) || []).length, 2, "gd ids as strings");
});
it("sql: open Pickings count qty_to_pick of live rows; Completed ones their records; Cancelled / Draft nothing", () => {
  assert.ok(/i\.qty_to_pick AS qty/.test(q) && /t\.to_status NOT IN \('Completed', 'Cancelled', 'Draft'\)/.test(q), "open");
  assert.ok(/COALESCE\(i\.line_status, ''\) <> 'Cancelled'/.test(q) && /COALESCE\(i\.row_type, ''\) <> 'header'/.test(q), "rows");
  assert.ok(/COALESCE\(r\.store_out_qty, 0\) AS qty/.test(q) && /t\.to_status = 'Completed'/.test(q), "completed");
  assert.strictEqual((q.match(/t\.is_deleted = 0/g) || []).length, 2); assert.ok(/i\.is_deleted = 0/.test(q) && /r\.is_deleted = 0/.test(q));
  assert.ok(!/\bLIMIT\b/i.test(q), "no row cap");
});

// ---- code_node_Cover
const vRun = (rows, mine) => run(verdict, { "node:sql_node_Cover.data": rows, "node:code_node_CoverIds.data.mine": mine });
const row = (x) => Object.assign({ gd_line_id: L2, gd_qty: "12.00000000", delivery_no: "GD-2610-67", item_name: "ITEM-A", covered: "12.00000000", pickings: "PI-20261009-1186" }, x || {});
it("the GD-2610-67 double (12 on PI-1186, the same 12 again) -> refused, the message names the GD, the item and the Picking", () => {
  const r = vRun([row()], { [L2]: 12 });
  assert.strictEqual(r.over, 1);
  assert.ok(/^Picking not saved/.test(r.message) && /GD-2610-67/.test(r.message) && /ITEM-A/.test(r.message) && /12 of 12/.test(r.message) && /PI-20261009-1186/.test(r.message), r.message);
});
it("a Full Picking remainder (38 of 40 picked on a Completed Picking + 2) passes; one unit more is refused", () => {
  assert.deepStrictEqual(vRun([row({ gd_qty: "40", covered: "38" })], { [L2]: 2 }), { over: 0, message: "" });
  assert.strictEqual(vRun([row({ gd_qty: "40", covered: "38" })], { [L2]: 3 }).over, 1);
});
it("float residue within 1e-6 passes (0.2 held + 0.1 added = 0.30000000000000004 on a line of 0.3)", () => {
  assert.strictEqual(vRun([row({ gd_qty: "0.30000000", covered: "0.20000000" })], { [L2]: 0.1 }).over, 0);
  assert.strictEqual(vRun([row({ gd_qty: "0.30000000", covered: "0.20000000" })], { [L2]: 0.1001 }).over, 1);
});
it("nothing held elsewhere -> passes, even above the line (not a double: the Picking's own quantity is not this guard's business)", () => {
  assert.strictEqual(vRun([row({ gd_qty: "5", covered: "0" })], { [L2]: 9 }).over, 0);
  assert.strictEqual(vRun([row({ gd_qty: "5", covered: null })], { [L2]: 9 }).over, 0);
});
it("rows as one object, empty or null; a line this call does not carry is ignored", () => {
  assert.strictEqual(vRun(row(), { [L2]: 12 }).over, 1);
  assert.deepStrictEqual(vRun([], { [L2]: 12 }), { over: 0, message: "" });
  assert.deepStrictEqual(vRun(null, { [L2]: 12 }), { over: 0, message: "" });
  assert.strictEqual(vRun([row({ gd_line_id: L1 })], { [L2]: 12 }).over, 0);
});
it("several lines over: the first three named, the rest counted", () => {
  const rows = [1, 2, 3, 4, 5].map((k) => row({ gd_line_id: "21000000000000000" + k, item_name: "IT-" + k }));
  const mine = {}; for (const r of rows) mine[r.gd_line_id] = 12;
  const m = vRun(rows, mine).message;
  assert.ok(/IT-1/.test(m) && /IT-3/.test(m) && !/IT-4/.test(m) && /and 2 more/.test(m), m);
});

console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
process.exit(failed ? 1 : 0);
