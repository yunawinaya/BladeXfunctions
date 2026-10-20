// test_prepare_fc.js: PICKING_BULK_PREPARE's force complete (Picking 1d, Task 10). code_node_PPplan answers FC for a
// FORCE_COMPLETE job (writes nothing); code_node_PPfc (view_stock + fc_fp + fc_plan + prepare_fc, as the patcher inlines them)
// turns the reads into the FCD parts and READY_TO_COMMIT (CONFIRM's payload shape), or FAILED + the Picking unlocked.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const C = path.join(__dirname, "../code/");
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0].slice(0, 240)); } };
const strip = (t) => t.replace(/^const \{[^}]*\} = require\([^)]*\);\s*$/gm, "").replace(/^(if \(typeof module !== "undefined"\) )?module\.exports = .*$/gm, "");
const body = ["view_stock.js", "fc_fp.js", "fc_plan.js", "prepare_fc.js"].map((f) => strip(fs.readFileSync(C + f, "utf8"))).join("\n");
const cutAt = (t) => { const k = t.search(/^.*\{\{.*$/m); return k >= 0 ? t.slice(0, k) : t; };
const sb = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Map, Date, parseInt, parseFloat, isNaN, isFinite, RegExp };
vm.createContext(sb);
vm.runInContext(cutAt(body), sb);
const call = (fn, ...args) => { sb.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", sb))); };

const entry = { jobId: "2112000000000000077", pickingId: "2112000000000000088", rowVersion: 3, dbNow: "2026-10-20 10:00:00", jsAt: 0, organizationId: "9", confirmedAt: "2026-10-20 10:00:00",
  request: { v: 1, operation: "FORCE_COMPLETE", picking_id: "2112000000000000088", confirmed_by: "admin", lines: [], header_patch: {} } };
const hdr = [{ id: "2112000000000000088", to_id: "PI-1", to_status: "In Progress", plant_id: "8", packing_required: 1, auto_trigger_pkg: 1, packing_mode: "Basic" }];
const lines = [{ id: "R1", gd_id: "G1", gd_line_id: "L1", line_status: "In Progress", item_uom: "PCS", parent_id: "", row_type: "", pending_process_qty: "5.00000000" },
  { id: "R2", gd_id: "G1", gd_line_id: "L2", line_status: "Created", item_uom: "PCS", parent_id: "", row_type: "", pending_process_qty: "4.00000000" }];
const gdl = (id, q, st) => ({ id, goods_delivery_id: "G1", delivery_no: "GD/1", gd_status: st || "Created", material_id: "M1", material_name: "Normal Item", gd_qty: q.toFixed(8), base_qty: q.toFixed(8),
  gd_order_quantity: q.toFixed(8), gd_initial_delivered_qty: "0.00000000", gd_order_uom_id: "PCS", temp_qty_data: JSON.stringify([{ location_id: "B1", batch_id: null, gd_quantity: q }]),
  temp_hu_data: "", view_stock: "Total: " + q + " PCS\n\nDETAILS:\n1. WH-A-01: " + q + " PCS", plan_qty: null, plan_temp_qty_data: null, plan_view_stock: null, picking_status: "In Progress",
  item_bundle_id: "", parent_id: "", so_line_item_id: "S-" + id });
const gd = [gdl("L1", 5), gdl("L2", 4)];
const recs = [{ id: "100", transfer_order_id: "2112000000000000088", to_status: "In Progress", gd_line_id: "L1", job_line_key: "", source_bin: "B1", target_location: "", batch_no: "", target_batch: "",
  handling_unit_id: "", store_out_qty: "3.00000000", item_code: "M1", source_bin_name: "WH-A-01" }];
const UUID = "3F2A9C1B-77AA-4E00-9D3C-0123456789AB";
const ok = () => call("prepareFc", entry, hdr, lines, gd, recs, [], UUID);

it("ok: parts FCD|<nonce>|<gi>|<nnn> under the job, PAYLOAD, joining to the delivery's {cells, removed, base}", () => {
  const r = ok();
  assert.strictEqual(r.route, "OK", r.result_message);
  assert.strictEqual(r.needParts, "YES");
  assert.ok(r.partRows.every((p) => /^FCD\|[0-9a-z]{8}\|0\|\d{3}$/.test(p.step_name) && p.step_status === "PAYLOAD" && p.job_id === entry.jobId && p.organization_id === "9"), JSON.stringify(r.partRows[0]));
  assert.ok(r.partRows.every((p) => p.step_name.length <= 32));
  const d = JSON.parse(r.partRows.map((p) => p.result_ref).join(""));
  assert.deepStrictEqual(Object.keys(d).sort(), ["base", "cells", "removed"]);
  assert.strictEqual(d.cells.L1.gd_qty, "3.00000000"); assert.deepStrictEqual(d.removed, ["L2"]);
});
it("ok: the nonce is 8 lowercase letters / digits from the run's uuid", () => { assert.strictEqual(ok().nonce, "3f2a9c1b"); });
it("ok: READY_TO_COMMIT with CONFIRM's payload shape: no records, no GD line updates, the row patch by row id", () => {
  const r = ok();
  assert.deepStrictEqual([r.needReady, r.readyRows[0].job_status, r.readyRows[0].row_version], ["YES", "READY_TO_COMMIT", 4]);
  const p = JSON.parse(r.readyRows[0].prepared_payload);
  assert.deepStrictEqual([p.operation, p.records, p.gd_lines, p.job_id, p.picking_id, p.picking_no], ["FORCE_COMPLETE", [], [], entry.jobId, entry.pickingId, "PI-1"]);
  assert.deepStrictEqual(p.row_patch, { R1: { line_status: "Completed", pending_process_qty: 0, picked_qty: 0 }, R2: { line_status: "Cancelled", pending_process_qty: 0, picked_qty: 0 } });
  assert.deepStrictEqual([p.gd_ids, p.gd_ids_all], [["G1"], ["G1"]]);
  assert.deepStrictEqual(p.packing, { required: 1, auto: 1, packing_mode: "Basic" });
});
it("ok: the fc section: nonce, manifest, counts and the records fingerprint; the snapshot COMMIT re-checks", () => {
  const p = JSON.parse(ok().readyRows[0].prepared_payload);
  assert.strictEqual(p.fc.nonce, "3f2a9c1b");
  assert.deepStrictEqual(p.fc.manifest, [{ gi: 0, gd_id: "G1", gd_no: "GD/1", so_line_ids: ["S-L1", "S-L2"], weight: 2 }]);
  assert.deepStrictEqual([p.fc.counts.reduced, p.fc.counts.removed], [1, 1]);
  assert.deepStrictEqual([p.fc.fp.recCount, p.fc.fp.recSum, p.fc.fp.recMaxId], [1, "3.00000000", "100"]);
  assert.deepStrictEqual(p.snapshot.rows.R1, { pending: "5.00000000", status: "In Progress" });
  assert.strictEqual(p.snapshot.to_status, "In Progress");
  assert.ok(/PI-1 force completed: 1 deliver(y|ies) updated, 1 line\(s\) reduced, 1 removed/.test(p.result_message), p.result_message);
});
it("fail: a refusal -> FAILED with its code, the lease released, the Picking unlocked, nothing else", () => {
  const r = call("prepareFc", entry, hdr, lines, gd, [], [], UUID);
  assert.deepStrictEqual([r.route, r.needJobUpd, r.jobRows[0].job_status, r.jobRows[0].error_code, r.jobRows[0].lease_owner], ["FAIL", "YES", "FAILED", "PK_FC_NO_RECORDS", null]);
  assert.deepStrictEqual([r.needUnlock, r.unlockRows], ["YES", [{ id: entry.pickingId, is_processing: 0 }]]);
  assert.deepStrictEqual([r.needParts, r.needReady], ["NO", "NO"]);
});
it("parts: a delivery larger than one chunk splits in order", () => {
  const big = []; const bl = []; const br = [];
  for (let k = 0; k < 1500; k++) {
    const g = gdl("L" + k, 5); g.view_stock = "Total: 5 PCS\n\nDETAILS:\n1. WH-A-01: 5 PCS" + " ".repeat(300); big.push(g);
    bl.push({ id: "R" + k, gd_id: "G1", gd_line_id: "L" + k, line_status: "In Progress", item_uom: "PCS", parent_id: "", row_type: "", pending_process_qty: "5.00000000" });
    br.push({ id: String(1000 + k), transfer_order_id: entry.pickingId, to_status: "In Progress", gd_line_id: "L" + k, job_line_key: "", source_bin: "B1", target_location: "", batch_no: "", target_batch: "", handling_unit_id: "", store_out_qty: "3.00000000", item_code: "M1" });
  }
  const r = call("prepareFc", entry, hdr, bl, big, br, [], UUID);
  assert.ok(r.partRows.length > 1, "parts: " + r.partRows.length);
  assert.deepStrictEqual(r.partRows.map((p) => p.step_name.slice(-3)), r.partRows.map((p, i) => String(i).padStart(3, "0")));
  assert.strictEqual(Object.keys(JSON.parse(r.partRows.map((p) => p.result_ref).join("")).cells).length, 1500);
});

// code_node_PPplan: a FORCE_COMPLETE job is the FC block's (route FC, nothing written here)
it("PPplan: FORCE_COMPLETE -> route FC, no rows to write", () => {
  const t = fs.readFileSync(C + "prepare_plan.js", "utf8");
  const pb = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Map, Date, parseInt, parseFloat, isNaN, isFinite, RegExp };
  vm.createContext(pb); vm.runInContext(cutAt(t), pb);
  pb.__A = [entry, hdr, lines, gd, [], []];
  const r = JSON.parse(JSON.stringify(vm.runInContext("planConfirm(...__A)", pb)));
  assert.deepStrictEqual([r.route, r.needReady, r.needJobUpd, r.needUnlock], ["FC", "NO", "NO", "NO"]);
});
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
