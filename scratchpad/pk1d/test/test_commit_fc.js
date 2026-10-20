// test_commit_fc.js: PICKING_BULK_COMMIT on a force complete (Picking 1d, Task 13) once PICKING_FC_DRIVE has updated every
// delivery (FC_GDS): P0 re-checks the Picking (any change -> REQUIRES_REVIEW: the deliveries are already shrunk), P1 writes the
// rows Completed / Cancelled and the Picking Completed, P4 rolls the headers up, P5 packs what was picked, P6 finishes.
// Runs the repo's JSON (or PK_OUT) on the 1c sim from a hand-built post-drive state.
const path = require("path"), assert = require("assert");
const { Engine } = require(path.join(__dirname, "../../pk1c/sim/engine.js"));
const { DB } = require(path.join(__dirname, "../../pk1c/sim/db.js"));
const { mocks1d } = require(path.join(__dirname, "../sim/mocks_1d.js"));
const { fcRowsFingerprint } = require(path.join(__dirname, "../code/fc_fp.js"));
const DIR = process.env.PK_OUT || path.join(__dirname, "../../../Picking/AsyncV2");
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.stack || e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const ORG = "9";
const MSG = "PI-1 force completed: 1 delivery updated, 2 line(s) reduced, 1 removed";

// the state PICKING_FC_DRIVE leaves: GD/1's lines shrunk (L1 5 -> 3, L3 4 -> 2 in HU H1) and L2 removed; FC_F0 / FC_HOLD / FC_GDS
function setup(opt) {
  const o = Object.assign({ completedGd: false, steps: ["FC_F0", "FC_HOLD", "FC_GDS"] }, opt || {});
  const db = new DB();
  db.t.setup.push({ id: "1", organization_id: ORG, picking_after: "Goods Delivery", allow_full_picking: 0, auto_completed_gd: 0, is_loading_bay: null });
  db.t.psetup.push({ id: "1", organization_id: ORG, packing_required: 1, auto_trigger_pkg: 1, packing_mode: "Basic" });
  db.t.rules.push({ id: "8001", department_id: ORG, is_default: 1, is_draft: 0 });
  db.t.hu.push({ id: "4001", handling_no: "HU-1", hu_material_id: "", hu_type: "", hu_uom: "" });
  db.t.so.push({ id: "7001", customer_name: "7101", cust_billing_address: "A", cust_shipping_address: "B" });
  const gd = (id, no, status, ps) => ({ id: id, delivery_no: no, gd_status: status, picking_status: ps, so_id: ["7001"], so_no: "SO/1", customer_name: "7101", plant_id: "8", organization_id: ORG, is_deleted: 0 });
  const gdl = (id, g, qty, temp, ps) => ({ id: id, goods_delivery_id: g, material_id: "M1", material_name: "Item " + id, gd_qty: qty, temp_qty_data: JSON.stringify(temp), picking_status: ps,
    good_delivery_uom_id: "PCS", line_so_id: "7001", line_so_no: "SO/1", so_line_item_id: "S-" + id, plant_id: "8", organization_id: ORG });
  db.t.gd.push(gd("5001", "GD/1", "Created", "In Progress"));
  db.t.gdl.push(gdl("6001", "5001", 3, [{ material_id: "M1", location_id: "B1", batch_id: null, gd_quantity: 3 }], "Completed"),
    gdl("6003", "5001", 2, [{ material_id: "M1", location_id: "B1", batch_id: null, handling_unit_id: "4001", gd_quantity: 2 }], "Completed"));
  const P = "9001", J = "3000000000000000500";
  const pick = { id: P, to_id: "PI-1", to_status: "In Progress", is_processing: 1, is_deleted: 0, organization_id: ORG, plant_id: "8", is_loading_bay: 0, gd_no: ["5001"], delivery_no: "GD/1",
    so_no: "SO/1", created_by: "admin", customer_id: ["7101"], remarks: "keep me", update_time: db.now };
  db.t.picking.push(pick);
  const row = (id, g, l, qty, pend, st, hu) => ({ id: id, transfer_order_id: P, gd_id: g, gd_no: g === "5001" ? "GD/1" : "GD/2", gd_line_id: l, item_code: "M1", item_name: "Item " + l, item_uom: "PCS",
    qty_to_pick: qty, pending_process_qty: pend, line_status: st, so_id: "7001", so_no: "SO/1", customer_id: "7101", handling_unit_id: hu || null, source_bin: "B1", parent_id: null });
  db.t.lines.push(row("8001", "5001", "6001", 5, 2, "In Progress"), row("8002", "5001", "6002", 4, 4, "Open"), row("8003", "5001", "6003", 4, 2, "In Progress", "4001"));
  db.t.records.push({ id: "7101", transfer_order_id: P, gd_id: "5001", gd_line_id: "6001", store_out_qty: 3, source_bin: "B1", target_location: "B1", job_line_key: "2000|R1|0" },
    { id: "7103", transfer_order_id: P, gd_id: "5001", gd_line_id: "6003", store_out_qty: 2, source_bin: "B1", target_location: "B1", handling_unit_id: "4001", job_line_key: "2000|R3|0" });
  const rowPatch = { "8001": { line_status: "Completed", pending_process_qty: 0, picked_qty: 0 }, "8002": { line_status: "Cancelled", pending_process_qty: 0, picked_qty: 0 },
    "8003": { line_status: "Completed", pending_process_qty: 0, picked_qty: 0 } };
  const snapRows = { "8001": { pending: "2.00000000", status: "In Progress" }, "8002": { pending: "4.00000000", status: "Open" }, "8003": { pending: "2.00000000", status: "In Progress" } };
  const gdsAll = ["5001"], snapGds = { "5001": "Created" };
  if (o.completedGd) {
    // a delivery completed before the force complete (skipped): its open row closes Completed, nothing else of it is touched
    db.t.gd.push(gd("5002", "GD/2", "Completed", "Completed"));
    db.t.gdl.push(gdl("6005", "5002", 6, [{ material_id: "M1", location_id: "B1", batch_id: null, gd_quantity: 6 }], "In Progress"));
    db.t.lines.push(row("8005", "5002", "6005", 6, 6, "Open"));
    rowPatch["8005"] = { line_status: "Completed", pending_process_qty: 0, picked_qty: 0 };
    snapRows["8005"] = { pending: "6.00000000", status: "Open" };
    gdsAll.push("5002"); snapGds["5002"] = "Completed"; pick.gd_no.push("5002");
  }
  const rows = db.t.lines.filter((r) => r.transfer_order_id === P);
  const payload = { v: 1, prepared_by: "PICKING_BULK_PREPARE", job_id: J, picking_id: P, picking_no: "PI-1", organization_id: ORG, plant_id: "8", operation: "FORCE_COMPLETE", full_picking: 0,
    confirmed_by: "admin", confirmed_at: "2026-10-12 12:00:00", header_patch: {}, records: [], row_patch: rowPatch, gd_lines: [], gd_ids: gdsAll, gd_ids_all: gdsAll,
    snapshot: { to_status: "In Progress", rows: snapRows, gds: snapGds }, clamped: [], result_message: MSG, packing: { required: 1, auto: 1, packing_mode: "Basic" },
    fc: { nonce: "a1b2c3d4", manifest: [{ gi: 0, gd_id: "5001", gd_no: "GD/1", so_line_ids: ["S-6001", "S-6002", "S-6003"], weight: 3 }], counts: { gds: 1, reduced: 2, removed: 1 },
      fp: { rowsFp: fcRowsFingerprint(rows), recCount: 2, recSum: "5.00000000", recMaxId: "7103" } } };
  db.t.job.push({ id: J, command: "CONFIRM_PICKING", organization_id: ORG, plant_id: "8", picking_id: P, idempotency_key: "K-" + J, job_status: "COMMITTING_PICKING", progress_percent: 80,
    progress_message: "Deliveries updated: saving the Picking", attempt_count: 0, row_version: 9, next_attempt_at: db.now, lease_owner: null, lease_expires_at: null,
    request_payload: JSON.stringify({ v: 1, operation: "FORCE_COMPLETE", picking_id: P }), prepared_payload: JSON.stringify(payload), is_deleted: 0, create_time: db.now });
  for (const name of o.steps) db.t.step.push({ id: db.id(), job_id: J, organization_id: ORG, step_name: name, step_status: "DONE", result_ref: "", is_deleted: 0, started_at: db.now });
  const e = new Engine({ dir: DIR, db: db, mocks: mocks1d() });
  const commit = () => e.run("PICKING_BULK_COMMIT", { job_id: J }).returned;
  const both = () => { const a = commit(); db.advance(1); const b = commit(); return [a, b]; };
  const job = () => db.t.job.find((x) => x.id === J);
  const line = (id) => db.t.lines.find((x) => x.id === id);
  return { db, e, commit, both, job, line, pick, P, J };
}

it("1 a force complete without FC_GDS (its deliveries not all updated): NO_WRITE, nothing written", () => {
  const t = setup({ steps: ["FC_F0", "FC_HOLD"] });
  t.commit();
  assert.deepStrictEqual([t.job().job_status, t.job().row_version, t.job().lease_owner], ["COMMITTING_PICKING", 9, null]);
  assert.deepStrictEqual([t.pick.to_status, t.line("8001").line_status], ["In Progress", "In Progress"]);
});

it("2 P0: a record added after PREPARE -> REQUIRES_REVIEW (the deliveries are already shrunk), the Picking stays locked, nothing written", () => {
  const t = setup();
  t.db.t.records.push({ id: "7109", transfer_order_id: t.P, gd_id: "5001", gd_line_id: "6001", store_out_qty: 1, source_bin: "B1", target_location: "B1", job_line_key: "2001|R1|0" });
  t.commit();
  assert.deepStrictEqual([t.job().job_status, t.job().error_code, t.job().lease_owner], ["REQUIRES_REVIEW", "PK_FC_STALE", null]);
  assert.ok(/records/.test(t.job().error_message), t.job().error_message);
  assert.deepStrictEqual([t.pick.is_processing, t.pick.to_status, t.line("8001").line_status], [1, "In Progress", "In Progress"]);
});

it("2b P0: a row changed after PREPARE -> REQUIRES_REVIEW too", () => {
  const t = setup();
  t.line("8002").pending_process_qty = 3;
  t.commit();
  assert.deepStrictEqual([t.job().job_status, t.job().error_code, t.pick.is_processing], ["REQUIRES_REVIEW", "PK_FC_STALE", 1]);
});

it("3 P1: the rows as patched (Completed / Cancelled, pending 0), the Picking Completed, its header and records untouched", () => {
  const t = setup();
  const [a] = t.both();
  assert.deepStrictEqual(["8001", "8002", "8003"].map((id) => [t.line(id).line_status, Number(t.line(id).pending_process_qty)]), [["Completed", 0], ["Cancelled", 0], ["Completed", 0]]);
  assert.strictEqual(t.pick.to_status, "Completed");
  assert.strictEqual(t.pick.remarks, "keep me");
  assert.deepStrictEqual(t.db.t.records.filter((r) => r.transfer_order_id === t.P).map((r) => r.id).sort(), ["7101", "7103"]);
  assert.ok(a, "phase A answered");
});

it("4 P1: a row the force complete did not plan, still open -> REQUIRES_REVIEW at once, the Picking not written", () => {
  const t = setup();
  t.db.t.lines.push({ id: "8004", transfer_order_id: t.P, gd_id: "5001", gd_line_id: "6004", item_code: "M1", qty_to_pick: 1, pending_process_qty: 1, line_status: "Open", parent_id: null });
  t.commit();
  assert.deepStrictEqual([t.job().job_status, t.job().error_code], ["REQUIRES_REVIEW", "PK_RECONCILIATION_MISMATCH"]);
  assert.ok(/open|Open/.test(t.job().error_message), t.job().error_message);
  assert.deepStrictEqual([t.pick.to_status, t.line("8001").line_status, t.pick.is_processing], ["In Progress", "In Progress", 1]);
});

it("5 P4: the delivery's header picking_status rolls up to Completed", () => {
  const t = setup();
  t.both();
  assert.strictEqual(t.db.t.gd.find((g) => g.id === "5001").picking_status, "Completed");
});

it("6 P5: the Packing holds what was picked - no row of the removed line, the HU Unpacked against its shrunk allocation", () => {
  const t = setup();
  t.both();
  const packs = t.db.t.packing.filter((p) => p.gd_id === "5001" && !p.is_deleted);
  assert.strictEqual(packs.length, 1);
  const src = packs[0].table_item_source;
  assert.deepStrictEqual(src.map((r) => [r.gd_line_id, r.picked_qty, r.remaining_qty, r.line_status]), [["6001", 3, 0, "Fully Picked"]]);
  const hu = packs[0].table_hu_source;
  assert.deepStrictEqual(hu.map((r) => [r.row_type, r.handling_unit_id, r.hu_status]), [["header", "4001", "Unpacked"], ["item", "4001", "Unpacked"]]);
});

it("7 P6: the job COMPLETED with the force complete's message, the Picking unlocked", () => {
  const t = setup();
  t.both();
  assert.deepStrictEqual([t.job().job_status, t.job().progress_message, t.job().lease_owner, t.pick.is_processing], ["COMPLETED", MSG, null, 0]);
});

it("8 a delivery completed before the force complete: its row closes, its header and its Packing are left alone", () => {
  const t = setup({ completedGd: true });
  t.both();
  assert.strictEqual(t.job().job_status, "COMPLETED", t.job().error_message);
  assert.strictEqual(t.line("8005").line_status, "Completed");
  assert.strictEqual(t.db.t.gd.find((g) => g.id === "5002").picking_status, "Completed");
  assert.deepStrictEqual(t.db.t.packing.filter((p) => p.gd_id === "5002"), []);
});

console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
