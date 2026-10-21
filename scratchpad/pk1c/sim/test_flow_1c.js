// Picking V2 1c end to end on the real JSON (SUBMIT with its stage switches on -> WORKER -> PREPARE -> COMMIT), GD_REPLAN and
// INVENTORY_BULK_APPLY stood in (stubs.js). Bay moves, bin / batch swaps, a Pending-only swap, the refusals, the faults.
// SIZES=1 adds the size run (25 GDs / 500 moved lines, the cap).
const { Engine } = require("./engine");
const { DB, mocks } = require("./db");
const { install, switchesOn } = require("./stubs");
const { eq, truthy, done } = require("../../gdc/pkv2tools/harness");

const DIR = process.env.PK_OUT || "/Users/yunawinaya/Developer/BladeXfunctions/Picking/AsyncV2";
const ORG = "1901545950162329602";
const PLANT = "7001";
const ITEM = "6001";
const UOM = "12001";

function seed(opts) {
  const o = Object.assign({ bay: 0, gds: 1, lines: 3, qty: 5, packing: 0, free: 100 }, opts || {});
  const db = new DB();
  db.t.setup.push({ id: "1", organization_id: ORG, picking_after: "Goods Delivery", allow_full_picking: 0, auto_completed_gd: 0, is_loading_bay: o.bay });
  db.t.psetup.push({ id: "1", organization_id: ORG, packing_required: o.packing, auto_trigger_pkg: o.packing, packing_mode: "Basic" });
  db.t.rules.push({ id: "R1", department_id: ORG, is_default: 1, is_draft: 0 });
  db.t.items.push({ id: ITEM, based_uom: UOM, serial_number_management: 0 });
  db.t.bins.push({ id: "4001", plant_id: PLANT, bin_location_combine: "A-01" }, { id: "4002", plant_id: PLANT, bin_location_combine: "A-02" },
    { id: "4009", plant_id: PLANT, bin_location_combine: "BAY-1" }, { id: "4777", plant_id: "7999", bin_location_combine: "OTHER" });
  db.t.batches.push({ id: "2001", material_id: ITEM, plant_id: PLANT, batch_number: "B1" }, { id: "2002", material_id: ITEM, plant_id: PLANT, batch_number: "B2" });
  db.t.so.push({ id: "7101", customer_name: "C1", cust_billing_address: "A", cust_shipping_address: "B" });
  db.t.bal = {};
  const b = (loc, bat) => db.t.bal[ITEM + "|" + loc + "|" + bat] || (db.t.bal[ITEM + "|" + loc + "|" + bat] = { Unrestricted: 0, Reserved: 0 });
  b("4001", "2001").Unrestricted = o.free;
  b("4002", "2001").Unrestricted = o.free;
  b("4001", "2002").Unrestricted = o.free;
  const p = { id: "9001", to_id: "PI-1", to_status: "Created", is_processing: 0, is_deleted: 0, organization_id: ORG, plant_id: PLANT, is_loading_bay: o.bay, gd_no: [], delivery_no: "",
    so_no: "SO/1", created_by: "admin", customer_id: ["C1"], remarks: "", update_time: db.now + 8 * 3600 * 1000 - 3600 * 1000 };
  db.t.picking.push(p);
  let k = 0;
  for (let gi = 0; gi < o.gds; gi++) {
    const gdId = String(5001 + gi);
    const gdNo = "GD/" + (gi + 1);
    db.t.gd.push({ id: gdId, gd_status: "Created", picking_status: "Created", delivery_no: gdNo, so_id: ["7101"], so_no: "SO/1", customer_name: "C1", plant_id: PLANT, organization_id: ORG,
      delivery_date: "2026-10-16", is_select_picking: 0 });
    p.gd_no.push(gdId);
    for (let i = 0; i < o.lines; i++, k++) {
      const gl = String(600000 + k);
      const q = o.qty;
      const ent = [{ material_id: ITEM, location_id: "4001", batch_id: "2001", gd_quantity: q, unrestricted_qty: q, plant_id: PLANT, organization_id: ORG, is_deleted: 0 }];
      db.t.gdl.push({ id: gl, goods_delivery_id: gdId, material_id: ITEM, material_name: "Item " + k, gd_qty: q, picking_status: "Created", temp_qty_data: JSON.stringify(ent),
        view_stock: "Total: " + q + " PCS\n\nDETAILS:\n1. A-01: " + q + " PCS\n[Batch: B1]", good_delivery_uom_id: UOM, line_so_id: "7101", line_so_no: "SO/1", so_line_item_id: "SL" + k,
        plant_id: PLANT, organization_id: ORG });
      db.t.res.push({ id: String(900000 + k), doc_type: "Good Delivery", status: "Allocated", parent_id: "7101", parent_line_id: "SL" + k, parent_no: "SO/1", doc_no: gdNo, doc_id: gdId,
        doc_line_id: gl, material_id: ITEM, item_code: ITEM, item_name: "Item " + k, batch_id: "2001", bin_location: "4001", item_uom: UOM, reserved_qty: q, delivered_qty: 0, open_qty: q,
        reserved_date: "2026-10-16", line_no: i + 1, plant_id: PLANT, organization_id: ORG, target_gd_id: gdId, source_reserved_id: null, handling_unit_id: null, job_line_key: null, is_deleted: 0 });
      b("4001", "2001").Reserved += q;
      db.t.lines.push({ id: String(800000 + k), transfer_order_id: "9001", item_code: ITEM, item_name: "Item " + k, item_desc: "", more_desc: "", item_uom: UOM, qty_to_pick: q,
        pending_process_qty: q, picked_qty: 0, line_status: "Open", gd_id: gdId, gd_no: gdNo, gd_line_id: gl, so_id: "7101", so_no: "SO/1", so_line_id: "SL" + k, source_bin: "4001",
        batch_no: "2001", row_type: "item", packing_conversion: 1, weight_conversion: 0.5, remark: "" });
    }
  }
  p.delivery_no = db.t.gd.map((g) => g.delivery_no).join(", ");
  return db;
}

const engine = (db, faults) => {
  const e = new Engine({ dir: DIR, db: db, mocks: mocks(), faults: faults || {} });
  e.st = install(e);
  switchesOn(e);
  return e;
};
let keyN = 0;
const submit = (e, op, lines) => e.run("PICKING_ASYNC_SUBMIT", { picking_id: "9001", organization_id: ORG, operation: op, idempotency_key: "KEY-1C-" + String(++keyN).padStart(12, "0"),
  payload: JSON.stringify({ lines: lines || [], header_patch: {} }), confirmed_by: "picker" }).returned;
const work = (e, jobId) => e.run("PICKING_ASYNC_WORKER", { job_id: jobId || "" }).returned;
const job = (db, id) => db.t.job.find((j) => j.id === id) || {};
const bal = (db, loc, bat) => [(db.t.bal[ITEM + "|" + loc + "|" + bat] || {}).Unrestricted || 0, (db.t.bal[ITEM + "|" + loc + "|" + bat] || {}).Reserved || 0];
const gdl = (db, id) => db.t.gdl.find((l) => l.id === id);
const alloc = (db, id) => JSON.parse(gdl(db, id).temp_qty_data).map((x) => [String(x.location_id), String(x.batch_id), Number(x.gd_quantity)]).sort();
const res = (db, id) => db.t.res.find((r) => r.id === id);
const created = (db, jobId) => db.t.res.filter((r) => String(r.job_line_key || "").indexOf(jobId + "|R|") === 0);
const doneSteps = (db, jobId) => db.t.step.filter((x) => x.job_id === jobId && x.step_status === "DONE" && /^P/.test(x.step_name)).map((x) => x.step_name).sort();
const modes = (e) => e.st.calls.map((c) => c.mode + (c.route === "GO" ? "" : ":" + c.route));
const snapshot = (db) => JSON.stringify({ bal: db.t.bal, res: db.t.res, gdl: db.t.gdl, records: db.t.records, lines: db.t.lines.map((l) => [l.id, l.pending_process_qty, l.line_status]) });
const ALL_P = ["P0_REVALIDATE", "P1_PICKING", "P3_GD_LINES", "P4_GD_HEADERS", "PM1_STOCK", "PM2_RESERVATIONS", "PM3_GD_ALLOC"];
// the worker ran the COMMIT call and died there: the job stays READY_TO_COMMIT, PREPARE's work kept
const prepareOnly = (e, jobId) => {
  e.faults = { workflow_node_PWpub: 1 };
  try { work(e, jobId); } catch (err) { /* the run died at the COMMIT call */ }
  e.faults = {};
};

// ---------------------------------------------------------------- 1. Loading Bay, full pick of 2 of 3 lines
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }, { row_id: "800001", qty: 5, target_location_id: "4009" }]);
  eq("bay: SUBMIT queues it, the job cleared for moves", [r.route, JSON.parse(job(db, r.job_id).request_payload).moves], ["QUEUED", 1]);
  work(e, r.job_id);
  const j = job(db, r.job_id);
  eq("bay: COMPLETED, Picking unlocked", [j.job_status, j.error_code || null, db.t.picking[0].is_processing], ["COMPLETED", null, 0]);
  eq("bay: steps", doneSteps(db, r.job_id), ALL_P.slice().sort());
  eq("bay: one PLAN in PREPARE, one APPLY in COMMIT, one re-plan", [modes(e), e.st.replanCalls], [["PLAN", "APPLY"], 1]);
  eq("bay: the reserved stock moved to the bay bin", [bal(db, "4001", "2001"), bal(db, "4009", "2001")], [[100, 5], [0, 10]]);
  eq("bay: the source reservations closed", ["900000", "900001", "900002"].map((id) => [res(db, id).status, res(db, id).open_qty]), [["Cancelled", "0.00000000"], ["Cancelled", "0.00000000"], ["Allocated", 5]]);
  eq("bay: created at the bay bin, once each, keyed, lineage kept", created(db, r.job_id).map((c) => [c.status, c.bin_location, c.reserved_qty, c.open_qty, c.source_reserved_id, c.doc_id, c.job_line_key]),
    [["Allocated", "4009", "5.00000000", "5.00000000", "900000", "5001", r.job_id + "|R|000.1"], ["Allocated", "4009", "5.00000000", "5.00000000", "900001", "5001", r.job_id + "|R|000.2"]]);
  eq("bay: the GD lines' allocation at the bay bin; the third untouched", [alloc(db, "600000"), alloc(db, "600001"), alloc(db, "600002")],
    [[["4009", "2001", 5]], [["4009", "2001", 5]], [["4001", "2001", 5]]]);
  eq("bay: view_stock names the bay bin; prev_temp_qty_data = the new allocation (classic's final)", [/1\. BAY-1: 5 PCS/.test(gdl(db, "600000").view_stock), gdl(db, "600000").prev_temp_qty_data === gdl(db, "600000").temp_qty_data],
    [true, true]);
  eq("bay: records picked from A-01 into the bay bin", db.t.records.map((x) => [x.source_bin, x.target_location, x.store_out_qty]), [["4001", "4009", 5], ["4001", "4009", 5]]);
  eq("bay: the Picking lines keep their stored target (classic rebuilds lines from the stored row)", db.t.lines.slice(0, 2).map((l) => [l.target_location || null, l.target_batch || null]),
    [[null, null], [null, null]]);
  eq("bay: GD line / header picking status", [gdl(db, "600000").picking_status, gdl(db, "600002").picking_status, db.t.gd[0].picking_status], ["Completed", "Created", "In Progress"]);
  eq("bay: PM1 DONE names the stock operation", db.t.step.find((x) => x.job_id === r.job_id && x.step_name === "PM1_STOCK").inventory_operation_id, "PKM|" + r.job_id);
}

// ---------------------------------------------------------------- 2. Loading Bay, a partial pick
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 3, target_location_id: "4009" }]);
  work(e, r.job_id);
  eq("bay partial: COMPLETED", job(db, r.job_id).job_status, "COMPLETED");
  eq("bay partial: the allocation split 2 at A-01 / 3 at the bay", alloc(db, "600000"), [["4001", "2001", 2], ["4009", "2001", 3]]);
  eq("bay partial: the source reservation reduced, 3 created at the bay", [res(db, "900000").status, res(db, "900000").reserved_qty, res(db, "900000").open_qty,
    created(db, r.job_id).map((c) => [c.bin_location, c.reserved_qty])], ["Allocated", "2.00000000", "2.00000000", [["4009", "3.00000000"]]]);
  eq("bay partial: 3 reserved moved", [bal(db, "4001", "2001"), bal(db, "4009", "2001")], [[100, 12], [0, 3]]);
  eq("bay partial: the line and GD line In Progress", [db.t.lines[0].line_status, db.t.lines[0].pending_process_qty, gdl(db, "600000").picking_status], ["In Progress", 2, "In Progress"]);
}

// ---------------------------------------------------------------- 3. a bin swap (not a bay org)
{
  const db = seed();
  const e = engine(db);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4002" }]);
  work(e, r.job_id);
  eq("bin swap: COMPLETED", [job(db, r.job_id).job_status, job(db, r.job_id).error_message || null], ["COMPLETED", null]);
  eq("bin swap: released at A-01, allocated at A-02", [bal(db, "4001", "2001"), bal(db, "4002", "2001")], [[105, 10], [95, 5]]);
  eq("bin swap: the old reservation closed, a new one at A-02", [res(db, "900000").status, created(db, r.job_id).map((c) => [c.bin_location, c.batch_id, c.reserved_qty])],
    ["Cancelled", [["4002", "2001", "5.00000000"]]]);
  eq("bin swap: the GD line allocated at A-02", [alloc(db, "600000"), /A-02: 5 PCS/.test(gdl(db, "600000").view_stock)], [[["4002", "2001", 5]], true]);
  eq("bin swap: the record", db.t.records.map((x) => [x.source_bin, x.target_location, x.batch_no, x.target_batch]), [["4001", "4002", "2001", "2001"]]);
}

// ---------------------------------------------------------------- 4. a batch swap
{
  const db = seed();
  const e = engine(db);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_batch_id: "2002" }]);
  work(e, r.job_id);
  eq("batch swap: COMPLETED", job(db, r.job_id).job_status, "COMPLETED");
  eq("batch swap: released in B1, allocated in B2", [bal(db, "4001", "2001"), bal(db, "4001", "2002")], [[105, 10], [95, 5]]);
  eq("batch swap: the GD line in batch B2", [alloc(db, "600000"), /\[Batch: B2\]/.test(gdl(db, "600000").view_stock)], [[["4001", "2002", 5]], true]);
  eq("batch swap: the record", db.t.records.map((x) => [x.batch_no, x.target_batch]), [["2001", "2002"]]);
}

// ---------------------------------------------------------------- 5. a swap onto SO Pending stock: reservations only, no stock movement
{
  const db = seed();
  db.t.res.push({ id: "950000", doc_type: "Sales Order", status: "Pending", parent_id: "7101", parent_line_id: "SL0", parent_no: "SO/1", doc_no: null, doc_id: null, doc_line_id: null,
    material_id: ITEM, item_code: ITEM, batch_id: "2001", bin_location: "4002", item_uom: UOM, reserved_qty: 5, delivered_qty: 0, open_qty: 5, target_gd_id: null, source_reserved_id: null,
    organization_id: ORG, plant_id: PLANT, is_deleted: 0 });
  const e = engine(db);
  e.st.replan["5001"] = { pending: true };
  const before = JSON.stringify(db.t.bal);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4002" }]);
  work(e, r.job_id);
  eq("pending swap: COMPLETED, no stock engine call at all", [job(db, r.job_id).job_status, modes(e), JSON.stringify(db.t.bal) === before], ["COMPLETED", [], true]);
  eq("pending swap: PM1 DONE without a movement", db.t.step.find((x) => x.job_id === r.job_id && x.step_name === "PM1_STOCK").result_ref, "no stock movement");
  eq("pending swap: the GD's reservation back to Pending, the SO's Pending row taken", [res(db, "900000").status, res(db, "900000").doc_line_id, res(db, "950000").status, res(db, "950000").doc_line_id,
    res(db, "950000").target_gd_id], ["Pending", null, "Allocated", "600000", "5001"]);
  eq("pending swap: the GD line at A-02", alloc(db, "600000"), [["4002", "2001", 5]]);
}

// ---------------------------------------------------------------- 6. Loading Bay without a bay bin
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  const r = submit(e, "PICK_ALL_REMAINING", []);
  eq("bay Auto Pick, no stored target: refused at SUBMIT, nothing written", [r.route, /Target Location is missing/.test(r.result_message), db.t.job.length, db.t.picking[0].is_processing],
    ["REJECT", true, 0, 0]);
  for (const l of db.t.lines) l.target_location = "4009";
  const r2 = submit(e, "PICK_ALL_REMAINING", []);
  eq("bay Auto Pick with stored bay bins: queued", r2.route, "QUEUED");
  db.t.lines[2].target_location = null; // cleared after SUBMIT
  const snap = snapshot(db);
  work(e, r2.job_id);
  eq("a bay bin cleared after SUBMIT: PREPARE refuses it (classic's text), unlocked, nothing written", [job(db, r2.job_id).job_status, job(db, r2.job_id).error_code,
    /Target Location is missing \(or the same as the source bin\) on these picked items: Item 2\./.test(job(db, r2.job_id).error_message), db.t.picking[0].is_processing, snapshot(db) === snap],
  ["FAILED", "PK_BAY_TARGET", true, 0, true]);
}

// ---------------------------------------------------------------- 7. no free stock at the target: FAILED at PLAN, nothing written
{
  const db = seed();
  db.t.bal[ITEM + "|4002|2001"].Unrestricted = 2;
  const e = engine(db);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4002" }]);
  const snap = snapshot(db);
  work(e, r.job_id);
  const j = job(db, r.job_id);
  eq("short stock: FAILED at PLAN with the engine's reason, unlocked", [j.job_status, j.error_code, /Insufficient quantity \(movement G000\.M2\)/.test(j.error_message), db.t.picking[0].is_processing],
    ["FAILED", "PK_STOCK_INSUFFICIENT", true, 0]);
  eq("short stock: nothing written, no APPLY", [snapshot(db) === snap, modes(e)], [true, ["PLAN"]]);
}

// ---------------------------------------------------------------- 8. a reservation changed after PREPARE: PM1 refuses before the stock moves
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }]);
  prepareOnly(e, r.job_id);
  eq("stale at PM1: prepared", job(db, r.job_id).job_status, "READY_TO_COMMIT");
  res(db, "900000").reserved_qty = 4; // someone else's save
  const snap = snapshot(db);
  db.advance(11 * 60);
  work(e, "");
  const j = job(db, r.job_id);
  eq("stale at PM1: FAILED PK_STALE, unlocked, no APPLY, nothing written", [j.job_status, j.error_code, /reservation 900000/.test(j.error_message), db.t.picking[0].is_processing, modes(e),
    snapshot(db) === snap], ["FAILED", "PK_STALE", true, 0, ["PLAN"], true]);
}
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  e.st.lockBusy = 1;
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }]);
  work(e, r.job_id);
  eq("stale at a PM1 retry: the first try waits for the lock", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, db.t.step.filter((x) => x.job_id === r.job_id && /^PM1_WAIT\|/.test(x.step_name)).length],
    ["COMMITTING_PICKING", "PK_LOCK_WAIT", 1]);
  gdl(db, "600000").temp_qty_data = JSON.stringify([{ material_id: ITEM, location_id: "4001", batch_id: "2001", gd_quantity: 4 }]); // a GD save while it waited
  db.advance(16);
  work(e, "");
  eq("stale at a PM1 retry: FAILED PK_STALE, unlocked, the stock never moved", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, db.t.picking[0].is_processing, bal(db, "4009", "2001")],
    ["FAILED", "PK_STALE", 0, [0, 0]]);
}

// ---------------------------------------------------------------- 9. the run dies right after the stock moved: replayed, never twice
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  e.st.crashAfterApply = 1;
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }, { row_id: "800001", qty: 5, target_location_id: "4009" }]);
  let threw = "";
  try { work(e, r.job_id); } catch (err) { threw = err.message; }
  eq("crash after PM1: the run died, the stock moved, no PM1 DONE", [/injected crash/.test(threw), job(db, r.job_id).job_status, bal(db, "4009", "2001"),
    db.t.step.some((x) => x.job_id === r.job_id && x.step_name === "PM1_STOCK")], [true, "COMMITTING_PICKING", [0, 10], false]);
  db.advance(11 * 60);
  work(e, "");
  eq("crash after PM1: resumed, REPLAYED, COMPLETED, moved once", [job(db, r.job_id).job_status, modes(e), e.st.applied, bal(db, "4001", "2001"), bal(db, "4009", "2001")],
    ["COMPLETED", ["PLAN", "APPLY", "APPLY"], 1, [100, 5], [0, 10]]);
  eq("crash after PM1: PM1 DONE from the replay", db.t.step.find((x) => x.job_id === r.job_id && x.step_name === "PM1_STOCK").result_ref, "REPLAYED Already applied");
}

// ---------------------------------------------------------------- 10. the run dies inside PM2 / PM3: written once, resumed
for (const [step, node] of [["PM2", "sql_node_PCpm2back"], ["PM3", "sql_node_PCpm3back"]]) {
  const db = seed({ bay: 1 });
  const e = engine(db, { [node]: 1 });
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }, { row_id: "800001", qty: 3, target_location_id: "4009" }]);
  let threw = "";
  try { work(e, r.job_id); } catch (err) { threw = err.message; }
  eq("crash in " + step + ": the run died after its writes", [/injected fault/.test(threw), job(db, r.job_id).job_status, created(db, r.job_id).length], [true, "COMMITTING_PICKING", 2]);
  db.advance(11 * 60);
  work(e, "");
  eq("crash in " + step + ": resumed to COMPLETED, each reservation created once, the lines once", [job(db, r.job_id).job_status, created(db, r.job_id).length,
    created(db, r.job_id).map((c) => c.reserved_qty), alloc(db, "600000"), alloc(db, "600001")],
  ["COMPLETED", 2, ["5.00000000", "3.00000000"], [["4009", "2001", 5]], [["4001", "2001", 2], ["4009", "2001", 3]]]);
  eq("crash in " + step + ": the step DONE once, the retry counted", [db.t.step.filter((x) => x.job_id === r.job_id && x.step_name === step + (step === "PM2" ? "_RESERVATIONS" : "_GD_ALLOC")).length,
    job(db, r.job_id).attempt_count], [1, 1]);
}

// ---------------------------------------------------------------- 11. a reservation changed between PM1 and PM2: review, the Picking stays locked
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  e.hooks = { sql_node_PCpm2facts: (ctx, eng) => { res(eng.db, "900000").status = "Delivered"; } };
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }]);
  work(e, r.job_id);
  const j = job(db, r.job_id);
  eq("PM2 conflict: REQUIRES_REVIEW, the Picking stays locked, the stock had moved", [j.job_status, j.error_code, /PM2_RESERVATIONS: 1 reservation\(s\) changed by someone else/.test(j.error_message),
    db.t.picking[0].is_processing, bal(db, "4009", "2001")], ["REQUIRES_REVIEW", "PK_RECONCILIATION_MISMATCH", true, 1, [0, 5]]);
}

// a GD save between PM2 and PM3 puts the reservation back at the source: PM3 must not write the line (review)
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  e.hooks = { sql_node_PCpm3facts: (ctx, eng) => {
    const r = res(eng.db, "900000");
    Object.assign(r, { status: "Allocated", open_qty: 5, target_gd_id: "5001", doc_id: "5001", doc_no: "GD/1", doc_line_id: "600000", item_uom: UOM, delivered_qty: 0 });
  } };
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }]);
  work(e, r.job_id);
  const j = job(db, r.job_id);
  eq("GD save between PM2 and PM3: REQUIRES_REVIEW, the line not written, the Picking locked", [j.job_status, /PM3_GD_ALLOC: 1 reservation\(s\) changed after they were written/.test(j.error_message),
    alloc(db, "600000"), db.t.picking[0].is_processing], ["REQUIRES_REVIEW", true, [["4001", "2001", 5]], 1]);
}

// ---------------------------------------------------------------- 12. the stock is locked by another operation
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  e.st.lockBusy = 5;
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }]);
  work(e, r.job_id);
  const waits = [];
  for (const sec of [15, 30, 60, 120]) {
    waits.push([job(db, r.job_id).job_status, job(db, r.job_id).next_attempt_at - db.now]);
    eq("lock busy: not due before the wait ends", (work(e, "") || {}).worker_route, "IDLE");
    db.advance(sec);
    work(e, "");
  }
  eq("lock busy: 4 waits of 15 / 30 / 60 / 120 s", waits, [["COMMITTING_PICKING", 15000], ["COMMITTING_PICKING", 30000], ["COMMITTING_PICKING", 60000], ["COMMITTING_PICKING", 120000]]);
  const j = job(db, r.job_id);
  eq("lock busy: the 5th answer -> FAILED, unlocked, nothing moved, retries untouched", [j.job_status, j.error_code, db.t.picking[0].is_processing, bal(db, "4009", "2001"), j.attempt_count,
    db.t.step.filter((x) => x.job_id === r.job_id && /^PM1_WAIT\|/.test(x.step_name)).map((x) => x.step_name)],
  ["FAILED", "PK_INVENTORY_LOCK_BUSY", 0, [0, 0], 0, ["PM1_WAIT|1", "PM1_WAIT|2", "PM1_WAIT|3", "PM1_WAIT|4"]]);
}
{
  const db = seed({ bay: 1 });
  const e = engine(db);
  e.st.lockBusy = 99;
  e.st.intentOnBusy = true;
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }]);
  work(e, r.job_id);
  for (let i = 0; i < 20 && job(db, r.job_id).job_status === "COMMITTING_PICKING"; i++) {
    db.advance(300);
    work(e, "");
  }
  const j = job(db, r.job_id);
  // engine v12: a 409 with the intent recorded is our own APPLY still held (up to 20 min) - wait it out, then review
  eq("lock busy after the engine recorded its intent: 8 waits, then review (never FAILED), the Picking locked",
    [j.job_status, j.error_code, db.t.picking[0].is_processing, db.t.step.filter((x) => x.job_id === r.job_id && /^PM1_WAIT\|/.test(x.step_name)).length],
    ["REQUIRES_REVIEW", "PK_RECONCILIATION_MISMATCH", 1, 8]);
}

// ---------------------------------------------------------------- 13. PREPARE's refusals
{
  const db = seed({ gds: 2, lines: 2 });
  const e = engine(db);
  e.st.replan["5002"] = { alsoUpdate: ["900000"] };
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4002" }, { row_id: "800002", qty: 5, target_location_id: "4002" }]);
  const snap = snapshot(db);
  work(e, r.job_id);
  eq("two GDs planning one reservation: FAILED PK_REPLAN, unlocked, nothing written", [job(db, r.job_id).job_status, job(db, r.job_id).error_message, db.t.picking[0].is_processing,
    snapshot(db) === snap, modes(e)], ["FAILED", "reservation 900000 would be changed by two deliveries at once (GD/1, GD/2); confirm them separately", 0, true, []]);
}
{
  const db = seed();
  const e = engine(db);
  e.st.replan["5001"] = { answer: { route: "NOT_ELIGIBLE", code: "GR_SERIAL", message: "Goods Delivery GD/1 has serial-numbered items: the classic save handles them" } };
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4002" }]);
  work(e, r.job_id);
  eq("the re-plan refuses the GD: FAILED with its reason", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, job(db, r.job_id).error_message],
    ["FAILED", "PK_REPLAN", "Goods Delivery GD/1: Goods Delivery GD/1 has serial-numbered items: the classic save handles them"]);
}
{
  const db = seed();
  const e = engine(db);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4002" }]);
  db.t.links.push({ target_doc_type: "Sales Order", link_status: "Linked", target_doc_id: "7101", is_deleted: 0 }); // linked after SUBMIT
  work(e, r.job_id);
  eq("linked to internal trading after SUBMIT: PREPARE refuses it", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, db.t.picking[0].is_processing], ["FAILED", "PK_NOT_SUPPORTED", 0]);
}
{
  const db = seed();
  const e = engine(db);
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4002" }]);
  db.t.picking.push({ id: "9002", to_id: "PI-2", to_status: "Created", is_processing: 1, is_deleted: 0, organization_id: ORG, plant_id: PLANT, gd_no: ["5001"] });
  db.t.job.push({ id: "77", organization_id: ORG, command: "CONFIRM_PICKING", job_status: "QUEUED", picking_id: "9002", idempotency_key: "OTHER-PICKING-0001", is_deleted: 0, create_time: db.now, row_version: 0 });
  work(e, r.job_id);
  eq("the GD confirmed on another Picking meanwhile: PREPARE refuses it", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, db.t.picking[0].is_processing], ["FAILED", "PK_BUSY", 0]);
}

// ---------------------------------------------------------------- 13b. the platform fails inside PREPARE's re-plan call
{
  const db = seed({ bay: 1 });
  const e = engine(db, { workflow_node_PPreplan: 1 });
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }]);
  try { work(e, r.job_id); } catch (err) { /* the run died inside PREPARE */ }
  eq("re-plan call dies once: the run died, nothing written", [job(db, r.job_id).job_status, bal(db, "4009", "2001"), db.t.records.length], ["VALIDATING", [0, 0], 0]);
  db.advance(11 * 60);
  work(e, "");
  eq("re-plan call dies once: the retry (a new nonce) completes, the first try's parts ignored", [job(db, r.job_id).job_status, job(db, r.job_id).attempt_count, bal(db, "4009", "2001"),
    created(db, r.job_id).length, new Set(db.t.step.filter((x) => x.job_id === r.job_id && /^MV\|/.test(x.step_name)).map((x) => x.step_name.split("|")[1])).size], ["COMPLETED", 1, [0, 5], 1, 2]);
}
{
  const db = seed({ bay: 1 });
  const e = engine(db, { workflow_node_PPreplan: 99 });
  const r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4009" }]);
  try { work(e, r.job_id); } catch (err) { /* died */ }
  for (let i = 0; i < 6 && !["FAILED", "COMPLETED", "REQUIRES_REVIEW"].includes(job(db, r.job_id).job_status); i++) {
    db.advance(11 * 60);
    try { work(e, ""); } catch (err) { /* died again */ }
  }
  eq("re-plan call always dies: retried, then FAILED + unlocked, nothing written", [job(db, r.job_id).job_status, db.t.picking[0].is_processing, bal(db, "4009", "2001"), db.t.records.length],
    ["FAILED", 0, [0, 0], 0]);
  console.log("     re-plan always dies:", JSON.stringify({ attempts: job(db, r.job_id).attempt_count, code: job(db, r.job_id).error_code, message: job(db, r.job_id).error_message }));
}

// ---------------------------------------------------------------- 14. Packing after a bay pick
{
  const db = seed({ bay: 1, packing: 1 });
  const e = engine(db);
  const r = submit(e, "PICK_ALL_REMAINING", []);
  eq("bay + Packing: refused without bay bins", r.route, "REJECT");
  const r2 = submit(e, "CONFIRM", [0, 1, 2].map((i) => ({ row_id: String(800000 + i), qty: 5, target_location_id: "4009" })));
  work(e, r2.job_id);
  eq("bay + Packing: COMPLETED, Picking Completed, P5 DONE", [job(db, r2.job_id).job_status, db.t.picking[0].to_status, db.t.step.some((x) => x.job_id === r2.job_id && x.step_name === "P5_PACKING")],
    ["COMPLETED", "Completed", true]);
  eq("bay + Packing: one source row per GD line, fully picked", (db.t.packing[0] || { table_item_source: [] }).table_item_source.map((x) => [x.picked_qty, x.line_status]),
    [[5, "Fully Picked"], [5, "Fully Picked"], [5, "Fully Picked"]]);
  console.log("     packing source row 1:", JSON.stringify((db.t.packing[0] || { table_item_source: [{}] }).table_item_source[0]).slice(0, 600));
}

// ---------------------------------------------------------------- 16. finished_at is the run's real end, not its start
// each run's entry reads the DB clock; the clock is then moved 30 s, so every end stamp of that run must read entry + 30 s
const clocked = (db, fn) => {
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => Date.UTC(2026, 9, 16, 2, 0, 0) + skew;
  try {
    return fn((e) => {
      const rec = e.record.bind(e);
      e.record = (n, ctx, data) => { rec(n, ctx, data); if (n.id === "code_node_PCentry" || n.id === "code_node_PPentry") skew += 30000; };
      return e;
    });
  } finally {
    Date.now = realNow;
  }
};
{
  const db = seed({ bay: 1 });
  const at30 = db.fmt(db.now + 30000);
  const r = clocked(db, (tick) => {
    const e = tick(engine(db));
    const q = submit(e, "CONFIRM", [0, 1, 2].map((i) => ({ row_id: String(800000 + i), qty: 5, target_location_id: "4009" })));
    work(e, q.job_id);
    return q;
  });
  const j = job(db, r.job_id);
  const steps = db.t.step.filter((x) => x.job_id === r.job_id && x.step_status === "DONE" && /^P/.test(x.step_name));
  eq("finished_at: the COMPLETED job reads entry + 30 s", [j.job_status, j.finished_at], ["COMPLETED", at30]);
  eq("finished_at: every DONE step row reads entry + 30 s", steps.filter((x) => x.finished_at !== at30).map((x) => x.step_name + " " + x.finished_at), []);
}
{
  const db = seed();
  db.t.bal[ITEM + "|4002|2001"].Unrestricted = 2;
  const at30 = db.fmt(db.now + 30000);
  const r = clocked(db, (tick) => {
    const e = tick(engine(db));
    const q = submit(e, "CONFIRM", [{ row_id: "800000", qty: 5, target_location_id: "4002" }]);
    work(e, q.job_id);
    return q;
  });
  const j = job(db, r.job_id);
  eq("finished_at: FAILED at the end of PREPARE reads entry + 30 s", [j.job_status, j.error_code, j.finished_at], ["FAILED", "PK_STOCK_INSUFFICIENT", at30]);
}

// ---------------------------------------------------------------- 15. size: 25 GDs, 500 moved lines (the cap), one confirmation
if (process.env.SIZES) {
  const db = seed({ bay: 1, gds: 25, lines: 20 });
  const e = engine(db);
  const t0 = Date.now();
  const r = submit(e, "CONFIRM", db.t.lines.map((l) => ({ row_id: l.id, qty: 5, target_location_id: "4009" })));
  eq("size: queued", r.route, "QUEUED");
  // one worker tick = one synchronous chain: every run's node data summed (the stubbed sub-runs count 0 here)
  let chain = 0;
  const run1 = e.run;
  e.run = (name, params) => { const x = run1(name, params); chain += ((x.ctx && x.ctx.bytes) || 0) + ((x.ctx && x.ctx.bytesIn) || 0); return x; };
  work(e, r.job_id);
  e.run = run1;
  const mb = (b) => Math.round(b / 1024 / 1024 * 10) / 10;
  console.log("     size run node data (MB), outputs + injected inputs:", Object.keys(e.sizes).map((k) => k + " " + mb(e.sizes[k]) + " + " + mb(e.sizesIn[k] || 0)).join(", "),
    "| GD_REPLAN answer (largest) " + mb(e.st.replanBytes) + " MB | sim", Date.now() - t0, "ms");
  console.log("     largest injected inputs (MB): " + Object.entries(e.inByNode).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => k.replace("PICKING_BULK_", "") + " " + mb(v)).join(", "));
  console.log("     worker tick chain (MB): " + mb(chain) + " measured + ~2.8 GD_REPLAN runs (2.8 MB / 499 lines, T3) + ~4.2 per engine run x 2 (GD Completed V2's APPLY: 8.4 MB at ~2,000 movements)");
  eq("size: COMPLETED, 25 re-plans, the stock moved once", [job(db, r.job_id).job_status, e.st.replanCalls, modes(e), bal(db, "4009", "2001")], ["COMPLETED", 25, ["PLAN", "APPLY"], [0, 2500]]);
  eq("size: 500 reservations created, 500 GD lines at the bay", [created(db, r.job_id).length, db.t.gdl.filter((l) => /"location_id":"4009"/.test(l.temp_qty_data)).length], [500, 500]);
  truthy("size: the worker's chain (every run, outputs + injected inputs, sub-runs stood in) < 40 MB", chain < 40 * 1024 * 1024, mb(chain));
  truthy("size: every run's node data (outputs + injected inputs) < 30 MB", Object.keys(e.sizes).every((k) => e.sizes[k] + (e.sizesIn[k] || 0) < 30 * 1024 * 1024),
    Object.keys(e.sizes).map((k) => k + " " + mb(e.sizes[k] + (e.sizesIn[k] || 0))));
}
done();
