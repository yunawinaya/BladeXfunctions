// RF-09 (BA 10-22): a Required typed by hand is the user's. Each line carries required_manual (a hidden bound column): the Required
// column's onChange sets it "1" when a value is typed and "" when it is emptied (the line then follows the BOM reference again); IA_SAVE
// keeps a flagged Required through re-scales (test_v13_sim.js).
//   node scratchpad/iasc/client/test/test_res_manual.js
const H = require("./harness");
const F = require("./fixture");
const { check } = H;

const SHIPPED = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const ON = H.resVariant(SHIPPED, true);
const table = (doc) => H.findModel(doc.list, "stock_movement");
const col = (doc, m) => (table(doc).tableColumns || []).find((c) => c.model === m);
const lines = () => [
  { id: "5001", item_selection: "C2", quantity_uom: F.EA, requested_qty: 10, required_qty: 10, required_manual: "", total_quantity: 10, temp_qty_data: "", temp_hu_data: "" },
  { id: "5002", item_selection: "C1", quantity_uom: F.EA, requested_qty: 4, required_qty: 4, required_manual: "1", total_quantity: 4, temp_qty_data: "", temp_hu_data: "" },
];
const edit = async (rowIndex, value, seed) => {
  const w = H.world({ db: H.tableDb(F.tables()) });
  const values = F.header({ id: "4001", page_status: "Edit", item_assembly_status: "Created", material_hold_status: "FULL", stock_movement: seed || lines() });
  const self = H.makeThis(w, ON, { values: H.clone(values), stateful: true, isEdit: true });
  self.values.stock_movement[rowIndex].required_qty = value;
  const e = H.byKey(ON, col(ON, "required_qty").events.onChange);
  H.compile(w, e.func, false).call(self, { rowIndex: rowIndex, value: value, field: "required_qty" });
  await H.drain(w);
  return { w: w, values: self.values, writes: w.trace.filter((t) => /setData$/.test(t[0])).map((t) => t[1]) };
};

(async () => {
  {
    const m = col(ON, "required_manual");
    const req = col(ON, "required_qty");
    const cols = table(ON).tableColumns.map((c) => c.model);
    check("required_manual: a hidden bound input right after Required, empty by default, no event of its own", !!m && m.type === "input" && m.options.hidden === true &&
      m.options.dataBind === true && m.options.defaultValue === "" && Object.values(m.events || {}).every((v) => v === "") &&
      cols.indexOf("required_manual") === cols.indexOf("required_qty") + 1, m && m.options);
    const e = req && H.byKey(ON, req.events.onChange);
    check("Required's onChange: the flag's js handler", !!e && e.type === "js" && /required_manual/.test(e.func), req && req.events);
  }
  {
    let r = await edit(0, 12);
    check("a Required typed by hand: the line flagged \"1\"", r.values.stock_movement[0].required_manual === "1", r.writes);
    r = await edit(0, 10);
    check("a Required typed equal to the reference: flagged too (the user's intent, RF-09)", r.values.stock_movement[0].required_manual === "1", r.writes);
    r = await edit(1, "");
    check("Required emptied: the flag cleared (the line follows the reference again)", r.values.stock_movement[1].required_manual === "", r.writes);
    r = await edit(1, null);
    check("Required cleared to null: the flag cleared", r.values.stock_movement[1].required_manual === "", r.writes);
    r = await edit(1, 7);
    check("an already flagged line typed again: no write (already \"1\")", r.writes.length === 0, r.writes);
    r = await edit(0, 5, lines().map((l, i) => (i === 0 ? Object.assign({}, l, { required_manual: undefined }) : l)));
    check("a line without the column yet (an IA saved before RF-09): flagged on a typed value", r.values.stock_movement[0].required_manual === "1", r.writes);
  }
  H.done("test_res_manual");
})();
