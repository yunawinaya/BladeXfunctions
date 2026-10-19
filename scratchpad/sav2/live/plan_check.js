// Feasibility of a 2k payload against TODAY's dev rows, offline: the CONTRACT §5 movements of the SA document
// (parity/v2moves.js) planned by the real engine planner (scratchpad/gdc/engine/core.js, required read-only) with the rows
// INVENTORY_BULK_APPLY would read (items, balances, batch balances, every FIFO / WA row of the materials at the plant) and
// the tenant's number rules. Prints PLAN OK + what the APPLY would write, or the first refusal. Writes nothing anywhere.
//   node scratchpad/sav2/live/plan_check.js <engine_input.json>
//   engine_input = { saDoc, hdr, items: [item rows], itemBalances, batchBalances, fifoLayers, waRows, precision: [rule rows] }
"use strict";
const fs = require("fs");
const path = require("path");
const { planBulk } = require(path.resolve(__dirname, "..", "..", "gdc", "engine", "core.js"));
const { v2Movements } = require(path.resolve(__dirname, "..", "parity", "v2moves.js"));

const inp = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const s = (v) => (v === undefined || v === null ? "" : String(v));
const n = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const TABLE_OF = { "1902698977724317697": "item_balance", "1902718803880558594": "item_batch_balance", "1902947165008400386": "fifo_costing_history",
  "1902948453171433474": "wa_costing_method", "1902259348776800257": "inventory_movement", "1902719754154655746": "batch" };
// code_node_IBplan's precision build
const precision = { price: null, qty: null, columns: {} };
for (const r of inp.precision || []) {
  const mode = Number(r.precision_rule);
  const dp = Number(r.decimal_places);
  const rule = Number(r.store_raw_value) === 1 || dp >= 8 ? { dp: null, mode } : { dp, mode };
  if (s(r.scope_type) === "2") {
    if (TABLE_OF[s(r.table_id)] && s(r.field_name)) precision.columns[TABLE_OF[s(r.table_id)] + "." + s(r.field_name)] = rule;
  } else if (s(r.rule_key) === "Inventory Price") precision.price = rule;
  else if (s(r.rule_key) === "Inventory Qty") precision.qty = rule;
}
const items = {};
for (const it of inp.items || []) {
  items[s(it.id)] = { id: s(it.id), stock_control: Number(it.stock_control), based_uom: s(it.based_uom), material_costing_method: it.material_costing_method,
    purchase_unit_price: n(it.purchase_unit_price), item_batch_management: Number(it.item_batch_management || 0), table_uom_conversion: [] };
}
const numCols = (rows, cols) => (rows || []).map((r) => { const o = Object.assign({}, r); for (const c of cols) if (o[c] !== undefined && o[c] !== null && o[c] !== "") o[c] = Number(o[c]); return o; });
const costBatch = (rows) => rows.map((r) => Object.assign(r, { batch_id: s(r.batch_id) === "0" || s(r.batch_id) === "" ? null : s(r.batch_id) }));
const { ms, bad } = v2Movements(inp.saDoc, inp.hdr);
const DIG = /^[0-9]{1,20}$/;
const guard = [];
const org = s((inp.hdr || inp.saDoc || {}).organization_id);
ms.forEach((m) => {
  for (const f of ["material_id", "plant_id", "location_id"]) if (!DIG.test(s(m[f]))) guard.push(m.movement_key + " " + f);
  if (s(m.batch_id) && !DIG.test(s(m.batch_id))) guard.push(m.movement_key + " batch_id");
  if (s(m.organization_id) !== org) guard.push(m.movement_key + " organization_id");
});
const pl = planBulk({ operationKey: "SAC|PLANCHECK", items, itemBalances: numCols(inp.itemBalances, QTY), batchBalances: numCols(inp.batchBalances, QTY),
  fifoLayers: costBatch(numCols(inp.fifoLayers, ["fifo_available_quantity", "fifo_cost_price"])), waRows: costBatch(numCols(inp.waRows, ["wa_quantity", "wa_cost_price"])),
  movements: ms, nowText: "2026-10-16 00:00:00", precision });
const dirs = ms.reduce((o, m) => ((o[m.direction] = (o[m.direction] || 0) + 1), o), {});
console.log(`movements ${ms.length} (ADD ${dirs.ADD || 0}, SUBTRACT ${dirs.SUBTRACT || 0}, batch ${ms.filter((m) => m.batch_id).length}); builder problems ${bad.length}; engine guard refusals ${guard.length}${guard.length ? " e.g. " + guard.slice(0, 3).join(", ") : ""}`);
if (!pl.ok) {
  console.log(`PLAN REFUSED ${pl.failure.code} at ${pl.failure.movement_key}: ${pl.failure.message}`);
  process.exit(1);
}
const u = pl.updates;
const c = pl.creates;
const lockKeys = new Set(ms.map((m) => "ITEM|" + m.material_id + "|" + m.location_id).concat(ms.filter((m) => m.batch_id).map((m) => "BATCH|" + m.material_id + "|" + m.location_id + "|" + m.batch_id)));
const intent = JSON.stringify(pl).length;
console.log(`PLAN OK: results ${pl.results.length} (401 skipped ${pl.results.filter((r) => r.code === "401").length}); writes item_balance ${u.item_balance.length} upd + ${c.item_balance.length} new, item_batch_balance ${u.item_batch_balance.length} + ${c.item_batch_balance.length}, ` +
  `fifo ${u.fifo.length} upd + ${c.fifo.length} new, wa ${u.wa.length} upd + ${c.wa.length} new, inventory_movement ${pl.movements.length}; lock keys ${lockKeys.size}; intent ${(intent / 1e6).toFixed(2)} MB (${Math.ceil(intent / 400000)} IBA|I rows)`);
