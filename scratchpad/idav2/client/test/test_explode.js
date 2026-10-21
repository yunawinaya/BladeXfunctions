// The BOM explode (onChange_idaSourceItem) at 2,000 components, whatever the switch: the built handler = the base's writes and
// messages exactly when no read is clamped; under a mocked 100-row server clamp it still fills every line (the base does not);
// every Item read sends .field(<the columns it reads>) in id chunks of <= 500; every other read but the BOM carries an explicit
// limit. Also measures, in the mock, the per-row option / disabled calls and the Batch Add / item-picker / mounted loops at
// 2,000 lines (client/out/measure.txt).
//   node test/test_explode.js
const fs = require("fs");
const path = require("path");
const H = require("./harness");
const { check, same } = H;

const BASE = H.readJSON(H.FILES.formBase);
const BUILT = H.readJSON(H.FILES.form);
const ORG = "1001";
const PLANT = "2002";
const ITEM_FIELDS = "material_code,material_name,material_desc,based_uom,serial_number_management,item_batch_management,batch_number_genaration,table_uom_conversion,table_default_bin";
const fn = (doc, name) => H.byName(doc, name);

// a BOM of `n` components over `uoms` UOMs; every 4th item batch-managed (every 8th auto-numbered), every 5th with an item
// default bin at the plant, every 7th line in an alternate UOM; the items carry a subform the explode never reads
const fixture = (o) => {
  o = Object.assign({ n: 2000, uoms: 150, balances: 1, hu: false }, o || {});
  const items = [{ id: "P1", material_code: "FG-1", material_name: "Assembly", material_desc: "the parent", based_uom: "U0", serial_number_management: 0, item_batch_management: 0,
    batch_number_genaration: "", table_uom_conversion: [], table_default_bin: [], table_supplier_price: [{ price: 1 }], is_deleted: 0 }];
  const subs = [];
  for (let i = 0; i < o.n; i++) {
    const id = "C" + String(i).padStart(4, "0");
    items.push({ id: id, material_code: "RM-" + i, material_name: "Comp " + i, material_desc: "d" + i, based_uom: "U" + (i % o.uoms), serial_number_management: 0,
      item_batch_management: i % 4 === 0 ? 1 : 0, batch_number_genaration: i % 8 === 0 ? "According To System Settings" : "Manual Input",
      table_uom_conversion: [{ alt_uom_id: "U" + ((i + 1) % o.uoms), base_qty: 12 }], table_default_bin: i % 5 === 0 ? [{ plant_id: PLANT, storage_location: "S9", bin_location: "L9" }] : [],
      table_supplier_price: [{ price: 1 }, { price: 2 }], is_deleted: 0 });
    subs.push({ bom_material_code: id, consume_type: i === 7 ? "REF" : "", sub_material_qty: (i % 3) + 1, sub_material_qty_uom: i % 7 === 0 ? "U" + ((i + 2) % o.uoms) : "",
      sub_material_name: i % 10 === 0 ? "Named " + i : "", sub_material_desc: "", sub_material_remark: i % 9 === 0 ? "r" + i : "" });
  }
  const balances = [];
  for (let b = 0; b < o.balances; b++) {
    balances.push({ id: "SB" + b, material_id: "P1", plant_id: PLANT, organization_id: ORG, is_deleted: 0, location_id: "L1", storage_location_id: "S1", batch_id: null,
      unrestricted_qty: 100, balance_quantity: 100 });
  }
  const tables = {
    bill_of_materials: [{ id: "BOM1", parent_material_code: "P1", organization_id: ORG, is_deleted: 0, is_active: 1, parent_mat_bom_version: "V1", parent_mat_is_default: 1,
      parent_mat_base_quantity: 1, subform_sub_material: subs }],
    item: items,
    unit_of_measurement: Array.from({ length: o.uoms }, (_, u) => ({ id: "U" + u, uom_name: "UOM " + u, is_deleted: 0 })),
    storage_location: [{ id: "S1", plant_id: PLANT, is_deleted: 0, is_default: 1, storage_status: 1, location_type: "Common" }],
    bin_location: [{ id: "L1", plant_id: PLANT, storage_location_id: "S1", is_deleted: 0, is_default: 1, bin_status: 1, bin_location_combine: "A-1" },
      { id: "L9", plant_id: PLANT, storage_location_id: "S9", is_deleted: 0, is_default: 0, bin_status: 1, bin_location_combine: "A-9" }],
    item_balance: balances, item_batch_balance: [], item_serial_balance: [],
    handling_unit_atu7sreg_sub: o.hu ? [{ id: "HS1", handling_unit_id: "HU1", material_id: "P1", is_deleted: 0 }] : [],
    handling_unit: o.hu ? [{ id: "HU1", plant_id: PLANT, organization_id: ORG, is_deleted: 0, table_hu_items: [{ material_id: "P1" }] }] : [],
    batch: [],
  };
  return { tables: tables, items: items, subs: subs };
};
const header = (o) => Object.assign({ page_status: "Add", issuing_operation_faci: PLANT, item_qty: 3, project_id: "", organization_id: ORG, item_id: "", item_uom: "", stock_movement: [] }, o || {});

const run = async (code, values, args, o) => {
  o = o || {};
  const w = H.world({ db: H.tableDb(o.tables || {}, { clamp: o.clamp, defaultLimit: o.defaultLimit }) });
  const self = H.makeThis(w, BUILT, { values: values, stateful: true, data: o.data, isAdd: o.isAdd, isEdit: o.isEdit, isCopy: o.isCopy });
  const t0 = process.hrtime.bigint();
  H.compile(w, code, false).call(self, args);
  await H.drain(w);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { w: w, self: self, trace: w.trace, rows: self.values.stock_movement || [], reads: w.reads, ms: ms };
};
const named = (trace, name) => trace.filter((t) => t[0] === name);
const nonReads = (trace) => trace.filter((t) => t[0] !== "db.get");
const paths = (trace) => named(trace, "disabled").reduce((n, t) => n + (Array.isArray(t[1]) ? t[1].length : 1), 0);
const counts = (r) => ({ ms: Math.round(r.ms), reads: r.reads.length, setData: named(r.trace, "setData").length, setOptionData: named(r.trace, "setOptionData").length,
  disabledCalls: named(r.trace, "disabled").length, disabledPaths: paths(r.trace) });
const measure = [];

(async () => {
  const E0 = fn(BASE, "onChange_idaSourceItem").func;
  const E1 = fn(BUILT, "onChange_idaSourceItem").func;
  check("explode: changed and compiles", E0 !== E1 && !!H.compile(H.world(), E1, false));

  for (const n of [5, 830, 2000]) {
    const f = fixture({ n: n });
    // no clamp: the built handler writes exactly what the base writes
    const a = await run(E0, header(), { value: "P1" }, { tables: f.tables });
    const b = await run(E1, header(), { value: "P1" }, { tables: f.tables });
    const expectRows = n - (n > 7 ? 1 : 0);
    check("explode " + n + " components, no clamp: the base's rows, writes, option / disabled calls and messages exactly", a.rows.length === expectRows && same(a.rows, b.rows) &&
      same(nonReads(a.trace), nonReads(b.trace)), { a: a.rows.length, b: b.rows.length, firstDiff: nonReads(a.trace).findIndex((t, i) => !same(t, nonReads(b.trace)[i])) });
    check("explode " + n + ": every line named, UOM options from the item, batch rule, plant / item default bin, the source picked", b.rows.every((x) =>
      x.item_name !== "" && JSON.parse(x.uom_options).length >= 2 && (x.batch_number === "-" || x.batch_number === "" || x.batch_number === "Auto-generated batch number") &&
      ["S1", "S9"].indexOf(x.storage_location_id) >= 0 && ["L1", "L9"].indexOf(x.location_id) >= 0) && JSON.parse(b.self.values.temp_qty_data).length === 1);
    const itemReads = b.reads.filter((q) => q.collection === "item");
    check("explode " + n + ": the Item reads send .field(<every column read>) and id chunks of <= 500 with limit = chunk", itemReads.length === 1 + Math.ceil(n / 500) &&
      itemReads.every((q) => q.field === ITEM_FIELDS && q.filter[0].children[0].value.length <= 500 && q.limit === q.filter[0].children[0].value.length), itemReads.map((q) => [q.field, q.limit]));
    check("explode " + n + ": every read but the BOM has an explicit limit", b.reads.filter((q) => q.collection !== "bill_of_materials").every((q) => typeof q.limit === "number" && q.limit > 0),
      b.reads.filter((q) => q.limit === undefined).map((q) => q.collection));
    check("explode " + n + ": the base sent no .field() / .limit() on its Item read (one read of every id)", a.reads.filter((q) => q.collection === "item").every((q) => q.field === undefined && q.limit === undefined) &&
      a.reads.filter((q) => q.collection === "item").length === 2);
    measure.push(["explode " + n + " components (base)", counts(a)], ["explode " + n + " components (built)", counts(b)]);

    // a 100-row server clamp (and no-limit default): the built handler re-reads what the clamp left out
    const c = await run(E1, header(), { value: "P1" }, { tables: f.tables, clamp: 100, defaultLimit: 100 });
    check("explode " + n + ", mocked 100-row clamp: every line filled exactly as without the clamp", same(c.rows, b.rows) && same(nonReads(c.trace), nonReads(b.trace)),
      { rows: c.rows.length, unnamed: c.rows.filter((x) => !x.item_name).length });
    if (n > 100) {
      const d = await run(E0, header(), { value: "P1" }, { tables: f.tables, clamp: 100, defaultLimit: 100 });
      const lost = d.rows.filter((x, i) => !same(x, b.rows[i])).length;
      check("explode " + n + ", the same clamp on the base v35 explode: lines lose their item data (the mock clamps)", lost > n / 2, lost);
      measure.push(["explode " + n + " components, 100-row clamp (base): lines that lost item data", { lost: lost }]);
    }
    if (n === 2000) {
      const cr = c.reads.filter((q) => q.collection === "item");
      check("explode 2,000, clamp 100: Item ids re-read in rounds (each round the ids the last one left out)", cr.length > 20 && cr.every((q) => q.field === ITEM_FIELDS));
      measure.push(["explode 2,000 components, 100-row clamp (built)", counts(c)]);
    }
  }
  // the source with several balances / HU stock: the multiple mode, as the base
  for (const o of [{ balances: 3 }, { hu: true }, { balances: 0 }]) {
    const f = fixture(Object.assign({ n: 60 }, o));
    const a = await run(E0, header(), { value: "P1" }, { tables: f.tables });
    const b = await run(E1, header(), { value: "P1" }, { tables: f.tables });
    check("explode, source " + JSON.stringify(o) + ": the base's writes and messages", same(a.rows, b.rows) && same(nonReads(a.trace), nonReads(b.trace)) &&
      a.self.models.ida_source_stock_mode === b.self.models.ida_source_stock_mode, { a: a.self.models.ida_source_stock_mode, b: b.self.models.ida_source_stock_mode });
    if (o.hu) {
      const hu = b.reads.filter((q) => q.collection === "handling_unit");
      check("explode, HU stock: the HU read projected (plant_id) and limited", hu.length === 1 && hu[0].field === "plant_id" && hu[0].limit === 5000 && b.self.models.ida_source_stock_mode === "multiple");
    }
  }
  // a rescale (quantity change) and a Select Stock re-run (preserveAllocation) keep the base's behaviour
  {
    const f = fixture({ n: 120 });
    const first = await run(E1, header(), { value: "P1" }, { tables: f.tables });
    const manual = { item_selection: "C0005", item_name: "manual", bom_ratio: null, requested_qty: 0, total_quantity: 4, uom_options: "[]", batch_number: "-" };
    for (const args of [{ value: "P1", quantity: 5, rescale: true }, { value: "P1", rescale: true, preserveAllocation: true }]) {
      const vals = header({ item_id: "P1", item_qty: 3, stock_movement: first.rows.concat([manual]), temp_qty_data: first.self.values.temp_qty_data });
      const a = await run(E0, H.clone(vals), args, { tables: f.tables });
      const b = await run(E1, H.clone(vals), args, { tables: f.tables });
      check("explode " + JSON.stringify(args) + ": the base's rows and writes", same(a.rows, b.rows) && same(nonReads(a.trace), nonReads(b.trace)) && a.rows.length === 120);
    }
    const none = await run(E1, header({ item_id: "P1", stock_movement: first.rows }), { value: "" }, { tables: f.tables });
    check("explode with the BOM item cleared: no read, the lines emptied", none.reads.length === 0 && none.rows.length === 0);
    const failing = H.world({ db: (name, q) => { if (name === "item") throw new Error("boom"); return H.tableDb(f.tables)(name, q); }, dbThrows: (name) => name === "item" });
    const self = H.makeThis(failing, BUILT, { values: header(), stateful: true });
    H.compile(failing, E1, false).call(self, { value: "P1" });
    await H.drain(failing);
    check("explode, an Item read failing: the base's error message, no lines", named(failing.trace, "$message.error").some((t) => t[1] === "db down") && (self.values.stock_movement || []).length === 0);
  }

  // ---- measurements at 2,000 lines: the other per-row loops and reads named in CONTRACT section 12 (not changed)
  {
    const f = fixture({ n: 2000 });
    const exploded = (await run(E1, header(), { value: "P1" }, { tables: f.tables })).rows;
    // Batch Add of 2,000 items (iabcnf01): the dialog hands over the items; reads UOMs / bins without a limit
    const itemArray = f.items.slice(1).map((x) => Object.assign({}, x));
    const ba = await run(fn(BUILT, "onConfirm_batchAddItem").func, header({ stock_movement: [] }), { itemArray: itemArray }, { tables: f.tables });
    check("Batch Add (iabcnf01) is unchanged", fn(BUILT, "onConfirm_batchAddItem").func === fn(BASE, "onConfirm_batchAddItem").func);
    check("Batch Add of 2,000 items: no Item read, 2,000 rows", !ba.reads.some((q) => q.collection === "item" || q.collection === "Item") && ba.rows.length === 2000);
    measure.push(["Batch Add 2,000 items (iabcnf01, unchanged)", Object.assign(counts(ba), { readCollections: ba.reads.map((q) => q.collection + (q.limit === undefined ? "" : "#" + q.limit)) })]);
    const bac = await run(fn(BUILT, "onConfirm_batchAddItem").func, header({ stock_movement: [] }), { itemArray: itemArray }, { tables: f.tables, clamp: 100, defaultLimit: 100 });
    measure.push(["Batch Add 2,000 items, 100-row default limit (if the platform had one): lines whose UOM options lost an entry",
      { lost: bac.rows.filter((x, i) => x.uom_options !== ba.rows[i].uom_options).length }]);
    // the item picker (iaitem01): one item per event; a re-render without fieldModel restores every row's options
    const pick = await run(fn(BUILT, "onAfterUpdate_item").func, header({ stock_movement: exploded }), { rowIndex: 5, value: "C0005", fieldModel: { item: f.items[6] } }, { tables: f.tables });
    const restore = await run(fn(BUILT, "onAfterUpdate_item").func, header({ stock_movement: exploded }), { rowIndex: 5, value: "C0005" }, { tables: f.tables });
    check("item picker (iaitem01) is unchanged; no Item read", fn(BUILT, "onAfterUpdate_item").func === fn(BASE, "onAfterUpdate_item").func && !pick.reads.some((q) => /item/i.test(q.collection) && q.collection !== "unit_of_measurement"));
    measure.push(["item picker, one pick at 2,000 lines (iaitem01, unchanged)", counts(pick)], ["item picker, re-render without fieldModel at 2,000 lines", counts(restore)]);
    // mounted on a 2,000-line Draft (Edit): configureBatchFields + restoreRecoveryUomOptions
    const m = await run(H.variant(fn(BUILT, "mounted").func, { master: false }, H.OFF_IDS), header({ page_status: "Edit", id: "77", item_disassembly_status: "Draft", item_id: "P1", stock_movement: exploded }), {},
      { tables: f.tables, isEdit: true });
    measure.push(["form mounted, Edit of a 2,000-line Draft (per-row loops unchanged)", counts(m)]);
    const mv = await run(H.variant(fn(BUILT, "mounted").func, { master: false }, H.OFF_IDS), header({ page_status: "Edit", id: "77", item_disassembly_status: "Completed", item_id: "P1", stock_movement: exploded }), {},
      { tables: f.tables, isEdit: true });
    measure.push(["form mounted, Edit of a 2,000-line Completed", counts(mv)]);
  }
  const out = ["Mock-harness measurements (scratchpad/idav2/client/test/test_explode.js; ms = the mock's JS time, not the platform's)"];
  for (const [what, c] of measure) out.push("- " + what + ": " + JSON.stringify(c));
  fs.writeFileSync(path.join(__dirname, "../out/measure.txt"), out.join("\n") + "\n");
  console.log(out.join("\n"));
  H.done("explode / 2,000 lines");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("explode / 2,000 lines");
});
