// Small Cycle client, preparation: BOM Mode Flat (a confirm when lines exist, the Expand dialog with the sub-assemblies that
// have a BOM, saved ticks, Expand All, Cancel puts the mode back), Flat with nothing to expand, Standard again (unlinked =
// legacy lines, linked = a Standard snapshot), the item changed on a linked IA (Keep Item puts it back; Change Item drops the
// link and runs the v36 explode), the item changed in Flat, Prepare BOM with the difference list, and every failure keeps the
// earlier item, mode and lines (cycle, missing conversion, failed read, no BOM).
//   node scratchpad/iasc/client/test/test_sc_prepare.js
const H = require("./harness");
const F = require("./fixture");
const { session, legacyLines, picks, snapOf } = require("./session");
const { check, same } = H;

const lines5 = (v) => (v.stock_movement || []).map((l) => [l.item_selection, l.requested_qty, l.total_quantity, l.sc_ref_key]);
const table = (v) => (v.sc_expand_dialog || {}).sc_expand_table || [];
const tick = async (s, ids) => {
  await s.self.setData({ "sc_expand_dialog.sc_expand_table": table(s.v()).map((r) => Object.assign({}, r, { expand: ids.indexOf(r.item_id) >= 0 ? 1 : 0 })) });
};
const flatWorld = (extraBoms) => F.tables({ boms: extraBoms || [] });

(async () => {
  const base = F.header({ item_qty: 5 });
  const legacy = await legacyLines(base);
  const start = Object.assign({}, base, { stock_movement: legacy });

  // ---- P1: Flat on a legacy IA with lines, Frame ticked
  for (const fire of [false, true]) {
    const s = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }), { fireOnChange: fire });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    const rows = table(s.v());
    const tag = "P1" + (fire ? " (onChange echoes)" : "");
    check(tag + ": a confirm first (lines exist)", s.calls("$confirm").length === 1 && s.calls("$confirm")[0][1] === "BOM Mode");
    check(tag + ": the dialog lists Frame only (the sub-assembly with a BOM), level 1, BOM V1, under SC-BOX, unticked", s.calls("openDialog").some((t) => t[1] === "sc_expand_dialog") &&
      same(rows.map((r) => [r.component, r.level, r.bom, r.under, r.item_id, r.expand]), [["SC-FRAME", 1, "V1", "SC-BOX", "C1", 0]]), rows);
    check(tag + ": nothing written before the dialog's OK", same(s.v().stock_movement, legacy) && s.v().bom_snapshot_json === "");
    await tick(s, ["C1"]);
    const m = s.mark();
    await s.fire("sc_onConfirm_expand");
    const v = s.v();
    check(tag + ": OK closes and empties the dialog", s.calls("closeDialog", m).some((t) => t[1] === "sc_expand_dialog") && table(v).length === 0);
    check(tag + ": Flat lines: Panel 30, Screw 20, Labour 0.5, keyed item|UOM, Panel allocated", same(lines5(v), [["C3", 30, 30, "C3|77"], ["C2", 20, 20, "C2|77"], ["N1", 0.5, 0.5, "N1|77"]]), lines5(v));
    const snap = snapOf(v) || { boms: {} };
    check(tag + ": the snapshot (FLAT, Frame expanded, both BOMs)", snap.mode === "FLAT" && same(snap.expand, ["C1"]) && same(Object.keys(snap.boms).sort(), ["B1", "B2"]) && v.bom_consumption_mode === "FLAT" &&
      v.source_bom_id === "B1");
    check(tag + ": shown: planned, sc_info, Prepare BOM", ["planned_output_qty", "sc_info", "sc_btn_bom"].every((x) => s.calls("display", m).flatMap((t) => t[1]).indexOf(x) >= 0));
    check(tag + ": the panel: not linked, BOM Flat V1, 1 sub-assembly expanded", same(s.panel().split("\n"), ["Sales Order: not linked",
      "BOM: Flat · V1 · 1 sub-assembly expanded · prepared " + String(snap.preparedAt).slice(0, 10)]), s.panel());
  }
  {
    const s = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }), { confirms: { "BOM Mode": "cancel" } });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    check("P1: Cancel on the confirm puts the mode back, reads no BOM", s.v().bom_consumption_mode === "" && s.reads("bill_of_materials").length === 0 && same(s.v().stock_movement, legacy));
  }
  // ---- P2 / P3: the dialog cancelled; Expand All
  {
    const s = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }), { fireOnChange: true });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    await s.fire("sc_onCancel_expand");
    check("P2: the dialog cancelled: closed, emptied, the mode back to legacy, the lines as they were", s.calls("closeDialog").some((t) => t[1] === "sc_expand_dialog") && table(s.v()).length === 0 &&
      s.v().bom_consumption_mode === "" && same(s.v().stock_movement, legacy) && s.v().bom_snapshot_json === "");
    const t = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }));
    await t.fire("sc_onChange_mode", { value: "FLAT" });
    await t.fire("sc_onClick_expandAll");
    check("P3: Expand All ticks every row", table(t.v()).length === 1 && table(t.v()).every((r) => r.expand === 1));
  }
  // ---- P4 / P5: Flat with nothing ticked; Flat with nothing to expand
  {
    const s = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }));
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    await s.fire("sc_onConfirm_expand");
    check("P4: Flat, nothing ticked: Frame consumed itself, keys item|UOM", same(lines5(s.v()), [["C1", 10, 10, "C1|77"], ["C2", 20, 20, "C2|77"], ["N1", 0.5, 0.5, "N1|77"]]) && same((snapOf(s.v()) || {}).expand, []),
      lines5(s.v()));
  }
  {
    const tables = F.tables({ boms: [F.bom("B7", "P7", 1, [F.row("C2", 2)])], extra: {} });
    tables.item.push(F.item("P7", "PLAIN"));
    const s = session(F.header({ item_id: "P7", item_qty: 3, bom_consumption_mode: "FLAT" }), { tables: tables });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    check("P5: Flat with no sub-assembly: no dialog, told so, prepared", !s.calls("openDialog").length && s.calls("$message.info").some((t) => /same components as Standard/.test(t[1])) &&
      same(lines5(s.v()), [["C2", 6, 6, "C2|77"]]), lines5(s.v()));
  }
  // a Flat IA to change from
  const flatSession = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }));
  await flatSession.fire("sc_onChange_mode", { value: "FLAT" });
  await tick(flatSession, ["C1"]);
  await flatSession.fire("sc_onConfirm_expand");
  const flat = H.clone(flatSession.v());
  // ---- P6 / P7: Standard again
  {
    const s = session(Object.assign({}, flat, { bom_consumption_mode: "STANDARD" }), { data: { sc_mode: "FLAT" } });
    await s.fire("sc_onChange_mode", { value: "STANDARD" });
    check("P6: Standard on an unlinked Flat IA: confirmed, today's Standard lines, no snapshot, no keys", s.calls("$confirm").some((t) => t[1] === "BOM Mode") &&
      same(lines5(s.v()), [["C1", 10, 10, ""], ["C2", 20, 20, ""], ["N1", 0.5, 0.5, ""]]) && s.v().bom_snapshot_json === "" && s.v().source_bom_id === "" && s.v().bom_consumption_mode === "STANDARD",
      lines5(s.v()));
    const legacyAt5 = await legacyLines(base);
    check("P6: the same lines and picks the v36 explode makes", same((s.v().stock_movement || []).map((l) => [l.item_selection, l.requested_qty, l.total_quantity, l.temp_qty_data, l.uom_options]),
      legacyAt5.map((l) => [l.item_selection, l.requested_qty, l.total_quantity, l.temp_qty_data, l.uom_options])));
  }
  {
    const s = session(Object.assign({}, flat, { bom_consumption_mode: "STANDARD", source_so_id: "9001", source_so_line_id: "8001" }), { data: { sc_mode: "FLAT" } });
    await s.fire("sc_onChange_mode", { value: "STANDARD" });
    check("P7: Standard on a linked Flat IA: a Standard snapshot, keyed lines", (snapOf(s.v()) || {}).mode === "STANDARD" && same(lines5(s.v()), [["C1", 10, 10, "C1|77|1"], ["C2", 20, 20, "C2|77|1"], ["N1", 0.5, 0.5, "N1|77|1"]]),
      lines5(s.v()));
  }
  // ---- P8: the item changed on a linked IA
  const linkedStd = Object.assign({}, start, { source_so_id: "9001", source_so_line_id: "8001", source_so_context_json: '{"v":1,"history":[{"op":"LINK"}]}', bom_consumption_mode: "STANDARD" });
  {
    const s = session(Object.assign({}, linkedStd, { item_id: "P9" }), { confirms: { "Item Changed": "cancel" }, data: { sc_item: "P1" } });
    await s.fire("onChange_assembledItem", { value: "P9" });
    check("P8: Keep Item: the item back to P1, the link and lines kept", s.v().item_id === "P1" && s.v().source_so_line_id === "8001" && same(s.v().stock_movement, legacy) &&
      s.calls("$confirm").some((t) => t[1] === "Item Changed"));
  }
  {
    const tables = F.tables();
    tables.bill_of_materials.push(F.bom("B8", "P8", 1, [F.row("C2", 3)]));
    tables.item.push(F.item("P8", "OTHER"));
    const s = session(Object.assign({}, linkedStd, { item_id: "P8" }), { tables: tables, data: { sc_item: "P1" } });
    await s.fire("onChange_assembledItem", { value: "P8" });
    const v = s.v();
    check("P8: Change Item: the link dropped (context kept for the save's UNLINK), no snapshot, the v36 explode for P8", v.source_so_line_id === "" && v.source_so_id === "" &&
      v.source_so_context_json === linkedStd.source_so_context_json && v.bom_snapshot_json === "" && same((v.stock_movement || []).map((l) => [l.item_selection, l.requested_qty]), [["C2", 15]]) &&
      s.since(0).some((t) => t[0] === "sc:triggerEvent" && t[1] === "onChange_assembledItem" && t[2].scLegacy === true), v.stock_movement);
  }
  // F1: the restore comes back through the platform's onChange; the item known from sc_item, else the link's context
  for (const [what, data, ctx] of [["sc_item kept", { sc_item: "P1" }, linkedStd.source_so_context_json],
    ["only the link's context knows the item", {}, JSON.stringify({ v: 1, itemId: "P1", history: [] })]]) {
    const s = session(Object.assign({}, linkedStd, { item_id: "P9", source_so_context_json: ctx }), { confirms: { "Item Changed": "cancel" }, data: data, fireOnChange: true });
    await s.fire("onChange_assembledItem", { value: "P9" });
    check("P8e (" + what + "): Keep Item with the platform's echo: asked once, the item back, the link and lines kept", s.calls("$confirm").filter((x) => x[1] === "Item Changed").length === 1 &&
      s.v().item_id === "P1" && s.v().source_so_line_id === "8001" && same(s.v().stock_movement, legacy), s.calls("$confirm").map((x) => x[1]));
  }
  {
    // the SO-line entry's own item (toView data) coming through onChange before mounted: nothing is known yet, nothing asked
    const s = session(Object.assign({}, linkedStd, { source_so_context_json: "" }), { fireOnChange: true });
    await s.fire("onChange_assembledItem", { value: "P1" });
    check("P8u: a linked IA, the previous item unknown: no question, nothing changed", !s.calls("$confirm").length && s.v().source_so_line_id === "8001" && same(s.v().stock_movement, legacy));
  }
  // ---- P9: the item changed in Flat
  {
    const tables = F.tables();
    tables.bill_of_materials.push(F.bom("B8", "P8", 1, [F.row("C1", 2), F.row("C2", 3)]));
    tables.item.push(F.item("P8", "OTHER", { table_default_bin: [{ plant_id: F.PLANT, bin_location: "L1", storage_location: "S1" }] }));
    const s = session(Object.assign({}, flat, { item_id: "P8" }), { tables: tables, data: { sc_item: "P1" } });
    await s.fire("onChange_assembledItem", { value: "P8" });
    check("P9: Flat, new item: the dialog for P8 with no saved tick", same(table(s.v()).map((r) => [r.item_id, r.expand, r.under]), [["C1", 0, "OTHER"]]), table(s.v()));
    await tick(s, ["C1"]);
    await s.fire("sc_onConfirm_expand");
    const v = s.v();
    check("P9: prepared for P8: its fields, its own bin, Flat lines", v.item_name === "OTHER" && v.item_uom === F.EA && v.location_id === "L1" &&
      same(lines5(v).map((l) => l.slice(0, 2)), [["C3", 30], ["C2", 15]]) && (snapOf(v) || {}).itemId === "P8", [v.item_name, v.location_id, lines5(v)]);
  }
  {
    const s = session(Object.assign({}, flat, { item_id: "P9" }), { data: { sc_item: "P1" } });
    await s.fire("onChange_assembledItem", { value: "P9" });
    check("P9: Flat, new item without a BOM: told, the item back to P1, the Flat lines kept", s.v().item_id === "P1" && same(s.v().stock_movement, flat.stock_movement) &&
      s.calls("$alert").some((t) => /No active Bill of Materials/.test(t[1])), s.calls("$alert"));
  }
  {
    const tables = F.tables();
    tables.bill_of_materials.push(F.bom("B8", "P8", 1, [F.row("C1", 2), F.row("C2", 3)]));
    tables.item.push(F.item("P8", "OTHER"));
    const s = session(Object.assign({}, start, { item_id: "P8", bom_consumption_mode: "FLAT" }), { tables: tables, data: { sc_item: "P1" } });
    await s.fire("onChange_assembledItem", { value: "P8" });
    check("P9b: an unprepared Flat IA (no snapshot): an item change opens the Flat dialog, never the v36 explode", s.calls("openDialog").some((x) => x[1] === "sc_expand_dialog") &&
      !s.since(0).some((x) => x[0] === "db.get" && x[1].collection === "bill_of_materials" && x[1].where), s.calls("openDialog"));
  }
  {
    const tables = F.tables();
    tables.bill_of_materials[1].is_active = 0;
    const s = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }), { tables: tables });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    check("P12: an inactive child BOM is not offered (no dialog; Flat = the root's components)", !s.calls("openDialog").length && s.calls("$message.info").some((x) => /same components as Standard/.test(x[1])) &&
      same(lines5(s.v()).map((l) => l.slice(0, 2)), [["C1", 10], ["C2", 20], ["N1", 0.5]]), lines5(s.v()));
  }
  // F2: a linked Flat IA's item change that is cancelled in the dialog, or fails, keeps its Sales Order link
  {
    const tables = F.tables();
    tables.bill_of_materials.push(F.bom("B8", "P8", 1, [F.row("C1", 2), F.row("C2", 3)]));
    tables.item.push(F.item("P8", "OTHER"));
    const linkedFlat = Object.assign({}, flat, { source_so_id: "9001", source_so_line_id: "8001", source_so_context_json: JSON.stringify({ v: 1, itemId: "P1", history: [] }) });
    for (const fire of [false, true]) {
      const s = session(Object.assign({}, linkedFlat, { item_id: "P8" }), { tables: tables, data: { sc_item: "P1" }, fireOnChange: fire });
      await s.fire("onChange_assembledItem", { value: "P8" });
      await s.fire("sc_onCancel_expand");
      check("P9L" + (fire ? " (onChange echoes)" : "") + ": a linked Flat IA, the new item's dialog cancelled: the item and the link back", s.v().item_id === "P1" && s.v().source_so_line_id === "8001" &&
        s.v().source_so_id === "9001" && same(s.v().stock_movement, flat.stock_movement), [s.v().item_id, s.v().source_so_line_id]);
      const f = session(Object.assign({}, linkedFlat, { item_id: "P9" }), { data: { sc_item: "P1" }, fireOnChange: fire });
      await f.fire("onChange_assembledItem", { value: "P9" });
      check("P9F" + (fire ? " (onChange echoes)" : "") + ": a linked Flat IA, the new item without a BOM: the item and the link back", f.v().item_id === "P1" && f.v().source_so_line_id === "8001" &&
        f.v().source_so_id === "9001" && f.calls("$alert").some((x) => /No active Bill of Materials/.test(x[1])), [f.v().item_id, f.v().source_so_line_id]);
    }
  }
  // ---- P10: Prepare BOM with the difference list
  {
    const changedTables = F.tables();
    changedTables.bill_of_materials[0].subform_sub_material[1].sub_material_qty = 50;
    const linkedFlat = Object.assign({}, flat, { source_so_id: "9001", source_so_line_id: "8001" });
    const s = session(linkedFlat, { tables: changedTables });
    await s.fire("sc_onClick_bom");
    check("P10: Prepare BOM (Flat): the dialog with the saved tick", same(table(s.v()).map((r) => [r.item_id, r.expand]), [["C1", 1]]));
    await s.fire("sc_onConfirm_expand");
    const ask = s.calls("$confirm").find((t) => t[1] === "BOM Changed") || null;
    check("P10: the differences listed (Screw 20 -> 25), then rebuilt", !!ask && /Changed: SC-SCREW 20 → 25/.test(ask[2]) && same(lines5(s.v()).map((l) => l.slice(0, 2)), [["C3", 30], ["C2", 25], ["N1", 0.5]]),
      [ask && ask[2], lines5(s.v())]);
    const k = session(linkedFlat, { tables: changedTables, confirms: { "BOM Changed": "cancel" } });
    await k.fire("sc_onClick_bom");
    await k.fire("sc_onConfirm_expand");
    check("P10: Keep: nothing changed", same(k.v().stock_movement, linkedFlat.stock_movement) && k.v().bom_snapshot_json === linkedFlat.bom_snapshot_json);
    const u = session(linkedFlat);
    await u.fire("sc_onClick_bom");
    await u.fire("sc_onConfirm_expand");
    check("P10: an unchanged BOM: told, nothing rebuilt", u.calls("$message.info").some((t) => /has not changed/.test(t[1])) && same(u.v().stock_movement, linkedFlat.stock_movement));
  }
  // ---- P11: failures keep everything (SC26)
  const failing = [
    ["a cycle (Frame <-> Panel)", { tables: flatWorld([F.bom("B3", "C3", 1, [F.row("C1", 1)])]) }, ["C1", "C3"], /loops back/],
    ["no conversion to the Frame BOM's unit", { tables: (() => {
      const t = flatWorld();
      t.bill_of_materials[0].subform_sub_material[0].sub_material_qty_uom = "79";
      return t;
    })() }, ["C1"], /no unit conversion/],
    ["a failed BOM read", { dbThrows: (name) => name === "bill_of_materials" }, null, /could not be read/],
  ];
  for (const [what, o, ticks, re] of failing) {
    const s = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }), o);
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    if (ticks) {
      await tick(s, ticks);
      await s.fire("sc_onConfirm_expand");
    }
    check("P11 " + what + ": an actionable error, the mode back, the lines and snapshot untouched", s.calls("$alert").some((t) => re.test(t[1])) && s.v().bom_consumption_mode === "" &&
      same(s.v().stock_movement, legacy) && s.v().bom_snapshot_json === "", s.calls("$alert").map((t) => t[1]));
  }
  // ---- P12: a BOM line that references a non-default BOM of its component: the Flat dialog shows that BOM and expands it
  {
    const boms = [F.bom("B9", "P9", 1, [F.row("C1", 1, { bom_type: "reference", ref_bom_id: "B3" })]),
      F.bom("B3", "C1", 1, [F.row("C2", 3)], { parent_mat_is_default: 0, parent_mat_bom_version: "V9" })];
    const s = session(F.header({ item_id: "P9", item_name: "NO-BOM", item_qty: 2, bom_consumption_mode: "FLAT" }), { tables: flatWorld(boms) });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    const rows = table(s.v());
    check("P12: the dialog shows the referenced BOM V9 for SC-FRAME (not its default V1)", same(rows.map((r) => [r.item_id, r.bom]), [["C1", "V9"]]), rows);
    await tick(s, ["C1"]);
    await s.fire("sc_onConfirm_expand");
    check("P12: expanded through V9: SC-SCREW 6 (2 x 1 x 3)", same((s.v().stock_movement || []).map((l) => [l.item_selection, l.requested_qty]), [["C2", 6]]),
      (s.v().stock_movement || []).map((l) => [l.item_selection, l.requested_qty]));
  }
  // ---- P13: a serial component and 250 picks (+ at least 1 for the serial line): told at preparation (such an IA completes through the
  // classic save, which takes at most 250 picks); 251 picks without a serial component: nothing said (IA V2 takes it)
  {
    const world = (n, serial) => {
      const ids = Array.from({ length: n }, (_, i) => "K" + i);
      return F.tables({ boms: [F.bom("B9", "P9", 1, ids.map((id) => F.row(id, 1)).concat(serial ? [F.row("S1", 1)] : []))],
        extra: { item: F.tables().item.concat(ids.map((id) => F.item(id, "KIT-" + id))), item_balance: F.tables().item_balance.concat(ids.map((id, i) => F.balance("KB" + i, id, 100))) } });
    };
    for (const [n, serial] of [[250, true], [251, false]]) {
      const s = session(F.header({ item_id: "P9", item_name: "NO-BOM", item_qty: 1, bom_consumption_mode: "FLAT" }), { tables: world(n, serial) });
      await s.fire("sc_onChange_mode", { value: "FLAT" });
      const said = s.calls("$alert").filter((t) => /250 picks/.test(String(t[1])));
      check("P13: " + (serial ? "a serial component + 250 picks: told to split it (at least 251)" : "251 picks, no serial component: nothing said"),
        (s.v().stock_movement || []).length === 251 && said.length === (serial ? 1 : 0) && (!serial || (/serial/.test(said[0][1]) && /at least 251/.test(said[0][1]))),
        [(s.v().stock_movement || []).length, said]);
    }
  }
  H.done("test_sc_prepare");
})();
