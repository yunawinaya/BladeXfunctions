// A synthetic Completed Item Assembly in Revert V2's own SQL row shapes (what revert/sql.py + code/shared/sql.py return), consistent
// the way a completion leaves it: one IA OUT row per component pick, one IA IN row of the assembled item, its FIFO layer / WA row,
// its balances, its Batch row. spec:
//   { parent: { method, batch?, qty, price, cat?, fixed? }, comps: [{ qty, price, method?, batch?, hu?, serial?, stock? }], waRow?: [q, p],
//     consumed?: <available left in the parent's FIFO layer>, posted?, status?, org?, reverted?: true (a revert already ran: IA-R rows),
//     manyComps?: n }
const X = require("./_rows");
let seq = 0n;
const BASE = 2120000000000000000n;
const id = () => String(BASE + ++seq);
const J = (o) => ({ j: JSON.stringify(o) });
const d8 = (v) => Number(v).toFixed(8);
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const UOM = "2018906563477008392";
const BIN = "2018912822846582786";
const FG_BIN = "2018912822846582799";

function synth(spec) {
  seq = 0n;
  const iaId = id();
  const iaNo = spec.iaNo || "IA-TEST-" + iaId.slice(-4);
  const P = Object.assign({ method: "First In First Out", qty: 2, price: 5, cat: "Unrestricted" }, spec.parent || {});
  const parent = { id: id(), code: "FG-1", name: "Assembly", method: P.method, batch: !!P.batch, serial: !!P.serial };
  let comps = (spec.comps || [{ qty: 3, price: 1 }, { qty: 4, price: 2 }]).map((c, i) => Object.assign({ id: id(), code: "RM-" + (i + 1), name: "Part " + (i + 1), method: "First In First Out" }, c));
  if (spec.manyComps) comps = Array.from({ length: spec.manyComps }, (_, i) => ({ id: id(), code: "RM-" + (i + 1), name: "Part " + (i + 1), method: "First In First Out", qty: 1, price: 1 }));
  const items = [parent].concat(comps).map((it) => J({ id: it.id, material_code: it.code, material_name: it.name, stock_control: it.stock === 0 ? 0 : 1, show_delivery: 1,
    serial_number_management: it.serial ? 1 : 0, item_batch_management: it.batch ? 1 : 0, batch_number_genaration: it.batch ? "According To System Settings" : null,
    material_costing_method: it.method, purchase_unit_price: "0.0000", assembly_cost: "0.00", based_uom: UOM, table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }] }));
  const batchId = P.batch ? id() : null;
  const moves = [];
  const mv = (o) => moves.push(Object.assign({ id: id(), trx_no: iaNo, plant_id: PLANT, inventory_category: "Unrestricted", uom_id: UOM, base_uom_id: UOM }, o));
  let outTotal = 0;
  for (const c of comps) {
    const row = { transaction_type: "IA", movement: "OUT", item_id: c.id, bin_location_id: BIN, quantity: d8(c.qty), base_qty: d8(c.qty), unit_price: d8(c.price),
      total_price: d8(c.qty * c.price), costing_method_id: c.method };
    if (c.batch) row.batch_number_id = id();
    if (c.hu) row.handling_unit_id = id();
    mv(row);
    outTotal += c.qty * c.price;
  }
  const unit = P.price === undefined ? outTotal / P.qty : P.price;
  const inRow = { transaction_type: "IA", movement: "IN", item_id: parent.id, bin_location_id: FG_BIN, inventory_category: P.cat, quantity: d8(P.qty), base_qty: d8(P.qty),
    unit_price: d8(unit), total_price: d8(unit * P.qty), costing_method_id: P.method };
  if (batchId) inRow.batch_number_id = batchId;
  mv(inRow);
  if (spec.reverted) {
    for (const m of moves.slice()) mv(Object.assign({}, m, { id: undefined, transaction_type: "IA-R", movement: m.movement === "OUT" ? "IN" : "OUT" }));
    for (const m of moves) if (!m.id) m.id = id();
  }
  const fifo = [];
  const wa = [];
  if (P.method === "First In First Out") {
    fifo.push(Object.assign({ id: id(), material_id: parent.id, fifo_cost_price: d8(unit), fifo_initial_quantity: d8(P.qty),
      fifo_available_quantity: d8(spec.consumed === undefined ? P.qty : spec.consumed), fifo_sequence: "3" }, batchId ? { batch_id: batchId } : {}));
  } else if (P.method === "Weighted Average") {
    if (batchId) wa.push({ id: id(), material_id: parent.id, batch_id: batchId, wa_quantity: d8(P.qty), wa_cost_price: d8(unit) });
    else {
      const [q, p] = spec.waRow || [10, 5];
      wa.push({ id: id(), material_id: parent.id, wa_quantity: d8(q), wa_cost_price: d8(p) });
    }
  }
  const costcounts = [];
  const nF = fifo.length;
  const nW = wa.length;
  if (nF) costcounts.push({ t: "FIFO", material_id: parent.id, cnt: nF });
  if (nW) costcounts.push({ t: "WA", material_id: parent.id, cnt: nW });
  for (const c of comps) if (c.method === "First In First Out") costcounts.push({ t: "FIFO", material_id: c.id, cnt: 1 });
  const cat = { Unrestricted: "unrestricted_qty", Blocked: "block_qty" }[P.cat] || "unrestricted_qty";
  const bal = (o) => Object.assign({ id: id(), material_id: parent.id, location_id: FG_BIN, plant_id: PLANT, organization_id: ORG, unrestricted_qty: 0, reserved_qty: 0, block_qty: 0,
    qualityinsp_qty: 0, intransit_qty: 0, balance_quantity: 0 }, o);
  const onHand = spec.onHand === undefined ? P.qty : spec.onHand;
  const itemBal = [J(bal({ [cat]: onHand, balance_quantity: onHand }))];
  const batchBal = batchId ? [J(bal({ batch_id: batchId, [cat]: onHand, balance_quantity: onHand }))] : [];
  const batch = [J({ id: batchId || id(), batch_number: batchId ? "B-0001" : "", material_id: parent.id, plant_id: PLANT, organization_id: ORG, transaction_no: iaNo })];
  const status = spec.status || "Processing";
  const hdr = { id: iaId, item_id: parent.id, item_qty: d8(P.qty), item_uom: UOM, location_id: FG_BIN, inventory_category: P.cat, batch_no: batchId ? "B-0001" : "",
    issuing_operation_faci: PLANT, organization_id: spec.org || ORG, stock_movement_no: iaNo, stock_movement_no_type: null, item_assembly_status: status,
    posted_status: spec.posted || "Unposted", table_hu: null, item_assembly_date: "2026-10-19 00:00:00", manufacturing_date: null, expired_date: null, remarks: null, remarks_2: null,
    remarks_3: null, ia_v2_job_id: status === "Processing" ? X.JOB : null };
  const S = {
    own: [{ db_now: "2026-10-19 12:00:00", ia_id: iaId, item_assembly_status: status, ia_v2_job_id: status === "Processing" ? X.JOB : null, stock_movement_no: iaNo,
      lock_ref: status === "Processing" ? X.KEY : null, lock_step: "LOCK|1" }],
    hdr: [J(hdr)], storedHdr: [J(Object.assign({}, hdr, { item_assembly_status: spec.stored || "Completed", ia_v2_job_id: null }))], moves: moves, batch: batch, fifo: fifo, wa: wa,
    costcounts: costcounts, itemBal: itemBal, batchBal: batchBal, items: items, bins: [J({ id: BIN, bin_location_combine: "A1-01" }), J({ id: FG_BIN, bin_location_combine: "FG-01" })],
    serial: [parent].concat(comps).filter((it) => it.serial).map((it) => ({ id: it.id })),
  };
  return { S: S, iaId: iaId, iaNo: iaNo, parent: parent, comps: comps, batchId: batchId, unit: unit, org: ORG, plant: PLANT, run: { tenant: "000000", params: { ia_id: iaId, ia_no: iaNo,
    organization_id: ORG } } };
}

module.exports = { synth, ORG, PLANT, UOM, BIN, FG_BIN, d8 };
