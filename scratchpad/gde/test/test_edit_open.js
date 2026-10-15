// test_edit_open.js: opening a Created GD in Edit - the GD form's mounted (Goods Delivery/GDonMounted.js) against the deployed
// v1477 one (test/baseline/GDonMounted.v1477.js), both on one in-memory db: every row's final disabled state and the
// recomputed undelivered / initially-delivered quantities must match, and the new one must read in a handful of calls (the
// old one reads 2 per line in sequence + 1 per line). The db honours .where / .filter / .field / .limit / .doc and clamps a
// limit at 5,000 rows, as dev's API does (asked 20,000, got 5,000).
const fs = require("fs"), assert = require("assert");
const NEW = __dirname + "/../../../Goods Delivery/GDonMounted.js", OLD = __dirname + "/baseline/GDonMounted.v1477.js";
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const MUT = {
  no_is_deleted: ['countRows("item_balance", stockOf(0), [\n          { prop: "is_deleted", operator: "equal", value: 0 },\n', 'countRows("item_balance", stockOf(0), [\n'],
  no_fallback: ["if (found.length >= GD_READ_MAX)", "if (false)"],
};
const PLANT = "900", OTHER_PLANT = "901", CAP = 5000;

function tables(o) {
  const T = { Item: [], item_balance: [], item_batch_balance: [], sales_order_axszx8cj_sub: [] };
  const item = (id, f) => T.Item.push(Object.assign({ id, is_deleted: 0, stock_control: 1, show_delivery: 1, item_batch_management: 0 }, f));
  const bal = (m, n, f) => { for (let i = 0; i < n; i++) T.item_balance.push(Object.assign({ id: "b" + m + "_" + i, material_id: m, plant_id: PLANT, is_deleted: 0 }, f)); };
  const bbal = (m, n, f) => { for (let i = 0; i < n; i++) T.item_batch_balance.push(Object.assign({ id: "bb" + m + "_" + i, material_id: m, plant_id: PLANT, is_deleted: 0 }, f)); };
  if (o.big) { item("mBIG"); bal("mBIG", CAP + 1); }   // first in the table: a clamped chunk keeps only its rows
  item("m1"); bal("m1", 1);                                 // one balance row -> delivery qty locked
  item("m2"); bal("m2", 2);                                 // two rows -> not locked
  item("m3", { item_batch_management: 1 }); bbal("m3", 1);  // batch, one row -> locked
  item("m4", { item_batch_management: 1 }); bbal("m4", 2);
  item("m5", { stock_control: 0, show_delivery: 0 });       // description-only -> locked, no balance read
  /* m6: no Item row */
  item("m7", { item_batch_management: 2 });                 // unknown mode -> logged, untouched
  item("m8"); bal("m8", 1); bal("m8", 1, { id: "bm8_deleted", is_deleted: 1 });   // a deleted row does not count
  item("m9", { item_batch_management: 1 }); bbal("m9", 1, { plant_id: OTHER_PLANT });
  item("m10", { stock_control: 0, show_delivery: 1 }); bal("m10", 1);
  item("m11", { is_deleted: 1 }); bal("m11", 1);           // a deleted item is not read
  for (let i = 0; i < (o.many || 0); i++) { item("x" + i, { item_batch_management: i % 3 === 0 ? 1 : 0 }); (i % 3 === 0 ? bbal : bal)("x" + i, 1 + (i % 2)); }
  return T;
}

function lines(o) {
  const L = [];
  const add = (m, f) => L.push(Object.assign({ id: "l" + L.length, material_id: m, so_line_item_id: "s" + L.length, gd_qty: 2 }, f));
  if (o.big) add("mBIG");
  ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m1"].forEach((m) => add(m));
  add("m1", { line_pp_id: "pp1" });   // a Picking Plan row: disabledGDPPRows' business
  add("", { so_line_item_id: "" });    // a description line without a material
  for (let i = 0; i < (o.many || 0); i++) add("x" + i);
  return L;
}

function makeDb(T, calls) {
  const eq = (a, b) => String(a) === String(b);
  const leaf = (r, f) => {
    if (f.type === "branch") return f.operator === "any" ? f.children.some((c) => leaf(r, c)) : f.children.every((c) => leaf(r, c));
    if (f.operator === "equal" || f.operator === "numberEqual") return eq(r[f.prop], f.value);
    if (f.operator === "in") return (Array.isArray(f.value) ? f.value : [f.value]).some((v) => eq(r[f.prop], v));
    throw new Error("operator " + f.operator);
  };
  return {
    collection: (name) => {
      const q = { conds: [], lim: 0 };
      const api = {
        where: (o) => { for (const k of Object.keys(o)) if (o[k] !== undefined) q.conds.push({ prop: k, operator: "equal", value: o[k] }); return api; },
        filter: (tree) => { q.conds.push(...tree); return api; },
        field: () => api, orderBy: () => api,
        limit: (n) => { q.lim = n; return api; },
        doc: (id) => ({ get: async () => { calls.push(name + ".doc"); const r = (T[name] || []).find((x) => eq(x.id, id)); return { data: r ? [r] : [] }; } }),
        get: async () => {
          calls.push(name);
          let rows = (T[name] || []).filter((r) => q.conds.every((c) => leaf(r, c)));
          // the old per-material reads set no limit: give them every row (what the deployed form relies on)
          if (q.lim) rows = rows.slice(0, Math.min(q.lim, CAP));
          return { data: rows.map((r) => Object.assign({}, r)) };
        },
      };
      return api;
    },
  };
}

async function run(file, o) {
  let code = fs.readFileSync(file, "utf8");
  if (mutate && file === NEW) { if (code.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant " + mutate + " does not apply"); code = code.split(MUT[mutate][0]).join(MUT[mutate][1]); }
  const T = tables(o), calls = [], disabledLog = [], errors = [];
  const so = {};
  lines(o).forEach((l, i) => { if (l.so_line_item_id) so[l.so_line_item_id] = { id: l.so_line_item_id, delivered_qty: i % 4, so_quantity: 5 + (i % 3) }; });
  T.sales_order_axszx8cj_sub = Object.values(so);
  const values = { id: "g1", delivery_no: "GD/1", gd_status: "Created", picking_status: "", so_id: ["so1"], plant_id: PLANT, organization_id: "org1", from_convert: "", gd_delivery_method: "", table_gd: lines(o) };
  let now = 1000000; const queue = [];
  const fakeSetTimeout = (fn, ms) => { queue.push({ at: now + (ms || 0), fn }); };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
  const list = (x) => (Array.isArray(x) ? x : [x]);
  const form = {
    isAdd: false, isEdit: true, isView: false, isCopy: false, models: { _data: {} }, parentGenerateForm: null,
    getValue: (k) => values[k], getValues: () => values, setData: (x) => Object.assign(values, x),
    getVarGlobal: (k) => (k === "deptParentId" ? "org1" : "admin"), getVarSystem: (k) => (k === "tenantId" ? "711077" : "org1"),
    display: () => {}, hide: () => {}, disabled: (x, f) => disabledLog.push({ fields: list(x), flag: f }),
    getComponent: () => ({ hideChildRecord: () => {}, options: {} }), getParamsVariables: () => "", triggerEvent: async () => {},
    onDropdownVisible: () => Promise.resolve([]), getOptionData: () => [], setOptionData: () => {},
    runWorkflow: () => { throw new Error("no workflow expected"); },
    $message: { success: () => {}, warning: () => {}, error: (m) => errors.push("message: " + m), info: () => {} }, $alert: () => Promise.resolve(),
  };
  const quiet = { log: () => {}, warn: () => {}, error: (...a) => errors.push(a.map(String).join(" ").slice(0, 160)) };
  new Function("setTimeout", "Date", "db", "console", code).call(form, fakeSetTimeout, FakeDate, makeDb(T, calls), quiet);
  for (let k = 0; k < 5000; k++) {
    await new Promise((r) => setImmediate(r));   // every pending promise chain runs first
    if (!queue.length) break;
    queue.sort((a, b) => a.at - b.at);
    const t = queue.shift(); now = Math.max(now, t.at); await t.fn();
  }
  const rowState = {}, headerCalls = [];
  for (const d of disabledLog) {
    const rowsOnly = d.fields.filter((f) => /^table_gd\.\d+\./.test(f));
    for (const f of rowsOnly) rowState[f] = d.flag;
    const rest = d.fields.filter((f) => !/^table_gd\.\d+\./.test(f));
    if (rest.length) headerCalls.push(JSON.stringify({ fields: rest, flag: d.flag }));
  }
  const qty = values.table_gd.map((r) => [r.id, r.gd_undelivered_qty, r.gd_initial_delivered_qty]);
  return { rowState, headerCalls, qty, calls, errors: errors.filter((e) => !/Item batch management is not found/.test(e)), unknownMode: errors.filter((e) => /Item batch management is not found/.test(e)).length };
}

let failed = 0, n = 0;
const it = async (name, f) => { n++; try { await f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0].slice(0, 500)); } };
const same = async (o) => {
  const a = await run(OLD, o), b = await run(NEW, o);
  assert.deepStrictEqual(b.rowState, a.rowState, "row disabled states differ");
  assert.deepStrictEqual(b.qty, a.qty, "recomputed quantities differ");
  assert.deepStrictEqual(b.headerCalls, a.headerCalls, "header field calls differ");
  assert.deepStrictEqual(b.errors, [], "errors: " + b.errors.join(" | "));
  assert.ok(b.unknownMode >= 1, "the unknown batch mode is not logged");
  return { a, b };
};

(async () => {
  await it("every line kind: the same row locks and quantities as v1477", async () => {
    const { a, b } = await same({});
    assert.strictEqual(a.rowState["table_gd.0.gd_delivery_qty"], true, "fixture: m1 locks in v1477");
  });
  await it("600 more lines (chunks): same result, a handful of reads instead of ~1,800", async () => {
    const { a, b } = await same({ many: 600 });
    assert.ok(a.calls.length > 1500, "baseline reads " + a.calls.length);
    assert.ok(b.calls.length <= 20, "reads " + b.calls.length + ": " + b.calls.join(","));   // 4 of them are the setup reads both versions make
  });
  await it("a balance chunk clamped at 5,000 rows -> its materials re-read one by one: same result", async () => {
    await same({ big: true });
  });
  console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
  process.exit(failed ? 1 : 0);
})();
