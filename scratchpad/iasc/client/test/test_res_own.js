// RES-01 R3: an enrolled IA's own holds (its Allocated on_reserved_gd rows) are its own stock: its component-quantity re-pick, its
// Transfer Stock picker and the BOM explode's auto-allocation add them back to the free stock they read (the hold moved them to
// Reserved). Another document's holds never, a clone's source's never; an IA that never reserved = v36, whatever the switch (review I4).
//   node scratchpad/iasc/client/test/test_res_own.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

// the shipped build (RES-01 ON on DEV since 10-22) and its two switch variants
const SHIPPED = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const BUILT = H.resVariant(SHIPPED, false);
const ON = H.resVariant(SHIPPED, true);
const V36 = H.readJSON(H.FILES.formBase);
// SC-SCREW at L0: 30 free; this IA (4001) holds 20 more there, another IA 5, a GD 7 (all already out of unrestricted_qty)
const hold = (id, docType, docId, qty, o) => Object.assign({ id: id, doc_type: docType, doc_id: docId, status: "Allocated", material_id: "C2", bin_location: "L0", batch_id: null,
  from_category: "Unrestricted", open_qty: qty, reserved_qty: qty, item_uom: F.EA, plant_id: F.PLANT, organization_id: F.ORG, handling_unit_id: null, is_deleted: 0 }, o || {});
const tables = (extra) => {
  const t = F.tables();
  // SC-SCREW also comes in cartons of 12
  t.item = t.item.map((i) => (i.id === "C2" ? Object.assign({}, i, { table_uom_conversion: [{ alt_uom_id: F.CTN, alt_qty: 1, base_qty: 12 }] }) : i));
  t.item_balance = t.item_balance.map((b) => (b.id === "BL2" ? Object.assign({}, b, { unrestricted_qty: 30, balance_quantity: 65, reserved_qty: 35 }) : b));
  t.on_reserved_gd = [hold("R1", "Item Assembly", "4001", 20), hold("R2", "Item Assembly", "4999", 5), hold("R3", "Good Delivery", "777", 7),
    hold("R4", "Item Assembly", "4001", 3, { from_category: "Blocked" })].concat(extra || []);
  // the picker reads the item by the collection's display name
  t.Item = t.item;
  return t;
};
const line = (o) => Object.assign({ id: "5001", item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 40, total_quantity: 0, temp_qty_data: "", temp_hu_data: "" }, o || {});
const draft = (o) => F.header(Object.assign({ id: "4001", page_status: "Edit", material_hold_status: "FULL", stock_movement: [line()] }, o || {}));
const run = async (doc, name, values, args, extra) => {
  const w = H.world({ db: H.tableDb(tables(extra)) });
  const self = H.makeThis(w, doc, { values: H.clone(values), stateful: true, answer: F.answer(w, H.SC_TEST_IDS), confirm: () => "confirm" });
  w.so = F.so();
  const e = H.byName(doc, name);
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self, args);
  await H.drain(w);
  return { trace: w.trace, values: self.values };
};
const picked = (values) => {
  const l = values.stock_movement[0];
  let t = [];
  try {
    t = JSON.parse(l.temp_qty_data || "[]");
  } catch (e) {}
  return [l.total_quantity, t.map((p) => [p.location_id, p.sm_quantity])];
};

(async () => {
  // ---- the component quantity typed: re-picked from the free stock plus this IA's own holds
  {
    const args = { value: 50, rowIndex: 0 };
    const on = await run(ON, "onChange_componentQty", draft(), args);
    check("typed 50: 30 free + this IA's 20 held = 50 picked at L0 (another IA's 5 and the GD's 7 never)", same(picked(on.values), [50, [["L0", 50]]]), picked(on.values));
    const off = await run(BUILT, "onChange_componentQty", draft({ material_hold_status: "" }), args);
    const v36 = await run(V36, "onChange_componentQty", draft({ material_hold_status: "" }), args);
    check("an IA that never reserved: only the 30 free, as v36", same(picked(off.values), [30, [["L0", 30]]]) && same(picked(off.values), picked(v36.values)), [picked(off.values), picked(v36.values)]);
    // review I4: the switch only makes holds; an IA that holds stock keeps using it with the switch off
    const offHeld = await run(BUILT, "onChange_componentQty", draft(), args);
    check("switch off, an IA that holds stock: its own 20 still added back (50 picked)", same(picked(offHeld.values), [50, [["L0", 50]]]), picked(offHeld.values));
    // review I2: a clone carries its source's id and hold status: its source's holds are never its own
    const clone = await run(ON, "onChange_componentQty", draft({ page_status: "Clone" }), args);
    check("a clone (its source's id and hold status on the form): nothing of its own to add", same(picked(clone.values), [30, [["L0", 30]]]), picked(clone.values));
    const fresh = await run(ON, "onChange_componentQty", draft({ id: "", page_status: "Add", material_hold_status: "" }), args);
    check("a new IA (no id): nothing of its own to add", same(picked(fresh.values), [30, [["L0", 30]]]), picked(fresh.values));
    const ctn = await run(ON, "onChange_componentQty", draft(), { value: 70, rowIndex: 0 }, [hold("R5", "Item Assembly", "4001", 1, { item_uom: F.CTN }),
      hold("R6", "Item Assembly", "4001", 4, { handling_unit_id: "H1" }), hold("R7", "Good Delivery", "4001", 9)]);
    check("typed 70: a carton held (12 EA) counts 12: 30 + 20 + 12 = 62 picked (a handling-unit row, or another type's row with the same id, never)",
      same(picked(ctn.values), [62, [["L0", 62]]]), picked(ctn.values));
    // the mobile session's find (10-22): a sibling line of the same material picks out of the same pool (free + this IA's own holds). 30 free
    // + 20 own at L0, a sibling line already holding 40 there: typing 50 leaves 10 to pick, not 20 (20 would stage 60 against 50)
    const sib = line({ id: "5002", requested_qty: 40, total_quantity: 40, temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", batch_id: null,
      sm_quantity: 40, category: "Unrestricted" }]) });
    const two = await run(ON, "onChange_componentQty", draft({ stock_movement: [line(), sib] }), args);
    check("typed 50 next to a sibling holding 40 of the same 50 (30 free + 20 own): 10 picked, never past the pool", same(picked(two.values), [10, [["L0", 10]]]),
      picked(two.values));
  }
  // ---- the Transfer Stock picker: this IA's holds shown as its free stock
  {
    const args = { row: line(), rowIndex: 0 };
    const rowsOf = (r) => {
      const set = r.trace.filter((t) => t[0] === "setData" && t[1] && t[1]["sm_item_balance.table_item_balance"]).pop();
      return set ? set[1]["sm_item_balance.table_item_balance"].map((x) => [x.location_id, x.unrestricted_qty, x.reserved_qty, x.block_qty || 0]) : null;
    };
    const on = await run(ON, "onClick_select_stock", draft(), args);
    check("picker: L0 shows 50 free (30 + this IA's 20), 3 blocked (this IA's 3 from Blocked), its reserved less this IA's 23", same((rowsOf(on) || []).filter((x) => x[0] === "L0"),
      [["L0", 50, 12, 3]]), rowsOf(on));
    const off = await run(BUILT, "onClick_select_stock", draft({ material_hold_status: "" }), args);
    const v36 = await run(V36, "onClick_select_stock", draft({ material_hold_status: "" }), args);
    check("picker, an IA that never reserved: as v36 (30 free)", same(rowsOf(off), rowsOf(v36)) && same((rowsOf(off) || []).filter((x) => x[0] === "L0"), [["L0", 30, 35, 0]]),
      [rowsOf(off), rowsOf(v36)]);
    const offHeld = await run(BUILT, "onClick_select_stock", draft(), args);
    check("picker, switch off, an IA that holds stock: its own holds still shown free (review I4)", same((rowsOf(offHeld) || []).filter((x) => x[0] === "L0"), [["L0", 50, 12, 3]]), rowsOf(offHeld));
    const clone = await run(ON, "onClick_select_stock", draft({ page_status: "Clone" }), args);
    check("picker, a clone: its source's holds never shown as its own (review I2)", same((rowsOf(clone) || []).filter((x) => x[0] === "L0"), [["L0", 30, 35, 0]]), rowsOf(clone));
  }
  // ---- the BOM explode's auto-allocation (and Small Cycle's copy of it): 40 SC-SCREW wanted
  {
    const values = draft({ stock_movement: [], item_id: "P1" });
    const on = await run(ON, "onChange_assembledItem", values, { value: "P1" });
    const screw = (v) => (v.stock_movement || []).find((l) => l.item_selection === "C2") || {};
    check("explode: 40 SC-SCREW allocated (30 free + 20 of this IA's own)", screw(on.values).total_quantity === 40, screw(on.values).total_quantity);
    const off = await run(BUILT, "onChange_assembledItem", draft({ stock_movement: [], item_id: "P1", material_hold_status: "" }), { value: "P1" });
    check("explode, an IA that never reserved: 30 (short), as v36", screw(off.values).total_quantity === 30, screw(off.values).total_quantity);
    const offHeld = await run(BUILT, "onChange_assembledItem", values, { value: "P1" });
    check("explode, switch off, an IA that holds stock: 40 (its own holds used; review I4)", screw(offHeld.values).total_quantity === 40, screw(offHeld.values).total_quantity);
  }
  H.done("test_res_own");
})();
