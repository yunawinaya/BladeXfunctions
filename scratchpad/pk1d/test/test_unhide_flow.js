// test_unhide_flow.js: end to end on the 1c sim (SUBMIT -> WORKER -> PREPARE -> COMMIT A -> COMMIT B). The GD's save-time Packing
// shell is kept hidden (HIDDEN, default Processing) until something is picked; P5 fills it and must make it visible. A Packing
// already being packed keeps its status. PK_OUT=<dir> runs another build (v15 leaves the shell hidden).
const path = require("path");
const { Engine } = require(path.join(__dirname, "../../pk1c/sim/engine.js"));
const { DB, mocks } = require(path.join(__dirname, "../../pk1c/sim/db.js"));
const { install, switches } = require(path.join(__dirname, "../../pk1c/sim/stubs.js"));
const { eq, done } = require(path.join(__dirname, "../../gdc/pkv2tools/harness.js"));
const DIR = process.env.PK_OUT || path.join(__dirname, "../../../Picking/AsyncV2");
const HIDDEN = process.env.HIDDEN || "Processing";
const ORG = "1901545950162329602";

function flow(packingStatus) {
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
  db.t.packing.push({ id: "PK1", gd_id: "5001", packing_status: packingStatus, idempotency_key: "PKG|5001", table_item_source: [], table_hu_source: [], is_deleted: 0 });
  const e = new Engine({ dir: DIR, db: db, mocks: mocks() });
  install(e);
  switches(e, true);
  const r = e.run("PICKING_ASYNC_SUBMIT", { picking_id: "9001", organization_id: ORG, operation: "PICK_ALL_REMAINING", idempotency_key: "KEY-0000000000000201",
    payload: JSON.stringify({ lines: [] }), confirmed_by: "picker" }).returned;
  e.run("PICKING_ASYNC_WORKER", { job_id: r.job_id });
  const job = db.t.job.find((j) => j.id === r.job_id);
  return [job.job_status, db.t.picking[0].to_status, db.t.packing.length, db.t.packing[0].packing_status, db.t.packing[0].table_item_source.length];
}

eq("hidden shell: filled and made visible (one Packing, Created, 3 rows)", flow(HIDDEN), ["COMPLETED", "Completed", 1, "Created", 3]);
eq("a Packing being packed: refreshed, status kept", flow("In Progress"), ["COMPLETED", "Completed", 1, "In Progress", 3]);
eq("a visible Created shell: refreshed, still Created", flow("Created"), ["COMPLETED", "Completed", 1, "Created", 3]);
done();
