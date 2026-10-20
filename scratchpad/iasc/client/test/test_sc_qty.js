// Small Cycle client, the actual output and the plant: on an enhanced IA a new item_qty recomputes the references from the
// snapshot (never a BOM read, never the v36 re-scale): untouched lines are re-allocated (asked when they hold picks; Keep picks
// leaves them), edited lines, lines with handling units and serial lines keep what was entered and are named; the
// re-allocation deducts the other lines' staged picks of the same material; non-stock lines follow. A plant change rebuilds
// the lines from the snapshot. A linked IA without a snapshot is prepared on the quantity change.
//   node scratchpad/iasc/client/test/test_sc_qty.js
const H = require("./harness");
const F = require("./fixture");
const { session, legacyLines, picks, snapOf } = require("./session");
const { check, same } = H;

const lines = (v) => (v.stock_movement || []).map((l) => [l.item_selection, l.requested_qty, l.total_quantity]);
// a linked, prepared IA at quantity 10 (the user's own steps)
const prepared = async (tables) => {
  const values = F.header();
  const ls = await legacyLines(values, { tables: tables });
  const s = session(Object.assign({}, values, { stock_movement: ls }), { tables: tables });
  await s.fire("sc_onClick_line");
  await s.fire("sc_onClick_pickLine", { rowIndex: 0, row: ((s.v().sc_line_dialog || {}).sc_line_table || [])[0] });
  return H.clone(s.v());
};

(async () => {
  const linked = await prepared();
  // ---- Q1: re-allocate / keep picks
  for (const fire of [false, true]) {
    const tag = "Q1" + (fire ? " (onChange echoes)" : "");
    const s = session(Object.assign({}, linked, { item_qty: 20 }), { fireOnChange: fire });
    const m = s.mark();
    await s.fire("onChange_itemQty", { value: 20 });
    const v = s.v();
    check(tag + ": one question, then the references at 20 and the lines re-allocated", s.calls("$confirm", m).length === 1 && s.calls("$confirm", m)[0][1] === "Quantity Changed" &&
      same(lines(v), [["C1", 40, 40], ["C2", 80, 80], ["N1", 2, 2]]) && picks(v.stock_movement[0]).length === 1, [lines(v), s.calls("$confirm", m).map((t) => t[1])]);
    check(tag + ": no BOM read, no v36 re-scale", s.reads("bill_of_materials", m).length === 0 && !s.since(m).some((t) => /triggerEvent$/.test(t[0]) && t[1] === "onChange_assembledItem"));
    check(tag + ": the keys and the snapshot unchanged", same(v.stock_movement.map((l) => l.sc_ref_key), linked.stock_movement.map((l) => l.sc_ref_key)) && v.bom_snapshot_json === linked.bom_snapshot_json);
    check(tag + ": what is left follows the new actual", /^After This IA: 80 EA still needed$/m.test(s.panel()), s.panel());
  }
  {
    // an echo of the same change arriving while the question is open finds the references already written: one question only
    let s = null;
    s = session(Object.assign({}, linked, { item_qty: 20 }), { confirms: { "Quantity Changed": () => {
      s.self.triggerEvent("sc_main", { scOp: "QTY", value: 20 });
      return "confirm";
    } } });
    await s.fire("onChange_itemQty", { value: 20 });
    check("Q1e: an echo during the question: asked once, re-allocated once", s.calls("$confirm").filter((y) => y[1] === "Quantity Changed").length === 1 &&
      same(lines(s.v()), [["C1", 40, 40], ["C2", 80, 80], ["N1", 2, 2]]), [s.calls("$confirm").map((y) => y[1]), lines(s.v())]);
  }
  {
    const s = session(Object.assign({}, linked, { item_qty: 20 }), { confirms: { "Quantity Changed": "cancel" } });
    await s.fire("onChange_itemQty", { value: 20 });
    const v = s.v();
    check("Q1: Keep picks: the references at 20, the picks and totals as they were (non-stock follows)", same(lines(v), [["C1", 40, 20], ["C2", 80, 40], ["N1", 2, 2]]) &&
      v.stock_movement[0].temp_qty_data === linked.stock_movement[0].temp_qty_data, lines(v));
  }
  {
    const s = session(Object.assign({}, linked));
    const m = s.mark();
    await s.fire("onChange_itemQty", { value: 10 });
    check("Q1: the same quantity again: nothing asked, nothing written but the panel", s.calls("$confirm", m).length === 0 && s.calls("setData", m).every((t) => Object.keys(t[1]).every((k) => /^sc_info_/.test(k))));
  }
  // ---- Q2: edited, HU and serial lines keep their numbers
  {
    const values = H.clone(linked);
    values.stock_movement[1].total_quantity = 41;
    values.item_qty = 20;
    const s = session(values);
    await s.fire("onChange_itemQty", { value: 20 });
    const v = s.v();
    check("Q2: the edited Screw line keeps 41 (reference 80), named; Frame re-allocated", same(lines(v), [["C1", 40, 40], ["C2", 80, 41], ["N1", 2, 2]]) &&
      s.calls("$message.info").some((t) => /keep the quantities you entered: SC-SCREW/.test(t[1])), [lines(v), s.calls("$message.info")]);
    const hu = H.clone(linked);
    hu.stock_movement[0].temp_hu_data = '[{"handling_unit_id":"HU1","sm_quantity":20}]';
    hu.item_qty = 20;
    const t = session(hu);
    await t.fire("onChange_itemQty", { value: 20 });
    check("Q2: a line picked from a handling unit is kept as entered", t.v().stock_movement[0].total_quantity === 20 && t.v().stock_movement[0].temp_hu_data === hu.stock_movement[0].temp_hu_data &&
      t.v().stock_movement[0].requested_qty === 40);
  }
  {
    const tables = F.tables();
    tables.bill_of_materials[0].subform_sub_material.push(F.row("S1", 1));
    const sn = await prepared(tables);
    const s = session(Object.assign({}, sn, { item_qty: 30 }), { tables: tables });
    await s.fire("onChange_itemQty", { value: 30 });
    const line = s.v().stock_movement.find((l) => l.item_selection === "S1");
    check("Q2: a serial line: reference 3, its picks left, named", !!line && line.requested_qty === 3 && line.total_quantity === 0 && s.calls("$message.info").some((t) => /serial numbers again for: SC-SN/.test(t[1])), line);
  }
  // ---- Q3: the re-allocation deducts the other lines' staged picks of the same material
  {
    const tables = F.tables();
    tables.bill_of_materials[0].subform_sub_material = [F.row("C2", 40), F.row("C2", 10)];
    const two = await prepared(tables);
    check("(Q3: two keyed Screw lines C2|77|1 and C2|77|2)", same(two.stock_movement.map((l) => l.sc_ref_key), ["C2|77|1", "C2|77|2"]));
    two.stock_movement.push({ item_selection: "C2", item_name: "manual screw", quantity_uom: F.EA, requested_qty: 0, total_quantity: 450, sc_ref_key: "",
      temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", batch_id: null, balance_id: "BL2", sm_quantity: 450 }]), temp_hu_data: "" });
    two.item_qty = 20;
    const s = session(two, { tables: tables });
    await s.fire("onChange_itemQty", { value: 20 });
    const v = s.v();
    check("Q3: 500 on hand - 450 staged on the manual line = 50 for the two lines (80 + 20 asked)", v.stock_movement[0].total_quantity === 50 && v.stock_movement[1].total_quantity === 0 &&
      v.stock_movement[2].total_quantity === 450 && s.calls("$message.warning").some((t) => /SC-SCREW \(30\)/.test(t[1]) && /SC-SCREW \(20\)/.test(t[1])), [lines(v), s.calls("$message.warning")]);
  }
  {
    const tables = F.tables();
    tables.handling_unit_atu7sreg_sub = [{ id: "HS1", handling_unit_id: "HU1", material_id: "C2", is_deleted: 0 }];
    tables.handling_unit = [{ id: "HU1", location_id: "L0", is_deleted: 0, table_hu_items: [{ material_id: "C2", location_id: "L0", batch_id: null, quantity: 400, is_deleted: 0 }] }];
    const s = session(Object.assign({}, linked, { item_qty: 30 }), { tables: tables });
    await s.fire("onChange_itemQty", { value: 30 });
    check("Q3b: stock held in a handling unit is not loose: 500 - 400 = 100 of the 120 asked", s.v().stock_movement[1].total_quantity === 100 &&
      s.calls("$message.warning").some((x) => /SC-SCREW \(20\)/.test(x[1])), [lines(s.v()), s.calls("$message.warning")]);
  }
  // ---- Q5: the plant changed on an enhanced IA
  {
    const s = session(Object.assign({}, linked));
    const m = s.mark();
    await s.fire("onChange_Plant", { value: F.PLANT });
    const v = s.v();
    check("Q5: v36 clears the lines, then they come back from the snapshot (keys, references), allocated", same(lines(v), [["C1", 20, 20], ["C2", 40, 40], ["N1", 1, 1]]) &&
      same(v.stock_movement.map((l) => l.sc_ref_key), ["C1|77|1", "C2|77|1", "N1|77|1"]) && s.since(m).some((t) => t[0] === "setData" && same(t[1].stock_movement, [])), lines(v));
    check("Q5: no BOM read", s.reads("bill_of_materials", m).length === 0);
  }
  {
    // two plant changes in a row, the first one's reads slower: the first run must not write over the second
    const s = session(Object.assign({}, linked), { dbDelay: (name, q) => (JSON.stringify(q).indexOf('"2009"') >= 0 || (name === "item" && !s2started) ? 50 : 0) });
    let s2started = false;
    s.start("onChange_Plant", { value: "2009" });
    s2started = true;
    s.start("onChange_Plant", { value: F.PLANT });
    await s.drain();
    check("Q5b: overlapping plant changes: the lines of the last plant stay (allocated at 2002)", same(lines(s.v()), [["C1", 20, 20], ["C2", 40, 40], ["N1", 1, 1]]) &&
      s.since(0).filter((x) => x[0] === "sc:setData" && "stock_movement" in x[1]).length === 1, [lines(s.v()), s.since(0).filter((x) => x[0] === "sc:setData" && "stock_movement" in x[1]).length]);
  }
  // ---- Q6: a linked IA without a snapshot: the quantity change prepares it
  {
    const values = Object.assign({}, linked, { bom_snapshot_json: "", source_bom_id: "", item_qty: 20 });
    values.stock_movement = [];
    const s = session(values);
    await s.fire("onChange_itemQty", { value: 20 });
    check("Q6: prepared at 20 (a BOM read, keyed lines, a snapshot)", s.reads("bill_of_materials").length > 0 && (snapOf(s.v()) || {}).mode === "STANDARD" && same(lines(s.v()).map((l) => l.slice(0, 2)), [["C1", 40], ["C2", 80], ["N1", 2]]),
      lines(s.v()));
    check("Q6: straight to sc_main, never through the v36 re-scale", !s.since(0).some((x) => /triggerEvent$/.test(x[0]) && x[1] === "onChange_assembledItem"));
  }
  H.done("test_sc_qty");
})();
