// test_engine_precision.js: the stock engine's checks compare stored decimals at the tenant number rule's scale (2026-10-26).
// Runs effectFacts / numScale exactly as the repo workflows carry them (INVENTORY_APPLY_OPERATION's 4 checks + Revalidate,
// INVENTORY_OPERATION_RECONCILE's Decide). usage: node test_engine_precision.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..", "..", "..", "..", "Goods Delivery", "AsyncV2");
const find = (o, id) => {
  if (Array.isArray(o)) {
    for (const v of o) {
      const r = find(v, id);
      if (r) return r;
    }
  } else if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) {
      const r = find(v, id);
      if (r) return r;
    }
  }
  return null;
};
const fn = (code, name) => {
  const i = code.indexOf("const " + name + " = function " + name + "(");
  if (i < 0) return null;
  const j = code.indexOf("\n};\n", i);
  return code.slice(i, j + 3);
};
const load = (file, id) => {
  const code = find(JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")), id).data.script.code;
  const body = [fn(code, "dec8"), fn(code, "effectFacts") || "const effectFacts = null;", fn(code, "numScale") || "const numScale = null;"].join("\n");
  return new Function(body + "\nreturn { effectFacts: effectFacts, numScale: numScale };")();
};

const TEXT = { transaction_type: "GDL", trx_no: "GD-26/10/0528", parent_trx_no: "SO-26/10/0021", inventory_category: "Reserved", movement: "IN", uom_id: "1", base_uom_id: "1", item_id: "1979082567809552385", bin_location_id: "1975932706692059138", batch_number_id: "", costing_method_id: "First In First Out", doc_date: "2026-10-26 00:00:00", manufacturing_date: "", expired_date: "", plant_id: "7", organization_id: "9" };
const KEY = "9|GD|2114523094264713218|1|E2";
const planned = (o) => Object.assign({ operation_effect_key: KEY }, TEXT, { unit_price: "99.93685714", total_price: "6995.5799998", quantity: "70", base_qty: "70", actual_qty: "70", actual_base_qty: "70" }, o || {});
const stored = (o) => Object.assign({ id: "2114523147138109443", is_deleted: "0", operation_effect_key: KEY }, TEXT, { unit_price: "99.93690000", total_price: "6995.58000000", quantity: "70.00000000", base_qty: "70.00000000", actual_qty: "70.00000000", actual_base_qty: "70.00000000" }, o || {});
const mov = (F, p, s, scale) => F.effectFacts({ balances: [], movements: [planned(p)], effects: [], balRows: [], movRows: [stored(s)], scale: scale }).movementsOk;
const COLS = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
const qty = (o) => Object.assign(Object.fromEntries(COLS.map((c) => [c, "0"])), o);
const bal = (F, before, after, row, scale, table) => F.effectFacts({ balances: [{ table: table || "item_balance", id: "1", before: qty(before), after: qty(after) }], movements: [], effects: [], balRows: [Object.assign({ id: "1", is_deleted: "0", tbl: table || "item_balance" }, qty(row))], movRows: [], scale: scale }).rows[(table || "item_balance") + "#1"].state;

const SEEDED = { price: { dp: 4, rule: "1" }, qty: { dp: 3, rule: "1" } };
let n = 0;
const ok = (name, got, want) => {
  assert.deepStrictEqual(got, want, name + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
  n++;
};
const cases = (F, label) => {
  ok(label + " GUB GD-26/10/0528 price 99.93685714 -> 99.9369, total 6995.5799998 -> 6995.58", mov(F, {}, {}, SEEDED), true);
  ok(label + " GUB with no scale given (a plan stored before the fix): the seeded 4 / 3", mov(F, {}, {}, undefined), true);
  ok(label + " raw 8-decimal value stored", mov(F, {}, { unit_price: "99.93685714", total_price: "6995.57999980" }, SEEDED), true);
  ok(label + " wrong rounding direction 99.9368 rejected", mov(F, {}, { unit_price: "99.93680000" }, SEEDED), false);
  ok(label + " value off the rule's scale (5 decimals) rejected", mov(F, {}, { unit_price: "99.93686000" }, SEEDED), false);
  ok(label + " a different price rejected", mov(F, {}, { unit_price: "98.93690000" }, SEEDED), false);
  ok(label + " tie 3.08625 -> 3.0863 (half up)", mov(F, { total_price: "3.08625" }, { total_price: "3.08630000" }, SEEDED), true);
  ok(label + " tie 3.08625 -> 3.0862 (half even)", mov(F, { total_price: "3.08625" }, { total_price: "3.08620000" }, SEEDED), true);
  ok(label + " tie 3.08625 -> 3.0861 rejected", mov(F, { total_price: "3.08625" }, { total_price: "3.08610000" }, SEEDED), false);
  ok(label + " tenant at 2 price decimals: 99.94 accepted", mov(F, {}, { unit_price: "99.94000000" }, { price: { dp: 2, rule: "1" }, qty: SEEDED.qty }), true);
  ok(label + " tenant at 2 price decimals: 99.9369 is off its scale", mov(F, {}, {}, { price: { dp: 2, rule: "1" }, qty: SEEDED.qty }), false);
  ok(label + " tenant at 6 price decimals: 99.936857 accepted", mov(F, {}, { unit_price: "99.93685700", total_price: "6995.58000000" }, { price: { dp: 6, rule: "1" }, qty: SEEDED.qty }), true);
  ok(label + " seeded 4 decimals: 99.936857 is off the scale", mov(F, {}, { unit_price: "99.93685700" }, SEEDED), false);
  ok(label + " rule 2 (not to nearest): one step either way accepted", mov(F, {}, { unit_price: "99.93680000" }, { price: { dp: 4, rule: "2" }, qty: SEEDED.qty }), true);
  ok(label + " rule 2: two steps rejected", mov(F, {}, { unit_price: "99.93670000" }, { price: { dp: 4, rule: "2" }, qty: SEEDED.qty }), false);
  ok(label + " rule not configured (null): exact only", mov(F, {}, {}, { price: null, qty: null }), false);
  ok(label + " rule not configured (null): exact value accepted", mov(F, {}, { unit_price: "99.93685714", total_price: "6995.57999980" }, { price: null, qty: null }), true);
  ok(label + " quantity 2.0004 stored 2.000 (qty rule 3)", mov(F, { quantity: "2.0004", base_qty: "2.0004", actual_qty: "-2.0004", actual_base_qty: "-2.0004" }, { quantity: "2.00000000", base_qty: "2.00000000", actual_qty: "-2.00000000", actual_base_qty: "-2.00000000" }, SEEDED), true);
  ok(label + " quantity 2.004 stored 2.000 rejected", mov(F, { quantity: "2.004" }, { quantity: "2.00000000" }, SEEDED), false);
  ok(label + " price column at the qty scale is not enough (price uses its own rule)", mov(F, { unit_price: "1.2346" }, { unit_price: "1.23500000" }, SEEDED), false);
  ok(label + " empty stored price rejected", mov(F, {}, { unit_price: "" }, SEEDED), false);
  ok(label + " text column still exact", mov(F, {}, { trx_no: "GD-26/10/0529" }, SEEDED), false);
  ok(label + " balance after exact", bal(F, { unrestricted_qty: "9076", reserved_qty: "44", balance_quantity: "9120" }, { unrestricted_qty: "9006", reserved_qty: "114", balance_quantity: "9120" }, { unrestricted_qty: "9006.00000000", reserved_qty: "114.00000000", balance_quantity: "9120.00000000" }, SEEDED), "AFTER");
  ok(label + " balance before exact", bal(F, { unrestricted_qty: "9076", reserved_qty: "44" }, { unrestricted_qty: "9006", reserved_qty: "114" }, { unrestricted_qty: "9076.00000000", reserved_qty: "44.00000000" }, SEEDED), "BEFORE");
  ok(label + " balance after 10.0004 stored 10.000", bal(F, { unrestricted_qty: "12" }, { unrestricted_qty: "10.0004" }, { unrestricted_qty: "10.00000000" }, SEEDED), "AFTER");
  ok(label + " balance after 10.004 stored 10.000 is OTHER", bal(F, { unrestricted_qty: "12" }, { unrestricted_qty: "10.004" }, { unrestricted_qty: "10.00000000" }, SEEDED), "OTHER");
  ok(label + " balance after 10.0004 with qty rule null: exact only", bal(F, { unrestricted_qty: "12" }, { unrestricted_qty: "10.0004" }, { unrestricted_qty: "10.00000000" }, { price: null, qty: null }), "OTHER");
  const COL2 = { price: SEEDED.price, qty: SEEDED.qty, columns: { "inventory_movement.unit_price": { dp: 2, rule: "1" } } };
  ok(label + " column rule unit_price 2 decimals: 99.94 accepted, total at the group's 4", mov(F, {}, { unit_price: "99.94000000" }, COL2), true);
  ok(label + " column rule unit_price 2 decimals: 99.9369 is off its scale", mov(F, {}, {}, COL2), false);
  ok(label + " column rule raw (null) on total_price: 6995.58 rejected", mov(F, {}, {}, { price: SEEDED.price, qty: SEEDED.qty, columns: { "inventory_movement.total_price": null } }), false);
  ok(label + " column rule raw (null) on total_price: the exact value accepted", mov(F, {}, { total_price: "6995.57999980" }, { price: SEEDED.price, qty: SEEDED.qty, columns: { "inventory_movement.total_price": null } }), true);
  const BCOL = { price: SEEDED.price, qty: SEEDED.qty, columns: { "item_batch_balance.unrestricted_qty": { dp: 0, rule: "1" } } };
  ok(label + " column rule on item_batch_balance: 10.4 stored 10", bal(F, { unrestricted_qty: "12" }, { unrestricted_qty: "10.4" }, { unrestricted_qty: "10.00000000" }, BCOL, "item_batch_balance"), "AFTER");
  ok(label + " that rule does not reach item_balance (qty 3 decimals)", bal(F, { unrestricted_qty: "12" }, { unrestricted_qty: "10.4" }, { unrestricted_qty: "10.00000000" }, BCOL, "item_balance"), "OTHER");
  ok(label + " rule 2 (toward zero) on a column: 10.9 stored 10", bal(F, { unrestricted_qty: "12" }, { unrestricted_qty: "10.9" }, { unrestricted_qty: "10.00000000" }, { price: null, qty: null, columns: { "item_balance.unrestricted_qty": { dp: 0, rule: "2" } } }), "AFTER");
};

const APPLY_CHECKS = ["code_node_FyT3zuFi", "code_node_p0sOD8ej", "code_node_Pf6NFe7B", "code_node_ncZJyNmS"];
for (const id of APPLY_CHECKS) cases(load("INVENTORY_APPLY_OPERATION.json", id), "APPLY " + id);
cases(load("INVENTORY_OPERATION_RECONCILE.json", "code_node_mDGats0w"), "RECONCILE");

const R = load("INVENTORY_APPLY_OPERATION.json", "code_node_8rCPo75P");
assert(R.numScale, "Revalidate carries numScale");
const SEEDED_TEXT = "1:Inventory Price:::4:1:0;1:Inventory Qty:::3:1:0";
ok("numScale seeded", R.numScale(SEEDED_TEXT), Object.assign({}, SEEDED, { columns: {} }));
ok("numScale either order + modes", R.numScale("1:Inventory Qty:::2:3:0;1:Inventory Price:::6:1:0"), { price: { dp: 6, rule: "1" }, qty: { dp: 2, rule: "3" }, columns: {} });
ok("numScale column rules (3 stock tables; another table ignored; raw = null)", R.numScale(SEEDED_TEXT + ";2::1902259348776800257:unit_price:2:2:0;2::1902698977724317697:reserved_qty:0:1:0;2::1902718803880558594:block_qty:5:1:1;2::999:unit_price:1:1:0"),
  { price: SEEDED.price, qty: SEEDED.qty, columns: { "inventory_movement.unit_price": { dp: 2, rule: "2" }, "item_balance.reserved_qty": { dp: 0, rule: "1" }, "item_batch_balance.block_qty": null } });
ok("numScale raw group rule = exact", R.numScale("1:Inventory Price:::4:1:1;1:Inventory Qty:::3:1:0"), { price: null, qty: SEEDED.qty, columns: {} });
ok("numScale none configured", R.numScale(""), { price: null, qty: null, columns: {} });
ok("numScale undefined", R.numScale(undefined), { price: null, qty: null, columns: {} });
ok("numScale malformed rows ignored", R.numScale("1:Inventory Price:::x:1:0;garbage;1:Inventory Qty:::3:1"), { price: null, qty: null, columns: {} });

// every check passes the plan's scale on, every stored plan keeps it, and the balance read declares the column it returns
const app = JSON.parse(fs.readFileSync(path.join(ROOT, "INVENTORY_APPLY_OPERATION.json"), "utf8"));
for (const id of APPLY_CHECKS) {
  const code = find(app, id).data.script.code;
  ok(id + " passes scale", /effectFacts\(\{[^)]*scale: rv\.plan\.scale \}\)/.test(code), true);
  ok(id + " stores scale on review", code.includes("scale: rv.plan.scale || null } };"), true);
}
const rv = find(app, "code_node_8rCPo75P").data.script.code;
ok("Revalidate plan.scale", rv.includes("scale: numScale(numRules) };"), true);
ok("Revalidate stored plan scale", rv.includes("checks: plan.checks, scale: plan.scale, planned_at: dbNow"), true);
const sql = find(app, "sql_node_e7OzTOyD").data;
ok("balance read returns num_rules", sql.script.code.includes(") AS num_rules,"), true);
ok("balance read declares num_rules", sql.response_json.filter((e) => e.name === "num_rules").length, 1);
const recon = JSON.parse(fs.readFileSync(path.join(ROOT, "INVENTORY_OPERATION_RECONCILE.json"), "utf8"));
ok("reconcile passes the stored plan's scale", find(recon, "code_node_mDGats0w").data.script.code.includes("movRows: reads.mov, scale: plan.scale })"), true);
console.log("test_engine_precision: " + n + " pass");
