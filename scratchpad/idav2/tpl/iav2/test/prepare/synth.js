// Synthesized Item Assemblies for the IA_V2_PREPARE tests: one spec -> the classic's form record (IA_SAVE v11 allData, an Edit of a
// stored Draft), the rows PREPARE's SQL reads after SUBMIT wrote it (FP_HEADER / FP_LINES / ITEMS / bins as JSON_OBJECT text) and the
// classic's search_items rows. 19-digit ids throughout; the two UOM ids 27 apart are one JS double.
const L = require("./lib.js");
const { C } = L;

const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const IA = "2113000000000000001";
const UOM = "2092460418772639758";
const UOM_BOX = "2092460418772639785";
const BIN = (n) => String(2113000000000000500n + BigInt(n));
const BATCH = (n) => String(2113000000000000700n + BigInt(n));
const ITEM = (n) => String(2113000000000000100n + BigInt(n));

// items: { n: { code, stock_control, batch, rule, method, assembly_cost, purchase_unit_price, serial, base_uom, conv: [[uom, base_qty]] } }
function itemRow(n, it) {
  return { id: ITEM(n), material_code: it.code || "SYN-" + n, material_name: it.name || "Synthetic item " + n, stock_control: it.stock_control === undefined ? 1 : it.stock_control,
    show_delivery: 1, serial_number_management: it.serial ? 1 : 0, item_batch_management: it.batch ? 1 : 0,
    batch_number_genaration: it.rule === undefined ? "According To System Settings" : it.rule, material_costing_method: it.method || "First In First Out",
    purchase_unit_price: it.purchase_unit_price === undefined ? 0 : it.purchase_unit_price, assembly_cost: it.assembly_cost === undefined ? 0 : it.assembly_cost,
    based_uom: it.base_uom || UOM, table_uom_conversion: (it.conv || [[UOM, 1]]).map(([u, q]) => ({ alt_uom_id: u, base_qty: q })) };
}
// spec = { items, parent: <n>, header: {...}, lines: [{ item: <n>, uom, total, picks: [{ bin, batch, qty, cat, mfg, exp, hu }] , raw }] }
function synth(spec) {
  const h = Object.assign({ item_qty: 2, item_uom: UOM, item_assembly_date: "2026-10-20 00:00:00", batch_no: "", manufacturing_date: null, expired_date: null,
    location_id: BIN(90), inventory_category: "Unrestricted", remarks: "synthetic", remarks_2: "", remarks_3: "", stock_movement_no: "IA-SYN-001", stock_movement_no_type: -9999 },
  spec.header || {});
  const lines = spec.lines.map((l, i) => {
    const picks = (l.picks || []).map((p) => ({ material_id: ITEM(l.item), location_id: BIN(p.bin), storage_location_id: null, batch_id: p.batch === undefined ? null : BATCH(p.batch),
      balance_id: String(2113000000000000900n + BigInt(i * 10 + (p.bin || 0))), sm_quantity: p.qty, category: p.cat === undefined ? "Unrestricted" : p.cat, plant_id: PLANT,
      organization_id: ORG, is_deleted: 0, manufacturing_date: p.mfg || null, expired_date: p.exp || null, handling_unit_id: p.hu || undefined }));
    const total = l.total === undefined ? picks.reduce((n, p) => n + (parseFloat(p.sm_quantity) || 0), 0) : l.total;
    return { id: String(2113000000000001000n + BigInt(i)), item_selection: ITEM(l.item), item_name: "line item " + l.item, quantity_uom: l.uom === undefined ? UOM : l.uom,
      total_quantity: total, requested_qty: total, temp_qty_data: l.raw !== undefined ? l.raw : JSON.stringify(picks), temp_hu_data: "[]", line_index: i + 1, item_remark: "",
      item_remark_2: "", item_remark_3: "" };
  });
  const form = Object.assign({ id: IA, organization_id: ORG, issuing_operation_faci: PLANT, item_assembly_status: "Draft", item_id: ITEM(spec.parent), item_name: "parent",
    storage_location_id: "2113000000000000400", stock_movement: lines }, h);
  const items = Object.entries(spec.items).map(([n, it]) => itemRow(Number(n), it));
  // what PREPARE reads after SUBMIT's write (code_fillback values; q8 decimals; the -9999 rule as text; locked by the test job)
  const fpHeader = { id: IA, item_id: form.item_id, item_qty: C.iaQ8(h.item_qty), item_uom: h.item_uom, location_id: h.location_id, inventory_category: h.inventory_category || "Unrestricted",
    batch_no: h.batch_no, issuing_operation_faci: PLANT, organization_id: ORG, stock_movement_no: h.stock_movement_no, stock_movement_no_type: String(h.stock_movement_no_type),
    item_assembly_status: "Processing", posted_status: null, table_hu: spec.tableHu || [], item_assembly_date: h.item_assembly_date, manufacturing_date: h.manufacturing_date,
    expired_date: h.expired_date, remarks: h.remarks, remarks_2: h.remarks_2, remarks_3: h.remarks_3, ia_v2_job_id: L.JOB };
  const fpLines = lines.map((l) => ({ id: l.id, line_index: String(l.line_index), item_selection: l.item_selection, quantity_uom: l.quantity_uom, total_quantity: C.iaQ8(l.total_quantity),
    temp_qty_data: l.temp_qty_data, temp_hu_data: l.temp_hu_data, item_name: l.item_name }));
  const itemsSql = items.map((it) => Object.assign({}, it, { assembly_cost: Number(it.assembly_cost).toFixed(2), purchase_unit_price: Number(it.purchase_unit_price).toFixed(4) }));
  const binIds = new Set([h.location_id]);
  for (const l of lines) for (const p of C.iaJsonList(l.temp_qty_data)) if (p && p.location_id) binIds.add(p.location_id);
  const bins = [...binIds].map((id) => ({ id: id, bin: "BIN-" + id.slice(-3) }));
  const hdr = [L.jrow(fpHeader)];
  const fl = fpLines.map(L.jrow);
  return { form: form, stored: Object.assign({}, form), items: items, hdr: hdr, lines: fl, itemsSql: itemsSql.map(L.jrow), bins: bins.map(L.jrow),
    spec: { tenant: "000000", org: ORG, iaId: IA, key: L.keyOf(ORG, IA), request: L.requestFor(hdr, fl), hdr: hdr, lines: fl, items: itemsSql.map(L.jrow), bins: bins.map(L.jrow) } };
}

// the rows the real INVENTORY_BULK_APPLY reads for a synth document (its sql_node_IB* shapes): every pick's balance (and batch balance)
// with `stock` in Unrestricted and Blocked, one FIFO layer per (item, batch) at 2.5, the parent's receipt balance
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
  for (const l of d.form.stock_movement) {
    for (const p of C.iaJsonList(l.temp_qty_data)) {
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
  }
  return { items: items, bal: Object.values(bal), batch: Object.values(batch), fifo: Object.values(fifo), wa: [] };
}

module.exports = { synth, engineState, ORG, PLANT, IA, UOM, UOM_BOX, BIN, BATCH, ITEM };
