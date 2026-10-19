// Stage 1b end to end on the generated JSON: Full Picking confirmations, the P3 recount from every Picking (incl. two
// sibling Pickings saving the same GD line at once), the over-pick refusal, the bundle rule, and P5 in chunks of <= 25.
const { Engine } = require("./engine");
const { DB, mocks } = require("./db");
const { eq, truthy, done } = require("../harness");

const DIR = process.env.PK_OUT || "/Users/yunawinaya/Developer/BladeXfunctions/Picking/AsyncV2";
const OLD = require("path").join(__dirname, "..", "base"); // the deployed stage 1a (git HEAD = dev v3/v4)
const ORG = "1901545950162329602";

// gds: [{ id, lines: [{ id, qty, bin, batch, onPickings: [{ picking, row, qty }] }] }]
function seed(opts) {
  const o = Object.assign({ full: 1, pickings: ["9001"] }, opts || {});
  const db = new DB();
  db.t.setup.push({ id: "1", organization_id: ORG, picking_after: "Goods Delivery", allow_full_picking: o.full, auto_completed_gd: 0, is_loading_bay: null });
  db.t.psetup.push({ id: "1", organization_id: ORG, packing_required: 1, auto_trigger_pkg: 1, packing_mode: "Detail" });
  db.t.rules.push({ id: "R1", department_id: ORG, is_default: 1, is_draft: 0 });
  db.t.bins.push({ id: "B1", bin_location_combine: "Zone A-01" }, { id: "B2", bin_name: "Zone B-07" });
  db.t.batches.push({ id: "BT1", batch_number: "LOT-1" });
  db.t.items.push({ id: "IT", based_uom: "PCS" });
  db.t.so.push({ id: "7001", customer_name: "C1", cust_billing_address: "A", cust_shipping_address: "B" });
  for (const pid of o.pickings) {
    db.t.picking.push({ id: pid, to_id: "PI-" + pid, to_status: "Created", is_processing: 0, is_deleted: 0, organization_id: ORG, plant_id: "P1", is_loading_bay: 0, gd_no: [], delivery_no: "", so_no: "SO/1", created_by: "admin", customer_id: ["C1"], update_time: db.now + 8 * 3600 * 1000 - 3600 * 1000 });
  }
  for (const g of o.gds) {
    db.t.gd.push({ id: g.id, gd_status: "Created", picking_status: "Created", delivery_no: "GD/" + g.id, so_id: ["7001"], so_no: "SO/1", customer_name: "C1", plant_id: "P1", organization_id: ORG, order_remark: "" });
    for (const l of g.lines) {
      const alloc = [{ material_id: "IT", location_id: l.bin || "B1", batch_id: l.batch || null, gd_quantity: l.qty }];
      db.t.gdl.push({ id: l.id, goods_delivery_id: g.id, material_id: l.bundleRow ? null : "IT", material_name: "Item " + l.id, gd_qty: l.qty, picking_status: "Created", plant_id: "P1", organization_id: ORG,
        temp_qty_data: JSON.stringify(alloc), view_stock: "Total: " + l.qty + " PCS\n\nDETAILS:\n1. Zone A-01: " + l.qty + " PCS", good_delivery_uom_id: "PCS", line_so_id: "7001", line_so_no: "SO/1", so_line_item_id: "SL" + l.id,
        item_bundle_id: l.bundleRow || l.kidOf ? "BUN" : null, parent_id: l.kidOf || null });
      for (const on of l.onPickings || [{ picking: o.pickings[0], row: "8" + l.id, qty: l.qty }]) {
        const p = db.t.picking.find((x) => x.id === on.picking);
        if (p.gd_no.indexOf(g.id) < 0) p.gd_no.push(g.id);
        db.t.lines.push({ id: on.row, transfer_order_id: on.picking, item_code: l.kidOf ? "IT" : l.bundleRow ? null : "IT", item_name: l.name || "Item " + l.id, item_desc: "", more_desc: "", item_uom: "PCS",
          qty_to_pick: on.qty, pending_process_qty: on.qty, picked_qty: 0, line_status: "Open", gd_id: g.id, gd_no: "GD/" + g.id, gd_line_id: l.id, so_id: "7001", so_no: "SO/1", so_line_id: "SL" + l.id,
          source_bin: l.bin || "B1", batch_no: l.batch || null, row_type: "item", packing_conversion: 1, weight_conversion: 0, remark: "",
          item_bundle_id: l.bundleRow || l.kidOf ? "BUN" : null, parent_id: l.kidOf ? "8" + l.kidOf : null });
      }
    }
  }
  return db;
}

const engine = (db, faults) => new Engine({ dir: DIR, db: db, mocks: mocks(), faults: faults });
let keyN = 0;
const submit = (e, pid, op, lines) => e.run("PICKING_ASYNC_SUBMIT", { picking_id: pid, organization_id: ORG, operation: op, idempotency_key: "KEY-FP-" + String(++keyN).padStart(12, "0"), payload: JSON.stringify({ lines: lines || [], header_patch: {} }), confirmed_by: "picker" }).returned;
const work = (e, jobId) => e.run("PICKING_ASYNC_WORKER", { job_id: jobId || "" }).returned;
const job = (db, id) => db.t.job.find((j) => j.id === id);
const row = (db, id) => db.t.lines.find((l) => l.id === id);
const gdl = (db, id) => db.t.gdl.find((l) => l.id === id);
const pick = (db, id) => db.t.picking.find((p) => p.id === id);
const picked = (l) => [l.picking_status, l.picked_qty, JSON.parse(l.picked_temp_qty_data || "[]").map((x) => [x.location_id, x.batch_id, x.gd_quantity])];

// ---------------------------------------------------------------- 1. short pick closes the line; the GD line counts picked qty
let db = seed({ gds: [{ id: "5001", lines: [{ id: "601", qty: 5 }, { id: "602", qty: 2, bin: "B2", batch: "BT1" }, { id: "603", qty: 4 }] }] });
let e = engine(db);
let r = submit(e, "9001", "CONFIRM", [{ row_id: "8601", qty: 3 }, { row_id: "8602", qty: 2 }]);
eq("FP submit: queued (no longer NOT_ELIGIBLE)", [r.route, r.result_code], ["QUEUED", "200"]);
work(e, r.job_id);
eq("FP: job COMPLETED, lock released", [job(db, r.job_id).job_status, pick(db, "9001").is_processing], ["COMPLETED", 0]);
eq("FP: the short line is Completed with pending 0 (any pick closes it)", [row(db, "8601").line_status, row(db, "8601").pending_process_qty, row(db, "8602").line_status, row(db, "8603").line_status], ["Completed", 0, "Completed", "Open"]);
eq("FP: GD line 601 In Progress 3 of 5; 602 Completed with its batch", [picked(gdl(db, "601")), picked(gdl(db, "602"))], [["In Progress", 3, [["B1", null, 3]]], ["Completed", 2, [["B2", "BT1", 2]]]]);
eq("FP: picked_view_stock with bin / batch names", [gdl(db, "601").picked_view_stock, gdl(db, "602").picked_view_stock], ["Total: 3 PCS\n\nDETAILS:\n1. Zone A-01: 3 PCS", "Total: 2 PCS\n\nDETAILS:\n1. Zone B-07: 2 PCS\n[Batch: LOT-1]"]);
eq("FP: prev_temp_qty_data = the allocation; untouched line 603 not written", [gdl(db, "601").prev_temp_qty_data === gdl(db, "601").temp_qty_data, gdl(db, "603").picked_qty, gdl(db, "603").prev_temp_qty_data], [true, undefined, undefined]);
eq("FP: Picking In Progress, GD header In Progress, no Packing yet", [pick(db, "9001").to_status, db.t.gd[0].picking_status, db.t.packing.length], ["In Progress", "In Progress", 0]);
const p3 = db.t.step.find((x) => x.job_id === r.job_id && x.step_name === "P3_GD_LINES");
eq("FP: P3 settled on pass 2 (pass 1 wrote 2 lines, pass 2 found nothing)", p3.result_ref, "2 GD line value(s) written in 2 pass(es)");
r = submit(e, "9001", "CONFIRM", [{ row_id: "8603", qty: 4 }]);
work(e, r.job_id);
eq("FP: last line -> Picking Completed, GD header stays In Progress (601 short), one Packing", [pick(db, "9001").to_status, db.t.gd[0].picking_status, db.t.packing.length], ["Completed", "In Progress", 1]);
eq("FP: Packing rows from the GD lines' picked bins (601 partly picked)", db.t.packing[0].table_item_source.map((x) => [x.gd_line_id, x.total_quantity, x.picked_qty, x.line_status]),
  [["601", 5, 3, "Partially Picked"], ["602", 2, 2, "Fully Picked"], ["603", 4, 4, "Fully Picked"]]);

// ---------------------------------------------------------------- 2. the remainder Picking: counted with the first one
db.t.picking.push({ id: "9002", to_id: "PI-9002", to_status: "Created", is_processing: 0, is_deleted: 0, organization_id: ORG, plant_id: "P1", is_loading_bay: 0, gd_no: ["5001"], delivery_no: "", so_no: "SO/1", created_by: "admin", customer_id: ["C1"], update_time: db.now });
db.t.lines.push(Object.assign({}, row(db, "8601"), { id: "86019", transfer_order_id: "9002", qty_to_pick: 2, pending_process_qty: 2, line_status: "Open" }));
r = submit(e, "9002", "CONFIRM", [{ row_id: "86019", qty: 3 }]);
work(e, r.job_id);
eq("remainder: 3 asked, clamped to the 2 on this Picking; GD line 601 = 3 + 2 = 5 Completed", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, picked(gdl(db, "601"))], ["COMPLETED", "PK_CLAMPED", ["Completed", 5, [["B1", null, 5]]]]);
eq("remainder: GD header Completed; the Packing refreshed, not duplicated", [db.t.gd[0].picking_status, db.t.packing.length, db.t.packing[0].table_item_source[0].picked_qty], ["Completed", 1, 5]);

// ---------------------------------------------------------------- 3. over-pick across Pickings: refused before any write
db = seed({ gds: [{ id: "5001", lines: [{ id: "601", qty: 5, onPickings: [{ picking: "9001", row: "8601", qty: 3 }, { picking: "9002", row: "86018", qty: 3 }] }] }], pickings: ["9001", "9002"] });
e = engine(db);
r = submit(e, "9001", "CONFIRM", [{ row_id: "8601", qty: 3 }]);
work(e, r.job_id);
eq("3 of 5 on the first Picking", picked(gdl(db, "601")), ["In Progress", 3, [["B1", null, 3]]]);
const before = db.t.records.length;
r = submit(e, "9002", "CONFIRM", [{ row_id: "86018", qty: 3 }]);
work(e, r.job_id);
eq("3 more on the sibling (6 of 5): FAILED, unlocked, nothing written", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, job(db, r.job_id).error_message, pick(db, "9002").is_processing, db.t.records.length, row(db, "86018").line_status],
  ["FAILED", "PK_OVER_PICK", "Picked quantity cannot exceed plan quantity: Item 601 (Picked: 6, Plan: 5)", 0, before, "Open"]);
r = submit(e, "9002", "CONFIRM", [{ row_id: "86018", qty: 2 }]);
work(e, r.job_id);
eq("2 more: 5 of 5 Completed", [job(db, r.job_id).job_status, picked(gdl(db, "601"))], ["COMPLETED", ["Completed", 5, [["B1", null, 5]]]]);

// ---------------------------------------------------------------- 4. bundles: Full Picking closes a short item, so any pick must be complete
const bundleGd = () => [{ id: "5001", lines: [{ id: "610", qty: 1, bundleRow: true, name: "Gift Set" }, { id: "611", qty: 2, kidOf: "610", name: "Mug" }, { id: "612", qty: 2, kidOf: "610", name: "Spoon" }] }];
db = seed({ gds: bundleGd() });
e = engine(db);
r = submit(e, "9001", "CONFIRM", [{ row_id: "8611", qty: 1 }, { row_id: "8612", qty: 1 }]);
work(e, r.job_id);
eq("FP bundle, part of every item: refused (normal picking allows it)", [job(db, r.job_id).job_status, job(db, r.job_id).error_code], ["FAILED", "PK_BUNDLE_SHORT"]);
db = seed({ gds: bundleGd(), full: 0 });
e = engine(db);
r = submit(e, "9001", "CONFIRM", [{ row_id: "8611", qty: 1 }, { row_id: "8612", qty: 1 }]);
work(e, r.job_id);
eq("normal picking, part of every item: allowed", job(db, r.job_id).job_status, "COMPLETED");
db = seed({ gds: bundleGd() });
e = engine(db);
r = submit(e, "9001", "CONFIRM", [{ row_id: "8611", qty: 2 }, { row_id: "8612", qty: 2 }]);
work(e, r.job_id);
eq("FP bundle in full: COMPLETED, the bundle row follows", [job(db, r.job_id).job_status, row(db, "8610").line_status, pick(db, "9001").to_status], ["COMPLETED", "Completed", "Completed"]);

// ---------------------------------------------------------------- 5. two sibling Pickings saving one GD line at the same time
db = seed({ gds: [{ id: "5001", lines: [{ id: "601", qty: 5, onPickings: [{ picking: "9001", row: "86017", qty: 2 }, { picking: "9002", row: "86018", qty: 3 }] }] }], pickings: ["9001", "9002"] });
e = engine(db);
const ja = submit(e, "9001", "CONFIRM", [{ row_id: "86017", qty: 2 }]).job_id;
const jb = submit(e, "9002", "CONFIRM", [{ row_id: "86018", qty: 3 }]).job_id;
// job A reads its P3 facts, then job B runs from start to end before A writes: A's first write is stale
let raced = false;
const realFacts = mocks().sql.sql_node_PCp3fpFacts;
e.mocks.sql.sql_node_PCp3fpFacts = (text, ctx, eng) => {
  const facts = realFacts(text, ctx, eng);
  if (!raced && ctx.params.job_id === ja) {
    raced = true;
    work(eng, jb);
  }
  return facts;
};
work(e, ja);
eq("race: B finished first with both Pickings counted", [raced, job(db, jb).job_status], [true, "COMPLETED"]);
eq("race: A's stale first write corrected by its second pass: 2 + 3 = 5 Completed", [job(db, ja).job_status, picked(gdl(db, "601"))], ["COMPLETED", ["Completed", 5, [["B1", null, 5]]]]);
eq("race: A needed 3 passes (stale write, the fix, nothing left)", db.t.step.find((x) => x.job_id === ja && x.step_name === "P3_GD_LINES").result_ref, "2 GD line value(s) written in 3 pass(es)");
eq("race: GD header Completed, one Packing", [db.t.gd[0].picking_status, db.t.packing.length], ["Completed", 1]);

// ---------------------------------------------------------------- 6. a run that dies between P3 passes resumes and settles
db = seed({ gds: [{ id: "5001", lines: [{ id: "601", qty: 5 }, { id: "602", qty: 2 }] }] });
e = engine(db, {});
r = submit(e, "9001", "CONFIRM", [{ row_id: "8601", qty: 4 }]);
let n = 0;
e.mocks.sql.sql_node_PCp3fpFacts = (text, ctx, eng) => {
  if (++n === 2) throw new Error("injected fault at pass 2");
  return realFacts(text, ctx, eng);
};
let threw = null;
try { work(e, r.job_id); } catch (err) { threw = err.message; }
eq("crash in P3 pass 2: run died, line already written by pass 1", [/pass 2/.test(threw || ""), job(db, r.job_id).job_status, picked(gdl(db, "601"))], [true, "COMMITTING_PICKING", ["In Progress", 4, [["B1", null, 4]]]]);
db.advance(11 * 60);
work(e, "");
eq("resumed: P3 settles on its first pass (nothing left to write), COMPLETED", [job(db, r.job_id).job_status, db.t.step.find((x) => x.job_id === r.job_id && x.step_name === "P3_GD_LINES").result_ref], ["COMPLETED", "0 GD line value(s) written in 1 pass(es)"]);

// ---------------------------------------------------------------- 7. 130 GDs on one Picking: P5 in chunks of 25 (the stage-1a P5 lost 30)
const many = (count, linesPer) => Array.from({ length: count }, (_, i) => ({ id: String(5100 + i), lines: Array.from({ length: linesPer }, (_, j) => ({ id: String(61000 + i * linesPer + j), qty: (j % 3) + 1 })) }));
for (const [label, dir] of [["stage 1a (repo)", OLD], ["stage 1b", DIR]]) {
  db = seed({ gds: many(130, 2), full: 0 });
  e = new Engine({ dir: dir, db: db, mocks: mocks() });
  r = submit(e, "9001", "PICK_ALL_REMAINING", []);
  work(e, r.job_id);
  const packs = new Set(db.t.packing.map((p) => p.gd_id)).size;
  if (dir === OLD) eq(label + ": COMPLETED but only 100 of 130 deliveries packed (search limit)", [job(db, r.job_id).job_status, packs, (e.truncated || []).length > 0], ["COMPLETED", 100, true]);
  else eq(label + ": COMPLETED, 130 Packings, no search cut, 6 add calls of <= 25", [job(db, r.job_id).job_status, packs, db.t.packing.length, (e.truncated || []).length, e.trace.filter((x) => x.endsWith("add_node_PCp5create")).length], ["COMPLETED", 130, 130, 0, 6]);
}

// ---------------------------------------------------------------- 8. a run that dies in the 3rd chunk resumes without duplicates
db = seed({ gds: many(60, 1), full: 1 });
e = engine(db, { add_node_PCp5create: 0 });
r = submit(e, "9001", "PICK_ALL_REMAINING", []);
let adds = 0;
const realInsert = db.insert.bind(db);
db.insert = (table, rows, ctx) => {
  if (table === "Packing" && ++adds === 3) throw new Error("injected fault at the 3rd Packing add");
  return realInsert(table, rows, ctx);
};
threw = null;
try { work(e, r.job_id); } catch (err) { threw = err.message; }
eq("P5 died at chunk 3: 50 Packings made", [/3rd Packing add/.test(threw || ""), db.t.packing.length, job(db, r.job_id).job_status], [true, 50, "COMMITTING_PICKING"]);
db.advance(11 * 60);
work(e, "");
eq("resumed: 60 Packings, one per delivery, COMPLETED", [db.t.packing.length, new Set(db.t.packing.map((p) => p.gd_id)).size, job(db, r.job_id).job_status], [60, 60, "COMPLETED"]);

// ---------------------------------------------------------------- 9. LSH size: 300 GDs, 2,100 lines, one Full Picking Picking
db = seed({ gds: many(300, 7) });
e = engine(db);
r = submit(e, "9001", "PICK_ALL_REMAINING", []);
const t0 = Date.now();
work(e, r.job_id);
const mb = (b) => Math.round(b / 1024 / 1024 * 10) / 10;
eq("LSH size: COMPLETED; 2,100 records; every GD line Completed with its picked qty; 300 headers Completed; 300 Packings",
  [job(db, r.job_id).job_status, db.t.records.length, db.t.gdl.every((l) => l.picking_status === "Completed" && l.picked_qty === l.gd_qty), db.t.gd.every((g) => g.picking_status === "Completed"), db.t.packing.length],
  ["COMPLETED", 2100, true, true, 300]);
console.log("     LSH size node data (MB):", Object.keys(e.sizes).map((k) => k + " " + mb(e.sizes[k])).join(", "), "| sim", Date.now() - t0, "ms");
truthy("LSH size: every run's node data < 30 MB", Object.values(e.sizes).every((b) => b < 30 * 1024 * 1024));
eq("LSH size: 9 GD-line slices in pass 1, nothing in pass 2; 12 Packing chunks", [e.trace.filter((x) => x.endsWith("update_node_PCp3fpWrite")).length, e.trace.filter((x) => x.endsWith("sql_node_PCp3fpFacts")).length, e.trace.filter((x) => x.endsWith("add_node_PCp5create")).length], [9, 2, 12]);

done();
