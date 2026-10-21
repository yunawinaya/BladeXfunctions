// Synthetic before / after fixtures for reconcile.py's unit test, produced by the REAL planner (scratchpad/gdc/engine/core.js,
// required read-only): each race scenario is planned twice from one seeded state and applied
//   serial      A planned + written, then B planned on A's result + written            -> expect CONSISTENT
//   interleaved A and B both planned on the seed, A written, then B's stale absolutes  -> expect LOST UPDATE / DUPLICATE SEQUENCE
// (exactly what INVENTORY_BULK_APPLY does: it writes each planned row's `after` by id, inserts the creates, inserts the
// movements). Plus hand-made edge cases. Ids are synthetic; no customer data.
//   node scratchpad/sav2/race/test/make_fixtures.js   -> race/test/fixtures/*.json
"use strict";
const fs = require("fs");
const path = require("path");
const { planBulk } = require(path.resolve(__dirname, "..", "..", "..", "gdc", "engine", "core.js"));

const OUT = path.join(__dirname, "fixtures");
fs.mkdirSync(OUT, { recursive: true });
const ORG = "5001";
const PLANT = "7001";
const BIN1 = "6001";
const BIN2 = "6002";
const UOM = "4001";
const MAT = { fifo: "9001", wa: "9002", fifob: "9003", fix: "9004" };
const BATCH = "8001";
const METHOD = { [MAT.fifo]: "First In First Out", [MAT.wa]: "Weighted Average", [MAT.fifob]: "First In First Out", [MAT.fix]: "Fixed Cost" };
const PREC = { price: { dp: 4, mode: 1 }, qty: { dp: 3, mode: 1 }, columns: {} };
const items = {};
for (const [k, id] of Object.entries(MAT)) {
  items[id] = { id, stock_control: 1, based_uom: UOM, material_costing_method: METHOD[id], purchase_unit_price: k === "fix" ? 2.5 : 0, item_batch_management: k === "fifob" ? 1 : 0, table_uom_conversion: [] };
}
const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const bal = (id, mat, loc, q, batch) => Object.assign({ id, material_id: mat, location_id: loc, plant_id: PLANT, organization_id: ORG }, batch ? { batch_id: batch } : {}, { unrestricted_qty: q, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0, balance_quantity: q });
function seed() {
  return {
    fifo: [
      { id: "1101", material_id: MAT.fifo, plant_id: PLANT, organization_id: ORG, batch_id: null, fifo_sequence: 1, fifo_cost_price: 1, fifo_initial_quantity: 500, fifo_available_quantity: 500 },
      { id: "1102", material_id: MAT.fifo, plant_id: PLANT, organization_id: ORG, batch_id: null, fifo_sequence: 2, fifo_cost_price: 2, fifo_initial_quantity: 500, fifo_available_quantity: 500 },
      { id: "1103", material_id: MAT.fifob, plant_id: PLANT, organization_id: ORG, batch_id: BATCH, fifo_sequence: 1, fifo_cost_price: 3, fifo_initial_quantity: 500, fifo_available_quantity: 500 },
      { id: "1104", material_id: MAT.fifob, plant_id: PLANT, organization_id: ORG, batch_id: BATCH, fifo_sequence: 2, fifo_cost_price: 4, fifo_initial_quantity: 500, fifo_available_quantity: 500 },
    ],
    wa: [{ id: "1201", material_id: MAT.wa, plant_id: PLANT, organization_id: ORG, batch_id: null, wa_quantity: 1000, wa_cost_price: 15, created_at: "2026-10-16 10:00:00" }],
    item_balance: [
      bal("1301", MAT.fifo, BIN1, 500), bal("1302", MAT.fifo, BIN2, 500), bal("1303", MAT.wa, BIN1, 500), bal("1304", MAT.wa, BIN2, 500),
      bal("1305", MAT.fifob, BIN1, 500), bal("1306", MAT.fifob, BIN2, 500), bal("1307", MAT.fix, BIN1, 10), bal("1308", MAT.fix, BIN2, 10),
    ],
    item_batch_balance: [bal("1401", MAT.fifob, BIN1, 500, BATCH), bal("1402", MAT.fifob, BIN2, 500, BATCH)],
  };
}
const mv = (key, dir, mat, loc, qty, price, batch) => ({
  movement_key: key, direction: dir, plant_id: PLANT, organization_id: ORG, material_id: mat, quantity: qty, material_uom: UOM, transaction_type: "SA",
  trx_no: "SACRACE|T", inventory_category: "Unrestricted", location_id: loc, batch_id: batch || null, doc_date: "2026-10-16 00:00:00", isMovingInv: 0, unit_price: price || 0,
});
let nextId = 2000;
function plan(state, op, movements) {
  const p = planBulk({ operationKey: op, items, itemBalances: state.item_balance, batchBalances: state.item_batch_balance, fifoLayers: state.fifo, waRows: state.wa, movements, nowText: "2026-10-16 12:00:00", precision: PREC });
  if (!p.ok) throw new Error(op + ": " + JSON.stringify(p.failure));
  return p;
}
// what INVENTORY_BULK_APPLY writes: each planned update's `after` by id, the creates, the movement rows
function apply(state, p, rows) {
  const s = JSON.parse(JSON.stringify(state));
  const map = { item_balance: "item_balance", item_batch_balance: "item_batch_balance", fifo: "fifo", wa: "wa" };
  for (const t of Object.keys(map)) {
    for (const u of p.updates[t]) {
      const r = s[map[t]].find((x) => String(x.id) === String(u.id));
      Object.assign(r, u.after);
    }
    for (const c of p.creates[t]) s[map[t]].push(Object.assign({}, c, { id: String(++nextId) }));
  }
  for (const m of p.movements) rows.push({ operation_effect_key: m.operation_effect_key, movement: m.movement, item_id: m.item_id, plant_id: m.plant_id, bin_location_id: m.bin_location_id, batch_number_id: m.batch_number_id, base_qty: m.base_qty, unit_price: m.unit_price, total_price: m.total_price });
  return s;
}
const text = (s) => JSON.parse(JSON.stringify(s, (k, v) => (typeof v === "number" ? String(v) : v)));
function write(name, about, expect, before, after, movements, extra) {
  fs.writeFileSync(path.join(OUT, name + ".json"), JSON.stringify(Object.assign({ about, expect, materials: METHOD, before: text(before), after: text(after), movements: text(movements) }, extra || {}), null, 1));
  console.log(name.padEnd(28), expect.padEnd(40), about);
}

const SC = {
  R0: { A: [mv("M1", "SUBTRACT", MAT.fifo, BIN1, 5)], B: (() => { const l = []; for (let i = 1; i < 21; i++) l.push(mv("M" + i, i % 2 ? "ADD" : "SUBTRACT", MAT.fix, BIN1, 1)); l.push(mv("M21", "SUBTRACT", MAT.fifo, BIN2, 10)); return l; })() },
  R1: { A: [mv("M1", "SUBTRACT", MAT.fifo, BIN1, 5)], B: [mv("M1", "SUBTRACT", MAT.fifo, BIN2, 7)] },
  R1b: { A: [mv("M1", "SUBTRACT", MAT.fifob, BIN1, 5, 0, BATCH)], B: [mv("M1", "SUBTRACT", MAT.fifob, BIN2, 7, 0, BATCH)] },
  R2: { A: [mv("M1", "ADD", MAT.wa, BIN1, 10, 30)], B: [mv("M1", "ADD", MAT.wa, BIN2, 10, 50)] },
  R2s: { A: [mv("M1", "ADD", MAT.wa, BIN1, 10, 30)], B: [mv("M1", "SUBTRACT", MAT.wa, BIN2, 10)] },
  R3: { A: [mv("M1", "ADD", MAT.fifo, BIN1, 10, 5)], B: [mv("M1", "ADD", MAT.fifo, BIN2, 10, 6)] },
  R3b: { A: [mv("M1", "ADD", MAT.fifob, BIN1, 10, 5, BATCH)], B: [mv("M1", "ADD", MAT.fifob, BIN2, 10, 6, BATCH)] },
};
const EXPECT = { R0: "LOST UPDATE", R1: "LOST UPDATE", R1b: "LOST UPDATE", R2: "LOST UPDATE", R2s: "LOST UPDATE", R3: "DUPLICATE SEQUENCE", R3b: "DUPLICATE SEQUENCE" };
for (const [name, sc] of Object.entries(SC)) {
  const run = name;
  const s0 = seed();
  // serial: A then B planned on A's result
  let rows = [];
  const s1 = apply(s0, plan(s0, "SACRACE|" + run + "|A", JSON.parse(JSON.stringify(sc.A))), rows);
  const s2 = apply(s1, plan(s1, "SACRACE|" + run + "|B", JSON.parse(JSON.stringify(sc.B))), rows);
  write(name + "_serial", name + " serial (A written before B read)", "CONSISTENT", s0, s2, rows);
  // interleaved: both planned on the seed; A written first, then B's stale absolutes (eb's silent interleaving)
  rows = [];
  const pA = plan(s0, "SACRACE|" + run + "|A", JSON.parse(JSON.stringify(sc.A)));
  const pB = plan(s0, "SACRACE|" + run + "|B", JSON.parse(JSON.stringify(sc.B)));
  const lost = apply(apply(s0, pA, rows), pB, rows);
  write(name + "_interleaved", name + " interleaved (B read, A wrote, B wrote stale absolutes)", EXPECT[name], s0, lost, rows);
  if (name === "R2") {
    rows = [];
    const lost2 = apply(apply(s0, pB, rows), pA, rows);
    write(name + "_interleaved_rev", name + " interleaved, A's stale write last", EXPECT[name], s0, lost2, rows);
  }
}
// hand-made edges
{
  const s0 = seed();
  s0.fifo.find((r) => r.id === "1102").fifo_available_quantity = 300; // costing behind the bins: layers hold 800 of the 1,000 in stock
  const rows = [];
  const s1 = apply(s0, plan(s0, "SACRACE|E1|A", [mv("M1", "SUBTRACT", MAT.fifo, BIN1, 400)]), rows);
  const s2 = apply(s1, plan(s1, "SACRACE|E1|B", [mv("M1", "SUBTRACT", MAT.fifo, BIN2, 450)]), rows);
  // a third op takes the remaining layers down to 0 and beyond (classic and engine consume what exists)
  const s3 = apply(s2, plan(s2, "SACRACE|E1|A", [mv("M2", "SUBTRACT", MAT.fifo, BIN1, 100)]), rows);
  const s4 = apply(s3, plan(s3, "SACRACE|E1|B", [mv("M2", "SUBTRACT", MAT.fifo, BIN2, 50)]), rows);
  write("E1_shortfall", "FIFO OUT beyond the layers' available quantity (layers 800, bins 1,000; serial)", "SHORTFALL", s0, s4, rows);
}
{
  const s0 = seed();
  const rows = [];
  const s1 = apply(s0, plan(s0, "SACRACE|E2|A", [mv("M1", "SUBTRACT", MAT.fifo, BIN1, 5)]), rows);
  const bad = JSON.parse(JSON.stringify(s1));
  bad.item_balance.find((r) => r.id === "1301").balance_quantity = 497; // a bin row off by 2: never expected under the ITEM| lock
  bad.item_balance.find((r) => r.id === "1301").unrestricted_qty = 497;
  write("E2_balance_mismatch", "a bin row moved differently from its movements (lock failure control)", "BALANCE MISMATCH", s0, bad, rows);
}
{
  const s0 = seed();
  const rows = [];
  const pA = plan(s0, "SACRACE|E3|A", [mv("M1", "ADD", MAT.fifo, BIN1, 10, 5)]);
  const pB = plan(s0, "SACRACE|E3|B", [mv("M1", "ADD", MAT.fifo, BIN2, 10, 6)]);
  const s = apply(apply(s0, pA, rows), pB, rows);
  s.fifo.pop(); // B's movement and bin rows are written but its layer insert is lost (e.g. an add-node failure)
  write("E3_lost_layer", "two IN movements, one new FIFO layer", "LOST UPDATE", s0, s, rows);
}
{
  const s0 = seed();
  const rows = [];
  const s1 = apply(s0, plan(s0, "SACRACE|E4|A", [mv("M1", "ADD", MAT.fix, BIN1, 3), mv("M2", "SUBTRACT", MAT.fix, BIN1, 1)]), rows);
  write("E4_fixed_cost_only", "Fixed Cost movements: bins only, no cost row", "CONSISTENT", s0, s1, rows);
}
