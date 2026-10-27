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
// the choices only (SFG rows); the other rows are the components included as they are (kind IN)
const sfgs = (v) => table(v).filter((r) => r.kind === "SFG");
// as a user clicks: untick what is not wanted, tick the wanted items' places top down (an expanded place shows the places under it)
const tick = async (s, ids) => {
  for (let guard = 0; guard < 50; guard++) {
    const rows = table(s.v());
    const off = rows.findIndex((r) => r.kind === "SFG" && Number(r.expand) === 1 && ids.indexOf(r.item_id) < 0);
    const on = rows.findIndex((r) => r.kind === "SFG" && Number(r.expand) !== 1 && ids.indexOf(r.item_id) >= 0);
    const i = off >= 0 ? off : on;
    if (i < 0) return;
    const value = off >= 0 ? 0 : 1;
    await s.self.setData({ ["sc_expand_dialog.sc_expand_table." + i + ".expand"]: value });
    await s.fire("sc_onChange_expandTick", { rowIndex: i, value: value });
  }
};
const preview = (v) => ((v.sc_expand_dialog || {}).sc_expand_preview || []).map((r) => [r.component, r.qty, r.uom]);
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
    check(tag + ": the dialog's choices: Frame only (the sub-assembly with a BOM), level 1, BOM V1, under SC-BOX, unticked", s.calls("openDialog").some((t) => t[1] === "sc_expand_dialog") &&
      same(rows.filter((r) => r.kind === "SFG").map((r) => [r.component, r.level, r.bom, r.under, r.item_id, r.expand]), [["SC-FRAME", 1, "V1", "SC-BOX", "C1", 0]]), rows);
    check(tag + ": the other level-1 components shown as Included, no choice (the BA: raw materials have no option)", same(rows.filter((r) => r.kind !== "SFG").map((r) => [r.component, r.level, r.bom, r.kind]),
      [["SC-SCREW", 1, "Included", "IN"], ["SC-LAB", 1, "Included", "IN"]]), rows);
    check(tag + ": the dialog says each row is one place", /Each row is one place a component is used/.test(((s.v().sc_expand_dialog || {}).sc_expand_note) || ""),
      (s.v().sc_expand_dialog || {}).sc_expand_note);
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
    check("P3: Expand All ticks every sub-assembly (the included rows have no choice)", sfgs(t.v()).length === 1 && sfgs(t.v()).every((r) => r.expand === 1) &&
      table(t.v()).filter((r) => r.kind !== "SFG").every((r) => r.expand === 0));
  }
  // ---- P13: "Stop at level" (the user, 10-27: choose the level where the expansion stops): SC-PANEL with its own BOM (2 SC-SCREW), so
  // SC-BOX -> SC-FRAME (level 1) -> SC-PANEL (level 2); level L ticks every sub-assembly above level L, the rest are taken from stock
  {
    const deep = () => session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }), { tables: flatWorld([F.bom("B3", "C3", 1, [F.row("C2", 2)])]) });
    let s = deep();
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    check("P13: the dialog shows SC-FRAME (level 1) only: SC-PANEL (level 2) is hidden until SC-FRAME is expanded; the level choice empty",
      same(sfgs(s.v()).map((r) => [r.item_id, r.level]), [["C1", 1]]) && (s.v().sc_expand_dialog || {}).sc_expand_level === null, [table(s.v()), (s.v().sc_expand_dialog || {}).sc_expand_level]);
    check("P13: the note explains the level choice", /Stop at level/.test(((s.v().sc_expand_dialog || {}).sc_expand_note) || ""), (s.v().sc_expand_dialog || {}).sc_expand_note);
    await s.fire("sc_onChange_expandLevel", { value: 2 });
    check("P13: stop at level 2: SC-FRAME ticked, SC-PANEL shown under it, not ticked", same(sfgs(s.v()).map((r) => [r.item_id, r.expand]), [["C1", 1], ["C3", 0]]), table(s.v()));
    check("P13: stop at level 2: the included rows stay unticked", table(s.v()).filter((r) => r.kind !== "SFG").every((r) => r.expand === 0), table(s.v()));
    await s.fire("sc_onConfirm_expand");
    check("P13: stop at level 2: SC-PANEL taken from stock (30), SC-SCREW 20, SC-LAB 0.5", same(lines5(s.v()), [["C3", 30, 30, "C3|77"], ["C2", 20, 20, "C2|77"], ["N1", 0.5, 0.5, "N1|77"]]) &&
      same((snapOf(s.v()) || {}).expand, ["C1"]), lines5(s.v()));
    s = deep();
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    await s.fire("sc_onChange_expandLevel", { value: 3 });
    check("P13: stop at level 3: both ticked", same(sfgs(s.v()).map((r) => [r.item_id, r.expand]), [["C1", 1], ["C3", 1]]), table(s.v()));
    await s.fire("sc_onConfirm_expand");
    check("P13: stop at level 3: SC-PANEL made of its 2 SC-SCREW each: SC-SCREW 80 (60 + 20), SC-LAB 0.5", same(lines5(s.v()), [["C2", 80, 80, "C2|77"], ["N1", 0.5, 0.5, "N1|77"]]),
      lines5(s.v()));
    s = deep();
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    await s.fire("sc_onClick_expandAll");
    await s.fire("sc_onChange_expandLevel", { value: 1 });
    check("P13: stop at level 1 (after Expand All): nothing ticked, SC-PANEL hidden again", same(sfgs(s.v()).map((r) => [r.item_id, r.expand]), [["C1", 0]]), table(s.v()));
    await s.fire("sc_onChange_expandLevel", { value: 2 });
    await tick(s, ["C1", "C3"]);
    check("P13: a tick changed after a level: the row's own tick counts", same(sfgs(s.v()).map((r) => r.expand), [1, 1]), table(s.v()));
    await s.fire("sc_onCancel_expand");
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    check("P13: the dialog opened again: the level choice empty again", (s.v().sc_expand_dialog || {}).sc_expand_level === null && sfgs(s.v()).length === 1,
      [(s.v().sc_expand_dialog || {}).sc_expand_level, table(s.v())]);
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
    check("P9: Flat, new item: the dialog for P8 with no saved tick", same(sfgs(s.v()).map((r) => [r.item_id, r.expand, r.under]), [["C1", 0, "OTHER"]]), table(s.v()));
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
  // a saved Flat IA's dialog (Prepare BOM), its onChange echoing (the level emptied on open fires it): the saved tick kept
  {
    const s = session(Object.assign({}, flat), { fireOnChange: true });
    await s.fire("sc_onClick_bom");
    check("P13: an emptied level choice on open (echoed) keeps the saved tick", same(sfgs(s.v()).map((r) => [r.item_id, r.expand]), [["C1", 1]]), table(s.v()));
    for (const empty of [null, "", undefined]) await s.fire("sc_onChange_expandLevel", { value: empty });
    check("P13: the level choice's onChange with no level (null / empty): the saved tick kept", same(sfgs(s.v()).map((r) => [r.item_id, r.expand]), [["C1", 1]]), table(s.v()));
  }
  // ---- P10: Prepare BOM with the difference list
  {
    const changedTables = F.tables();
    changedTables.bill_of_materials[0].subform_sub_material[1].sub_material_qty = 50;
    const linkedFlat = Object.assign({}, flat, { source_so_id: "9001", source_so_line_id: "8001" });
    const s = session(linkedFlat, { tables: changedTables });
    await s.fire("sc_onClick_bom");
    check("P10: Prepare BOM (Flat): the dialog with the saved tick", same(sfgs(s.v()).map((r) => [r.item_id, r.expand]), [["C1", 1]]));
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
    if (ticks) check("P11 " + what + ": the Assembly components preview warned first", what === "a failed BOM read" || s.calls("$message.warning").some((x) => /^Cannot expand: /.test(x[1])),
      s.calls("$message.warning"));
    check("P11 " + what + ": an actionable error, the mode back, the lines and snapshot untouched", s.calls("$alert").some((t) => re.test(t[1])) && s.v().bom_consumption_mode === "" &&
      same(s.v().stock_movement, legacy) && s.v().bom_snapshot_json === "", s.calls("$alert").map((t) => t[1]));
  }
  // ---- P11b: a loop in the BOMs (Frame -> Panel -> Frame): the place whose BOM loops back is not offered, it is included as it is with the
  // reason, so expanding Frame still prepares (Panel taken from stock under it)
  {
    const s = session(Object.assign({}, start, { bom_consumption_mode: "FLAT" }), { tables: flatWorld([F.bom("B3", "C3", 1, [F.row("C1", 1)])]) });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    await tick(s, ["C1", "C3"]);
    const panel = table(s.v()).find((r) => r.path === "C1>C3") || {};
    check("P11b: Panel under Frame shown as Included with the loop reason, not ticked", panel.kind === "IN" && panel.bom === "Included as it is: its BOM contains SC-FRAME, which it is part of (a loop in the BOMs)" && panel.expand === 0, panel);
    const idx = table(s.v()).findIndex((r) => r.path === "C1>C3");
    await s.self.setData({ ["sc_expand_dialog.sc_expand_table." + idx + ".expand"]: 1 });
    await s.fire("sc_onChange_expandTick", { rowIndex: idx, value: 1 });
    check("P11b: ticking an included row: taken back, told why", (table(s.v()).find((r) => r.path === "C1>C3") || {}).expand === 0 &&
      s.calls("$message.info").some((x) => /SC-PANEL has no choice here/.test(x[1])), s.calls("$message.info"));
    await s.fire("sc_onConfirm_expand");
    check("P11b: prepared: Frame expanded, Panel 30 taken as it is", same(lines5(s.v()), [["C3", 30, 30, "C3|77"], ["C2", 20, 20, "C2|77"], ["N1", 0.5, 0.5, "N1|77"]]), lines5(s.v()));
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
  // ---- P15: one choice per place (the BA, 10-27 "select per SFG occurrence"): SC-FRAME directly under NO-BOM (its default V1: 6 SC-PANEL)
  // and under SC-PANEL (a reference to V9: 3 SC-SCREW); SC-PANEL directly under NO-BOM (B4: 2 SC-FRAME)
  {
    const B = require(require("path").join(H.IASC, "code/shared/sc_bom.js"));
    const boms = [F.bom("B9", "P9", 1, [F.row("C1", 1), F.row("C3", 1)]),
      F.bom("B3", "C1", 1, [F.row("C2", 3)], { parent_mat_is_default: 0, parent_mat_bom_version: "V9" }),
      F.bom("B4", "C3", 1, [F.row("C1", 2, { bom_type: "reference", ref_bom_id: "B3" })])];
    const tables = flatWorld(boms);
    const open = async () => {
      const s = session(F.header({ item_id: "P9", item_name: "NO-BOM", item_qty: 2, bom_consumption_mode: "FLAT" }), { tables: tables });
      await s.fire("sc_onChange_mode", { value: "FLAT" });
      return s;
    };
    const ticks = (s) => sfgs(s.v()).map((r) => [r.path, r.expand]);
    const setTick = async (s, path, value) => {
      const rows = table(s.v());
      const i = rows.findIndex((r) => r.path === path);
      await s.self.setData({ ["sc_expand_dialog.sc_expand_table." + i + ".expand"]: value });
      await s.fire("sc_onChange_expandTick", { rowIndex: i, value: value });
    };
    let s = await open();
    check("P15: first the level-1 places only, nothing ticked", same(ticks(s), [["C1", 0], ["C3", 0]]), ticks(s));
    check("P15: Assembly components: SC-FRAME 2 and SC-PANEL 2 (nothing expanded)", same(preview(s.v()), [["SC-FRAME", 2, "EA"], ["SC-PANEL", 2, "EA"]]), preview(s.v()));
    await setTick(s, "C3", 1);
    check("P15: SC-PANEL expanded: its SC-FRAME place shown under it, not ticked", same(ticks(s), [["C1", 0], ["C3", 1], ["C3>C1", 0]]), ticks(s));
    check("P15: Assembly components follow: SC-FRAME 6 (2 at the top + 2 x 2 under SC-PANEL)", same(preview(s.v()), [["SC-FRAME", 6, "EA"]]), preview(s.v()));
    await setTick(s, "C3>C1", 1);
    check("P15: SC-FRAME under SC-PANEL expanded too: SC-FRAME 2 + SC-SCREW 12 (V9: 3 each)", same(preview(s.v()), [["SC-FRAME", 2, "EA"], ["SC-SCREW", 12, "EA"]]), preview(s.v()));
    await setTick(s, "C3", 0);
    check("P15: stop SC-PANEL: what is under it hidden and cleared, the components back", same(ticks(s), [["C1", 0], ["C3", 0]]) &&
      same(preview(s.v()), [["SC-FRAME", 2, "EA"], ["SC-PANEL", 2, "EA"]]), [ticks(s), preview(s.v())]);
    await setTick(s, "C3", 1);
    check("P15: SC-PANEL expanded again: the place under it starts unticked (decide again)", same(ticks(s), [["C1", 0], ["C3", 1], ["C3>C1", 0]]), ticks(s));
    await setTick(s, "C3>C1", 1);
    await s.fire("sc_onConfirm_expand");
    const v = s.v();
    const snap = snapOf(v) || {};
    check("P15 (the BA's case): SC-FRAME taken from stock at the top (2), expanded under SC-PANEL: SC-SCREW 12 (2 x 1 x 2 x 3)",
      same(lines5(v), [["C1", 2, 2, "C1|77"], ["C2", 12, 12, "C2|77"]]), lines5(v));
    check("P15: the snapshot keeps the places; expand = the items expanded at every place (SC-PANEL only)", same([snap.expandAt, snap.expand], [["C3", "C3>C1"], ["C3"]]),
      [snap.expandAt, snap.expand]);
    const chk = B.scCheck(v.bom_snapshot_json, v, v.stock_movement, {});
    check("P15: the save's check accepts SC-FRAME's line (it is kept at one place)", chk.ok === true, chk);
    check("P15: the panel counts the expanded places", /2 sub-assemblies expanded/.test(s.panel()), s.panel());
    const c = session(Object.assign({}, v, { id: "4001" }), { tables: tables, this: { isCopy: true } });
    await c.fire("mounted");
    check("P15: a Clone prepares again with its places (SC-FRAME kept at the top, expanded under SC-PANEL), no dialog",
      same(lines5(c.v()), [["C1", 2, 2, "C1|77"], ["C2", 12, 12, "C2|77"]]) && same((snapOf(c.v()) || {}).expandAt, ["C3", "C3>C1"]) &&
      !c.calls("openDialog").some((x) => x[1] === "sc_expand_dialog"), [lines5(c.v()), (snapOf(c.v()) || {}).expandAt]);
    await s.fire("sc_onClick_bom");
    check("P15: Prepare BOM: the saved places ticked again (and shown), nothing else", same(ticks(s), [["C1", 0], ["C3", 1], ["C3>C1", 1]]), ticks(s));
    // an IA prepared before (item ticks, no places): SC-FRAME ticked = every place of it whose places above are expanded (here: the top only)
    s = await open();
    await setTick(s, "C1", 1);
    await s.fire("sc_onConfirm_expand");
    const old = Object.assign({}, snapOf(s.v()));
    delete old.expandAt;
    await s.self.setData({ bom_snapshot_json: JSON.stringify(old) });
    await s.fire("sc_onClick_bom");
    check("P15: an IA prepared before (item tick SC-FRAME): ticked at the top, not under the unexpanded SC-PANEL", same(ticks(s), [["C1", 1], ["C3", 0]]) &&
      (table(s.v()).find((r) => r.path === "C1>C3") || {}).bom === "Included as it is: its BOM contains SC-FRAME, which it is part of (a loop in the BOMs)", table(s.v()));
    await setTick(s, "C3", 1);
    check("P15: an IA prepared before, SC-PANEL now expanded: the SC-FRAME place under it starts unticked (choose again)",
      same(ticks(s), [["C1", 1], ["C3", 1], ["C3>C1", 0]]), ticks(s));
    // Stop at level 2 per place: both level-1 places expanded, each other taken from stock under them
    s = await open();
    await s.fire("sc_onChange_expandLevel", { value: 2 });
    await s.fire("sc_onConfirm_expand");
    check("P15: stop at level 2: SC-PANEL 6 (under SC-FRAME: 2 x 6 / base 2), SC-FRAME 4 (under SC-PANEL: 2 x 2)", same(lines5(s.v()), [["C3", 6, 6, "C3|77"], ["C1", 4, 4, "C1|77"]]),
      lines5(s.v()));
    const chk2 = B.scCheck(s.v().bom_snapshot_json, s.v(), s.v().stock_movement, {});
    check("P15: stop at level 2: expand = [] (each is also consumed), the save's check accepts both lines", same((snapOf(s.v()) || {}).expand, []) && chk2.ok === true, chk2);
  }
  // ---- P16 (the BA's fix 1, 10-27): the same SFG on two lines of one BOM = two places, each its own choice
  {
    const boms = [F.bom("B9", "P9", 1, [F.row("C1", 1, { bom_type: "reference", ref_bom_id: "B5" }), F.row("C1", 2, { bom_type: "reference", ref_bom_id: "B5" })]),
      F.bom("B5", "C1", 1, [F.row("C2", 1)], { parent_mat_is_default: 0, parent_mat_bom_version: "V5" })];
    const tables = flatWorld(boms);
    const s = session(F.header({ item_id: "P9", item_name: "NO-BOM", item_qty: 1, bom_consumption_mode: "FLAT" }), { tables: tables });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    check("P16: two rows for SC-FRAME, one per line", same(sfgs(s.v()).map((r) => [r.path, r.component, r.level]), [["C1#1", "SC-FRAME", 1], ["C1#2", "SC-FRAME", 1]]), table(s.v()));
    const i = table(s.v()).findIndex((r) => r.path === "C1#1");
    await s.self.setData({ ["sc_expand_dialog.sc_expand_table." + i + ".expand"]: 1 });
    await s.fire("sc_onChange_expandTick", { rowIndex: i, value: 1 });
    check("P16: line 1 expanded, line 2 keeps Stop here", same(sfgs(s.v()).map((r) => [r.path, r.expand]), [["C1#1", 1], ["C1#2", 0]]), sfgs(s.v()));
    check("P16: Assembly components: SC-SCREW 1 (line 1) and SC-FRAME 2 (line 2)", same(preview(s.v()), [["SC-SCREW", 1, "EA"], ["SC-FRAME", 2, "EA"]]), preview(s.v()));
    await s.fire("sc_onConfirm_expand");
    const snap = snapOf(s.v()) || {};
    check("P16: prepared: SC-SCREW 1, SC-FRAME 2; the snapshot keeps line 1's place (v2)", same(lines5(s.v()), [["C2", 1, 1, "C2|77"], ["C1", 2, 2, "C1|77"]]) &&
      same([snap.expandAt, snap.expandAtV], [["C1#1"], 2]), [lines5(s.v()), snap.expandAt]);
    const re = session(Object.assign({}, s.v()), { tables: tables });
    await re.fire("sc_onClick_bom");
    check("P16: reopened (Prepare BOM on the saved IA): line 1 Expand, line 2 Stop here", same(sfgs(re.v()).map((r) => [r.path, r.expand]), [["C1#1", 1], ["C1#2", 0]]), sfgs(re.v()));
    // an IA saved before line keys (place "C1", no v2): one choice for both lines, as it was prepared
    const old = Object.assign({}, snap, { expandAt: ["C1"] });
    delete old.expandAtV;
    const ol = session(Object.assign({}, s.v(), { bom_snapshot_json: JSON.stringify(old) }), { tables: tables });
    await ol.fire("sc_onClick_bom");
    check("P16: an IA saved before line keys: its place C1 ticks both lines, as before", same(sfgs(ol.v()).map((r) => [r.path, r.expand]), [["C1#1", 1], ["C1#2", 1]]), sfgs(ol.v()));
  }
  // ---- P17 (the BA's fix 2, 10-27): choices moved to another branch with the same totals: saved, the lines and their picks kept
  {
    const tables = flatWorld([F.bom("B9", "P9", 1, [F.row("PP", 1), F.row("QQ", 1)]), F.bom("BP", "PP", 1, [F.row("XX", 1)]), F.bom("BQ", "QQ", 1, [F.row("XX", 1)]),
      F.bom("BX", "XX", 1, [F.row("RR", 1)])]);
    tables.item.push(F.item("PP", "SFG-P"), F.item("QQ", "SFG-Q"), F.item("XX", "SFG-X"), F.item("RR", "RM-X"));
    const flip = async (s, path, value) => {
      const i = table(s.v()).findIndex((r) => r.path === path);
      await s.self.setData({ ["sc_expand_dialog.sc_expand_table." + i + ".expand"]: value });
      await s.fire("sc_onChange_expandTick", { rowIndex: i, value: value });
    };
    const s = session(F.header({ item_id: "P9", item_name: "NO-BOM", item_qty: 1, bom_consumption_mode: "FLAT" }), { tables: tables });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    for (const [path, value] of [["PP", 1], ["QQ", 1], ["PP>XX", 1]]) await flip(s, path, value);
    await s.fire("sc_onConfirm_expand");
    const before = H.clone(s.v().stock_movement);
    check("P17: first prepare (P > X expanded, Q > X stopped): RM-X 1, SFG-X 1 requested (no stock in this world, none allocated)",
      same(lines5(s.v()), [["RR", 1, 0, "RR|77"], ["XX", 1, 0, "XX|77"]]), lines5(s.v()));
    await s.fire("sc_onClick_bom");
    for (const [path, value] of [["PP>XX", 0], ["QQ>XX", 1]]) await flip(s, path, value);
    await s.fire("sc_onConfirm_expand");
    const snap = snapOf(s.v()) || {};
    check("P17: the choices moved (Q > X expanded, P > X stopped): the snapshot has the new choices", same(snap.expandAt, ["PP", "QQ", "QQ>XX"]), snap.expandAt);
    check("P17: the same totals: the lines and their picks kept as they were, said so", same(s.v().stock_movement, before) &&
      s.calls("$message.success").some((x) => /expansion choices are saved/.test(x[1])) && !s.calls("$message.info").some((x) => /has not changed/.test(x[1])), s.calls("$message.success"));
    await s.fire("sc_onClick_bom");
    check("P17: reopened: the new choices shown", same(sfgs(s.v()).map((r) => [r.path, r.expand]), [["PP", 1], ["PP>XX", 0], ["QQ", 1], ["QQ>XX", 1]]), sfgs(s.v()));
    await s.fire("sc_onConfirm_expand");
    check("P17: confirmed unchanged: told the BOM has not changed", s.calls("$message.info").some((x) => /has not changed/.test(x[1])), s.calls("$message.info"));
  }
  // ---- P14: the same sub-assembly on two BOM lines resolving to different BOMs: two places (the BA, 10-27), each its parent and version
  {
    const boms = [F.bom("B9", "P9", 1, [F.row("C1", 1), F.row("C3", 1)]),
      F.bom("B3", "C1", 1, [F.row("C2", 3)], { parent_mat_is_default: 0, parent_mat_bom_version: "V9" }),
      F.bom("B4", "C3", 1, [F.row("C1", 2, { bom_type: "reference", ref_bom_id: "B3" })])];
    const s = session(F.header({ item_id: "P9", item_name: "NO-BOM", item_qty: 2, bom_consumption_mode: "FLAT" }), { tables: flatWorld(boms) });
    await s.fire("sc_onChange_mode", { value: "FLAT" });
    check("P14: first only the level-1 places", same(table(s.v()).map((r) => r.path), ["C1", "C3"]), table(s.v()));
    for (const path of ["C1", "C3"]) {
      const i = table(s.v()).findIndex((r) => r.path === path);
      await s.self.setData({ ["sc_expand_dialog.sc_expand_table." + i + ".expand"]: 1 });
      await s.fire("sc_onChange_expandTick", { rowIndex: i, value: 1 });
    }
    check("P14: SC-FRAME on 2 lines = 2 places in branch order: under NO-BOM (V1) and under SC-PANEL (V9)", same(table(s.v()).map((r) => [r.path, r.component, r.level, r.under, r.bom]),
      [["C1", "SC-FRAME", 1, "NO-BOM", "V1"], ["C1>C3", "— SC-PANEL", 2, "SC-FRAME", "Included as it is: its BOM contains SC-FRAME, which it is part of (a loop in the BOMs)"], ["C3", "SC-PANEL", 1, "NO-BOM", "V1"],
        ["C3>C1", "— SC-FRAME", 2, "SC-PANEL", "V9"]]),
      table(s.v()));
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
