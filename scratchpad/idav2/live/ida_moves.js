// CONTRACT section 5 engine requests of one Item Disassembly, built from its document - the reference E checks the recorded classic
// child calls against (test/twins/replay_ida.js MOVES), plans live requests with (plan_ida.js) and reconciles stored rows with
// (recon_ida.py). Read-only; uses code/shared (ida_common, price) as the packages do.
//   idaEngineMoves(hdr, lines, items, opts) -> { I, R, alloc, batch, order, bad, counts }
//   hdr   = the STORED header (issuing_operation_faci, organization_id, stock_movement_no, item_disassembly_date, item_id, item_uom,
//           temp_qty_data) - or code_fillback's allData with the number code_persisted read back
//   lines = the recovery rows (stock_movement / sm_item_disassembly_tlm8ve69_sub: id, line_index, item_selection, total_quantity,
//           quantity_uom, location_id, batch_number, dates, remarks, issuing_plant, organization_id, item_name)
//   items = { <id>: item row (stock_control, based_uom, table_uom_conversion, item_batch_management, batch_number_genaration) }
//   opts  = { jobId, prices: [{ unit_price }] aligned with alloc, batchIdOf(batchKey, line) -> id | null }
"use strict";
const fs = require("fs");
const path = require("path");

const SHARED = path.resolve(__dirname, "..", "code", "shared");
const C = require(path.join(SHARED, "ida_common.js"));
const P = require(path.join(SHARED, "price.js"));
const F = require(path.join(SHARED, "fingerprint.js"));
const strip = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
let BN = null;
// batchnum.js + its adapter concatenated as the workflows include them (test/shared does the same); run under TZ=Asia/Kuala_Lumpur
const batchnum = () => BN || (BN = new Function(fs.readFileSync(path.join(SHARED, "batchnum.js"), "utf8") + "\n" + strip(path.join(SHARED, "batchnum_adapter.js"))
  + "\nreturn { bnNumber, idaBatchnum };")());

const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const raw = (v) => (v === undefined || v === null ? "" : String(v));
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const dt = (v) => {
  const t = s(v).replace("T", " ").replace(/Z$/, "");
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t + " 00:00:00";
  return t.slice(0, 19);
};
const digitsOrNull = (v) => (/^[0-9]{1,20}$/.test(s(v)) ? s(v) : null);
const DIG = /^[0-9]{1,20}$/;

// ruling 17: numeric line_index, ties by id (length, then text), id-less rows keep their array order
function lineOrder(lines) {
  return C.idaRecoveryLines(lines).filter((l) => Number(l.is_deleted || 0) === 0).map((l, i) => ({ l, i })).sort((a, b) => {
    const x = Number(s(a.l.line_index)) || a.i + 1;
    const y = Number(s(b.l.line_index)) || b.i + 1;
    if (x !== y) return x - y;
    const ia = s(a.l.id);
    const ib = s(b.l.id);
    if (ia !== ib) return ia.length !== ib.length ? ia.length - ib.length : ia < ib ? -1 : 1;
    return a.i - b.i;
  }).map((x) => x.l);
}

function idaEngineMoves(hdr, lines, items, opts) {
  const o = opts || {};
  const h = hdr || {};
  const jobId = s(o.jobId) || "0";
  const bad = [];
  const plant = s(h.issuing_operation_faci);
  const org = s(h.organization_id);
  const trx = raw(h.stock_movement_no);
  const docDate = dt(h.item_disassembly_date);
  const itemOf = (id) => (items || {})[s(id)] || null;
  const src = itemOf(h.item_id);
  if (!src) bad.push("source item " + s(h.item_id) + " not in the item set");
  if (typeof h.temp_qty_data === "string" && s(h.temp_qty_data) && !Array.isArray(C.idaParseJ(h.temp_qty_data))) bad.push("temp_qty_data does not parse");
  const picks = C.idaPicks(h);
  const I = { operation_key: C.idaOpKey(jobId, "I"), mode: "APPLY", organization_id: org, movements: [] };
  picks.forEach((p, i) => {
    if (!DIG.test(s(p.location_id))) bad.push("pick " + (i + 1) + ": bin " + s(p.location_id) + " is not an id");
    if (s(p.handling_unit_id)) bad.push("pick " + (i + 1) + " is an HU pick (NOT_ELIGIBLE)");
    I.movements.push({
      movement_key: "M" + (i + 1), direction: "SUBTRACT", plant_id: plant, organization_id: org, material_id: s(h.item_id), quantity: q8(p.sm_quantity),
      material_uom: digitsOrNull(h.item_uom) || "", transaction_type: "IDA", trx_no: trx, parent_trx_no: "", inventory_category: C.idaCategory(p.category),
      location_id: s(p.location_id), batch_id: digitsOrNull(p.batch_id), manufacturing_date: p.manufacturing_date || null, expired_date: p.expired_date || null,
      doc_date: docDate, isMovingInv: 0, handling_unit_id: null,
    });
  });
  const order = lineOrder(lines);
  const alloc = [];
  const R = { operation_key: C.idaOpKey(jobId, "R"), mode: "APPLY", organization_id: org, movements: [] };
  const rows = [];
  const typed = {};
  let nonStock = 0;
  order.forEach((l, i) => {
    const it = itemOf(l.item_selection);
    if (!it) bad.push("line " + s(l.line_index) + ": item " + s(l.item_selection) + " not in the item set");
    const stock = !!it && Number(it.stock_control) !== 0;
    if (it && (it.stock_control === null || it.stock_control === undefined || s(it.stock_control) === "")) bad.push("line " + s(l.line_index) + ": item has no stock control setting");
    const share = q8(l.total_quantity);
    if (!(share > 0)) bad.push("line " + s(l.line_index) + ": total_quantity " + s(l.total_quantity) + " is not > 0");
    const base = P.idaUomOf(it || {}, share, s(l.quantity_uom) || undefined).baseQty;
    const lplant = s(l.issuing_plant) || plant;
    const lorg = s(l.organization_id) || org;
    const kind = it ? C.idaBatchKind(l, it) : "NONE";
    let bkey = "";
    if (kind === "TYPED" && stock) {
      const k = s(l.item_selection) + "|" + C.idaBatchKey(l.batch_number);
      if (!typed[k]) {
        typed[k] = { key: "B" + (rows.length + 1), kind: "TYPED", insert: true, batch_number: raw(l.batch_number), line_ids: [], material_id: s(l.item_selection),
          plant_id: lplant, organization_id: lorg, base: 0, transaction_no: trx, remark: raw(l.item_remark), remark2: raw(l.item_remark_2), remark3: raw(l.item_remark_3),
          manufacturing_date: dt(l.manufacturing_date), expired_date: dt(l.expired_date), request: null, lines: [] };
        rows.push(typed[k]);
      }
      typed[k].line_ids.push(s(l.id));
      typed[k].lines.push(i);
      typed[k].base = q8(typed[k].base + base);
      bkey = typed[k].key;
    } else if (kind === "AUTO") {
      const r = { key: "B" + (rows.length + 1), kind: "AUTO", insert: stock, batch_number: "", line_ids: [s(l.id)], material_id: s(l.item_selection), plant_id: lplant,
        organization_id: lorg, base: base, transaction_no: trx, remark: raw(l.item_remark), remark2: raw(l.item_remark_2), remark3: raw(l.item_remark_3),
        manufacturing_date: dt(l.manufacturing_date), expired_date: dt(l.expired_date), request: C.idaBatchRequest(h, l, org), lines: [i] };
      rows.push(r);
      bkey = stock ? r.key : "";
    }
    let mkey = "";
    if (stock) {
      mkey = "R" + (R.movements.length + 1);
      R.movements.push({
        movement_key: mkey, direction: "ADD", plant_id: lplant, organization_id: lorg, material_id: s(l.item_selection), quantity: share,
        material_uom: digitsOrNull(l.quantity_uom) || "", transaction_type: "IDA", trx_no: trx, parent_trx_no: "", inventory_category: "Unrestricted",
        location_id: s(l.location_id), batch_id: null, unit_price: 0, doc_date: docDate, manufacturing_date: dt(l.manufacturing_date), expired_date: dt(l.expired_date),
        remark: raw(l.item_remark) || "", remark2: raw(l.item_remark_2) || "", remark3: raw(l.item_remark_3) || "", isMovingInv: 0, handling_unit_id: null,
      });
      if (!DIG.test(s(l.location_id))) bad.push("line " + s(l.line_index) + ": bin " + s(l.location_id) + " is not an id");
    } else nonStock++;
    alloc.push({ line_id: s(l.id), line_index: s(l.line_index), item_id: s(l.item_selection), share_qty: share, base_qty: base, movement_key: mkey, batch_key: bkey });
  });
  // COMMIT D3's two values: unit_price (idaAllocate) and batch_id (the line's Batch row)
  const prices = Array.isArray(o.prices) ? o.prices : null;
  alloc.forEach((a, i) => {
    if (!a.movement_key) return;
    const m = R.movements.find((x) => x.movement_key === a.movement_key);
    if (prices && prices[i]) m.unit_price = prices[i].unit_price;
    if (o.batchIdOf && a.batch_key) m.batch_id = o.batchIdOf(a.batch_key, order[i]) || null;
  });
  for (const r of rows) r.initial_quantity = C.idaQtyStr(r.base);
  const autoItems = {};
  for (const r of rows) if (r.kind === "AUTO") autoItems[r.material_id] = true;
  const batch = { mode: rows.length ? "insert" : "none", rows,
    items: Object.keys(autoItems).map((id) => ({ id, item_category: (itemOf(id) || {}).item_category || null, item_group_id: (itemOf(id) || {}).item_group_id || null })) };
  const ids = {};
  ids[s(h.item_id)] = true;
  for (const l of order) ids[s(l.item_selection)] = true;
  const counts = { lines: order.length, picks: picks.length, movementsI: I.movements.length, movementsR: R.movements.length, nonStockLines: nonStock,
    moves: picks.length + order.length, batchRows: rows.length, autoRows: rows.filter((r) => r.kind === "AUTO").length, typedRows: rows.filter((r) => r.kind === "TYPED").length,
    items: Object.keys(ids).length };
  return { I, R, alloc, batch, order, bad, counts };
}

// AUTO numbers for the plan's AUTO rows (in row order = GENERATE_BATCH's call order) over fresh config rows
function autoNumbers(built, configRows, now) {
  const reqs = built.batch.rows.filter((r) => r.kind === "AUTO").map((r) => r.request);
  if (!reqs.length) return { numbers: [], configs: [] };
  return batchnum().idaBatchnum(configRows, built.batch.items, reqs, now === undefined ? Date.now() : now);
}

module.exports = { idaEngineMoves, autoNumbers, lineOrder, batchnum, dt, q8, s, C, P, F };
