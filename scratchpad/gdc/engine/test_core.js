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
  assert.strictEqual(p.creates.fifo[0].fifo_sequence, "4");
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

t("precision: a WA receipt re-average and the balances are stored at the tenant rule (4 dp price, 3 dp qty)", () => {
  const p = planBulk({
    precision: { price: 4, qty: 3 },
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { unrestricted_qty: 3, balance_quantity: 3 })],
    waRows: [{ id: "W1", material_id: "M1", plant_id: PLANT, organization_id: ORG, batch_id: null, wa_quantity: 3, wa_cost_price: 10, created_at: "2026-10-01 00:00:00" }],
    movements: [add("a", "M1", "L1", 1, { isMovingInv: 0, transaction_type: "GRN", unit_price: 1.00005, po_quantity: 1, po_amount: 1.00005, exchange_rate: 1 })],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  // (10 * 3 + 1.00005 * 1) / 4 = 7.7500125 -> 7.7500 stored; the movement price 1.00005 -> 1.0001
  assert.deepStrictEqual(upd(p, "wa", "W1").after, { wa_quantity: 4, wa_cost_price: 7.75 });
  assert.strictEqual(p.movements[0].unit_price, 1.0001);
  assert.strictEqual(p.results[0].unit_price, 1.00005); // the caller still gets the computed price
});

t("precision: a later movement reads the stored (rounded) value, as the old path's next call did", () => {
  const p = planBulk({
    precision: { price: 4, qty: 3 },
    items: { M1: item("M1", "Fixed Cost") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 1, balance_quantity: 1 })],
    movements: [sub("a", "M1", "L1", 0.0004), sub("b", "M1", "L1", 0.0004)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  // 1 - 0.0004 = 0.9996 -> 1.000 stored; again -> 1.000
  assert.strictEqual(upd(p, "item_balance", "B1").after.reserved_qty, 1);
  assert.strictEqual(p.movements[0].base_qty, 0);
});

t("no precision given: values kept at 8 dp (unchanged behaviour)", () => {
  const p = planBulk({
    items: { M1: item("M1", "Fixed Cost") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 1, balance_quantity: 1 })],
    movements: [sub("a", "M1", "L1", 0.0004)],
  });
  assert.strictEqual(upd(p, "item_balance", "B1").after.reserved_qty, 0.9996);
});

t("a category move with its price given skips the costing-migration refusal; without a price it still refuses", () => {
  const rows = {
    items: { M1: item("M1", "First In First Out") },
    itemBalances: [bal("B1", "M1", "L1", { unrestricted_qty: 5, balance_quantity: 5 })],
    fifoLayers: [{ id: "F1", material_id: "M1", plant_id: PLANT, organization_id: ORG, fifo_sequence: 1, fifo_available_quantity: 5, fifo_cost_price: 2 }],
    waRows: [{ id: "W1", material_id: "M1", plant_id: PLANT, organization_id: ORG, wa_quantity: 5, wa_cost_price: 2 }],
  };
  const priced = planBulk(Object.assign({}, rows, { movements: [sub("a", "M1", "L1", 1, { inventory_category: "Unrestricted", isMovingInv: 1, unit_price: 2 })] }));
  assert.ok(priced.ok, JSON.stringify(priced.failure));
  assert.strictEqual(priced.updates.fifo.length + priced.updates.wa.length, 0); // no costing row touched
  const unpriced = planBulk(Object.assign({}, rows, { movements: [sub("a", "M1", "L1", 1, { inventory_category: "Unrestricted", isMovingInv: 1 })] }));
  assert.strictEqual(unpriced.failure.code, "UNSUPPORTED_COSTING");
});

t("a negative price is refused before anything is planned (given, or computed for a GRN)", () => {
  const base = { items: { M1: item("M1", "First In First Out") }, itemBalances: [bal("B1", "M1", "L1", {})] };
  const given = planBulk(Object.assign({}, base, { movements: [add("a", "M1", "L1", 1, { isMovingInv: 0, transaction_type: "GRN", unit_price: -1, po_quantity: 1, po_amount: 5 })] }));
  assert.strictEqual(given.failure.code, "UNSUPPORTED_PRICE");
  const computed = planBulk(Object.assign({}, base, { movements: [add("a", "M1", "L1", 1, { isMovingInv: 0, transaction_type: "GRN", unit_price: 0, po_quantity: 1, po_amount: -5 })] }));
  assert.strictEqual(computed.failure.code, "UNSUPPORTED_PRICE");
});

t("snapshot: a column first touched by a later movement (the ADD's remark after a SUBTRACT) reaches the write", () => {
  const p = planBulk({
    items: { M1: item("M1", "Fixed Cost") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 2, balance_quantity: 2 })],
    batchBalances: [Object.assign(bal("BB1", "M1", "L1", { reserved_qty: 2, balance_quantity: 2 }), { batch_id: "BA1", remark: "old" })],
    movements: [sub("a", "M1", "L1", 1, { batch_id: "BA1" }), add("b", "M1", "L1", 1, { batch_id: "BA1", remark: "new" })],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  const u = upd(p, "item_batch_balance", "BB1");
  assert.strictEqual(u.before.remark, "old");
  assert.strictEqual(u.after.remark, "new");
});

t("customised rules: truncate toward zero for prices, and a per-column override (item_balance.reserved_qty 1 dp)", () => {
  const p = planBulk({
    precision: { price: { dp: 2, mode: 2 }, qty: { dp: 3, mode: 1 }, columns: { "item_balance.reserved_qty": { dp: 1, mode: 3 } } },
    items: { M1: item("M1", "Fixed Cost", { purchase_unit_price: 7.129 }) },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 5, balance_quantity: 5 })],
    movements: [sub("a", "M1", "L1", 1.0004)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  const b = upd(p, "item_balance", "B1");
  assert.strictEqual(b.after.reserved_qty, 4); // 3.9996 away from zero at 1 dp -> 4.0
  assert.strictEqual(b.after.balance_quantity, 4); // 3.9996 half-up at 3 dp -> 4.000
  assert.strictEqual(p.movements[0].unit_price, 7.12); // 7.129 toward zero at 2 dp
  assert.strictEqual(p.movements[0].total_price, 7.13); // 7.1318516 toward zero
});

t("store raw value (dp null) keeps 8 dp for that rule", () => {
  const p = planBulk({
    precision: { price: { dp: null, mode: 1 }, qty: { dp: null, mode: 1 } },
    items: { M1: item("M1", "Fixed Cost") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 1, balance_quantity: 1 })],
    movements: [sub("a", "M1", "L1", 0.0004)],
  });
  assert.strictEqual(upd(p, "item_balance", "B1").after.reserved_qty, 0.9996);
});

// ---------------------------------------------------------------- costing migration (opt-in: input.migrateCosting)
const fifoL = (id, mat, seq, avail, cost, extra) => Object.assign({ id, material_id: mat, plant_id: PLANT, organization_id: ORG, batch_id: null, fifo_sequence: String(seq), fifo_available_quantity: avail, fifo_initial_quantity: avail, fifo_cost_price: cost }, extra || {});
const waR = (id, mat, qty, cost, extra) => Object.assign({ id, material_id: mat, plant_id: PLANT, organization_id: ORG, batch_id: null, wa_quantity: qty, wa_cost_price: cost, created_at: "" }, extra || {});
const P4 = { price: { dp: 4, mode: 1 }, qty: { dp: 3, mode: 1 } };

t("migration: a WA item with FIFO rows only gets one WA row (weighted, at the tenant rule), FIFO retired, then priced + deducted from it", () => {
  const p = planBulk({
    migrateCosting: { ["M1|" + PLANT]: true },
    precision: P4,
    nowText: "2026-10-30 12:00:00",
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 12, unrestricted_qty: 1000999958, balance_quantity: 1000999970 })],
    fifoLayers: [fifoL("F1", "M1", 1, 999971, 0), fifoL("F2", "M1", 2, 999999999, 52)],
    movements: [sub("a", "M1", "L1", 12)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.creates.wa.length, 1);
  const w = p.creates.wa[0];
  assert.strictEqual(w.wa_cost_price, 51.9481); // V97: 51.94805345 at 4 dp, as the platform stores it
  assert.strictEqual(w.wa_quantity, 1000999958); // 1,000,999,970 merged, 12 deducted
  assert.strictEqual(w.created_at, "2026-10-30 12:00:00");
  assert.ok(!("batch_id" in w));
  for (const id of ["F1", "F2"]) {
    const f = upd(p, "fifo", id);
    assert.deepStrictEqual(f.after, { fifo_available_quantity: f.before.fifo_available_quantity, is_deleted: 1 });
    assert.strictEqual(f.before.is_deleted, null);
  }
  assert.strictEqual(p.results[0].unit_price, 51.9481);
  assert.strictEqual(p.results[0].costing_migrated, "FIFO_TO_WA");
  assert.strictEqual(p.movements[0].unit_price, 51.9481);
});

t("migration: a WA item with both kinds merges FIFO into its newest WA row (wc*wq + avg*Q)/(wq+Q), FIFO retired, older WA row kept", () => {
  const p = planBulk({
    migrateCosting: "ALL",
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 5, balance_quantity: 5 })],
    fifoLayers: [fifoL("F1", "M1", 1, 10, 4), fifoL("F2", "M1", 2, 0, 99)],
    waRows: [waR("W1", "M1", 1, 1, { created_at: "2026-01-01 00:00:00" }), waR("W2", "M1", 30, 2, { created_at: "2026-10-01 00:00:00" })],
    movements: [sub("a", "M1", "L1", 5)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  const w2 = upd(p, "wa", "W2");
  // (2*30 + 4*10) / 40 = 2.5; then 5 out
  assert.deepStrictEqual(w2.after, { wa_quantity: 35, wa_cost_price: 2.5 });
  assert.strictEqual(upd(p, "wa", "W1"), undefined);
  assert.strictEqual(upd(p, "fifo", "F1").after.is_deleted, 1);
  assert.strictEqual(upd(p, "fifo", "F2").after.is_deleted, 1); // retired even at 0 available, as classic
  assert.strictEqual(p.results[0].unit_price, 2.5);
  assert.strictEqual(p.results[0].costing_migrated, "FIFO_INTO_WA");
  assert.strictEqual(p.creates.wa.length, 0);
});

t("migration: a FIFO item with WA rows only gets the newest WA row as layer 1, WA retired, then priced + deducted (classic priced 0)", () => {
  const p = planBulk({
    migrateCosting: "ALL",
    items: { M1: item("M1", "First In First Out") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 4, unrestricted_qty: 6, balance_quantity: 10 })],
    waRows: [waR("W1", "M1", 10, 3.5), waR("W0", "M1", 7, 9, { created_at: "" })],
    movements: [sub("a", "M1", "L1", 4)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.creates.fifo.length, 1);
  const l = p.creates.fifo[0];
  assert.strictEqual(l.fifo_sequence, "1");
  assert.strictEqual(l.fifo_cost_price, 3.5);
  assert.strictEqual(l.fifo_initial_quantity, 10);
  assert.strictEqual(l.fifo_available_quantity, 6); // deducted in the same movement
  assert.strictEqual(upd(p, "wa", "W1").after.is_deleted, 1);
  assert.strictEqual(upd(p, "wa", "W0").after.is_deleted, 1);
  assert.strictEqual(p.results[0].unit_price, 3.5);
  assert.strictEqual(p.results[0].costing_migrated, "WA_TO_FIFO");
});

t("migration: a FIFO item with both kinds gets the newest WA row as the next layer (max + 1), priced in FIFO order", () => {
  const p = planBulk({
    migrateCosting: "ALL",
    items: { M1: item("M1", "First In First Out") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 6, balance_quantity: 6 })],
    fifoLayers: [fifoL("F1", "M1", 3, 2, 1)],
    waRows: [waR("W1", "M1", 5, 4)],
    movements: [sub("a", "M1", "L1", 6)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  const l = p.creates.fifo[0];
  assert.strictEqual(l.fifo_sequence, "4");
  assert.strictEqual(l.fifo_available_quantity, 1); // 2 from layer 3, then 4 of 5 from the new layer
  assert.strictEqual(upd(p, "fifo", "F1").after.fifo_available_quantity, 0);
  assert.strictEqual(p.results[0].unit_price, 3); // (2*1 + 4*4) / 6
  assert.strictEqual(p.results[0].costing_migrated, "WA_INTO_FIFO");
});

t("migration: a batch key migrates only its own batch's rows, the new row carries the batch", () => {
  const p = planBulk({
    migrateCosting: "ALL",
    items: { M1: item("M1", "Weighted Average", { item_batch_management: 1 }) },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 2, balance_quantity: 2 })],
    batchBalances: [Object.assign(bal("BB1", "M1", "L1", { reserved_qty: 2, balance_quantity: 2 }), { batch_id: "T1" })],
    fifoLayers: [fifoL("F1", "M1", 1, 2, 5, { batch_id: "T1" }), fifoL("F9", "M1", 1, 9, 9, { batch_id: "T9" })],
    movements: [sub("a", "M1", "L1", 2, { batch_id: "T1" })],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.creates.wa[0].batch_id, "T1");
  assert.strictEqual(upd(p, "fifo", "F1").after.is_deleted, 1);
  assert.strictEqual(upd(p, "fifo", "F9"), undefined);
});

t("migration: a later movement of the same key sees the migrated rows (no second migration)", () => {
  const p = planBulk({
    migrateCosting: "ALL",
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 3, balance_quantity: 3 })],
    fifoLayers: [fifoL("F1", "M1", 1, 3, 2)],
    movements: [sub("a", "M1", "L1", 1), sub("b", "M1", "L1", 2)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.creates.wa.length, 1);
  assert.strictEqual(p.creates.wa[0].wa_quantity, 0);
  assert.strictEqual(p.results[0].costing_migrated, "FIFO_TO_WA");
  assert.strictEqual(p.results[1].costing_migrated, undefined);
  assert.strictEqual(p.results[1].unit_price, 2);
});

t("migration: Fixed Cost with both kinds goes through untouched (classic leaves them); without the flag it is still refused", () => {
  const input = () => ({
    items: { M1: item("M1", "Fixed Cost") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 1, balance_quantity: 1 })],
    fifoLayers: [fifoL("F1", "M1", 1, 1, 1)],
    waRows: [waR("W1", "M1", 1, 1)],
    movements: [sub("a", "M1", "L1", 1)],
  });
  const p = planBulk(Object.assign(input(), { migrateCosting: "ALL" }));
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.results[0].unit_price, 7);
  assert.strictEqual(p.updates.fifo.length + p.updates.wa.length + p.creates.fifo.length + p.creates.wa.length, 0);
  assert.strictEqual(p.results[0].costing_migrated, undefined);
  assert.strictEqual(planBulk(input()).failure.code, "UNSUPPORTED_COSTING");
});

t("migration: a pair whose COST lock this run does not hold is refused as before (the category-move race)", () => {
  const p = planBulk({
    migrateCosting: { ["M2|" + PLANT]: true },
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 1, balance_quantity: 1 })],
    fifoLayers: [fifoL("F1", "M1", 1, 1, 1)],
    movements: [sub("a", "M1", "L1", 1, { isMovingInv: 1, inventory_category: "Reserved" })],
  });
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.failure.code, "UNSUPPORTED_COSTING");
  assert.ok(/FIFO 1, WA 0/.test(p.failure.message));
});

t("migration: a category move (isMovingInv 1) migrates under the lock but writes no movement-side costing beyond the migration", () => {
  const p = planBulk({
    migrateCosting: { ["M1|" + PLANT]: true },
    items: { M1: item("M1", "Weighted Average") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 4, balance_quantity: 4 })],
    fifoLayers: [fifoL("F1", "M1", 1, 4, 3)],
    movements: [sub("a", "M1", "L1", 4, { isMovingInv: 1 }), add("b", "M1", "L2", 4, { unit_price_from: "a" })],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.creates.wa[0].wa_quantity, 4); // a category move takes nothing out of the costing rows
  assert.strictEqual(p.results[0].unit_price, 3);
  assert.strictEqual(p.results[1].unit_price, 3);
});

t("migration: rows retired in an earlier movement are invisible to later ones (live filter)", () => {
  const p = planBulk({
    migrateCosting: "ALL",
    items: { M1: item("M1", "First In First Out") },
    itemBalances: [bal("B1", "M1", "L1", { reserved_qty: 2, balance_quantity: 2 })],
    waRows: [waR("W1", "M1", 2, 5)],
    movements: [sub("a", "M1", "L1", 1), sub("b", "M1", "L1", 1)],
  });
  assert.ok(p.ok, JSON.stringify(p.failure));
  assert.strictEqual(p.creates.fifo.length, 1);
  assert.strictEqual(p.creates.fifo[0].fifo_available_quantity, 0);
  assert.strictEqual(p.results[1].costing_migrated, undefined);
});

console.log(n + " passed");
