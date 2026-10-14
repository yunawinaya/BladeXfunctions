// node test_core.js — branch tests of core.js on synthetic rows
const assert = require("assert");
const { planBulk } = require("./core.js");

const ORG = "100";
const PLANT = "200";
const item = (id, method, extra) =>
  Object.assign({ id, stock_control: 1, based_uom: "U1", material_costing_method: method, purchase_unit_price: 7, table_uom_conversion: [{ alt_uom_id: "BOX", base_qty: 12 }] }, extra || {});
const bal = (id, mat, loc, cols) => Object.assign({ id, material_id: mat, location_id: loc, plant_id: PLANT, organization_id: ORG, unrestricted_qty: 0, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0, balance_quantity: 0 }, cols);
const sub = (key, mat, loc, qty, extra) =>
  Object.assign({ movement_key: key, direction: "SUBTRACT", plant_id: PLANT, organization_id: ORG, material_id: mat, quantity: qty, location_id: loc, inventory_category: "Reserved", transaction_type: "GDL", trx_no: "GD/1", doc_date: "2026-10-13", isMovingInv: 0 }, extra || {});
const add = (key, mat, loc, qty, extra) =>
  Object.assign({ movement_key: key, direction: "ADD", plant_id: PLANT, organization_id: ORG, material_id: mat, quantity: qty, location_id: loc, inventory_category: "Unrestricted", transaction_type: "GDL", trx_no: "GD/1", doc_date: "2026-10-13", isMovingInv: 1 }, extra || {});
const upd = (plan, table, id) => plan.updates[table].find((u) => u.id === id);
let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log("ok", name);
};

t("FIFO: two lines of one item consume layers in order and price cumulatively", () => {
  const p = planBulk({
    operationKey: "OP",
    items: { M1: item("M1", "First In First Out") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 10, balance_quantity: 30, unrestricted_qty: 20 })],
    fifoLayers: [
      { id: "F2", material_id: "M1", plant_id: PLANT, organization_id: ORG, batch_id: null, fifo_sequence: "2", fifo_available_quantity: 5, fifo_cost_price: 3 },
      { id: "F1", material_id: "M1", plant_id: PLANT, organization_id: ORG, batch_id: null, fifo_sequence: "1", fifo_available_quantity: 4, fifo_cost_price: 2 },
    ],
    movements: [sub("a", "M1", "L1", 3), sub("b", "M1", "L1", 4)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.results[0].unit_price, 2); // 3 from layer 1 @2
  assert.strictEqual(p.results[1].unit_price, 2.75); // 1 @2 + 3 @3 = 11 / 4
  assert.deepStrictEqual(upd(p, "fifo", "F1").after, { fifo_available_quantity: 0 });
  assert.deepStrictEqual(upd(p, "fifo", "F2").after, { fifo_available_quantity: 2 });
  const b = upd(p, "item_balance", "B1");
  assert.strictEqual(b.before.reserved_qty, 10);
  assert.strictEqual(b.after.reserved_qty, 3);
  assert.strictEqual(b.after.balance_quantity, 23);
  assert.strictEqual(b.after.unrestricted_qty, 20);
  assert.strictEqual(p.movements.length, 2);
  assert.strictEqual(p.movements[1].operation_effect_key, "OP|b");
  assert.strictEqual(p.movements[1].actual_base_qty, -4);
  assert.strictEqual(p.movements[1].total_price, 11);
});

t("FIFO shortfall priced at the highest-sequence layer, even used up", () => {
  const p = planBulk({
    items: { M1: item("M1", "First In First Out") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 10, balance_quantity: 10 })],
    fifoLayers: [
      { id: "F1", material_id: "M1", plant_id: PLANT, organization_id: ORG, fifo_sequence: 1, fifo_available_quantity: 2, fifo_cost_price: 4 },
      { id: "F2", material_id: "M1", plant_id: PLANT, organization_id: ORG, fifo_sequence: 2, fifo_available_quantity: 0, fifo_cost_price: 10 },
    ],
    movements: [sub("a", "M1", "L1", 4)],
  });
  assert.ok(p.ok);
  assert.strictEqual(p.results[0].unit_price, 7); // (2*4 + 2*10)/4
  assert.deepStrictEqual(upd(p, "fifo", "F1").after, { fifo_available_quantity: 0 });
  assert.strictEqual(upd(p, "fifo", "F2"), undefined);
});

t("UOM conversion: BOX x12 to base", () => {
  const p = planBulk({
    items: { M1: item("M1", "Fixed Cost") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 30, balance_quantity: 30 })],
    movements: [sub("a", "M1", "L1", 2, { material_uom: "BOX" })],
  });
  assert.ok(p.ok);
  assert.strictEqual(p.movements[0].base_qty, 24);
  assert.strictEqual(p.movements[0].quantity, 2);
  assert.strictEqual(p.movements[0].uom_id, "BOX");
  assert.strictEqual(p.movements[0].unit_price, 7);
  assert.strictEqual(upd(p, "item_balance", "B1").after.reserved_qty, 6);
});

t("batch: deducts batch row and the item aggregate, dates from the batch row", () => {
  const p = planBulk({
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 9, balance_quantity: 9 })],
    batchBalances: [Object.assign(bal("T1", "M1", "L1", { reserved_qty: 5, balance_quantity: 5 }), { batch_id: "X1", manufacturing_date: "2026-01-01", expired_date: "2027-01-01" })],
    waRows: [
      { id: "W1", material_id: "M1", plant_id: PLANT, organization_id: ORG, batch_id: "X1", wa_quantity: 8, wa_cost_price: 1.5, created_at: "2026-01-01 00:00:00" },
      { id: "W2", material_id: "M1", plant_id: PLANT, organization_id: ORG, batch_id: "X1", wa_quantity: 5, wa_cost_price: 2.5, created_at: "2026-02-01 00:00:00" },
    ],
    movements: [sub("a", "M1", "L1", 5, { batch_id: "X1" })],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.results[0].unit_price, 2.5); // newest WA row
  assert.strictEqual(p.results[0].manufacturing_date, "2026-01-01");
  assert.strictEqual(upd(p, "item_batch_balance", "T1").after.reserved_qty, 0);
  assert.strictEqual(upd(p, "item_balance", "B1").after.reserved_qty, 4);
  assert.deepStrictEqual(upd(p, "wa", "W2").after, { wa_quantity: 0, wa_cost_price: 2.5 });
  assert.strictEqual(upd(p, "wa", "W1"), undefined);
});

t("insufficient: the whole plan fails, first offender named", () => {
  const p = planBulk({
    items: { M1: item("M1", "Fixed Cost") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 5, balance_quantity: 5 })],
    movements: [sub("a", "M1", "L1", 3), sub("b", "M1", "L1", 3)],
  });
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.failure.code, "INSUFFICIENT");
  assert.strictEqual(p.failure.movement_key, "b");
  assert.strictEqual(p.failure.message, "Insufficient quantity");
});

t("release pair: Reserved -> Unrestricted at the SUBTRACT's price, no costing write", () => {
  const p = planBulk({
    items: { M1: item("M1", "First In First Out") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 6, unrestricted_qty: 1, balance_quantity: 7 })],
    fifoLayers: [{ id: "F1", material_id: "M1", plant_id: PLANT, organization_id: ORG, fifo_sequence: 1, fifo_available_quantity: 7, fifo_cost_price: 3 }],
    movements: [sub("r1", "M1", "L1", 2, { isMovingInv: 1 }), add("r2", "M1", "L1", 2, { unit_price_from: "r1" })],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  const b = upd(p, "item_balance", "B1").after;
  assert.strictEqual(b.reserved_qty, 4);
  assert.strictEqual(b.unrestricted_qty, 3);
  assert.strictEqual(b.balance_quantity, 7);
  assert.strictEqual(p.updates.fifo.length, 0);
  assert.strictEqual(p.movements[1].movement, "IN");
  assert.strictEqual(p.movements[1].unit_price, 3);
  assert.strictEqual(p.movements[1].actual_base_qty, 2);
});

t("costing migration states are refused", () => {
  const both = planBulk({
    items: { M1: item("M1", "First In First Out") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 6, balance_quantity: 6 })],
    fifoLayers: [{ id: "F1", material_id: "M1", plant_id: PLANT, organization_id: ORG, fifo_sequence: 1, fifo_available_quantity: 7, fifo_cost_price: 3 }],
    waRows: [{ id: "W1", material_id: "M1", plant_id: PLANT, organization_id: ORG, wa_quantity: 1, wa_cost_price: 1 }],
    movements: [sub("a", "M1", "L1", 1)],
  });
  assert.strictEqual(both.failure.code, "UNSUPPORTED_COSTING");
  const wrong = planBulk({
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 6, balance_quantity: 6 })],
    fifoLayers: [{ id: "F1", material_id: "M1", plant_id: PLANT, organization_id: ORG, fifo_sequence: 1, fifo_available_quantity: 7, fifo_cost_price: 3 }],
    movements: [sub("a", "M1", "L1", 1)],
  });
  assert.strictEqual(wrong.failure.code, "UNSUPPORTED_COSTING");
});

t("WA item without a WA row fails like SUBTRACT's throw", () => {
  const p = planBulk({
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 6, balance_quantity: 6 })],
    movements: [sub("a", "M1", "L1", 1)],
  });
  assert.strictEqual(p.failure.code, "NO_WA_RECORD");
});

t("stock_control 0 is skipped with 401 and writes nothing", () => {
  const p = planBulk({ items: { M1: item("M1", "Fixed Cost", { stock_control: 0 }) }, movements: [sub("a", "M1", "L1", 1)] });
  assert.ok(p.ok);
  assert.strictEqual(p.results[0].code, "401");
  assert.strictEqual(p.movements.length, 0);
});

t("ADD GRN on FIFO: PO price, new balance row, next FIFO sequence", () => {
  const p = planBulk({
    nowText: "2026-10-13 10:00:00",
    items: { M1: item("M1", "First In First Out") },
    fifoLayers: [{ id: "F1", material_id: "M1", plant_id: PLANT, organization_id: ORG, fifo_sequence: 3, fifo_available_quantity: 0, fifo_cost_price: 3 }],
    movements: [add("g", "M1", "L9", 2, { transaction_type: "GRN", isMovingInv: 0, material_uom: "BOX", po_quantity: 10, po_amount: 1200, exchange_rate: 1, unit_price: 0 })],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  // ppu 120 per BOX, conversion 12 -> 10 per base unit
  assert.strictEqual(p.results[0].unit_price, 10);
  assert.strictEqual(p.creates.item_balance.length, 1);
  assert.strictEqual(p.creates.item_balance[0].unrestricted_qty, 24);
  assert.strictEqual(p.creates.fifo[0].fifo_sequence, 4);
  assert.strictEqual(p.creates.fifo[0].fifo_available_quantity, 24);
});

t("ADD new batch: batch, batch balance and WA rows created", () => {
  const p = planBulk({
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { unrestricted_qty: 1, balance_quantity: 1 })],
    movements: [add("g", "M1", "L1", 3, { transaction_type: "MSR", isMovingInv: 0, batch_number: "LOT-9", unit_price: 4, remark: "r" })],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.creates.batch.length, 1);
  assert.strictEqual(p.creates.item_batch_balance[0].batch_id, p.creates.batch[0].id);
  assert.strictEqual(p.creates.wa[0].wa_quantity, 3);
  assert.strictEqual(upd(p, "item_balance", "B1").after.unrestricted_qty, 4);
});

t("ADD on WA without batch re-averages the newest row", () => {
  const p = planBulk({
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { unrestricted_qty: 2, balance_quantity: 2 })],
    waRows: [{ id: "W1", material_id: "M1", plant_id: PLANT, organization_id: ORG, wa_quantity: 2, wa_cost_price: 5 }],
    movements: [add("g", "M1", "L1", 2, { transaction_type: "MSR", isMovingInv: 0, unit_price: 7 })],
  });
  assert.ok(p.ok);
  assert.deepStrictEqual(upd(p, "wa", "W1").after, { wa_quantity: 4, wa_cost_price: 6 });
});

t("duplicate balance rows refuse the plan", () => {
  const p = planBulk({
    items: { M1: item("M1", "Fixed Cost") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 5, balance_quantity: 5 }), bal("B2", "M1", "L1", { reserved_qty: 5, balance_quantity: 5 })],
    movements: [sub("a", "M1", "L1", 1)],
  });
  assert.strictEqual(p.failure.code, "DUPLICATE_BALANCE");
});

console.log(n + " passed");
