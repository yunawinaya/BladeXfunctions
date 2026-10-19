// Test data for SA_V2_SUBMIT on the interpreter: ids, items, bins, balances, costing rows, the SA numbering rule; builders of
// Stock Adjustment form records, stored Drafts, Stock Count records (form + stored).
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const PLANT2 = "1123598813738675299";
const RULE = "2026902921863950338";
const UOM = "2300000000000000001";
const ITEM = { A: "2100000000000000001", B: "2100000000000000002", SER: "2100000000000000003", NOSTK: "2100000000000000004", BAT: "2100000000000000005",
  MIG: "2100000000000000006" };
const BIN = { b1: "2200000000000000001", b2: "2200000000000000002", b3: "2200000000000000003" };
const BATCH = { x: "2400000000000000001", y: "2400000000000000002" };

function seed(db) {
  db.t.items.push(
    { id: ITEM.A, material_code: "FG-A", material_name: "Widget A", serial_number_management: 0, material_costing_method: "Weighted Average", stock_control: 1,
      item_batch_management: 0, purchase_unit_price: 2.5 },
    { id: ITEM.B, material_code: "FG-B", material_name: "Widget B", serial_number_management: 0, material_costing_method: "First In First Out", stock_control: 1,
      item_batch_management: 0, purchase_unit_price: 4 },
    { id: ITEM.SER, material_code: "FG-SER", material_name: "Serial thing", serial_number_management: 1, material_costing_method: "First In First Out", stock_control: 1,
      item_batch_management: 0 },
    { id: ITEM.NOSTK, material_code: "SVC-1", material_name: "Service", serial_number_management: 0, material_costing_method: "Weighted Average", stock_control: 0,
      item_batch_management: 0 },
    { id: ITEM.BAT, material_code: "FG-BAT", material_name: "Batch thing", serial_number_management: 0, material_costing_method: "Weighted Average", stock_control: 1,
      item_batch_management: 1 },
    { id: ITEM.MIG, material_code: "FG-MIG", material_name: "Migrating", serial_number_management: 0, material_costing_method: "First In First Out", stock_control: 1,
      item_batch_management: 0 });
  db.t.wa.push({ material_id: ITEM.A, batch_id: null, plant_id: PLANT, organization_id: ORG, wa_cost_price: 3 },
    { material_id: ITEM.BAT, batch_id: BATCH.x, plant_id: PLANT, organization_id: ORG, wa_cost_price: 7 },
    { material_id: ITEM.MIG, batch_id: null, plant_id: PLANT, organization_id: ORG, wa_cost_price: 1 });
  db.t.fifo.push({ material_id: ITEM.B, batch_id: null, plant_id: PLANT, organization_id: ORG, fifo_cost_price: 4 },
    { material_id: ITEM.MIG, batch_id: null, plant_id: PLANT, organization_id: ORG, fifo_cost_price: 1 });
  db.t.bins.push({ id: BIN.b1, bin_location_combine: "A1-B1", plant_id: PLANT }, { id: BIN.b2, bin_location_combine: "A1-B2", plant_id: PLANT },
    { id: BIN.b3, bin_location_combine: "A1-B3", plant_id: PLANT });
  db.t.uoms.push({ id: UOM, uom_name: "UNIT" });
  db.t.batches.push({ id: BATCH.x, batch_number: "LOT-X" }, { id: BATCH.y, batch_number: "LOT-Y" });
  db.t.rules.push({ id: RULE, department_id: ORG, is_default: 1, is_draft: 0, rule_name: "SA 1" });
  db.t.bal.push({ id: "2500000000000000001", material_id: ITEM.B, plant_id: PLANT, location_id: BIN.b2, balance_quantity: 10, unrestricted_qty: 10, organization_id: ORG },
    { id: "2500000000000000002", material_id: ITEM.A, plant_id: PLANT, location_id: BIN.b1, balance_quantity: 5, unrestricted_qty: 5, organization_id: ORG });
  return db;
}

// one balance_index entry (the SA form's dialog shape)
function ent(material, bin, qty, mt, extra) {
  return Object.assign({ balance_id: null, material_id: material, plant_id: PLANT, location_id: bin, batch_id: null, balance_quantity: 0, unrestricted_qty: 0, block_qty: 0,
    qualityinsp_qty: 0, reserved_qty: 0, intransit_qty: 0, organization_id: ORG, is_deleted: 0, category: "Unrestricted", movement_type: mt || "In", sa_quantity: qty },
  extra || {});
}
function line(material, entries, extra) {
  const total = entries.reduce((t, e) => t + (Number(e.sa_quantity) > 0 ? Number(e.sa_quantity) : 0), 0);
  return Object.assign({ material_id: material, material_name: "item " + material.slice(-2), uom_id: UOM, total_quantity: total, unit_price: 5,
    balance_index: JSON.stringify(entries), item_category: "2018905941675634689", is_serialized_item: 0, adj_summary: "Total: " + total + " UNIT", item_remark: "r" },
  extra || {});
}
function saForm(o) {
  const x = o || {};
  const f = { organization_id: ORG, plant_id: PLANT, adjustment_date: "2026-10-16 00:00:00", adjustment_type: "Write Off", adjusted_by: "tester",
    adjustment_no: x.no === undefined ? "" : x.no, adjustment_no_type: x.noType === undefined ? RULE : x.noType, stock_adjustment_status: x.status || "Draft",
    acc_integration_type: "SQL Accounting V2", reference_documents: [], adjustment_remarks: "remark 1", adjustment_remarks2: "", adjustment_remarks3: "",
    page_status: x.page || "Add", stock_adjustment: x.lines || [line(ITEM.A, [ent(ITEM.A, BIN.b1, 3, "In")]), line(ITEM.B, [ent(ITEM.B, BIN.b2, 2, "Out")])] };
  if (x.id) f.id = x.id;
  return Object.assign(f, x.extra || {});
}
// a stored Draft (header + lines, as the classic Draft path left it: filled back, line ids)
function storeSa(db, o) {
  const x = o || {};
  const id = x.id || db.id();
  const form = saForm(Object.assign({ status: x.status || "Draft", no: x.no === undefined ? "SA-DRAFT-0007" : x.no, page: "Edit" }, x));
  const lines = form.stock_adjustment.map((l, i) => Object.assign({}, l, { id: db.id(), line_index: i + 1, plant_id: PLANT, unit_price: Number((parseFloat(l.unit_price) || 0).toFixed(8)) }));
  db.t.sa.push(Object.assign({}, form, { id: id, stock_adjustment: undefined, is_deleted: 0, sa_v2_job_id: x.jobId || null, stock_count_id: x.scId || null }));
  for (const l of lines) db.t.sal.push(Object.assign({}, l, { stock_adjustment_id: id, total_quantity: String(l.total_quantity), is_deleted: 0 }));
  // the form record the user has open: the stored values with ids
  return Object.assign({}, form, { id: id, stock_adjustment: lines.map((l) => Object.assign({}, l)) });
}

// Stock Count: lines { material, bin, variance, status, review, batch, serialized }; the stored SC and the form record (same values)
function scLine(db, o) {
  return { id: o.id || db.id(), material_id: o.material, material_name: "item " + o.material.slice(-2), location_id: o.bin, batch_id: o.batch || null, uom_id: UOM,
    base_uom_id: UOM, system_qty: 10, count_qty: 10 + o.variance, variance_qty: o.variance, line_status: o.status || "Approved", review_status: o.review || "Approved",
    is_counted: 1, is_serialized: o.serialized ? 1 : 0, is_single: 0, plant_id: PLANT, line_index: String(o.index || 1), table_uom_conversion: "[]",
    adjusted_qty: o.adjusted === undefined ? null : o.adjusted };
}
function storeSc(db, o) {
  const x = o || {};
  const id = x.id || db.id();
  const lines = (x.lines || [{ material: ITEM.A, bin: BIN.b1, variance: 3 }, { material: ITEM.B, bin: BIN.b2, variance: -2 },
    { material: ITEM.A, bin: BIN.b3, variance: 1, status: "Counted", review: "" }]).map((l, i) => scLine(db, Object.assign({ index: i + 1 }, l)));
  const hdr = { id: id, stock_count_no: "STC/0001", stock_count_status: x.status || "In Progress", review_status: x.review === undefined ? "In Review" : x.review,
    organization_id: ORG, plant_id: PLANT, count_type: x.countType === undefined ? "Item" : x.countType, count_method: "Ad Hoc Count", stock_count_remark: "sc remark",
    page_status: "Edit", adjustment_status: "" };
  db.t.sc.push(Object.assign({}, hdr, { is_deleted: 0 }));
  for (const l of lines) db.t.scl.push(Object.assign({}, l, { stock_count_id: id, is_deleted: 0 }));
  return Object.assign({}, hdr, { table_stock_count: lines.map((l) => Object.assign({}, l)) }, x.formExtra || {});
}

module.exports = { ORG, PLANT, PLANT2, RULE, UOM, ITEM, BIN, BATCH, seed, ent, line, saForm, storeSa, scLine, storeSc };
