// Offline pre-flight of one Item Assembly request, read-only: the CONTRACT section 5 operations (ia_moves.js) planned by the REAL
// engine planner (scratchpad/gdc/engine/core.js planBulk, required read-only) over a snap_ia.py snapshot taken right before the run:
// op 1 (ENGINE_I, every stock pick) and then op 2 (ENGINE_R, R1 at V2's receipt price = price.js receiptUnitPrice over op 1's
// stored totals). Prints PLAN OK with the expected rows (balance deltas, FIFO consumption / the parent's new layer, WA, the
// movements, the receipt price) or the refusal V2 PREPARE would give (INSUFFICIENT, DUPLICATE_BALANCE, UNSUPPORTED_COSTING, ...).
// The classic writes the same rows through SUBTRACT / ADD_INVENTORY (replay_ia.js proves it on recorded runs), so this is the
// expected delta of a classic twin too (receipt price: the classic divides by item_qty, V2 by the base qty - equal in base UOM).
//   node scratchpad/iav2/live/plan_ia.js <classic.json | submit.json> <snapshot.json> [--batch-id ID] [--json out.json]
"use strict";
const fs = require("fs");
const path = require("path");
const { planBulk, roundDec, q8 } = require(path.resolve(__dirname, "..", "..", "gdc", "engine", "core.js"));
const { iaEngineMoves } = require(path.join(__dirname, "ia_moves.js"));
const P = require(path.resolve(__dirname, "..", "code", "shared", "price.js"));

const argv = process.argv.slice(2);
const opt = (f) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : null);
const [reqFile, snapFile] = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!reqFile || !snapFile) {
  console.error("usage: node plan_ia.js <classic.json | submit.json> <snapshot.json> [--batch-id ID] [--json out.json]");
  process.exit(2);
}
const s = (v) => (v === undefined || v === null ? "" : String(v));
const n = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const reqIn = JSON.parse(fs.readFileSync(reqFile, "utf8"));
const snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
const doc = reqIn.allData || reqIn.form;
if (!doc || !Array.isArray(doc.stock_movement)) {
  console.error("not an IA request (no allData / form with stock_movement)");
  process.exit(2);
}
const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const TABLE_OF = { "1902698977724317697": "item_balance", "1902718803880558594": "item_batch_balance", "1902947165008400386": "fifo_costing_history",
  "1902948453171433474": "wa_costing_method", "1902259348776800257": "inventory_movement", "1902719754154655746": "batch" };
const PRICE_COLUMNS = { unit_price: 1, total_price: 1, fifo_cost_price: 1, wa_cost_price: 1 };
const precision = { price: null, qty: null, columns: {} };
for (const r of snap.precision || []) {
  const mode = Number(r.precision_rule);
  const dp = Number(r.decimal_places);
  const rule = Number(r.store_raw_value) === 1 || dp >= 8 ? { dp: null, mode } : { dp, mode };
  if (s(r.scope_type) === "2") {
    if (TABLE_OF[s(r.table_id)] && s(r.field_name)) precision.columns[TABLE_OF[s(r.table_id)] + "." + s(r.field_name)] = rule;
  } else if (s(r.rule_key) === "Inventory Price") precision.price = rule;
  else if (s(r.rule_key) === "Inventory Qty") precision.qty = rule;
}
const stored = (table, col, v) => {
  const r = Object.prototype.hasOwnProperty.call(precision.columns, table + "." + col) ? precision.columns[table + "." + col] : PRICE_COLUMNS[col] ? precision.price : precision.qty;
  return r && r.dp !== null && r.dp !== undefined ? roundDec(v, r.dp, r.mode) : q8(v);
};
const items = {};
for (const it of snap.itemdef || []) {
  items[s(it.id)] = { id: s(it.id), stock_control: Number(it.stock_control), based_uom: s(it.based_uom), material_costing_method: it.material_costing_method,
    purchase_unit_price: n(it.purchase_unit_price), item_batch_management: Number(it.item_batch_management || 0), assembly_cost: s(it.assembly_cost),
    table_uom_conversion: (it.table_uom_conversion || []).map((c) => ({ alt_uom_id: s(c.alt_uom_id), base_uom_id: s(c.base_uom_id), alt_qty: n(c.alt_qty), base_qty: n(c.base_qty) })) };
}
const live = (rows) => (rows || []).filter((r) => Number(r.is_deleted || 0) === 0);
const ID_COLS = ["id", "material_id", "location_id", "plant_id", "organization_id", "batch_id"];
const ids = (rows) => rows.map((r) => { const o = Object.assign({}, r); for (const c of ID_COLS) if (o[c] !== undefined && o[c] !== null) o[c] = s(o[c]); return o; });
const nums = (rows, cols) => rows.map((r) => { const o = Object.assign({}, r); for (const c of cols) if (o[c] !== undefined && o[c] !== null && o[c] !== "") o[c] = Number(o[c]); return o; });
const costBatch = (rows) => rows.map((r) => Object.assign(r, { batch_id: s(r.batch_id) === "0" || s(r.batch_id) === "" ? null : s(r.batch_id) }));
const waRows = (rows) => rows.map((r) => Object.assign(r, { created_at: s(r.created_at) }));
const hdr = { issuing_operation_faci: s(doc.issuing_operation_faci), organization_id: s(doc.organization_id), stock_movement_no: "<IA number>",
  item_assembly_date: s(doc.item_assembly_date), item_id: s(doc.item_id), item_qty: doc.item_qty, item_uom: s(doc.item_uom), location_id: s(doc.location_id),
  inventory_category: s(doc.inventory_category) || "Unrestricted", manufacturing_date: doc.manufacturing_date, expired_date: doc.expired_date,
  remarks: doc.remarks, remarks_2: doc.remarks_2, remarks_3: doc.remarks_3 };
const lines = doc.stock_movement.map((l, i) => Object.assign({}, l, { line_index: l.line_index || i + 1 }));
const parent = items[hdr.item_id];
if (!parent) {
  console.error("the snapshot has no item row for the parent " + hdr.item_id + " (take it with --request on this request)");
  process.exit(2);
}
const receiptBaseQty = P.iaUomOf(parent, hdr.item_qty, hdr.item_uom).baseQty;
const assemblyCost = q8(parent.assembly_cost);
// a batch parent is received on the Batch row COMMIT I1 inserts: a placeholder id stands for it (a new batch balance / layer / WA row)
const batchId = opt("--batch-id") || (parent.item_batch_management === 1 ? "9000000000000000001" : null);
if (batchId && !opt("--batch-id")) console.log("   batch parent: planned on a placeholder batch id 9000000000000000001 (I1's new Batch row)");
const built = iaEngineMoves({ stock_movement: lines }, hdr, items, { jobId: "PLAN", receiptBaseQty, assemblyCost, batchId });
const state = { itemBalances: nums(ids(live(snap.ib)), QTY), batchBalances: nums(ids(live(snap.ibb)), QTY),
  fifoLayers: costBatch(nums(ids(live(snap.fifo)), ["fifo_available_quantity", "fifo_cost_price", "fifo_initial_quantity"])),
  waRows: waRows(costBatch(nums(ids(live(snap.wa)), ["wa_quantity", "wa_cost_price"]))) };
const code = Object.fromEntries((snap.itemdef || []).map((i) => [s(i.id), i.material_code]));
console.log(`${path.basename(reqFile)}: ${built.counts.lines} lines, ${built.counts.picks} picks, ${built.counts.nonStock} non-stock lines, op 1 ${built.I.movements.length} SUBTRACT `
  + `+ op 2 R1; builder problems ${built.bad.length}${built.bad.length ? ": " + built.bad.slice(0, 3).join("; ") : ""}`);
const p1 = planBulk(Object.assign({ operationKey: built.I.operation_key, items, movements: built.I.movements, nowText: "2026-10-20 00:00:00", precision }, JSON.parse(JSON.stringify(state))));
if (!p1.ok) {
  console.log(`PLAN REFUSED op 1 ${p1.failure.code} at ${p1.failure.movement_key}: ${p1.failure.message}  (V2 PREPARE: FAILED IA_INVENTORY_${p1.failure.code}, nothing moved, IA back to Draft)`);
  process.exit(1);
}
const skipped = p1.results.filter((r) => r.code !== "200");
const outTotal = p1.movements.reduce((t, m) => t + Number(stored("inventory_movement", "total_price", m.total_price)), 0);
const price = P.receiptUnitPrice({ outTotals: [outTotal], receiptBaseQty, assemblyCost });
// op 2 runs on the rows op 1 left (the parent is not a component: its rows are untouched by op 1)
const after1 = JSON.parse(JSON.stringify(state));
const apply = (rows, upd) => { for (const u of upd) { const r = rows.find((x) => s(x.id) === s(u.id)); if (r) Object.assign(r, u.after); } };
apply(after1.itemBalances, p1.updates.item_balance);
apply(after1.batchBalances, p1.updates.item_batch_balance);
apply(after1.fifoLayers, p1.updates.fifo);
apply(after1.waRows, p1.updates.wa);
built.R.movements[0].unit_price = price;
const p2 = planBulk(Object.assign({ operationKey: built.R.operation_key, items, movements: built.R.movements, nowText: "2026-10-20 00:00:00", precision }, after1));
if (!p2.ok) {
  console.log(`PLAN REFUSED op 2 ${p2.failure.code} at R1: ${p2.failure.message}  (V2: PREPARE's receipt PLAN fails the job; the classic would have issued first)`);
  process.exit(1);
}
const out = { op1: { movements: p1.movements.length, skipped: skipped.length, out_total: outTotal }, receipt: { base_qty: receiptBaseQty, assembly_cost: assemblyCost, unit_price: price,
  method: parent.material_costing_method, stored_unit_price: p2.movements[0].unit_price, r1: p2.results[0] }, item_balance: [], item_batch_balance: [], fifo: [], wa: [], movements: [] };
for (const pl of [p1, p2]) {
  for (const r of pl.updates.item_balance) out.item_balance.push({ id: r.id, before: r.before.balance_quantity, after: r.after.balance_quantity });
  for (const r of pl.updates.item_batch_balance) out.item_batch_balance.push({ id: r.id, before: r.before.balance_quantity, after: r.after.balance_quantity });
  for (const r of pl.creates.item_balance) out.item_balance.push({ id: "new", material: r.material_id, location: r.location_id, after: r.balance_quantity });
  for (const r of pl.creates.item_batch_balance) out.item_batch_balance.push({ id: "new", material: r.material_id, location: r.location_id, batch: r.batch_id, after: r.balance_quantity });
  for (const r of pl.updates.fifo) out.fifo.push({ id: r.id, available_before: r.before.fifo_available_quantity, available_after: r.after.fifo_available_quantity });
  for (const r of pl.creates.fifo) out.fifo.push({ id: "new", material: r.material_id, batch: r.batch_id, sequence: r.fifo_sequence, qty: r.fifo_initial_quantity, price: r.fifo_cost_price });
  for (const r of pl.updates.wa) out.wa.push({ id: r.id, before: r.before, after: r.after });
  for (const r of pl.creates.wa) out.wa.push({ id: "new", material: r.material_id, batch: r.batch_id, qty: r.wa_quantity, price: r.wa_cost_price });
  for (const m of pl.movements) out.movements.push({ key: m.operation_effect_key.split("|").pop(), item: code[s(m.item_id)] || m.item_id, item_id: s(m.item_id), bin: s(m.bin_location_id),
    batch: s(m.batch_number_id), category: m.inventory_category, movement: m.movement, quantity: m.quantity, base_qty: m.base_qty, uom: s(m.uom_id), unit_price: m.unit_price,
    total_price: m.total_price });
}
console.log(`PLAN OK op 1: ${p1.movements.length} OUT (${skipped.length} skipped inside a 200), OUT total ${outTotal}; op 2: R1 ${p2.results[0].code} - receipt ${hdr.item_qty} `
  + `(base ${receiptBaseQty}) of ${code[hdr.item_id] || hdr.item_id} (${parent.material_costing_method}) at ${price} = q8(${outTotal} / ${receiptBaseQty} + ${assemblyCost})`
  + (parent.material_costing_method === "Fixed Cost" ? ` -> stored at purchase_unit_price ${p2.movements[0].unit_price} (Fixed Cost)` : ` -> stored ${p2.movements[0].unit_price}`));
console.log(`   rows: item_balance ${out.item_balance.length}, item_batch_balance ${out.item_batch_balance.length}, fifo ${out.fifo.length} (new ${p1.creates.fifo.length + p2.creates.fifo.length}), `
  + `wa ${out.wa.length}, inventory_movement ${out.movements.length}`);
for (const m of out.movements.slice(0, 6).concat(out.movements.length > 7 ? [{ key: "...", movement: "", item: "", bin: "", batch: "" }] : []).concat(out.movements.length > 6 ? out.movements.slice(-1) : [])) {
  console.log(`   ${String(m.key).padEnd(5)} ${String(m.movement).padEnd(3)} ${String(m.item).padEnd(18)} bin ..${String(m.bin).slice(-4)} ${m.batch ? "batch .." + String(m.batch).slice(-4) : "          "} `
    + (m.quantity === undefined ? "" : `qty ${m.quantity} (base ${m.base_qty}) @ ${m.unit_price} = ${m.total_price}`));
}
for (const r of out.fifo.filter((x) => x.id === "new")) console.log("   new fifo layer " + JSON.stringify(r));
for (const r of out.wa) console.log("   wa " + JSON.stringify(r));
if (opt("--json")) fs.writeFileSync(opt("--json"), JSON.stringify(out, null, 1));
