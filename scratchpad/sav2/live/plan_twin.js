// Offline pre-flight of a twin document, read-only: the CONTRACT §5 movements of an SA request (parity/v2moves.js) planned by
// the REAL engine planner (scratchpad/gdc/engine/core.js planBulk) over a snap.py snapshot (items WITH their UOM conversions -
// plan_check.js passes none - balances, batch balances, FIFO layers, WA rows, the tenant's number rules). Prints PLAN OK and
// every row the APPLY would write (balance deltas, FIFO consumption / new layers, WA quantity + price, movements), or the
// refusal. The classic writes the same rows through ADD / SUBTRACT_INVENTORY (the engine replays them), so this is the
// expected delta of BOTH twins when they start from this snapshot.
//   node scratchpad/sav2/live/plan_twin.js <request.json> <snapshot.json> [--json out.json]
//   request = {allData} (classic STOCK_ADJUSTMENT) or SA_V2_SUBMIT {form} (FORM); hdr = the request's plant / org /
//   adjustment_date, trx_no "<SA number>"
"use strict";
const fs = require("fs");
const path = require("path");
const { planBulk } = require(path.resolve(__dirname, "..", "..", "gdc", "engine", "core.js"));
const { v2Movements } = require(path.resolve(__dirname, "..", "parity", "v2moves.js"));

const [reqFile, snapFile] = process.argv.slice(2);
if (!reqFile || !snapFile) {
  console.error("usage: node plan_twin.js <request.json> <snapshot.json> [--json out.json]");
  process.exit(2);
}
const reqIn = JSON.parse(fs.readFileSync(reqFile, "utf8"));
const snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
const doc = reqIn.allData || reqIn.form;
if (!doc || !Array.isArray(doc.stock_adjustment)) {
  console.error("not an SA request (no allData / form with stock_adjustment)");
  process.exit(2);
}
const s = (v) => (v === undefined || v === null ? "" : String(v));
const n = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const TABLE_OF = { "1902698977724317697": "item_balance", "1902718803880558594": "item_batch_balance", "1902947165008400386": "fifo_costing_history",
  "1902948453171433474": "wa_costing_method", "1902259348776800257": "inventory_movement", "1902719754154655746": "batch" };
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
const items = {};
for (const it of snap.itemdef || []) {
  items[s(it.id)] = { id: s(it.id), stock_control: Number(it.stock_control), based_uom: s(it.based_uom), material_costing_method: it.material_costing_method,
    purchase_unit_price: n(it.purchase_unit_price), item_batch_management: Number(it.item_batch_management || 0),
    table_uom_conversion: (it.table_uom_conversion || []).map((c) => ({ alt_uom_id: s(c.alt_uom_id), base_uom_id: s(c.base_uom_id), alt_qty: n(c.alt_qty),
      base_qty: n(c.base_qty) })) };
}
const live = (rows) => (rows || []).filter((r) => Number(r.is_deleted || 0) === 0);
const ids = (rows, cols) => rows.map((r) => { const o = Object.assign({}, r); for (const c of cols) if (o[c] !== undefined && o[c] !== null) o[c] = s(o[c]); return o; });
const nums = (rows, cols) => rows.map((r) => { const o = Object.assign({}, r); for (const c of cols) if (o[c] !== undefined && o[c] !== null && o[c] !== "") o[c] = Number(o[c]); return o; });
const costBatch = (rows) => rows.map((r) => Object.assign(r, { batch_id: s(r.batch_id) === "0" || s(r.batch_id) === "" ? null : s(r.batch_id) }));
const ID_COLS = ["id", "material_id", "location_id", "plant_id", "organization_id", "batch_id"];
const hdr = { plant_id: s(doc.plant_id), organization_id: s(doc.organization_id), adjustment_no: "<SA number>", adjustment_date: s(doc.adjustment_date) };
const lines = doc.stock_adjustment.map((l, i) => Object.assign({}, l, { line_index: l.line_index || i + 1 }));
const { ms, bad } = v2Movements({ stock_adjustment: lines }, hdr);
const pl = planBulk({ operationKey: "SAC|PLANTWIN", items, itemBalances: nums(ids(live(snap.ib), ID_COLS), QTY), batchBalances: nums(ids(live(snap.ibb), ID_COLS), QTY),
  fifoLayers: costBatch(nums(ids(live(snap.fifo), ID_COLS), ["fifo_available_quantity", "fifo_cost_price", "fifo_initial_quantity"])),
  waRows: costBatch(nums(ids(live(snap.wa), ID_COLS), ["wa_quantity", "wa_cost_price"])), movements: ms, nowText: "2026-10-16 00:00:00", precision });
const code = Object.fromEntries((snap.itemdef || []).map((i) => [s(i.id), i.material_code]));
console.log(`${path.basename(reqFile)}: ${lines.length} lines, ${ms.length} movements (ADD ${ms.filter((m) => m.direction === "ADD").length}, SUBTRACT `
  + `${ms.filter((m) => m.direction === "SUBTRACT").length}); builder problems ${bad.length}${bad.length ? ": " + bad.join("; ") : ""}`);
if (!pl.ok) {
  console.log(`PLAN REFUSED ${pl.failure.code} at ${pl.failure.movement_key}: ${pl.failure.message}`);
  process.exit(1);
}
const out = { movements: [], item_balance: [], item_batch_balance: [], fifo: [], wa: [] };
for (const r of pl.updates.item_balance) out.item_balance.push({ id: r.id, before: r.before.balance_quantity, after: r.after.balance_quantity });
for (const r of pl.updates.item_batch_balance) out.item_batch_balance.push({ id: r.id, before: r.before.balance_quantity, after: r.after.balance_quantity });
for (const r of pl.creates.item_balance) out.item_balance.push({ id: "new", material: r.material_id, location: r.location_id, after: r.balance_quantity });
for (const r of pl.creates.item_batch_balance) out.item_batch_balance.push({ id: "new", material: r.material_id, location: r.location_id, after: r.balance_quantity });
for (const r of pl.updates.fifo) out.fifo.push({ id: r.id, available_before: r.before.fifo_available_quantity, available_after: r.after.fifo_available_quantity });
for (const r of pl.creates.fifo) out.fifo.push({ id: "new", material: r.material_id, batch: r.batch_id, sequence: r.fifo_sequence, qty: r.fifo_initial_quantity, price: r.fifo_cost_price });
for (const r of pl.updates.wa) out.wa.push({ id: r.id, before: r.before, after: r.after });
for (const r of pl.creates.wa) out.wa.push({ id: "new", material: r.material_id, qty: r.wa_quantity, price: r.wa_cost_price });
for (const m of pl.movements) out.movements.push({ key: m.operation_effect_key.split("|").pop(), item: code[s(m.item_id)] || m.item_id, bin: s(m.bin_location_id), batch: s(m.batch_number_id),
  movement: m.movement, quantity: m.quantity, base_qty: m.base_qty, uom: s(m.uom_id), unit_price: m.unit_price, total_price: m.total_price });
console.log(`PLAN OK: item_balance ${pl.updates.item_balance.length} upd + ${pl.creates.item_balance.length} new, item_batch_balance ${pl.updates.item_batch_balance.length} + `
  + `${pl.creates.item_batch_balance.length}, fifo ${pl.updates.fifo.length} upd + ${pl.creates.fifo.length} new, wa ${pl.updates.wa.length} upd + ${pl.creates.wa.length} new, `
  + `inventory_movement ${pl.movements.length}`);
for (const m of out.movements) console.log(`  ${m.key.padEnd(4)} ${m.movement.padEnd(3)} ${String(m.item).padEnd(12)} bin ..${m.bin.slice(-4)} ${m.batch ? "batch .." + m.batch.slice(-4) : "         "} qty ${m.quantity} (base ${m.base_qty}) @ ${m.unit_price} = ${m.total_price}`);
for (const r of out.fifo) console.log("  fifo " + JSON.stringify(r));
for (const r of out.wa) console.log("  wa   " + JSON.stringify(r));
const jx = process.argv.indexOf("--json");
if (jx > 0) fs.writeFileSync(process.argv[jx + 1], JSON.stringify(out, null, 1));
