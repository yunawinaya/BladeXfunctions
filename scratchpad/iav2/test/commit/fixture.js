// Fixtures for IA_V2_COMMIT / IA_V2_WORKER: a COMPLETE_IA job as PREPARE leaves it (CONTRACT sections 3-5: manifest, the P
// parts ENGINE_I / ENGINE_R / BATCH / LABELS / ITEMS), the stored Item Assembly (FP_HEADER / FP_LINES shapes) and the stock
// the engine reads (items, item_balance, FIFO layers). Built with code/shared (WP0) so the fingerprint and the price are the
// shipped ones; the engine is the deployed planner (scratchpad/gdc/engine/core.js = INVENTORY_BULK_APPLY v10's planBulk,
// required read-only).
const fs = require("fs");
const path = require("path");
const IAV2 = path.join(__dirname, "..", "..");
const C = require(path.join(IAV2, "code", "shared", "ia_common.js"));
const F = require(path.join(IAV2, "code", "shared", "fingerprint.js"));
const P = require(path.join(IAV2, "code", "shared", "price.js"));
const CORE = path.join(IAV2, "..", "gdc", "engine", "core.js");
const REPO = path.join(IAV2, "..", "..");
// IAC_OUT: a folder holding another build of IA_V2_COMMIT.json (the output split mutants, test/commit/mutants_os.py)
const OUT = process.env.IAC_OUT || path.join(REPO, "Item Assembly & BOM", "AsyncV2");

const JOB = "2112100000000000001";
const IAID = "2112073133161844738";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const NONCE = "c9d8e7f6";
const KEY = "IA:" + ORG + ":" + IAID + ":0a1b2c3d4e5f6a7b:1";
const UOM = "2018906563477008392";
const ALT = "2018906563477008399";
const BIN0 = "2018912822846582786";
const PARENT = "2094626841323700251";
const IANO = "IA-2610-0042";
const DOC_DATE = "2026-10-20 00:00:00";
const BATCH_NO = "1016-005-0003";
const FIFO = "First In First Out";
const BATCH_COLS = ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id", "remark", "remark2", "remark3", "manufacturing_date", "expired_date"];
// prod's only number rule set (Inventory Price 4 dp / Inventory Qty 3 dp, half-up): stored totals differ from the APPLY answer's
const PRECISION = { price: { dp: 4, mode: 1 }, qty: { dp: 3, mode: 1 } };

const big = (b, i) => (BigInt(b) + BigInt(i)).toString();
const comp = (i) => big("2094626841323700300", i);
const nsItem = (i) => big("2094626841323700900", i);
const binOf = (i) => big("2018912822846583000", i);
const lineId = (i) => big("2112073133161845000", i);
const balId = (i) => big("2051183829505900000", i);
const layerId = (i, k) => big("2061183829505900000", i * 10 + k);

function partRows(jobId, name, value) {
  return C.iaPartRows(jobId, ORG, "P|" + NONCE + "|" + name + "|", value, "PAYLOAD");
}

// opts: lines (stock component lines), picks (per line), nonStock (DL / IDL / VO lines, no picks), batch (batch-managed parent,
// system-generated), category (the receipt's), altUom (item_uom = an alt UOM of 12 base units), sameBalance (line 3 picks the
// balance line 1 picks), itemQty, assemblyCost, batchMode (override, e.g. a Manual parent's "reuse_or_insert")
function makeCase(opts) {
  const o = Object.assign({ lines: 6, picks: 2, nonStock: 1, batch: false, category: "Unrestricted", altUom: false, sameBalance: false, itemQty: 3, assemblyCost: 1.25 }, opts || {});
  const items = {};
  items[PARENT] = { id: PARENT, material_code: "FG-0001", material_name: "Assembly", stock_control: 1, material_costing_method: FIFO, based_uom: UOM,
    table_uom_conversion: o.altUom ? [{ alt_uom_id: ALT, base_qty: 12 }] : [], purchase_unit_price: 0, assembly_cost: o.assemblyCost, item_batch_management: o.batch ? 1 : 0 };
  const balances = [];
  const layers = [];
  const lines = [];
  const lineOf = {};
  for (let i = 1; i <= o.lines; i++) {
    const same = o.sameBalance && i === 3;
    const mat = same ? comp(1) : comp(i);
    const bin = same ? binOf(1) : binOf(i);
    if (!items[mat]) {
      items[mat] = { id: mat, material_code: "RM-" + String(i).padStart(4, "0"), material_name: "Part " + i, stock_control: 1, material_costing_method: FIFO, based_uom: UOM, table_uom_conversion: [],
        purchase_unit_price: 0, assembly_cost: 0 };
      balances.push({ id: balId(i), material_id: mat, location_id: bin, plant_id: PLANT, organization_id: ORG, unrestricted_qty: 500, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0,
        intransit_qty: 0, balance_quantity: 500 });
      // a small first layer, so a second pick of the same balance is priced from the next one (stored prices: 4 dp)
      layers.push({ id: layerId(i, 1), material_id: mat, batch_id: null, plant_id: PLANT, organization_id: ORG, fifo_sequence: "1", fifo_cost_price: Number((1.2346 + i * 0.1111).toFixed(4)),
        fifo_initial_quantity: 5, fifo_available_quantity: 2.5 });
      layers.push({ id: layerId(i, 2), material_id: mat, batch_id: null, plant_id: PLANT, organization_id: ORG, fifo_sequence: "2", fifo_cost_price: Number((2.0345 + i * 0.0777).toFixed(4)),
        fifo_initial_quantity: 400, fifo_available_quantity: 400 });
    }
    const picks = [];
    for (let k = 0; k < o.picks; k++) picks.push({ balance_id: same ? balId(1) : balId(i), location_id: bin, batch_id: "", category: "Unrestricted", sm_quantity: k % 2 ? 2 : 1.5,
      material_id: mat, plant_id: PLANT });
    const total = picks.reduce((t, p) => t + p.sm_quantity, 0);
    const row = { id: lineId(i), line_index: String(i), item_selection: mat, quantity_uom: UOM, total_quantity: total.toFixed(8), temp_qty_data: JSON.stringify(picks), temp_hu_data: "[]",
      item_name: items[mat].material_name };
    lines.push(row);
    lineOf[row.line_index] = row;
  }
  for (let k = 1; k <= o.nonStock; k++) {
    const id = nsItem(k);
    items[id] = { id: id, material_code: ["DL", "IDL", "VO"][(k - 1) % 3], material_name: "Labour " + k, stock_control: 0, material_costing_method: "Fixed Cost", based_uom: UOM, table_uom_conversion: [],
      purchase_unit_price: 534.4, assembly_cost: 0 };
    const idx = o.lines + k;
    const row = { id: lineId(idx), line_index: String(idx), item_selection: id, quantity_uom: UOM, total_quantity: (3).toFixed(8), temp_qty_data: "[]", temp_hu_data: "[]",
      item_name: items[id].material_name };
    lines.push(row);
    lineOf[row.line_index] = row;
  }
  const header = { id: IAID, item_id: PARENT, item_qty: Number(o.itemQty).toFixed(8), item_uom: o.altUom ? ALT : UOM, location_id: BIN0, inventory_category: o.category, batch_no: o.batch ? BATCH_NO : "",
    issuing_operation_faci: PLANT, organization_id: ORG, stock_movement_no: IANO, stock_movement_no_type: "2098256587713404930", item_assembly_status: "Processing", posted_status: "",
    table_hu: null, item_assembly_date: DOC_DATE, manufacturing_date: o.batch ? DOC_DATE : null, expired_date: o.batch ? "2028-10-19 00:00:00" : null, remarks: "r1", remarks_2: "", remarks_3: "",
    ia_v2_job_id: JOB };
  // ENGINE_I: one SUBTRACT per stock pick with sm_quantity > 0, lines by line_index then picks in array order (CONTRACT section 5)
  const movements = [];
  const labels = {};
  for (const l of lines.slice().sort((a, b) => Number(a.line_index) - Number(b.line_index))) {
    if (Number(items[l.item_selection].stock_control) === 0) continue;
    for (const p of C.iaPicks(l)) {
      const key = "M" + (movements.length + 1);
      movements.push({ movement_key: key, direction: "SUBTRACT", plant_id: PLANT, organization_id: ORG, material_id: l.item_selection, quantity: C.iaQ8(p.sm_quantity), material_uom: l.quantity_uom,
        transaction_type: "IA", trx_no: IANO, parent_trx_no: "", inventory_category: C.iaCategory(p.category), location_id: p.location_id, batch_id: null, manufacturing_date: null, expired_date: null,
        doc_date: DOC_DATE, isMovingInv: 0, handling_unit_id: null });
      labels[key] = { line_index: l.line_index, line_id: l.id, item_code: items[l.item_selection].material_code, item_name: l.item_name, bin: "A1-B" + l.line_index, bin_id: p.location_id,
        category: C.iaCategory(p.category), side: "out" };
    }
  }
  const receiptBaseQty = P.iaUomOf(items[PARENT], header.item_qty, header.item_uom).baseQty;
  const r1 = { movement_key: "R1", direction: "ADD", plant_id: PLANT, organization_id: ORG, material_id: PARENT, quantity: C.iaQ8(header.item_qty), material_uom: header.item_uom, transaction_type: "IA",
    trx_no: IANO, parent_trx_no: "", inventory_category: o.category, location_id: BIN0, batch_id: null, unit_price: 0, doc_date: DOC_DATE, manufacturing_date: header.manufacturing_date,
    expired_date: header.expired_date, remark: "r1", remark2: "", remark3: "", isMovingInv: 0, handling_unit_id: null };
  labels.R1 = { line_index: "", line_id: "", item_code: "FG-0001", item_name: "Assembly", bin: "FG-01", bin_id: BIN0, category: o.category, side: "in" };
  // IA output split (plan 10-27): o.split = [{ qty, bin, cat, number }] -> one receipt per row (R1..Rn), a Batch row per number (batch
  // parents), the header's stored rows
  let receipts = [r1];
  const batchOf = {};
  if (o.split) {
    receipts = o.split.map((x, i) => Object.assign({}, r1, { movement_key: "R" + (i + 1), quantity: C.iaQ8(x.qty), location_id: x.bin, inventory_category: x.cat || o.category }));
    delete labels.R1;
    receipts.forEach((m, i) => {
      labels[m.movement_key] = { line_index: "", line_id: "", item_code: "FG-0001", item_name: "Assembly", bin: "FG-" + (i + 1), bin_id: m.location_id, category: m.inventory_category, side: "in" };
      if (o.batch) batchOf[m.movement_key] = o.split[i].number;
    });
    header.output_split = o.split.map((x) => ({ os_qty: x.qty, os_location_id: x.bin, os_category: x.cat || o.category, os_batch_no: x.number || "" }));
  }
  const itemIds = [PARENT].concat(lines.map((l) => l.item_selection)).filter((x, i, a) => a.indexOf(x) === i);
  const parts = {
    ENGINE_I: { operation_key: "IAC|" + JOB + "|I", mode: "APPLY", organization_id: ORG, movements: movements },
    ENGINE_R: Object.assign({ operation_key: "IAC|" + JOB + "|R", mode: "APPLY", organization_id: ORG, receiptBaseQty: receiptBaseQty, assemblyCost: C.iaQ8(o.assemblyCost),
      movements: receipts }, o.split && o.batch ? { batchOf: batchOf } : {}),
    LABELS: labels,
    ITEMS: { itemDates: itemIds.map((id) => ({ id: id })) },
  };
  const batchMode = o.batchMode || (o.batch ? "insert" : "none");
  const numbers = o.split && o.batch ? o.split.map((x) => x.number).filter((x, i, a) => a.indexOf(x) === i) : [];
  if (o.batch && numbers.length) {
    parts.BATCH = { mode: "insert", rows: numbers.map((nm) => ({ batch_number: nm, material_id: PARENT, initial_quantity: C.iaQtyStr(o.split.filter((x) => x.number === nm)
      .reduce((s, x) => s + P.iaUomOf(items[PARENT], x.qty, header.item_uom).baseQty, 0)), transaction_no: IANO, plant_id: PLANT, organization_id: ORG, remark: "r1", remark2: "", remark3: "",
      manufacturing_date: header.manufacturing_date, expired_date: header.expired_date })) };
  } else if (o.batch) {
    parts.BATCH = { mode: "insert", row: { batch_number: BATCH_NO, material_id: PARENT, initial_quantity: C.iaQtyStr(receiptBaseQty), transaction_no: IANO, plant_id: PLANT, organization_id: ORG,
      remark: "r1", remark2: "", remark3: "", manufacturing_date: header.manufacturing_date, expired_date: header.expired_date } };
  }
  const rows = [];
  const names = {};
  for (const k of Object.keys(parts)) {
    const r = partRows(JOB, k, parts[k]);
    names[k] = r.map((x) => x.step_name);
    rows.push(...r);
  }
  const fp = F.iaLineFingerprint(lines.map((l) => ({ j: JSON.stringify(l) })), [{ j: JSON.stringify(header) }]);
  const nonStockLines = lines.filter((l) => Number(items[l.item_selection].stock_control) === 0).length;
  const manifest = { v: 1, prepared_by: "IA_V2_PREPARE", job_id: JOB, ia_id: IAID, ia_no: IANO, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", organization_id: ORG, plant_id: PLANT,
    nonce: NONCE, lineFingerprint: fp, batchMode: batchMode, parts: names,
    counts: { lines: lines.length, picks: movements.length, movementsI: movements.length, nonStockLines: nonStockLines, items: itemIds.length } };
  const request = { v: 1, action: "DIRECT", prevStatus: "Draft", saveAs: "Completed", pageStatus: "Edit", iaId: IAID, iaNo: IANO, issuedNo: IANO, lineFingerprint: fp, organizationId: ORG,
    plantId: PLANT, lineCount: lines.length - nonStockLines, pickCount: movements.length, nonStockLines: nonStockLines, movementCount: movements.length + 1, uid: "1123598821738675201",
    source: "FORM", nonce: "ab12cd34", parts: {} };
  return { o, JOB, IAID, ORG, PLANT, NONCE, KEY, items, balances, layers, lines, header, movements, r1, receiptBaseQty, labels, parts, partStepRows: rows, manifest, request, fp, itemIds, lineOf,
    batchMode, receipts, batchOf, numbers };
}

function nodeById(doc, id) {
  let hit = null;
  const walk = (n) => {
    if (hit) return;
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.id === id && n.type) hit = n;
      else Object.values(n).forEach(walk);
    }
  };
  walk(doc);
  if (!hit) throw new Error("no node " + id);
  return hit;
}
const docs = {};
const built = (name) => docs[name] || (docs[name] = JSON.parse(fs.readFileSync(path.join(OUT, name + ".json"), "utf8")));
// the unit loader (lib/test_load.js strip rule) on a BUILT code node: exactly what ships, without its platform tail
const strip = require(path.join(IAV2, "lib", "test_load.js")).strip;
function loadNode(name, id, names) {
  const src = strip(nodeById(built(name), id).data.script.code) + "\nreturn { " + names.join(", ") + " };";
  if (/\{\{/.test(src)) throw new Error(id + ": a platform token is left in the loaded body");
  return new Function(src)();
}

module.exports = { C, F, P, CORE, REPO, OUT, JOB, IAID, ORG, PLANT, NONCE, KEY, UOM, ALT, BIN0, PARENT, IANO, DOC_DATE, BATCH_NO, FIFO, BATCH_COLS, PRECISION, makeCase, partRows, nodeById, built,
  loadNode, comp, binOf, balId };
