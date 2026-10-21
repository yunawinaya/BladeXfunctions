// IA form, the labour / overhead rule and the read limits: the BOM explode, the per-line allocator, the item picker, Batch Add,
// the row-remove fix-up and the Transfer Stock guard. Non-stock (stock_control 0) lines carry total_quantity = the requested
// quantity, no picks, no allocation, no Transfer Stock; stock lines behave as the base v32. Every explode / allocate read has
// an explicit .limit() and 500-id chunks; an 830-item explode under a server clamp still fills every line.
//   node test/test_labour.js
const H = require("./harness");
const { check, same } = H;

const BASE = H.readJSON(H.FILES.formBase);
const BUILT = H.readJSON(H.FILES.form);
const ORG = "1001";
const PLANT = "2002";
const fn = (doc, name) => H.byName(doc, name);
const NAMES = ["onChange_assembledItem", "onChange_componentQty", "onAfterUpdate_item", "onConfirm_batchAddItem"];

// tables: a BOM of `stock` stock components (+ the labour lines), each stock item with `bal` balances of `per` units
const fixture = (o) => {
  o = Object.assign({ stock: 5, labour: ["DL", "IDL", "VO"], bal: 2, per: 5, qty: 3, hu: false }, o || {});
  const items = [{ id: "P1", material_name: "Assembly", material_desc: "", based_uom: "77", table_default_bin: [], item_batch_management: 0, batch_number_genaration: "", stock_control: 1, is_deleted: 0 }];
  const subs = [];
  const balances = [];
  for (let i = 0; i < o.stock; i++) {
    const id = "C" + String(i).padStart(4, "0");
    items.push({ id: id, material_name: "Comp " + i, material_desc: "d" + i, based_uom: "77", serial_number_management: 0, item_batch_management: 0, table_uom_conversion: [],
      table_default_bin: [], stock_control: 1, is_deleted: 0 });
    subs.push({ bom_material_code: id, consume_type: "", sub_material_qty: o.qty, sub_material_qty_uom: "77", sub_material_wastage: 0, sub_material_name: "", sub_material_desc: "" });
    for (let b = 0; b < o.bal; b++) {
      balances.push({ id: "B" + i + "_" + b, material_id: id, location_id: "L" + (b % 3), storage_location_id: "S1", batch_id: null, plant_id: PLANT, organization_id: ORG,
        unrestricted_qty: o.per, balance_quantity: o.per, is_deleted: 0, create_time: "2026-01-0" + ((b % 9) + 1) + " 00:00:00" });
    }
  }
  o.labour.forEach((code, i) => {
    const id = "N" + i;
    items.push({ id: id, material_name: code, material_desc: "", based_uom: "77", serial_number_management: 0, item_batch_management: 0, table_uom_conversion: [], table_default_bin: [],
      stock_control: 0, is_deleted: 0 });
    subs.splice(Math.min(1 + i * 2, subs.length), 0, { bom_material_code: id, consume_type: "", sub_material_qty: 1.32, sub_material_qty_uom: "77", sub_material_wastage: 0, sub_material_name: "", sub_material_desc: "" });
  });
  const tables = {
    bill_of_materials: [{ id: "BOM1", parent_material_code: "P1", organization_id: ORG, is_deleted: 0, is_active: 1, parent_mat_bom_version: "V1", parent_mat_is_default: 1, parent_mat_base_quantity: 1, subform_sub_material: subs }],
    item: items, Item: items,
    unit_of_measurement: [{ id: "77", uom_name: "PCS", is_deleted: 0 }],
    item_balance: balances, item_batch_balance: [],
    handling_unit_atu7sreg_sub: o.hu ? [{ id: "HS1", handling_unit_id: "HU1", material_id: "C0000", is_deleted: 0 }] : [],
    handling_unit: o.hu ? [{ id: "HU1", location_id: "L0", is_deleted: 0, table_hu_items: [{ material_id: "C0000", location_id: "L0", batch_id: null, quantity: 4, is_deleted: 0 }] }] : [],
    on_reserved_gd: [], bin_location: [{ id: "L0", bin_location_combine: "A-0", is_deleted: 0 }, { id: "L1", bin_location_combine: "A-1", is_deleted: 0 }, { id: "L2", bin_location_combine: "A-2", is_deleted: 0 }],
    batch: [], storage_location: [],
  };
  return { tables: tables, items: items, subs: subs };
};
const header = (o) => Object.assign({ page_status: "Add", issuing_operation_faci: PLANT, item_qty: 1, project_id: "", organization_id: ORG, item_id: "P1", stock_movement: [] }, o || {});

const run = async (code, values, args, o) => {
  o = o || {};
  const w = H.world({ db: H.tableDb(o.tables || {}, { clamp: o.clamp, defaultLimit: o.defaultLimit }) });
  const self = H.makeThis(w, BUILT, { values: values, stateful: true, data: o.data, confirm: o.confirm });
  H.compile(w, code, false).call(self, args);
  await H.drain(w);
  return { w: w, self: self, trace: w.trace, rows: self.values.stock_movement || [], reads: w.reads };
};
const named = (trace, name) => trace.filter((t) => t[0] === name);
const linkCalls = (trace) => named(trace, "disabled").filter((t) => Array.isArray(t[1]) && t[1].some((p) => /\.transfer_stock$/.test(p)));
const picksOf = (row) => (row.temp_qty_data ? JSON.parse(row.temp_qty_data) : []);
const nonReads = (trace) => trace.filter((t) => t[0] !== "db.get");

(async () => {
  // ---- each patched handler: the base text was pinned; the built text compiles; every read carries an explicit limit
  for (const name of NAMES) check(name + ": changed and compiles", fn(BUILT, name).func !== fn(BASE, name).func && !!H.compile(H.world(), fn(BUILT, name).func, false));

  // ---- the explode, a BOM with labour lines
  let f = fixture();
  let r = await run(fn(BUILT, "onChange_assembledItem").func, header(), { value: "P1" }, { tables: f.tables });
  const ns = r.rows.filter((x) => /^N/.test(x.item_selection));
  const stockRows = r.rows.filter((x) => /^C/.test(x.item_selection));
  check("explode: 8 rows (5 stock + DL / IDL / VO in BOM order)", r.rows.length === 8 && same(r.rows.map((x) => x.item_selection), f.subs.map((s) => s.bom_material_code)), r.rows.map((x) => x.item_selection));
  check("explode: non-stock rows carry total_quantity = requested_qty, no picks, no summary", ns.length === 3 && ns.every((x) => x.total_quantity === x.requested_qty && x.requested_qty === 1.32 &&
    x.temp_qty_data === "" && x.stock_summary === ""), ns);
  check("explode: stock rows allocated from loose stock as the base does", stockRows.every((x) => x.total_quantity === 3 && picksOf(x).length === 1 && picksOf(x)[0].sm_quantity === 3 && /^Total: 3 PCS/.test(x.stock_summary)), stockRows.map((x) => [x.total_quantity, x.temp_qty_data]));
  const balanceReads = r.reads.filter((q) => ["item_balance", "item_batch_balance", "handling_unit_atu7sreg_sub", "on_reserved_gd"].indexOf(q.collection) >= 0);
  check("explode: no balance / HU / reservation read for the non-stock items", balanceReads.length > 0 && balanceReads.every((q) => !JSON.stringify(q.filter).includes('"N')), balanceReads.map((q) => q.collection));
  check("explode: every read but the BOM / plant-default ones has an explicit limit", r.reads.filter((q) => ["bill_of_materials", "storage_location"].indexOf(q.collection) < 0).every((q) => typeof q.limit === "number" && q.limit > 0),
    r.reads.filter((q) => q.limit === undefined).map((q) => q.collection));
  check("explode: the item read projects stock_control", r.reads.some((q) => q.collection === "item" && /stock_control/.test(q.field || "")));
  const links = linkCalls(r.trace);
  check("explode: Transfer Stock off on the 3 non-stock rows, on for the stock rows (one call each)", links.length === 2 && same(links[0][1], ns.map((x) => "stock_movement." + r.rows.indexOf(x) + ".transfer_stock")) && links[0][2] === true &&
    links[1][2] === false && links[1][1].length === 5, links);
  check("explode: the non-stock items remembered for the other handlers", same(Object.keys(r.self.models._data.ia_ns_items).sort(), ["N0", "N1", "N2"]) && r.self.models._data.ia_ns_links === 1);
  check("explode: no shortfall warning for the non-stock rows", !named(r.trace, "$message.warning").some((t) => /DL|IDL|VO/.test(t[1])));

  // a BOM without labour lines: the same writes and messages as the base, no Transfer Stock call
  for (const o of [{}, { hu: true }, { per: 1, bal: 2 }]) {
    f = fixture(Object.assign({ labour: [] }, o));
    const a = await run(fn(BASE, "onChange_assembledItem").func, header(), { value: "P1" }, { tables: f.tables });
    const b = await run(fn(BUILT, "onChange_assembledItem").func, header(), { value: "P1" }, { tables: f.tables });
    check("explode without labour lines " + JSON.stringify(o) + ": the base's writes, messages and option calls exactly; no Transfer Stock call", same(nonReads(a.trace), nonReads(b.trace)) && linkCalls(b.trace).length === 0 &&
      same(a.rows, b.rows), { a: nonReads(a.trace).slice(0, 6), b: nonReads(b.trace).slice(0, 6) });
  }
  // a rescale keeps the edited-components question: non-stock rows at their BOM quantity are not "edited"
  f = fixture();
  r = await run(fn(BUILT, "onChange_assembledItem").func, header(), { value: "P1" }, { tables: f.tables });
  const rescale = await run(fn(BUILT, "onChange_assembledItem").func, header({ stock_movement: r.rows, item_qty: 2 }), { value: "P1", rescale: true }, { tables: f.tables, data: r.self.models._data });
  check("explode rescale: rows exploded by the explode itself are not 'edited' (no question), re-scaled", named(rescale.trace, "$confirm").length === 0 &&
    rescale.rows.filter((x) => /^N/.test(x.item_selection)).every((x) => x.total_quantity === 2.64) && rescale.rows.filter((x) => /^C/.test(x.item_selection)).every((x) => x.total_quantity === 6));

  // ---- 830 components under a server clamp of 100 rows (the read limit scaled down to the clamp): every line filled
  {
    const big = fixture({ stock: 830, labour: ["DL", "IDL", "VO"], bal: 3, per: 2, qty: 5 });
    const small = (code) => code.replace("const IA_READ_MAX = 5000;", "const IA_READ_MAX = 100;");
    const b = await run(small(fn(BUILT, "onChange_assembledItem").func), header(), { value: "P1" }, { tables: big.tables, clamp: 100, defaultLimit: 100 });
    const st = b.rows.filter((x) => /^C/.test(x.item_selection));
    check("830-item explode, clamp 100: every stock line named, allocated in full from its 3 balances", b.rows.length === 833 && st.length === 830 && st.every((x) => x.item_name === "Comp " + Number(x.item_selection.slice(1)) &&
      x.total_quantity === 5 && picksOf(x).length === 3 && JSON.parse(x.uom_options).length === 1), st.filter((x) => x.total_quantity !== 5).slice(0, 3));
    check("830-item explode, clamp 100: the labour lines at their BOM quantity", b.rows.filter((x) => /^N/.test(x.item_selection)).every((x) => x.total_quantity === 1.32 && x.temp_qty_data === ""));
    check("830-item explode, clamp 100: id reads in chunks of <= 100, every read limited", b.reads.filter((q) => q.collection === "item" && q.filter).every((q) => q.filter[0].children[0].value.length <= 100 && q.limit <= 100) &&
      b.reads.filter((q) => q.collection === "item").length >= 9, b.reads.filter((q) => q.collection === "item").map((q) => q.limit));
    const a = await run(small(fn(BASE, "onChange_assembledItem").func), header(), { value: "P1" }, { tables: big.tables, clamp: 100, defaultLimit: 100 });
    check("(the same clamp on the base v32 explode leaves most lines unfilled - the mock clamps)", a.rows.filter((x) => /^C/.test(x.item_selection) && x.total_quantity === 5).length < 100);
    // the real limit: 12 one-unit balances per item = 9,960 rows, the server clamps at 5,000: the reads split and fill every line
    const many = fixture({ stock: 830, labour: [], bal: 12, per: 1, qty: 12 });
    const c = await run(fn(BUILT, "onChange_assembledItem").func, header(), { value: "P1" }, { tables: many.tables, clamp: 5000 });
    check("830-item explode, 9,960 balance rows, clamp 5,000: split reads, every line allocated 12 x 1", c.rows.length === 830 && c.rows.every((x) => x.total_quantity === 12 && picksOf(x).length === 12) &&
      c.reads.filter((q) => q.collection === "item_balance").length >= 4, { reads: c.reads.filter((q) => q.collection === "item_balance").map((q) => q.filter[0].children[0].value.length) });
  }

  // ---- the per-line allocator
  f = fixture();
  const lineOf = (id, o) => Object.assign({ item_selection: id, item_name: id, quantity_uom: "77", total_quantity: 0, requested_qty: 0, temp_qty_data: "", temp_hu_data: "", stock_summary: "" }, o || {});
  // non-stock, already known (cache): the typed quantity kept, no read at all
  r = await run(fn(BUILT, "onChange_componentQty").func, header({ stock_movement: [lineOf("C0000"), lineOf("N0", { total_quantity: 7 })] }), { rowIndex: 1, value: 7 },
    { tables: f.tables, data: { ia_ns_items: { N0: 1 } } });
  check("allocator, known non-stock line: typed 7 kept, no read, no write", r.reads.length === 0 && named(r.trace, "setData").length === 0 && r.rows[1].total_quantity === 7);
  r = await run(fn(BUILT, "onChange_componentQty").func, header({ stock_movement: [lineOf("N0", { total_quantity: 4, temp_qty_data: "[{\"sm_quantity\":1}]", stock_summary: "old" })] }),
    { rowIndex: 0, value: 4 }, { tables: f.tables, data: { ia_ns_items: { N0: 1 } } });
  check("allocator, known non-stock line with stale picks: total 4, picks / summary cleared", r.reads.length === 0 && r.rows[0].total_quantity === 4 && r.rows[0].temp_qty_data === "" && r.rows[0].stock_summary === "");
  // non-stock, not known yet: one read burst, kept, remembered, its Transfer Stock off
  r = await run(fn(BUILT, "onChange_componentQty").func, header({ stock_movement: [lineOf("N1", { total_quantity: 2.5 })] }), { rowIndex: 0, value: 2.5 }, { tables: f.tables });
  check("allocator, unknown non-stock line: one burst, typed 2.5 kept, remembered, Transfer Stock off", r.rows[0].total_quantity === 2.5 && r.rows[0].temp_qty_data === "" &&
    r.self.models._data.ia_ns_items.N1 === 1 && same(linkCalls(r.trace).map((t) => [t[1], t[2]]), [[["stock_movement.0.transfer_stock"], true]]) &&
    r.reads.some((q) => q.collection === "item" && /stock_control/.test(q.field)) && r.reads.every((q) => typeof q.limit === "number"));
  r = await run(fn(BUILT, "onChange_componentQty").func, header({ stock_movement: [lineOf("N1", { total_quantity: -3 })] }), { rowIndex: 0, value: -3 }, { tables: f.tables, data: { ia_ns_items: { N1: 1 } } });
  check("allocator, non-stock line typed below 0: total 0", r.rows[0].total_quantity === 0);
  // stock lines: the base's writes and messages
  for (const [what, vals, args] of [["typed 4", [lineOf("C0001")], { rowIndex: 0, value: 4 }], ["typed 30 (short)", [lineOf("C0002")], { rowIndex: 0, value: 30 }],
    ["typed again = picks", [lineOf("C0003", { total_quantity: 2, temp_qty_data: JSON.stringify([{ sm_quantity: 2 }]) })], { rowIndex: 0, value: 2 }],
    ["sibling staged", [lineOf("C0004", { temp_qty_data: JSON.stringify([{ material_id: "C0004", location_id: "L0", sm_quantity: 5 }]) }), lineOf("C0004")], { rowIndex: 1, value: 6 }]]) {
    const a = await run(fn(BASE, "onChange_componentQty").func, header({ stock_movement: H.clone(vals) }), args, { tables: f.tables });
    const b = await run(fn(BUILT, "onChange_componentQty").func, header({ stock_movement: H.clone(vals) }), args, { tables: f.tables });
    check("allocator, stock line " + what + ": the base's writes and messages", same(nonReads(a.trace), nonReads(b.trace)) && same(a.rows, b.rows), { a: nonReads(a.trace), b: nonReads(b.trace) });
  }

  // ---- the item picker
  const picked = (item) => ({ rowIndex: 2, value: item.id, fieldModel: { item: item } });
  const N0 = f.items.find((x) => x.id === "N0");
  const C1 = f.items.find((x) => x.id === "C0001");
  const rows3 = [lineOf("C0000"), lineOf("C0001"), lineOf("")];
  r = await run(fn(BUILT, "onAfterUpdate_item").func, header({ stock_movement: H.clone(rows3) }), picked(N0), { tables: f.tables });
  check("picker, a non-stock item (stock_control on the row): no item read, remembered, its Transfer Stock off", !r.reads.some((q) => q.collection === "Item") &&
    r.self.models._data.ia_ns_items.N0 === 1 && same(linkCalls(r.trace).map((t) => [t[1], t[2]]), [[["stock_movement.2.transfer_stock"], true]]));
  const noFlag = Object.assign({}, N0);
  delete noFlag.stock_control;
  r = await run(fn(BUILT, "onAfterUpdate_item").func, header({ stock_movement: H.clone(rows3) }), picked(noFlag), { tables: f.tables });
  check("picker, a row without stock_control: one Item read of it (stock_control projected, limited)", r.reads.filter((q) => q.collection === "Item").length === 1 &&
    r.reads.filter((q) => q.collection === "Item").every((q) => q.field === "stock_control" && q.limit === 1) && r.self.models._data.ia_ns_items.N0 === 1);
  {
    const a = await run(fn(BASE, "onAfterUpdate_item").func, header({ stock_movement: H.clone(rows3) }), picked(C1), { tables: f.tables });
    const b = await run(fn(BUILT, "onAfterUpdate_item").func, header({ stock_movement: H.clone(rows3) }), picked(C1), { tables: f.tables });
    check("picker, a stock item (no non-stock line seen): the base's writes, no Transfer Stock call", same(nonReads(a.trace), nonReads(b.trace)) && linkCalls(b.trace).length === 0);
    const c = await run(fn(BUILT, "onAfterUpdate_item").func, header({ stock_movement: H.clone(rows3) }), picked(C1), { tables: f.tables, data: { ia_ns_items: { N0: 1 }, ia_ns_links: 1 } });
    check("picker, a stock item on a row a non-stock item had: its Transfer Stock on again", same(linkCalls(c.trace).map((t) => [t[1], t[2]]), [[["stock_movement.2.transfer_stock"], false]]));
  }

  // ---- Batch Add
  {
    const arr = [Object.assign({}, C1), Object.assign({}, N0), (() => { const x = Object.assign({}, f.items.find((i) => i.id === "N1")); delete x.stock_control; return x; })()];
    r = await run(fn(BUILT, "onConfirm_batchAddItem").func, header({ stock_movement: [lineOf("C0000"), lineOf("C0002")] }), { itemArray: arr }, { tables: f.tables });
    check("Batch Add: rows appended as the base; only the item without stock_control is read; non-stock rows' Transfer Stock off", r.rows.length === 5 &&
      same(r.reads.filter((q) => q.collection === "Item").map((q) => q.filter[0].children[0].value), [["N1"]]) &&
      same(linkCalls(r.trace).map((t) => [t[1], t[2]]), [[["stock_movement.3.transfer_stock", "stock_movement.4.transfer_stock"], true], [["stock_movement.2.transfer_stock"], false]]) &&
      same(Object.keys(r.self.models._data.ia_ns_items).sort(), ["N0", "N1"]), linkCalls(r.trace));
    const a = await run(fn(BASE, "onConfirm_batchAddItem").func, header({ stock_movement: [lineOf("C0000")] }), { itemArray: [Object.assign({}, C1)] }, { tables: f.tables });
    const b = await run(fn(BUILT, "onConfirm_batchAddItem").func, header({ stock_movement: [lineOf("C0000")] }), { itemArray: [Object.assign({}, C1)] }, { tables: f.tables });
    check("Batch Add of stock items only: the base's writes, no Transfer Stock call", same(nonReads(a.trace), nonReads(b.trace)) && same(a.rows, b.rows) && linkCalls(b.trace).length === 0);
  }

  // ---- the row-remove fix-up: the links follow the rows; nothing before a non-stock line switched one off
  {
    const remove = fn(BUILT, "onRowRemove_item");
    check("onRowRemove_item is bound to the components table", H.findModel(BUILT.list, "stock_movement", "tlm8ve69").events.onRowRemove === remove.key);
    r = await run(remove.func, header({ stock_movement: [lineOf("C0000"), lineOf("N0"), lineOf("C0002")] }), {}, { data: { ia_ns_items: { N0: 1 }, ia_ns_links: 1 } });
    check("row removed after a non-stock line: links set again by item", same(linkCalls(r.trace).map((t) => [t[1], t[2]]), [[["stock_movement.1.transfer_stock"], true], [["stock_movement.0.transfer_stock", "stock_movement.2.transfer_stock"], false]]));
    r = await run(remove.func, header({ stock_movement: [lineOf("C0000"), lineOf("C0002")] }), {}, {});
    check("row removed, no non-stock line ever: nothing", r.trace.filter((t) => t[0] !== "getValue").length === 0 && named(r.trace, "getValue").length === 0);
  }

  // ---- the Transfer Stock guard
  {
    const sel = H.byKey(BUILT, "evhzkk8e");
    const sel0 = H.byKey(BASE, "evhzkk8e");
    const tables = Object.assign({}, f.tables);
    const ns = await run(H.sourceOf(sel), header({ stock_movement: [lineOf("N0")] }), { row: lineOf("N0", { item_name: "DL" }), rowIndex: 0 }, { tables: tables });
    check("Transfer Stock on a non-stock line: the dialog closed with a message, no stock read", same(named(ns.trace, "closeDialog").map((t) => t[1]), ["sm_item_balance"]) &&
      named(ns.trace, "$message.warning").some((t) => t[1] === "DL is not stock-controlled: enter its quantity on the line.") &&
      !ns.reads.some((q) => ["item_balance", "item_batch_balance", "on_reserved_gd", "handling_unit"].indexOf(q.collection) >= 0) && named(ns.trace, "hideLoading").length === 1);
    const a = await run(H.sourceOf(sel0), header({ stock_movement: [lineOf("C0001")] }), { row: lineOf("C0001"), rowIndex: 0 }, { tables: tables });
    const b = await run(H.sourceOf(sel), header({ stock_movement: [lineOf("C0001")] }), { row: lineOf("C0001"), rowIndex: 0 }, { tables: tables });
    check("Transfer Stock on a stock line: exactly the base", same(a.trace, b.trace) && a.trace.length > 10, { a: a.trace.length, b: b.trace.length });
  }

  // ---- the V2 click path does not block non-stock lines: no variance confirm when they carry their BOM quantity
  {
    const T = H.TEST_IDS;
    const click = H.clone(H.byName(BUILT, "iaV2_onClick_completed"));
    click.func = H.variant(click.func, { master: true }, T);
    f = fixture({ stock: 60 });
    const ex = await run(fn(BUILT, "onChange_assembledItem").func, header(), { value: "P1" }, { tables: f.tables });
    const values = header({ stock_movement: ex.rows });
    const w = H.world({ db: H.tableDb(f.tables) });
    const self = H.makeThis(w, BUILT, { values: values, answer: (id, p) => (id === T.IA_V2_SUBMIT && p.operation === "SUBMIT" ? { data: { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", ia_id: "88" } }
      : id === T.IA_V2_SUBMIT ? { data: { route: "STATUS", code: "200", job_id: "J1", job_status: "COMPLETED", terminal: "YES", ia_id: "88" } } : { data: { processed: "0" } }) });
    await H.fire(w, click, self);
    const sub = w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === T.IA_V2_SUBMIT && t[2].operation === "SUBMIT");
    check("V2 click on an exploded BOM with labour lines: validate passes, no variance confirm, SUBMIT sent with the non-stock lines at their quantity", named(w.trace, "$confirm").length === 0 &&
      sub.length === 1 && sub[0][2].form.stock_movement.filter((x) => /^N/.test(x.item_selection)).every((x) => x.total_quantity === 1.32 && x.temp_qty_data === ""));
  }
  H.done("labour / reads");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("labour / reads");
});
