// test_fc_plan.js: scratchpad/pk1d/code/fc_plan.js, the Force Complete planner (spec ~/.claude/plans/delightful-imagining-naur.md).
// Cases first; then each MUTANT (a marked line of fc_plan.js replaced by a classic-style bug) must make some case fail.
const fs = require("fs"), path = require("path"), assert = require("assert");
const PLAN = path.join(__dirname, "../code/fc_plan.js");
let failed = 0, n = 0;
const C = JSON.stringify;
const clone = (x) => JSON.parse(C(x));

// one GD (GD/1), one line L1: 5 PCS at bin B1 with an extra stored field; one row; one record of 5
const base = () => ({
  picking: { id: "T1", to_id: "PI-1", to_status: "In Progress" },
  rows: [{ id: "R1", gd_id: "G1", gd_line_id: "L1", line_status: "In Progress", item_uom: "PCS", parent_id: "" }],
  gds: [{ id: "G1", delivery_no: "GD/1", gd_status: "Created" }],
  gdLines: [line("L1", "G1", 5)],
  records: [rec("100", "T1", "L1", 5)],
  otherOpen: [],
  names: { bins: { B1: "WH-A-01", B2: "WH-A-02" }, batches: { BT1: "Batch-1" }, hus: { H1: "HU-1", H2: "HU-2" } },
});
function line(id, gd, qty, extra) {
  return Object.assign({
    id, goods_delivery_id: gd, material_id: "M1", material_name: "Normal Item", gd_qty: qty.toFixed(8), base_qty: qty.toFixed(8),
    gd_order_quantity: qty.toFixed(8), gd_initial_delivered_qty: "0.00000000", gd_order_uom_id: "PCS",
    temp_qty_data: C([{ material_id: "M1", location_id: "B1", batch_id: null, handling_unit_id: null, gd_quantity: qty, plant_id: "P1" }]),
    temp_hu_data: "", view_stock: "Total: " + qty + " PCS\n\nDETAILS:\n1. WH-A-01: " + qty + " PCS", plan_qty: null, plan_temp_qty_data: null,
    plan_view_stock: null, picking_status: "In Progress", item_bundle_id: "", parent_id: "", so_line_item_id: "S-" + id,
  }, extra || {});
}
function rec(id, to, gdLine, qty, extra) {
  return Object.assign({ id, transfer_order_id: to, to_status: to === "T1" ? "In Progress" : "Completed", gd_line_id: gdLine, job_line_key: "",
    source_bin: "B1", target_location: "", batch_no: "", target_batch: "", handling_unit_id: "", store_out_qty: qty.toFixed(8), item_code: "M1" }, extra || {});
}
const ok = (r) => { assert.ok(r.ok, "expected ok, got " + C(r).slice(0, 200)); return r; };
const refused = (r, code) => { assert.strictEqual(r.ok, false, "expected a refusal, got ok"); assert.strictEqual(r.code, code, r.message); return r; };
const cellsOf = (r, gd, l) => ((r.deltas.filter((d) => d.gd_id === gd)[0] || { cells: {} }).cells[l]);
const rowOf = (r, id) => r.rowPatch.filter((x) => x.id === id)[0];

const CASES = [
  ["1 fully picked, same bin, line not yet Completed: Completed + plan_* only", (P) => {
    const r = ok(P(base()));
    const c = cellsOf(r, "G1", "L1");
    assert.deepStrictEqual(Object.keys(c).sort(), ["is_force_complete", "pick_status", "picking_status", "plan_qty", "plan_temp_qty_data", "plan_view_stock"].filter((k) => k !== "pick_status").sort());
    assert.strictEqual(c.picking_status, "Completed"); assert.strictEqual(c.is_force_complete, 1); assert.strictEqual(c.plan_qty, "5.00000000");
    assert.strictEqual(c.plan_temp_qty_data, base().gdLines[0].temp_qty_data);
    assert.strictEqual(r.counts.kept, 1); assert.strictEqual(rowOf(r, "R1").line_status, "Completed"); assert.strictEqual(rowOf(r, "R1").pending_process_qty, "0.00000000");
  }],
  ["1b fully picked, unchanged, already Completed: no delta for the GD", (P) => {
    const i = base(); i.gdLines[0].picking_status = "Completed";
    const r = ok(P(i));
    assert.strictEqual(r.deltas.length, 0); assert.strictEqual(r.counts.kept, 1); assert.strictEqual(rowOf(r, "R1").line_status, "Completed");
  }],
  ["2 partly picked 3 of 5: quantities, allocation and text", (P) => {
    const i = base(); i.records[0].store_out_qty = "3.00000000";
    const c = cellsOf(ok(P(i)), "G1", "L1");
    assert.strictEqual(c.gd_qty, "3.00000000"); assert.strictEqual(c.base_qty, "3.00000000");
    assert.strictEqual(c.gd_delivered_qty, "3.00000000"); assert.strictEqual(c.gd_undelivered_qty, "2.00000000");
    assert.deepStrictEqual(JSON.parse(c.temp_qty_data), [{ material_id: "M1", location_id: "B1", batch_id: null, handling_unit_id: null, gd_quantity: 3, plant_id: "P1" }]);
    assert.strictEqual(c.view_stock, "Total: 3 PCS\n\nDETAILS:\n1. WH-A-01: 3 PCS");
  }],
  ["3 alternate UOM: base_qty scales by the line's own ratio", (P) => {
    const i = base(); Object.assign(i.gdLines[0], { gd_qty: "2.00000000", base_qty: "20.00000000", gd_order_quantity: "2.00000000" }); i.records[0].store_out_qty = "1.00000000";
    assert.strictEqual(cellsOf(ok(P(i)), "G1", "L1").base_qty, "10.00000000");
  }],
  ["4 nothing picked on line 2 of 2: removed, its row Cancelled", (P) => {
    const i = base(); i.gdLines.push(line("L2", "G1", 4)); i.rows.push({ id: "R2", gd_id: "G1", gd_line_id: "L2", line_status: "Created", item_uom: "PCS", parent_id: "" });
    const r = ok(P(i));
    assert.deepStrictEqual(r.deltas[0].removed, ["L2"]); assert.strictEqual(rowOf(r, "R2").line_status, "Cancelled"); assert.strictEqual(r.counts.removed, 1);
  }],
  ["5 a live GD with nothing picked: refused, naming it", (P) => {
    const i = base(); i.gds.push({ id: "G2", delivery_no: "GD/2", gd_status: "Created" }); i.gdLines.push(line("L2", "G2", 4));
    i.rows.push({ id: "R2", gd_id: "G2", gd_line_id: "L2", line_status: "Created", item_uom: "PCS", parent_id: "" });
    const r = refused(P(i), "PK_FC_GD_UNPICKED");
    assert.ok(r.message.indexOf("GD/2") >= 0 && r.message.indexOf("cancel it first") >= 0, r.message);
  }],
  ["5b a GD with other stock lines not on this Picking may lose all its lines here", (P) => {
    const i = base(); i.gdLines.push(line("L2", "G1", 4)); i.gdLines.push(line("L3", "G1", 1));
    i.rows.push({ id: "R2", gd_id: "G1", gd_line_id: "L2", line_status: "Created", item_uom: "PCS", parent_id: "" });
    i.records = [rec("100", "T1", "L1", 5)];
    const r = ok(P(i)); assert.deepStrictEqual(r.deltas[0].removed, ["L2"]);
  }],
  ["6 a Cancelled GD: skipped, its rows Cancelled", (P) => {
    const i = base(); i.gds.push({ id: "G2", delivery_no: "GD/2", gd_status: "Cancelled" }); i.gdLines.push(line("L2", "G2", 4));
    i.rows.push({ id: "R2", gd_id: "G2", gd_line_id: "L2", line_status: "Created", item_uom: "PCS", parent_id: "" });
    const r = ok(P(i));
    assert.strictEqual(r.deltas.filter((d) => d.gd_id === "G2").length, 0); assert.strictEqual(rowOf(r, "R2").line_status, "Cancelled"); assert.strictEqual(r.counts.skippedCancelled, 1);
  }],
  ["6b a Completed GD: skipped, its open rows Completed", (P) => {
    const i = base(); i.gds.push({ id: "G2", delivery_no: "GD/2", gd_status: "Completed" }); i.gdLines.push(line("L2", "G2", 4));
    i.rows.push({ id: "R2", gd_id: "G2", gd_line_id: "L2", line_status: "In Progress", item_uom: "PCS", parent_id: "" });
    const r = ok(P(i)); assert.strictEqual(rowOf(r, "R2").line_status, "Completed"); assert.strictEqual(r.counts.skippedCompleted, 1);
  }],
  ["7 records on two bins, 2 + 2 of 5", (P) => {
    const i = base(); i.records = [rec("100", "T1", "L1", 2), rec("101", "T1", "L1", 2, { source_bin: "B2" })];
    const c = cellsOf(ok(P(i)), "G1", "L1");
    assert.strictEqual(JSON.parse(c.temp_qty_data).length, 2); assert.strictEqual(c.view_stock, "Total: 4 PCS\n\nDETAILS:\n1. WH-A-01: 2 PCS\n2. WH-A-02: 2 PCS");
  }],
  ["8 the target bin wins over the source bin", (P) => {
    const i = base(); i.records[0].target_location = "B2"; i.records[0].store_out_qty = "4.00000000";
    assert.strictEqual(JSON.parse(cellsOf(ok(P(i)), "G1", "L1").temp_qty_data)[0].location_id, "B2");
  }],
  ["9 two records at one bin and batch merge into one entry, the stored entry's fields kept", (P) => {
    const i = base(); i.records = [rec("100", "T1", "L1", 1), rec("101", "T1", "L1", 2)];
    const e = JSON.parse(cellsOf(ok(P(i)), "G1", "L1").temp_qty_data);
    assert.strictEqual(e.length, 1); assert.strictEqual(e[0].gd_quantity, 3); assert.strictEqual(e[0].plant_id, "P1");
  }],
  ["10 HU picks: temp_hu_data keeps the picked HUs only, scaled", (P) => {
    const i = base();
    i.gdLines[0].temp_qty_data = C([{ material_id: "M1", location_id: "B1", batch_id: null, handling_unit_id: "H1", gd_quantity: 3 }, { material_id: "M1", location_id: "B1", batch_id: null, handling_unit_id: "H2", gd_quantity: 2 }]);
    i.gdLines[0].temp_hu_data = C([{ row_type: "item", handling_unit_id: "H1", handling_no: "HU-1", deliver_quantity: 3 }, { row_type: "item", handling_unit_id: "H2", handling_no: "HU-2", deliver_quantity: 2 }]);
    i.records = [rec("100", "T1", "L1", 2, { handling_unit_id: "H1" })];
    const c = cellsOf(ok(P(i)), "G1", "L1");
    assert.deepStrictEqual(JSON.parse(c.temp_hu_data), [{ row_type: "item", handling_unit_id: "H1", handling_no: "HU-1", deliver_quantity: 2 }]);
    assert.strictEqual(JSON.parse(c.temp_qty_data)[0].handling_unit_id, "H1");
    assert.ok(c.view_stock.indexOf("HANDLING UNIT:\n1. HU-1: 2 PCS") >= 0, c.view_stock);
  }],
  ["11 a bundle with every item picked: no quantity change, all Completed", (P) => {
    const i = bundle([2, 3], [2, 3]);
    const r = ok(P(i)); const d = r.deltas[0];
    for (const l of ["LB", "LC1", "LC2"]) { assert.strictEqual(d.cells[l].picking_status, "Completed"); assert.ok(!("gd_qty" in d.cells[l]), l); }
    assert.deepStrictEqual(d.removed, []);
  }],
  ["12 a bundle with nothing picked: the bundle and its items removed", (P) => {
    const i = bundle([2, 3], [0, 0]); i.gdLines.push(line("L1", "G1", 5)); i.rows.push({ id: "R1", gd_id: "G1", gd_line_id: "L1", line_status: "In Progress", item_uom: "PCS", parent_id: "" });
    i.records.push(rec("100", "T1", "L1", 5));
    assert.deepStrictEqual(ok(P(i)).deltas[0].removed, ["LB", "LC1", "LC2"]);
  }],
  ["13 a bundle partly picked: refused", (P) => { refused(P(bundle([2, 3], [2, 1])), "PK_BUNDLE_SHORT"); }],
  ["14 more picked than the line holds: refused", (P) => { const i = base(); i.records[0].store_out_qty = "6.00000000"; refused(P(i), "PK_FC_OVERPICK"); }],
  ["14b rounding residue of 8-decimal records (3 x 1.66666667 = 5.00000001 of 5) is not an over-pick", (P) => {
    const i = base(); i.records = [rec("100", "T1", "L1", 1.66666667), rec("101", "T1", "L1", 1.66666667), rec("102", "T1", "L1", 1.66666667)];
    ok(P(i));
  }],
  ["15 a row in another unit than the line: refused", (P) => { const i = base(); i.rows[0].item_uom = "BAG"; refused(P(i), "PK_FC_UOM"); }],
  ["16 a GD whose lines are fully picked, unchanged and Completed: no edit job", (P) => {
    const i = base(); i.gdLines[0].picking_status = "Completed"; i.gds.push({ id: "G2", delivery_no: "GD/2", gd_status: "Created" });
    i.gdLines.push(line("L2", "G2", 4)); i.rows.push({ id: "R2", gd_id: "G2", gd_line_id: "L2", line_status: "In Progress", item_uom: "PCS", parent_id: "" });
    i.records.push(rec("101", "T1", "L2", 3));
    const r = ok(P(i)); assert.deepStrictEqual(r.deltas.map((d) => d.gd_id), ["G2"]); assert.strictEqual(r.counts.kept, 1); assert.strictEqual(r.counts.reduced, 1);
  }],
  ["17 a line also on another open Picking: refused, naming it", (P) => {
    const i = base(); i.otherOpen = [{ transfer_order_id: "T9", to_id: "PI-9", gd_line_id: "L1" }];
    assert.ok(refused(P(i), "PK_FC_SHARED_LINE").message.indexOf("PI-9") >= 0);
  }],
  ["18 a Completed sibling's picks count: 2 there + 3 here = 5 of 5, kept", (P) => {
    const i = base(); i.records = [rec("90", "T2", "L1", 2), rec("100", "T1", "L1", 3)];
    const c = cellsOf(ok(P(i)), "G1", "L1"); assert.ok(!("gd_qty" in c), C(c));
  }],
  ["19 a Cancelled sibling's picks do not count", (P) => {
    const i = base(); i.records = [rec("90", "T2", "L1", 2, { to_status: "Cancelled" }), rec("100", "T1", "L1", 3)];
    assert.strictEqual(cellsOf(ok(P(i)), "G1", "L1").gd_qty, "3.00000000");
  }],
  ["20 a V2 record of a Cancelled row is ignored", (P) => {
    const i = base(); i.rows[0].line_status = "Cancelled"; i.rows.push({ id: "R1b", gd_id: "G1", gd_line_id: "L1", line_status: "In Progress", item_uom: "PCS", parent_id: "" });
    i.records = [rec("90", "T1", "L1", 2, { job_line_key: "J9|R1|0" }), rec("100", "T1", "L1", 3)];
    assert.strictEqual(cellsOf(ok(P(i)), "G1", "L1").gd_qty, "3.00000000");
  }],
  ["21 deltas in GD-id order, gi 0..n", (P) => {
    const i = { picking: base().picking, rows: [], gds: [], gdLines: [], records: [], otherOpen: [], names: base().names };
    for (const g of ["30", "4", "200"]) {
      i.gds.push({ id: g, delivery_no: "GD/" + g, gd_status: "Created" }); i.gdLines.push(line("L" + g, g, 5));
      i.rows.push({ id: "R" + g, gd_id: g, gd_line_id: "L" + g, line_status: "In Progress", item_uom: "PCS", parent_id: "" }); i.records.push(rec("1" + g, "T1", "L" + g, 3));
    }
    const r = ok(P(i)); assert.deepStrictEqual(r.deltas.map((d) => [d.gi, d.gd_id]), [[0, "4"], [1, "30"], [2, "200"]]);
  }],
  ["22 120 lines in one GD are all planned", (P) => {
    const i = { picking: base().picking, rows: [], gds: [base().gds[0]], gdLines: [], records: [], otherOpen: [], names: base().names };
    for (let k = 0; k < 120; k++) {
      i.gdLines.push(line("L" + k, "G1", 2)); i.rows.push({ id: "R" + k, gd_id: "G1", gd_line_id: "L" + k, line_status: "In Progress", item_uom: "PCS", parent_id: "" });
      i.records.push(rec("9" + k, "T1", "L" + k, 1));
    }
    assert.strictEqual(Object.keys(ok(P(i)).deltas[0].cells).length, 120);
  }],
  ["23 nothing picked at all: refused", (P) => { const i = base(); i.records = []; refused(P(i), "PK_FC_NO_RECORDS"); }],
  ["24 base fingerprint of a touched line", (P) => {
    const i = base(); i.records[0].store_out_qty = "3.00000000";
    const b = ok(P(i)).deltas[0].base.L1;
    assert.deepStrictEqual(Object.keys(b).sort(), ["base_qty", "gd_qty", "picking_status", "temp_qty_data"]);
    assert.strictEqual(b.gd_qty, "5.00000000"); assert.strictEqual(b.picking_status, "In Progress");
  }],
  ["25 not In Progress: refused", (P) => { const i = base(); i.picking.to_status = "Completed"; refused(P(i), "PK_FC_NOT_IN_PROGRESS"); }],
  ["26 undelivered is clamped at 0", (P) => {
    const i = base(); Object.assign(i.gdLines[0], { gd_order_quantity: "2.00000000", gd_initial_delivered_qty: "2.00000000", gd_qty: "1.00000000", base_qty: "1.00000000" });
    i.records[0].store_out_qty = "0.50000000";
    const c = cellsOf(ok(P(i)), "G1", "L1"); assert.strictEqual(c.gd_delivered_qty, "2.50000000"); assert.strictEqual(c.gd_undelivered_qty, "0.00000000");
  }],
  ["27 the snapshot fingerprints this Picking's records", (P) => {
    const i = base(); i.records = [rec("90", "T2", "L1", 2), rec("100", "T1", "L1", 1), rec("101", "T1", "L1", 2)];
    const s = ok(P(i)).snapshot; assert.strictEqual(s.recCount, 2); assert.strictEqual(s.recSum, "3.00000000"); assert.strictEqual(s.recMaxId, "101");
  }],
  ["28 so_line_ids and weight per delta", (P) => {
    const i = base(); i.records[0].store_out_qty = "3.00000000";
    const d = ok(P(i)).deltas[0]; assert.deepStrictEqual(d.so_line_ids, ["S-L1"]); assert.strictEqual(d.weight, 1); assert.strictEqual(d.gd_no, "GD/1");
  }],
];
function bundle(qtys, picked) {
  const i = { picking: base().picking, rows: [{ id: "RB", gd_id: "G1", gd_line_id: "LB", line_status: "In Progress", item_uom: "PCS", parent_id: "" }],
    gds: [base().gds[0]], gdLines: [line("LB", "G1", 1, { material_id: "", item_bundle_id: "BUN1", temp_qty_data: "[]", view_stock: "" })], records: [], otherOpen: [], names: base().names };
  qtys.forEach((q, k) => {
    const id = "LC" + (k + 1);
    i.gdLines.push(line(id, "G1", q, { parent_id: "LB" }));
    i.rows.push({ id: "RC" + (k + 1), gd_id: "G1", gd_line_id: id, line_status: "In Progress", item_uom: "PCS", parent_id: "RB" });
    if (picked[k] > 0) i.records.push(rec("7" + k, "T1", id, picked[k]));
  });
  return i;
}

function run(fcPlan, quiet) {
  let bad = 0;
  for (const [name, f] of CASES) {
    try { f((input) => fcPlan(clone(input))); } catch (e) { bad++; if (!quiet) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0]); } }
    if (!quiet) n++;
  }
  return bad;
}
run(require(PLAN).fcPlan, false);

const MUTANTS = [
  ["no merge per bin/batch/HU", "/*M:merge*/ mergeByKey(", "/*M:merge*/ ((x) => x)("],
  ["base_qty = gd_qty (classic)", "/*M:base*/ q8(num(l.base_qty) * P / q)", "/*M:base*/ q8(P)"],
  ["unpicked lines kept (classic)", "/*M:remove*/ P <= EPS", "/*M:remove*/ false"],
  ["classic bundle rule (half picked passes)", "/*M:bundle*/ full.length === kids.length", "/*M:bundle*/ full.length * 2 >= kids.length"],
  ["sibling Pickings ignored (classic)", "/*M:sibling*/ s(r.to_status) !== \"Cancelled\"", "/*M:sibling*/ s(r.transfer_order_id) === s(P0.id)"],
  ["no EPS on the over-pick check", "/*M:eps*/ P > q + EPS", "/*M:eps*/ P > q"],
];
const src = fs.readFileSync(PLAN, "utf8");
for (const [name, from, to] of MUTANTS) {
  n++;
  if (src.indexOf(from) < 0) { failed++; console.log("FAIL mutant " + name + ": marker not found in fc_plan.js"); continue; }
  const file = path.join(__dirname, "../code/.mut_fc_plan.js");
  fs.writeFileSync(file, src.replace(from, to));
  delete require.cache[file];
  let killed;
  try { killed = run(require(file).fcPlan, true) > 0; } catch (e) { killed = true; }
  fs.unlinkSync(file);
  if (!killed) { failed++; console.log("FAIL mutant survived: " + name); }
}
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
