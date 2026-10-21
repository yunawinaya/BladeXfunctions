// Offline pre-flight of one Item Disassembly request, read-only: the CONTRACT section 5 operations (ida_moves.js) planned by the REAL
// engine planner (scratchpad/gdc/engine/core.js planBulk, required read-only) over a snap_ida.py snapshot taken right before the run:
// op 1 (ENGINE_I, every source pick) and then op 2 (ENGINE_R, every stock line at V2's price = price.js idaAllocate over op 1's stored
// OUT totals; each Batch row D1 would insert stands as a placeholder id). Prints PLAN OK with the expected rows (balance deltas, FIFO
// consumption / new layers, WA, the movements, the receipt prices) or the refusal V2 PREPARE would give (INSUFFICIENT, DUPLICATE_BALANCE,
// UNSUPPORTED_COSTING, ...). The classic writes the same rows through SUBTRACT / ADD_INVENTORY (test/twins/replay_ida.js proves it on
// recorded runs), except its price per LINE unit on a non-base-UOM line and its Batch rows (one per line, blank ones for NONE lines).
//   node scratchpad/idav2/live/plan_ida.js <classic.json | submit.json> <snapshot.json> [--json out.json]
"use strict";
const fs = require("fs");
const path = require("path");
const { planBulk, roundDec, q8 } = require(path.resolve(__dirname, "..", "..", "gdc", "engine", "core.js"));
const M = require(path.join(__dirname, "ida_moves.js"));

const argv = process.argv.slice(2);
const opt = (f) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : null);
const [reqFile, snapFile] = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!reqFile || !snapFile) {
  console.error("usage: node plan_ida.js <classic.json | submit.json> <snapshot.json> [--json out.json]");
  process.exit(2);
}
const s = (v) => (v === undefined || v === null ? "" : String(v));
const n = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const reqIn = JSON.parse(fs.readFileSync(reqFile, "utf8"));
const snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
const doc = reqIn.allData || reqIn.form;
if (!doc || !Array.isArray(doc.stock_movement)) {
  console.error("not an IDA request (no allData / form with stock_movement)");
  process.exit(2);
}
const TABLE_OF = { "1902698977724317697": "item_balance", "1902718803880558594": "item_batch_balance", "1902947165008400386": "fifo_costing_history",
  "1902948453171433474": "wa_costing_method", "1902259348776800257": "inventory_movement", "1902719754154655746": "batch" };
const PRICE_COLUMNS = { unit_price: 1, total_price: 1, fifo_cost_price: 1, wa_cost_price: 1 };
const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
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
// the deployed engine's item adapter (code_node_IBplan)
const items = {};
for (const it of snap.itemdef || []) {
  items[s(it.id)] = { id: s(it.id), material_code: it.material_code, stock_control: it.stock_control === null || it.stock_control === undefined ? null : Number(it.stock_control),
    based_uom: s(it.based_uom), material_costing_method: it.material_costing_method, purchase_unit_price: n(it.purchase_unit_price),
    item_batch_management: Number(it.item_batch_management || 0), batch_number_genaration: it.batch_number_genaration, item_category: it.item_category, item_group_id: it.item_group_id,
    table_uom_conversion: (it.table_uom_conversion || []).map((c) => ({ alt_uom_id: s(c.alt_uom_id), base_uom_id: s(c.base_uom_id), alt_qty: n(c.alt_qty), base_qty: n(c.base_qty) })) };
}
const live = (rows) => (rows || []).filter((r) => Number(r.is_deleted || 0) === 0);
const ID_COLS = ["id", "material_id", "location_id", "plant_id", "organization_id", "batch_id"];
const ids = (rows) => rows.map((r) => { const o = Object.assign({}, r); for (const c of ID_COLS) if (o[c] !== undefined && o[c] !== null) o[c] = s(o[c]); return o; });
const nums = (rows, cols) => rows.map((r) => { const o = Object.assign({}, r); for (const c of cols) if (o[c] !== undefined && o[c] !== null && o[c] !== "") o[c] = Number(o[c]); return o; });
const costBatch = (rows) => rows.map((r) => Object.assign(r, { batch_id: s(r.batch_id) === "0" || s(r.batch_id) === "" ? null : s(r.batch_id) }));
const waRows = (rows) => rows.map((r) => Object.assign(r, { created_at: s(r.created_at) }));
const hdr = { issuing_operation_faci: s(doc.issuing_operation_faci), organization_id: s(doc.organization_id), stock_movement_no: s(doc.stock_movement_no) || "<IDA number>",
  item_disassembly_date: s(doc.item_disassembly_date), item_id: s(doc.item_id), item_uom: s(doc.item_uom), temp_qty_data: doc.temp_qty_data };
const lines = doc.stock_movement.map((l, i) => Object.assign({}, l, { line_index: l.line_index || i + 1 }));
if (!items[hdr.item_id]) {
  console.error("the snapshot has no item row for the source " + hdr.item_id + " (take it with --request on this request)");
  process.exit(2);
}
const built0 = M.idaEngineMoves(hdr, lines, items, { jobId: "PLAN" });
const code = Object.fromEntries((snap.itemdef || []).map((i) => [s(i.id), i.material_code]));
console.log(`${path.basename(reqFile)}: ${built0.counts.lines} lines (${built0.counts.movementsR} stock, ${built0.counts.nonStockLines} non-stock), ${built0.counts.picks} pick(s), `
  + `${built0.counts.moves} moves, Batch rows ${built0.counts.batchRows} (AUTO ${built0.counts.autoRows}, TYPED ${built0.counts.typedRows}); builder problems ${built0.bad.length}`
  + (built0.bad.length ? ": " + built0.bad.slice(0, 3).join("; ") : ""));
const state = { itemBalances: nums(ids(live(snap.ib)), QTY), batchBalances: nums(ids(live(snap.ibb)), QTY),
  fifoLayers: costBatch(nums(ids(live(snap.fifo)), ["fifo_available_quantity", "fifo_cost_price", "fifo_initial_quantity"])),
  waRows: waRows(costBatch(nums(ids(live(snap.wa)), ["wa_quantity", "wa_cost_price"]))) };
const NOW = "2026-10-21 00:00:00";
const p1 = planBulk(Object.assign({ operationKey: built0.I.operation_key, items, movements: built0.I.movements, nowText: NOW, precision }, JSON.parse(JSON.stringify(state))));
if (!p1.ok) {
  console.log(`PLAN REFUSED op 1 ${p1.failure.code} at ${p1.failure.movement_key}: ${p1.failure.message}  (V2 PREPARE: FAILED IDA_INVENTORY_${p1.failure.code}, nothing moved, IDA back to Draft)`);
  process.exit(1);
}
const skipped = p1.results.filter((r) => r.code !== "200");
if (skipped.length) console.log(`   op 1: ${skipped.length} movement(s) answered ${skipped[0].code} inside the 200 (PREPARE refuses: IDA_PLAN_SKIPPED)`);
const issued = p1.movements.reduce((t, m) => t + Number(stored("inventory_movement", "total_price", m.total_price)), 0);
const prices = M.P.idaAllocate(issued, built0.alloc);
const placeholder = {};
built0.batch.rows.filter((r) => r.insert).forEach((r, i) => (placeholder[r.key] = String(9000000000000000001n + BigInt(i))));
const built = M.idaEngineMoves(hdr, lines, items, { jobId: "PLAN", prices, batchIdOf: (k) => placeholder[k] || null });
const after1 = JSON.parse(JSON.stringify(state));
const apply = (rows, upd) => { for (const u of upd) { const r = rows.find((x) => s(x.id) === s(u.id)); if (r) Object.assign(r, u.after); } };
apply(after1.itemBalances, p1.updates.item_balance);
apply(after1.batchBalances, p1.updates.item_batch_balance);
apply(after1.fifoLayers, p1.updates.fifo);
apply(after1.waRows, p1.updates.wa);
const p2 = planBulk(Object.assign({ operationKey: built.R.operation_key, items, movements: built.R.movements, nowText: NOW, precision }, after1));
if (!p2.ok) {
  console.log(`PLAN REFUSED op 2 ${p2.failure.code} at ${p2.failure.movement_key}: ${p2.failure.message}  (V2: PREPARE's receipt PLAN fails the job, FAILED + Draft, nothing moved)`);
  process.exit(1);
}
const skipped2 = p2.results.filter((r) => r.code !== "200");
const out = { op1: { movements: p1.movements.length, skipped: skipped.length, out_total: issued }, op2: { movements: p2.movements.length, skipped: skipped2.length },
  prices: built.alloc.map((a, i) => ({ line_index: a.line_index, item: code[a.item_id] || a.item_id, key: a.movement_key, share: a.share_qty, base: a.base_qty, value: prices[i].value,
    unit_price: prices[i].unit_price })), item_balance: [], item_batch_balance: [], fifo: [], wa: [], movements: [] };
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
    total_price: m.total_price, method: m.costing_method_id });
}
const inTotal = out.movements.filter((m) => m.movement === "IN").reduce((t, m) => t + Number(m.total_price), 0);
const nonStockShare = built.alloc.map((a, i) => (a.movement_key ? 0 : prices[i].value)).reduce((t, v) => t + v, 0);
console.log(`PLAN OK op 1: ${p1.movements.length} OUT, issued value ${issued}; op 2: ${p2.movements.length} IN (${skipped2.length} skipped inside the 200${skipped2.length ? ": PREPARE refuses IDA_PLAN_SKIPPED" : ""}), `
  + `IN total ${q8(inTotal)} (issued ${issued} - non-stock share ${q8(nonStockShare)}; Fixed Cost lines take purchase_unit_price)`);
console.log(`   rows: item_balance ${out.item_balance.length}, item_batch_balance ${out.item_batch_balance.length}, fifo ${out.fifo.length} (new ${p1.creates.fifo.length + p2.creates.fifo.length}), `
  + `wa ${out.wa.length}, inventory_movement ${out.movements.length}; Batch rows D1 inserts: ${Object.keys(placeholder).length} (placeholders 9000000000000000001..)`);
const shown = out.movements.length > 12 ? out.movements.slice(0, 6).concat([{ key: "..." }], out.movements.slice(-5)) : out.movements;
for (const m of shown) {
  if (m.key === "...") { console.log("   ..."); continue; }
  console.log(`   ${String(m.key).padEnd(6)} ${String(m.movement).padEnd(3)} ${String(m.item).slice(0, 22).padEnd(22)} bin ..${String(m.bin).slice(-4)} ${m.batch ? "batch .." + String(m.batch).slice(-4) : "          "} `
    + `qty ${m.quantity} (base ${m.base_qty}) @ ${m.unit_price} = ${m.total_price} ${m.method || ""}`);
}
for (const r of out.fifo.filter((x) => x.id === "new").slice(0, 4)) console.log("   new fifo layer " + JSON.stringify(r));
for (const r of out.wa.slice(0, 4)) console.log("   wa " + JSON.stringify(r));
if (opt("--json")) fs.writeFileSync(opt("--json"), JSON.stringify(out, null, 1));
