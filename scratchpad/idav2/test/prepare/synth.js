// Synthesized Item Disassemblies for the IDA_V2_PREPARE tests: one spec -> the classic's form record (IDA_SAVE v6 allData, an Edit of a
// stored Draft), the rows PREPARE's SQL reads after SUBMIT wrote it (FP_HEADER / FP_LINES / ITEMS_STORED / BINS_STORED / BATCH_TYPED_STORED
// as JSON_OBJECT text) and the classic's search_items rows. 19-digit ids throughout; the two UOM ids 27 apart are one JS double.
const L = require("./lib.js");
const { C } = L;

const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const IDA = "2113000000000000001";
const UOM = "2092460418772639758";
const UOM_BOX = "2092460418772639785";
const STORAGE = "2113000000000000400";
const BIN = (n) => String(2113000000000000500n + BigInt(n));
const BATCH = (n) => String(2113000000000000700n + BigInt(n));
const ITEM = (n) => String(2113000000000000100n + BigInt(n));

// items: { n: { code, name, stock_control (null = unset), batch, rule, method, purchase_unit_price, serial, base_uom, conv: [[uom, base_qty]], category, group } }
function itemRow(n, it) {
  return { id: ITEM(n), material_code: it.code || "SYN-" + n, material_name: it.name || "Synthetic item " + n, stock_control: it.stock_control === undefined ? 1 : it.stock_control,
    serial_number_management: it.serial ? 1 : 0, item_batch_management: it.batch ? 1 : 0,
    batch_number_genaration: it.rule === undefined ? "According To System Settings" : it.rule, material_costing_method: it.method === undefined ? "First In First Out" : it.method,
    purchase_unit_price: it.purchase_unit_price === undefined ? 0 : it.purchase_unit_price, based_uom: it.base_uom || UOM,
    item_category: it.category === undefined ? "2113000000000000300" : it.category, item_group_id: it.group === undefined ? null : it.group,
    table_uom_conversion: (it.conv || [[UOM, 1]]).map(([u, q]) => ({ alt_uom_id: u, base_qty: q })) };
}
// spec = { items, source: <n>, header: {...}, picks: [{ bin, batch, qty, cat, mfg, exp, hu, serial }], rawPicks: "<text>",
//          lines: [{ item, uom, total, bin, batch, mfg, exp, remark, remark2, remark3, name, storage }], typed: [<BATCH_TYPED_STORED rows>] }
function synth(spec) {
  const picks = (spec.picks || [{ bin: 1, qty: 1 }]).map((p, i) => ({ material_id: ITEM(spec.source), location_id: BIN(p.bin), storage_location_id: null,
    batch_id: p.batch === undefined ? null : BATCH(p.batch), serial_number: p.serial || "", balance_id: String(2113000000000000900n + BigInt(i)), sm_quantity: p.qty,
    category: p.cat === undefined ? "Unrestricted" : p.cat, plant_id: PLANT, organization_id: ORG, is_deleted: 0, expired_date: p.exp || null, manufacturing_date: p.mfg || null,
    handling_unit_id: p.hu || undefined, unrestricted_qty: 100000, balance_quantity: 100000 }));
  const temp = spec.rawPicks !== undefined ? spec.rawPicks : JSON.stringify(picks);
  const picked = picks.reduce((n, p) => n + (parseFloat(p.sm_quantity) || 0), 0);
  const h = Object.assign({ item_qty: C.idaQ8(picked), item_uom: UOM, item_disassembly_date: "2026-10-21 00:00:00", stock_movement_no: "IDA-SYN-001",
    stock_movement_no_type: -9999, remarks: "synthetic", remarks_2: "", remarks_3: "", temp_hu_data: "[]", table_hu: [] }, spec.header || {});
  const items = Object.entries(spec.items).map(([n, it]) => itemRow(Number(n), it));
  const lines = spec.lines.map((l, i) => {
    const total = l.total === undefined ? 1 : l.total;
    return { id: String(2113000000000001000n + BigInt(i)), item_selection: ITEM(l.item), item_name: l.name === undefined ? "line item " + l.item : l.name, item_desc: "",
      requested_qty: total, bom_ratio: null, total_quantity: total, quantity_uom: l.uom === undefined ? UOM : l.uom, storage_location_id: l.storage === undefined ? STORAGE : l.storage,
      location_id: BIN(l.bin === undefined ? 50 : l.bin), batch_number: l.batch === undefined ? "-" : l.batch, manufacturing_date: l.mfg || null, expired_date: l.exp || null,
      item_remark: l.remark || "", item_remark_2: l.remark2 || "", item_remark_3: l.remark3 || "", project_id: "", uom_options: "[]", line_index: i + 1 };
  });
  const src = items.find((it) => it.id === ITEM(spec.source)) || {};
  const form = Object.assign({ id: IDA, organization_id: ORG, issuing_operation_faci: PLANT, item_disassembly_status: "Draft", item_id: ITEM(spec.source),
    item_code: src.material_code || "", item_name: src.material_name || "source", page_status: "Edit", temp_qty_data: temp, stock_movement: lines }, h);
  // what PREPARE reads after SUBMIT's write (code_fillback values; q8 decimals; the -9999 rule as text; locked by the test job)
  const fpHeader = { id: IDA, item_id: form.item_id, item_code: form.item_code, item_name: form.item_name, item_qty: C.idaQ8(h.item_qty), item_uom: h.item_uom,
    issuing_operation_faci: PLANT, organization_id: ORG, stock_movement_no: h.stock_movement_no, stock_movement_no_type: String(h.stock_movement_no_type),
    item_disassembly_status: "Processing", posted_status: null, item_disassembly_date: h.item_disassembly_date, temp_qty_data: temp, temp_hu_data: h.temp_hu_data,
    table_hu: h.table_hu, remarks: h.remarks, remarks_2: h.remarks_2, remarks_3: h.remarks_3, ida_v2_job_id: L.JOB };
  const fpLines = lines.map((l) => ({ id: l.id, line_index: String(l.line_index), item_selection: l.item_selection, quantity_uom: l.quantity_uom,
    total_quantity: C.idaQ8(l.total_quantity), location_id: l.location_id, batch_number: l.batch_number, manufacturing_date: l.manufacturing_date, expired_date: l.expired_date,
    item_remark: l.item_remark, item_remark_2: l.item_remark_2, item_remark_3: l.item_remark_3, issuing_plant: PLANT, organization_id: ORG, item_name: l.item_name }));
  const itemsSql = items.map((it) => Object.assign({}, it, { purchase_unit_price: Number(it.purchase_unit_price).toFixed(4) }));
  const binIds = [];
  for (const p of C.idaJsonList(temp)) if (p && p.location_id && binIds.indexOf(p.location_id) < 0) binIds.push(p.location_id);
  for (const l of lines) if (binIds.indexOf(l.location_id) < 0) binIds.push(l.location_id);
  const bins = binIds.map((id) => ({ id: id, bin: "BIN-" + id.slice(-3) }));
  const hdr = [L.jrow(fpHeader)];
  const fl = fpLines.map(L.jrow);
  const itemRows = itemsSql.map(L.jrow);
  // LINE_STORAGE: what the stored lines hold (a line without one: the column is NULL)
  const storage = lines.map((l) => L.jrow({ id: l.id, storage_location_id: l.storage_location_id || null }));
  return { form: form, stored: Object.assign({}, form), items: items, hdr: hdr, lines: fl, itemsSql: itemRows, bins: bins.map(L.jrow),
    spec: { tenant: "000000", org: ORG, idaId: IDA, key: L.keyOf(ORG, IDA), request: L.requestFor(hdr, fl, itemRows), hdr: hdr, lines: fl, items: itemRows, bins: bins.map(L.jrow),
      typed: (spec.typed || []).map(L.jrow), storage: storage } };
}

// the rows the deployed INVENTORY_BULK_APPLY reads for a synth document (its sql_node_IB* shapes): the source picks' balances (and batch
// balances) with `stock` in Unrestricted and Blocked, one FIFO layer per (source, batch) at 2.5; the receipt bins have no balance yet
function engineState(d, stock, patchItem) {
  const items = d.items.map((it) => Object.assign({ id: it.id, item_batch_management: it.item_batch_management, stock_control: it.stock_control, based_uom: it.based_uom,
    material_costing_method: it.material_costing_method, purchase_unit_price: Number(it.purchase_unit_price).toFixed(4),
    uom_conversion_json: JSON.stringify(it.table_uom_conversion) }, patchItem ? patchItem(it) : {}));
  const q = (v) => Number(v).toFixed(8);
  const bal = {};
  const batch = {};
  const fifo = {};
  let n = 0;
  const id = () => String(2113000000000090000n + BigInt(++n));
  const qtys = (amount) => ({ unrestricted_qty: q(amount), reserved_qty: q(0), block_qty: q(amount), qualityinsp_qty: q(0), intransit_qty: q(0), balance_quantity: q(2 * amount) });
  for (const p of C.idaJsonList(d.form.temp_qty_data)) {
    const amount = typeof stock === "function" ? stock(p) : stock;
    const bk = [p.material_id, p.location_id].join("|");
    bal[bk] = bal[bk] || Object.assign({ id: id(), material_id: p.material_id, location_id: p.location_id, plant_id: PLANT, organization_id: ORG }, qtys(amount));
    if (p.batch_id) {
      const tk = [p.material_id, p.location_id, p.batch_id].join("|");
      batch[tk] = batch[tk] || Object.assign({ id: id(), material_id: p.material_id, location_id: p.location_id, batch_id: p.batch_id, plant_id: PLANT, organization_id: ORG,
        manufacturing_date: null, expired_date: null, remark: null, remark2: null, remark3: null }, qtys(amount));
    }
    const fk = [p.material_id, p.batch_id || "0"].join("|");
    fifo[fk] = fifo[fk] || { id: id(), material_id: p.material_id, plant_id: PLANT, organization_id: ORG, batch_id: p.batch_id || "0", fifo_sequence: "1", fifo_cost_price: "2.50000000",
      fifo_initial_quantity: q(100000), fifo_available_quantity: q(100000) };
  }
  return { items: items, bal: Object.values(bal), batch: Object.values(batch), fifo: Object.values(fifo), wa: [] };
}

module.exports = { synth, engineState, itemRow, ORG, PLANT, IDA, UOM, UOM_BOX, STORAGE, BIN, BATCH, ITEM };
