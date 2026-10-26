// test_header_race_flow.js: end to end on the 1c sim (SUBMIT -> WORKER -> PREPARE -> COMMIT phase A -> COMMIT phase B),
// the outcome of LSH PI-2610-3697 (10-26): a second confirm of the same Picking committed at the same moment and wrote the
// header In Progress after our phase A. Our phase B must still leave the Picking Completed and P5 must fill the Packing.
// The first phase-B read (the header re-check, or on v14 P5's header read) rewrites the header to In Progress once, as that
// late write did. PK_OUT=<dir> runs another build (v14 fails both checks).
const path = require("path");
const { Engine } = require(path.join(__dirname, "../../pk1c/sim/engine.js"));
const { DB, mocks } = require(path.join(__dirname, "../../pk1c/sim/db.js"));
const { install, switches } = require(path.join(__dirname, "../../pk1c/sim/stubs.js"));
const { eq, done } = require(path.join(__dirname, "../../gdc/pkv2tools/harness.js"));
const DIR = process.env.PK_OUT || path.join(__dirname, "../../../Picking/AsyncV2");
const ORG = "1901545950162329602";

const db = new DB();
db.t.setup.push({ id: "1", organization_id: ORG, picking_after: "Goods Delivery", allow_full_picking: 0, auto_completed_gd: 0, is_loading_bay: null });
db.t.psetup.push({ id: "1", organization_id: ORG, packing_required: 1, auto_trigger_pkg: 1, packing_mode: "Basic" });
db.t.rules.push({ id: "R1", department_id: ORG, is_default: 1, is_draft: 0 });
db.t.gd.push({ id: "5001", gd_status: "Created", picking_status: "Created", delivery_no: "GD/1", so_id: ["7001"], so_no: "SO/1", customer_name: "C1", plant_id: "P1",
  organization_id: ORG, order_remark: "", is_deleted: 0 });
db.t.so.push({ id: "7001", customer_name: "C1", cust_billing_address: "A", cust_shipping_address: "B" });
db.t.items.push({ id: "IT", based_uom: "12001" });
db.t.picking.push({ id: "9001", to_id: "PI-1", to_status: "Created", is_processing: 0, is_deleted: 0, organization_id: ORG, plant_id: "P1", is_loading_bay: 0, gd_no: ["5001"],
  delivery_no: "GD/1", so_no: "SO/1", created_by: "admin", customer_id: ["C1"], update_time: db.now });
for (let i = 0; i < 3; i++) {
  const gl = "60000" + i, qty = i + 1;
  db.t.gdl.push({ id: gl, goods_delivery_id: "5001", material_id: "IT", material_name: "Item " + i, gd_qty: qty, picking_status: "Created", good_delivery_uom_id: "12001",
    temp_qty_data: JSON.stringify([{ material_id: "IT", location_id: "B1", batch_id: null, gd_quantity: qty }]), line_so_id: "7001", line_so_no: "SO/1", so_line_item_id: "S" + i,
    plant_id: "P1", organization_id: ORG });
  db.t.lines.push({ id: "80000" + i, transfer_order_id: "9001", gd_id: "5001", gd_no: "GD/1", gd_line_id: gl, item_code: "IT", item_name: "Item " + i, item_uom: "12001",
    qty_to_pick: qty, pending_process_qty: qty, picked_qty: 0, line_status: "Open", so_id: "7001", so_no: "SO/1", customer_id: "C1", source_bin: "B1", parent_id: null });
}
db.t.packing.push({ id: "PK1", gd_id: "5001", packing_status: "Created", idempotency_key: "PKG|5001", table_item_source: [], table_hu_source: [], is_deleted: 0 });

const m = mocks();
let lateWrite = 0;
const late = (name) => {
  const orig = m.sql[name];
  m.sql[name] = (text, ctx, e) => {
    if (!lateWrite) { lateWrite = 1; e.db.t.picking[0].to_status = "In Progress"; }
    return orig(text, ctx, e);
  };
};
if (m.sql.sql_node_PCbhdr) late("sql_node_PCbhdr");
late("sql_node_PCp5hdr");
const e = new Engine({ dir: DIR, db: db, mocks: m });
install(e);
switches(e, true);

const r = e.run("PICKING_ASYNC_SUBMIT", { picking_id: "9001", organization_id: ORG, operation: "PICK_ALL_REMAINING", idempotency_key: "KEY-0000000000000101",
  payload: JSON.stringify({ lines: [] }), confirmed_by: "picker" }).returned;
eq("pick-all queued", r.route, "QUEUED");
e.run("PICKING_ASYNC_WORKER", { job_id: r.job_id });
const job = db.t.job.find((j) => j.id === r.job_id);
eq("the late In Progress write happened between phase A and phase B", lateWrite, 1);
eq("job COMPLETED, every row Completed, lock released", [job.job_status, db.t.lines.map((l) => l.line_status), db.t.picking[0].is_processing],
  ["COMPLETED", ["Completed", "Completed", "Completed"], 0]);
eq("the Picking ends Completed (the header re-check promoted it)", db.t.picking[0].to_status, "Completed");
eq("P5 filled the Packing: one source row per picked line", db.t.packing[0].table_item_source.length, 3);
done();
