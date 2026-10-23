// test_uom_guard_edit.js <fixture dir>: GOODS_DELIVERY v246's unit guard in GD_EDIT_SUBMIT's gate (lifted code_node_GdUomGuard /
// code_node_GdUomCheck, rows from geUomGuardRows), on a recorded edit that the classic save completed: a stored Draft with a stock line in a unit its item does not have answers classic's 400; a stored
// Created GD never does; the base unit or a conversion with base_qty > 0 passes.
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const FX = process.argv[2];
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
  D + "/code/prepare/chain_edit.js", D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js", D + "/code/prepare/adapter_edit.js",
  R + "scratchpad/gdc/code/submit/required.js", D + "/code/submit/_common.js", D + "/code/prepare/alloc_ids.js", D + "/code/submit/guard.js", D + "/code/submit/entry.js",
  D + "/code/submit/gate.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
const mk = () => {
  const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(SRC + "\nconst GE_KINDS = " + JSON.stringify(KINDS) + ";", sb);
  return sb;
};
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.stack || e).toString().split("\n")[0]); } };
const BAD = "1999999999999999999";

// the recorded run's reads, as test_submit.js replays them; the edit's form, stored status and items are the case's
const load = (name) => {
  const fx = JSON.parse(fs.readFileSync(path.join(FX, name), "utf8"));
  const rec = {};
  for (const x of JSON.parse(fx.head.nodes_data || "[]")) if (x.node_id && rec[x.node_id] === undefined) { try { rec[x.node_id] = P(x.response_json_data || "null").data; } catch (e) {} }
  return { fx, rec, stored: rec["get_node_xTRvHWB8"].data, params: P(fx.head.request_json_data).workflowparams };
};
const gate = (base, opts) => {
  const sb = mk();
  const S0 = { total: 0, count: 0, data: [] }, G0 = { count: 0, data: {} };
  const g = (id, d) => (base.rec[id] === undefined ? d : base.rec[id]);
  const stored = Object.assign({}, base.stored, { gd_status: opts.stored });
  const form = JSON.parse(JSON.stringify(base.params.allData));
  if (opts.form) opts.form(form);
  // the items as stored: each recorded line's own unit is its item's base unit
  const lines = base.params.allData.table_gd.filter((r) => r.material_id);
  const items = opts.items || lines.map((l) => ({ id: String(l.material_id), material_name: "Item " + l.material_id, stock_control: 1,
    based_uom: String(l.gd_order_uom_id || l.good_delivery_uom_id), uom_conversion_json: [] }));
  const Rd = { stored, gd: { count: 1, data: stored }, pick: g("get_pick_for_reconcile", G0), livePickings: [], linkage: g("search_gr_linkage", S0),
    pickingSetup: g("get_node_iFPuvJX2", G0), itemFlags: g("sql_node_ItemFlags", []), packingSetup: g("get_packing_setup", G0),
    activePickings: g("search_node_NBAQ9gsj", S0), binNames: g("search_bin_names", S0), soLines: g("search_node_SOLine8kQ2", S0),
    cleanupSoLines: g("search_node_DnZIKKVH", S0), soHeaders: g("search_node_FVhsTRDu", S0), pickingFormat: g("get_node_zna6o03F", G0),
    itemDatas: items, allocated: S0, pending: S0, serialItems: [], allocTable: base.rec["get_cache_node_wiBIs4cB"], extraReads: {},
    uomNames: opts.uomNames || [] };
  for (const x of JSON.parse(base.fx.head.nodes_data)) if (/^(search|sql|get)-node$/.test(x.node_type || "") && !(x.node_id in Rd)) Rd.extraReads[x.node_id] = base.rec[x.node_id];
  const entry = { route: "GO", tenantId: base.fx.tenant_id, gdId: String(stored.id), gdNo: stored.delivery_no, organizationId: String(stored.organization_id), lineCount: 1, storedStatus: opts.stored };
  const gu = { operation: "SUBMIT", gdId: String(stored.id), tenantId: base.fx.tenant_id, source: "FORM", uid: "7",
    answers: { needCL: base.params.needCL || "required", continueZero: "Yes", confirmPickReversal: base.params.confirmPickReversal || "" } };
  sb.__G = gu; sb.__E = entry; sb.__R = Rd; sb.__F = form;
  return JSON.parse(JSON.stringify(vm.runInContext("submitGateOn(__G, __E, __R, __F, GE_KINDS)", sb)));
};
const MSG = (label, item, unit) => "Not saved: line " + label + " (" + item + ") is in " + unit + ". That unit is not one of the item's units, so the stock quantity cannot be worked out. Choose the item's own unit, or add the unit to the item's unit conversions, then save again.";

// GD/20260915/010, a Created edit of 2 lines that classic saved; the cases set the stored status (Draft: a Draft saved as
// Created, the guard's "fresh" delivery; Created: an edit). The recorded Draft runs lack the stored-GD read the replay uses.
const created = load("2105202870661320706.json");
const draft = created;
const firstStock = (form) => form.table_gd.findIndex((r) => r.material_id);
const setUnit = (u) => (form) => { const l = form.table_gd[firstStock(form)]; l.gd_order_uom_id = u; };

it("Draft -> Created, every unit the item's own: no 400 from the unit guard", () => {
  const r = gate(draft, { stored: "Draft" });
  assert.ok(!(r.code === "400" && /^Not saved: line/.test(r.message)), r.code + " " + r.message);
});
it("Draft -> Created, a line in a unit its item does not have: classic's 400 and text (unit id when no name)", () => {
  const base = gate(draft, { stored: "Draft" });
  const r = gate(draft, { stored: "Draft", form: setUnit(BAD), items: null });
  const l = draft.params.allData.table_gd[firstStock(draft.params.allData)];
  // the items are the recorded lines' (their own unit as base), so the changed line's unit is foreign
  assert.strictEqual(r.code, "400", JSON.stringify(r).slice(0, 300));
  assert.strictEqual(r.message, MSG(String(firstStock(draft.params.allData) + 1), (l.material_name || "Item " + l.material_id), "unit " + BAD));
  assert.notStrictEqual(base.code, "400");
});
it("the message names the unit when SUBMIT read its name", () => {
  const r = gate(draft, { stored: "Draft", form: setUnit(BAD), uomNames: [{ id: BAD, uom_name: "CTN" }] });
  assert.ok(/ is in CTN\. That unit is not one of the item's units/.test(r.message), r.message);
});
it("gd_order_uom_id blank: good_delivery_uom_id is the unit checked", () => {
  const r = gate(draft, { stored: "Draft", form: (f) => { const l = f.table_gd[firstStock(f)]; l.gd_order_uom_id = ""; l.good_delivery_uom_id = BAD; } });
  assert.strictEqual(r.code, "400", r.message);
});
it("a conversion with base_qty > 0 passes; base_qty 0 does not", () => {
  const f0 = draft.params.allData.table_gd.filter((r) => r.material_id);
  const items = (bq) => f0.map((l) => ({ id: String(l.material_id), material_name: "X", stock_control: 1, based_uom: String(l.gd_order_uom_id || l.good_delivery_uom_id),
    uom_conversion_json: JSON.stringify([{ alt_uom_id: BAD, base_qty: bq }]) }));
  assert.notStrictEqual(gate(draft, { stored: "Draft", form: setUnit(BAD), items: items(6) }).code, "400");
  assert.strictEqual(gate(draft, { stored: "Draft", form: setUnit(BAD), items: items(0) }).code, "400");
});
it("a non-stock item and an item not found pass", () => {
  const f0 = draft.params.allData.table_gd.filter((r) => r.material_id);
  const nonStock = f0.map((l) => ({ id: String(l.material_id), material_name: "X", stock_control: 0, based_uom: "1", uom_conversion_json: [] }));
  assert.notStrictEqual(gate(draft, { stored: "Draft", form: setUnit(BAD), items: nonStock }).code, "400");
  assert.notStrictEqual(gate(draft, { stored: "Draft", form: setUnit(BAD), items: [] }).code, "400");
});
it("a stored Created GD is never refused by the unit guard (an edit, as classic)", () => {
  const r = gate(created, { stored: "Created", form: setUnit(BAD) });
  assert.ok(!(r.code === "400" && /^Not saved: line/.test(r.message)), r.code + " " + r.message);
});
it("geUomGuardRows: the GD row, ITEM rows as the SQL's GROUP_CONCAT (base_qty > 0 only), UNIT rows", () => {
  const sb = mk();
  sb.__R = { itemDatas: [{ id: "5", based_uom: "1", stock_control: 1, material_name: "A", uom_conversion_json: [{ alt_uom_id: "2", base_qty: 6 }, { alt_uom_id: "3", base_qty: 0 }] },
    { id: "6", material_name: "B", uom_conversion_json: "[{\"alt_uom_id\":\"4\",\"base_qty\":1}]" }], uomNames: [{ id: "2", uom_name: "CTN" }] };
  const rows = JSON.parse(JSON.stringify(vm.runInContext("geUomGuardRows(__R, { gd_status: 'Draft' })", sb)));
  assert.deepStrictEqual(rows, [
    { kind: "GD", k: "Draft", base_uom: "", stock_control: "", conv: "", name: "" },
    { kind: "ITEM", k: "5", base_uom: "1", stock_control: "1", conv: "2", name: "A" },
    { kind: "ITEM", k: "6", base_uom: "", stock_control: "", conv: "4", name: "B" },
    { kind: "UNIT", k: "2", base_uom: "", stock_control: "", conv: "", name: "CTN" }]);
});
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
