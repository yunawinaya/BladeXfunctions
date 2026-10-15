// test_hu.js: COMMIT's handling-unit replay (code/commit/_hu.js) against the classic Branch 5 semantics
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const D = __dirname + "/../";
const roundDec = fs.readFileSync(D + "engine/core.js", "utf8").match(/^function roundDec\(.*?^}\n/ms)[0];
const src = [fs.readFileSync(D + "code/commit/_common.js", "utf8"), fs.readFileSync(D + "code/commit/_cmp.js", "utf8"), roundDec, fs.readFileSync(D + "code/commit/_hu.js", "utf8")].join("\n");
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(src + "\nthis.huReplay = huReplay; this.huRules = huRules; this.huParse = huParse;", sb);
const { huReplay, huRules, huParse } = sb;
// sandbox objects carry the sandbox's prototypes: compare plain copies
const eq = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);
const hu = (id, q) => ({ id, total_quantity: q, is_deleted: 0 });
const it = (id, h, mat, batch, q) => ({ id, handling_unit_id: h, material_id: mat, batch_id: batch, quantity: q, is_deleted: 0 });
const e = (h, mat, batch, q) => ({ handling_unit_id: h, material_id: mat, batch_id: batch, deliver_quantity: q });
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.after]));
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };

t("dev classic run 2100465031407538178 (no batch: HU 100 -> 0, item 100 -> 0)", () => {
  const r = huReplay([{ handling_unit_id: "2100464350349037569", material_id: "2097538734013677569", deliver_quantity: 100.0 }],
    [hu("2100464350349037569", 100)], [it("2100464350378397698", "2100464350349037569", "2097538734013677569", null, 100)], null);
  eq(r.short, []);
  eq(r.hus, [{ id: "2100464350349037569", before: 100, after: 0 }]);
  eq(r.items, [{ id: "2100464350378397698", before: 100, after: 0 }]);
});
t("several rows of one material + batch drain in id order (weighed pieces)", () => {
  const rows = [it("15", "H", "M", "B", 1.29), it("12", "H", "M", "B", 1.275), it("13", "H", "M", "B", 1.195), it("14", "H", "M", "B", 1.325)];
  const r = huReplay([e("H", "M", "B", 2.6)], [hu("H", 5.085)], rows, null);
  eq(r.short, []);
  eq(byId(r.items), { 12: 0, 13: 0, 14: 1.195 });
  eq(byId(r.hus), { H: 2.485 });
});
t("a batch entry touches only its batch; a null batch matches any (the node drops the condition)", () => {
  const rows = [it("1", "H", "M", "B1", 5), it("2", "H", "M", "B2", 5)];
  eq(byId(huReplay([e("H", "M", "B2", 3)], [hu("H", 10)], rows, null).items), { 2: 2 });
  eq(byId(huReplay([e("H", "M", null, 7)], [hu("H", 10)], rows, null).items), { 1: 0, 2: 3 });
});
t("entries apply in order on the same rows (two lines from one HU)", () => {
  const r = huReplay([e("H", "M", null, 4), e("H", "M", null, 4)], [hu("H", 10)], [it("1", "H", "M", null, 5), it("2", "H", "M", null, 5)], null);
  eq(byId(r.items), { 1: 0, 2: 2 });
  eq(byId(r.hus), { H: 2 });
});
t("other materials and other HUs are untouched", () => {
  const r = huReplay([e("H", "M", null, 1)], [hu("H", 3), hu("G", 3)], [it("1", "H", "X", null, 2), it("2", "H", "M", null, 1), it("3", "G", "M", null, 3)], null);
  eq(byId(r.items), { 2: 0 });
  eq(byId(r.hus), { H: 2 });
});
t("short: not enough in the HU, not enough of the material, no row, HU gone or deleted", () => {
  assert.strictEqual(huReplay([e("H", "M", null, 4)], [hu("H", 3)], [it("1", "H", "M", null, 9)], null).short.length, 1);
  assert.strictEqual(huReplay([e("H", "M", null, 4)], [hu("H", 9)], [it("1", "H", "M", null, 3)], null).short.length, 1);
  assert.strictEqual(huReplay([e("H", "M", "B", 1)], [hu("H", 9)], [it("1", "H", "M", "C", 3)], null).short.length, 1);
  assert.strictEqual(huReplay([e("H", "M", null, 1)], [], [it("1", "H", "M", null, 3)], null).short.length, 1);
  assert.strictEqual(huReplay([e("H", "M", null, 1)], [{ id: "H", total_quantity: 9, is_deleted: 1 }], [it("1", "H", "M", null, 3)], null).short.length, 1);
  assert.strictEqual(huReplay([e("H", "M", null, 1)], [hu("H", 9)], [Object.assign(it("1", "H", "M", null, 3), { is_deleted: 1 })], null).short.length, 1);
});
t("exact fit and zero / negative quantities", () => {
  eq(huReplay([e("H", "M", null, 0.765)], [hu("H", 0.765)], [it("1", "H", "M", null, 0.765)], null).short, []);
  const r = huReplay([e("H", "M", null, 0)], [hu("H", 1)], [it("1", "H", "M", null, 1)], null);
  eq([r.hus, r.items], [[], []]);
});
t("number rules: the HU total rounds per entry, item rows by their own rule", () => {
  const rules = { hu: { dp: 2, mode: 1 }, item: null };
  const r = huReplay([e("H", "M", null, 0.1234)], [hu("H", 1)], [it("1", "H", "M", null, 1)], rules);
  eq(byId(r.hus), { H: 0.88 });
  eq(byId(r.items), { 1: 0.8766 });
});
t("huRules: Handling Unit Qty binds total_quantity; a per-column rule wins; raw storage = no rounding", () => {
  const base = { scope_type: "1", rule_key: "Handling Unit Qty", decimal_places: 3, precision_rule: "1", store_raw_value: 0 };
  eq(huRules([base]), { hu: { dp: 3, mode: 1 }, item: null });
  const col = { scope_type: "2", table_id: "2036736671686529026", field_name: "total_quantity", decimal_places: 2, precision_rule: "2", store_raw_value: 0 };
  eq(huRules([col, base]), { hu: { dp: 2, mode: 2 }, item: null });
  eq(huRules([base, col]), { hu: { dp: 2, mode: 2 }, item: null });
  const item = { scope_type: "2", table_id: "2036977712276639745", field_name: "quantity", decimal_places: 4, precision_rule: "3", store_raw_value: 1 };
  eq(huRules([item]), { hu: null, item: { dp: null, mode: 3 } });
  eq(huRules([Object.assign({}, base, { precision_rule: "9" })]), { hu: null, item: null });
});
t("huParse: the sql rows' JSON, 19-digit ids kept as text", () => {
  const rows = huParse([{ j: '{"id": "2100464350349037569", "total_quantity": 10.00000000, "is_deleted": 0}' }, { j: null }]);
  eq(rows, [{ id: "2100464350349037569", total_quantity: 10, is_deleted: 0 }]);
});
console.log(n + " tests passed");
