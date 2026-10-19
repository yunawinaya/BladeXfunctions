// End to end on the generated JSON: SUBMIT -> WORKER (-> PREPARE -> COMMIT -> COMMIT after SPLIT) on an in-memory DB.
const path = require("path");
const { Engine } = require("./engine");
const { DB, mocks } = require("./db");
const { eq, truthy, done } = require("../harness");

const DIR = process.env.PK_OUT || "/Users/yunawinaya/Developer/BladeXfunctions/Picking/AsyncV2";
const ORG = "1901545950162329602";

function seed(nLines, opts) {
  const o = Object.assign({ shell: true, autoGd: 0, picked: 0 }, opts || {});
  const db = new DB();
  db.t.setup.push({ id: "1", organization_id: ORG, picking_after: "Goods Delivery", allow_full_picking: 0, auto_completed_gd: o.autoGd, is_loading_bay: null });
  db.t.setup.push({ id: "2", organization_id: ORG, picking_after: "Sales Order", allow_full_picking: 1, auto_completed_gd: 1, is_loading_bay: 1 }); // a second plant: ignored (first row wins, as PICKING)
  db.t.psetup.push({ id: "1", organization_id: ORG, packing_required: 1, auto_trigger_pkg: 1, packing_mode: "Basic" });
  db.t.rules.push({ id: "R2", department_id: ORG, is_default: 0, is_draft: 1 }, { id: "R1", department_id: ORG, is_default: 1, is_draft: 0 });
  db.t.gd.push({ id: "5001", gd_status: "Created", picking_status: "Created", delivery_no: "GD/1", so_id: ["7001"], so_no: "SO/1", customer_name: "C1", plant_id: "P1", organization_id: ORG, order_remark: "", di_driver_name: "GD driver" });
  db.t.so.push({ id: "7001", customer_name: "C1", cust_billing_address: "A", cust_shipping_address: "B" });
  db.t.items.push({ id: "IT", based_uom: "12001" });
  db.t.uom.push({ item_id: "IT", alt_uom_id: "12002", base_qty: 12 });
  const p = { id: "9001", to_id: "PI-1", to_status: "Created", is_processing: 0, is_deleted: 0, organization_id: ORG, plant_id: "P1", is_loading_bay: 0, gd_no: ["5001"], delivery_no: "GD/1", so_no: "SO/1", created_by: "admin", customer_id: ["C1"], remarks: "orig", di_driver_name: "PK driver", update_time: db.now + 8 * 3600 * 1000 - 3600 * 1000 };
  db.t.picking.push(p);
  for (let i = 0; i < nLines; i++) {
    const gl = "6" + String(i).padStart(5, "0");
    const qty = (i % 3) + 1;
    db.t.gdl.push({ id: gl, goods_delivery_id: "5001", material_id: "IT", material_name: "Item " + i, gd_qty: qty, picking_status: "Created", temp_qty_data: JSON.stringify([{ material_id: "IT", location_id: "B1", batch_id: "", gd_quantity: String(qty) }]), good_delivery_uom_id: "12001", line_so_id: "7001", line_so_no: "SO/1", so_line_item_id: "SL" + i });
    db.t.lines.push({ id: "8" + String(i).padStart(5, "0"), transfer_order_id: "9001", item_code: "IT", item_name: "Item " + i, item_desc: "", more_desc: "", item_uom: "12001", qty_to_pick: qty, pending_process_qty: qty, picked_qty: 0, line_status: "Open", gd_id: "5001", gd_no: "GD/1", gd_line_id: gl, so_id: "7001", so_no: "SO/1", so_line_id: "SL" + i, source_bin: "B1", batch_no: null, row_type: "item", packing_conversion: 1, weight_conversion: 0.5, remark: "" });
  }
  if (o.shell) db.t.packing.push({ id: "PK-SHELL", gd_id: "5001", packing_status: "Created", is_deleted: 0, table_item_source: [], table_hu_source: [] });
  return db;
}

const engine = (db, faults) => new Engine({ dir: DIR, db: db, mocks: mocks(), faults: faults });
const submit = (e, op, lines, key, extra) => e.run("PICKING_ASYNC_SUBMIT", Object.assign({ picking_id: "9001", organization_id: ORG, operation: op, idempotency_key: key, payload: JSON.stringify({ lines: lines || [], header_patch: { remarks: "edited on the form", di_driver_name: "Ali" } }), confirmed_by: "picker" }, extra || {})).returned;
const work = (e, jobId) => e.run("PICKING_ASYNC_WORKER", { job_id: jobId || "" }).returned;
const job = (db, id) => db.t.job.find((j) => j.id === id);
const line = (db, id) => db.t.lines.find((l) => l.id === id);

// ---------------------------------------------------------------- 1. confirm 2 of 5 lines
let db = seed(5);
let e = engine(db);
let r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 1 }, { row_id: "800001", qty: 1, pick_uom: "12001", remark: "r" }], "KEY-0000000000000001");
eq("submit: QUEUED + lock", [r.route, r.result_code, r.job_status, db.t.picking[0].is_processing], ["QUEUED", "200", "QUEUED", 1]);
const jobA = r.job_id;
let r2 = submit(e, "CONFIRM", [{ row_id: "800000", qty: 1 }], "KEY-0000000000000001");
eq("submit again with the same key: the same job, nothing new", [r2.route, r2.job_id, db.t.job.length], ["EXISTING", jobA, 1]);
let r3 = submit(e, "CONFIRM", [{ row_id: "800002", qty: 1 }], "KEY-0000000000000002");
eq("a second click while the job is open: refused", [r3.route, r3.result_code], ["REJECT", "400"]);
let w = work(e, jobA);
eq("worker: job COMPLETED, lock released", [job(db, jobA).job_status, db.t.picking[0].is_processing, w.worker_route], ["COMPLETED", 0, "WORKED"]);
eq("records: 2 with job keys, picked_uom, remark", db.t.records.map((x) => [x.job_line_key, x.store_out_qty, x.picked_uom, x.remark, x.confirmed_by]), [[jobA + "|800000|0", 1, "12001", "", "picker"], [jobA + "|800001|0", 1, "12001", "r", "picker"]]);
eq("lines: 800000 Completed (qty 1), 800001 In Progress (1 of 2), picked_qty 0", [line(db, "800000").line_status, line(db, "800001").line_status, line(db, "800001").pending_process_qty, line(db, "800001").picked_qty], ["Completed", "In Progress", 1, 0]);
eq("Picking In Progress, header patch written", [db.t.picking[0].to_status, db.t.picking[0].remarks, db.t.picking[0].di_driver_name], ["In Progress", "edited on the form", "Ali"]);
eq("GD lines: Completed / In Progress; GD header In Progress", [db.t.gdl[0].picking_status, db.t.gdl[1].picking_status, db.t.gdl[2].picking_status, db.t.gd[0].picking_status], ["Completed", "In Progress", "Created", "In Progress"]);
eq("prev_temp_qty_data = the allocation", db.t.gdl[0].prev_temp_qty_data, db.t.gdl[0].temp_qty_data);
eq("steps DONE", db.t.step.filter((x) => x.job_id === jobA && x.step_name[0] === "P").map((x) => x.step_name).sort(), ["P0_REVALIDATE", "P1_PICKING", "P3_GD_LINES", "P4_GD_HEADERS"]);
eq("no Packing change while the Picking is not Completed", db.t.packing[0].table_item_source, []);

const status = (e) => e.run("PICKING_ASYNC_SUBMIT", { picking_id: "9001", organization_id: ORG, operation: "STATUS" }).returned;
let st = status(e);
eq("STATUS: the latest job, read only", [st.route, st.job_id, st.job_status, st.result_message, db.t.job.length], ["STATUS", jobA, "COMPLETED", "Picking processed successfully", 1]);

// ---------------------------------------------------------------- 2. the list action: pick everything left
r = submit(e, "PICK_ALL_REMAINING", [], "KEY-0000000000000003");
eq("pick-all queued", r.route, "QUEUED");
w = work(e, r.job_id);
eq("pick-all: COMPLETED; Picking Completed; GD header Completed", [job(db, r.job_id).job_status, db.t.picking[0].to_status, db.t.gd[0].picking_status], ["COMPLETED", "Completed", "Completed"]);
eq("records: 2 + 4 (800001 rest 1, 800002..4)", db.t.records.length, 6);
eq("header untouched by the list action (no patch)", db.t.picking[0].remarks, "edited on the form");
const pk = db.t.packing[0];
eq("Packing: the shell refreshed (no new Packing), one source row per GD line, picked from ALL records", [db.t.packing.length, pk.table_item_source.length, pk.table_item_source.map((x) => x.picked_qty), pk.table_item_source.map((x) => x.line_status)],
  [1, 5, [1, 2, 3, 1, 2], ["Fully Picked", "Fully Picked", "Fully Picked", "Fully Picked", "Fully Picked"]]);
eq("Packing Delivery Info from the Picking (single GD)", pk.di_driver_name, "Ali");
eq("P5 DONE", db.t.step.some((x) => x.job_id === r.job_id && x.step_name === "P5_PACKING"), true);

// ---------------------------------------------------------------- 3. no shell: the Packing is created with the rule
db = seed(3, { shell: false });
e = engine(db);
r = submit(e, "PICK_ALL_REMAINING", [], "KEY-0000000000000004");
work(e, r.job_id);
eq("created Packing: issued + the doc rule (not the draft one), PKG|<gd>, Created", [db.t.packing.length, db.t.packing[0].packing_no_type, db.t.packing[0].idempotency_key, db.t.packing[0].packing_status, db.t.packing[0].table_item_source.length], [1, "R1", "PKG|5001", "Created", 3]);

// ---------------------------------------------------------------- 4. alternate unit + clamp
db = seed(2);
e = engine(db);
line(db, "800000").qty_to_pick = 24;
line(db, "800000").pending_process_qty = 24;
r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 3, pick_uom: "12002" }], "KEY-0000000000000005");
work(e, r.job_id);
eq("3 BOX = 36 PCS clamped to 24 / 2 BOX; message on the job", [db.t.records[0].store_out_qty, db.t.records[0].picked_qty_alt, db.t.records[0].picked_uom, job(db, r.job_id).error_code, /reduced/.test(job(db, r.job_id).progress_message)], [24, 2, "12002", "PK_CLAMPED", true]);

r = submit(e, "CONFIRM", [{ row_id: "800001", qty: 1, pick_uom: "BOX" }], "KEY-0000000000000012");
eq("a unit that is not an id is refused, not dropped", [r.route, r.result_code, /pick_uom is not an id/.test(r.result_message)], ["REJECT", "400", true]);

db = seed(2);
e = engine(db);
line(db, "800000").target_location = "B9";
r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 1, target_location_id: "" }], "KEY-0000000000000013");
work(e, r.job_id);
eq("the form cleared the stored move (sent empty): picked from the source bin", [job(db, r.job_id).job_status, db.t.records[0].target_location], ["COMPLETED", "B1"]);
r = submit(e, "CONFIRM", [{ row_id: "800001", qty: 1 }], "KEY-0000000000000014");
line(db, "800001").target_location = "B9";
work(e, r.job_id);
eq("no target sent + a stored move: refused before any write (stage 1c), lock released", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, db.t.records.length, db.t.picking[0].is_processing], ["FAILED", "PK_NOT_SUPPORTED", 1, 0]);

// ---------------------------------------------------------------- 5. a crash after the Picking write: resumed, no duplicate record
db = seed(4);
e = engine(db, { sql_node_PCp1back: 1 });
r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 1 }, { row_id: "800003", qty: 1 }], "KEY-0000000000000006");
let threw = null;
try { work(e, r.job_id); } catch (err) { threw = err.message; }
eq("crash after P1 write: run died, job COMMITTING with a live lease, records written", [/injected fault/.test(threw || ""), job(db, r.job_id).job_status, db.t.records.length, db.t.picking[0].is_processing], [true, "COMMITTING_PICKING", 2, 1]);
w = work(e, "");
eq("next tick before the lease ends: nothing to do", w.worker_route, "IDLE");
db.advance(11 * 60);
w = work(e, "");
eq("after the lease: resumed to COMPLETED, still 2 records, retry counted", [job(db, r.job_id).job_status, db.t.records.length, job(db, r.job_id).attempt_count, db.t.picking[0].is_processing], ["COMPLETED", 2, 1, 0]);

// ---------------------------------------------------------------- 6. the Picking changed between PREPARE and COMMIT -> FAILED, nothing written
db = seed(3);
e = engine(db);
r = submit(e, "CONFIRM", [{ row_id: "800001", qty: 1 }], "KEY-0000000000000007");
e.run("PICKING_ASYNC_WORKER", { job_id: "" }); // full run: we need the stale case, so stop it after PREPARE by hand instead
db = seed(3);
e = engine(db, {});
r = submit(e, "CONFIRM", [{ row_id: "800001", qty: 1 }], "KEY-0000000000000008");
// claim + prepare only: run the worker with the COMMIT call made to fail once (it never wrote: READY_TO_COMMIT stays)
e.faults = { workflow_node_PWpub: 1 };
try { work(e, r.job_id); } catch (err) { /* the run died at the publish call */ }
eq("prepared, not committed", job(db, r.job_id).job_status, "READY_TO_COMMIT");
line(db, "800001").pending_process_qty = 0;
line(db, "800001").line_status = "Completed";
db.advance(11 * 60);
work(e, "");
st = e.run("PICKING_ASYNC_SUBMIT", { picking_id: "9001", organization_id: ORG, operation: "STATUS" }).returned;
eq("STATUS of a failed job: its reason", [st.job_status, st.result_code, /changed after it was queued/.test(st.result_message)], ["FAILED", "PK_STALE", true]);
eq("P0 stale: FAILED, lock released, no record", [job(db, r.job_id).job_status, job(db, r.job_id).error_code, db.t.picking[0].is_processing, db.t.records.length], ["FAILED", "PK_STALE", 0, 0]);

// ---------------------------------------------------------------- 7. not eligible: auto complete GD -> the form runs the old save
db = seed(2, { autoGd: 1 });
e = engine(db);
r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 1 }], "KEY-0000000000000009");
eq("auto complete GD -> NOT_ELIGIBLE, nothing written", [r.route, r.result_code, db.t.job.length, db.t.picking[0].is_processing], ["NOT_ELIGIBLE", "NOT_ELIGIBLE", 0, 0]);

// ---------------------------------------------------------------- 8. 2,000 lines: confirm 3, then the rest
db = seed(2000);
e = engine(db);
r = submit(e, "CONFIRM", [{ row_id: "800000", qty: 1 }, { row_id: "800001", qty: 2 }, { row_id: "800002", qty: 3 }], "KEY-0000000000000010");
let t0 = Date.now();
work(e, r.job_id);
eq("2k: 3 lines -> COMPLETED", [job(db, r.job_id).job_status, db.t.records.length], ["COMPLETED", 3]);
r = submit(e, "PICK_ALL_REMAINING", [], "KEY-0000000000000011");
work(e, r.job_id);
eq("2k: the rest -> COMPLETED, 2,000 records, Picking + GD Completed, Packing 2,000 rows", [job(db, r.job_id).job_status, db.t.records.length, db.t.picking[0].to_status, db.t.gd[0].picking_status, db.t.packing[0].table_item_source.length], ["COMPLETED", 2000, "Completed", "Completed", 2000]);
const mb = (b) => Math.round(b / 1024 / 1024 * 10) / 10;
console.log("     largest run node data (MB):", Object.keys(e.sizes).map((k) => k + " " + mb(e.sizes[k])).join(", "), "| sim time", Date.now() - t0, "ms");
truthy("2k: every run's node data < 20 MB (cap 64 MB)", Object.values(e.sizes).every((b) => b < 20 * 1024 * 1024));
eq("2k: GD line slices of 250", e.trace.filter((x) => x.endsWith("update_node_PCp3write")).length, 1 + 8);

done();
