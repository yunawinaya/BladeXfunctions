// Small Cycle client, the Sales Order link: Select SO Line -> the dialog -> a line picked (an IA with lines keeps them and their
// picks, keys stamped, the snapshot saved; an IA at quantity 0 takes the suggestion through QTY), Unlink (only the link goes,
// Standard and Flat keep their prepared BOM), Use Suggested Qty (other open IAs, a fully covered line, a CTN line, a failed read), the SO-line entry, mounted
// per page (Edit Draft rehydrates only, View / Completed read-only, a removed line offers Re-link), Clone, Re-link.
//   node scratchpad/iasc/client/test/test_sc_link.js
const H = require("./harness");
const F = require("./fixture");
const { session, legacyLines, picks, snapOf } = require("./session");
const { check, same } = H;
const PROJ = H.SC_TEST_IDS.SO_IA_PROJECTION;
const RELINK = H.SC_TEST_IDS.IA_SC_RELINK;

const shown = (s, n) => s.calls("display", n).flatMap((t) => t[1]);
const hidden = (s, n) => s.calls("hide", n).flatMap((t) => t[1]);
const keys = (v) => (v.stock_movement || []).map((l) => l.sc_ref_key);
const lineTable = (v) => (v.sc_line_dialog || {}).sc_line_table || [];
const J = (text) => {
  try {
    return JSON.parse(text) || {};
  } catch (e) {
    return {};
  }
};

// a user links an Add IA whose lines the v36 explode built
const linkNew = async (values, o) => {
  const lines = await legacyLines(values, o);
  const s = session(Object.assign({}, values, { stock_movement: lines }), o);
  await s.fire("sc_onClick_line");
  const dialogRows = lineTable(s.v());
  const m = s.mark();
  await s.fire("sc_onClick_pickLine", { rowIndex: 0, row: dialogRows[0] });
  return { s: s, lines: lines, dialogRows: dialogRows, m: m };
};

(async () => {
  // ---- L1: an Add IA with lines, linked
  {
    const { s, lines, dialogRows, m } = await linkNew(F.header());
    const v = s.v();
    check("L1: the dialog lists SO-A line 1 (ordered 100 EA, suggested 100)", dialogRows.length === 1 && same([dialogRows[0].so_no, dialogRows[0].line_no, dialogRows[0].customer,
      dialogRows[0].ordered, dialogRows[0].suggestion, dialogRows[0].uom, dialogRows[0].line_id, dialogRows[0].so_id, dialogRows[0].uom_id], ["SO-A", "1", "ACME", 100, 100, "EA", "8001", "9001", F.EA]), dialogRows);
    check("L1: CANDIDATES asked for the item and the org", s.wf(PROJ).some((t) => t[2].operation === "CANDIDATES" && t[2].item_id === "P1" && t[2].organization_id === F.ORG));
    check("L1: the dialog opened, then closed and emptied on the pick", s.calls("openDialog").some((t) => t[1] === "sc_line_dialog") && s.calls("closeDialog", m).some((t) => t[1] === "sc_line_dialog") &&
      same(lineTable(v), []));
    const ctx = J(v.source_so_context_json);
    check("L1: the link (ids, mode STANDARD, a baseline preview; the history is the server's to write)", v.source_so_id === "9001" && v.source_so_line_id === "8001" &&
      v.bom_consumption_mode === "STANDARD" && ctx.v === 1 && ctx.soNo === "SO-A" && ctx.orderedQty === "100" && ctx.uomId === F.EA && same(ctx.history, []), ctx);
    check("L1: planned = the quantity already entered (10)", v.planned_output_qty === 10 && v.item_qty === 10);
    check("L1: the lines and their picks kept, keys stamped by item + UOM occurrence", same(v.stock_movement.map((l) => [l.item_selection, l.total_quantity, l.temp_qty_data, l.requested_qty]),
      lines.map((l) => [l.item_selection, l.total_quantity, l.temp_qty_data, l.requested_qty])) && same(keys(v), ["C1|77|1", "C2|77|1", "N1|77|1"]), v.stock_movement);
    const snap = snapOf(v);
    check("L1: the snapshot (STANDARD, P1, root B1) and source_bom_id", snap && snap.mode === "STANDARD" && snap.itemId === "P1" && snap.root.bomId === "B1" && snap.rows.length === 3 &&
      v.source_bom_id === "B1");
    check("L1: one BOM read (the stamp), no line rebuilt", s.reads("bill_of_materials", m).length === 1 && !s.calls("setData", m).some((t) => "stock_movement" in t[1]));
    const sum = s.wf(PROJ, m).filter((t) => t[2].operation === "SUMMARY");
    check("L1: SUMMARY for the new link (no exclusion, proposal 10 EA)", sum.length === 1 && sum[0][2].so_line_id === "8001" && sum[0][2].exclude_ia_id === "" && sum[0][2].proposal_qty === "10.00000000" &&
      sum[0][2].proposal_uom_id === F.EA, sum.map((t) => t[2]));
    check("L1: the section: the line, its figures, the suggestion with its sum, what is left after this IA, the BOM; no message", same(s.panel().split("\n"), [
      "Sales Order: SO-A · line 1", "Customer: ACME", "Ordered: 100 EA", "Delivered: 0 EA", "Produced: 0 EA", "In Progress: 0 EA in other open IAs",
      "Remaining to Plan: 100 EA = 100 ordered − 0 produced − 0 in progress", "After This IA: 90 EA still needed", "BOM: Standard · V1 · prepared " + snapOf(v).preparedAt.slice(0, 10)]),
      s.panel());
    check("L1: the section shown", shown(s, m).indexOf("sc_section") >= 0 || shown(s).indexOf("sc_section") >= 0, shown(s));
    check("L1: the linked controls shown", ["planned_output_qty", "sc_info", "sc_btn_unlink", "sc_btn_suggest", "sc_btn_refresh", "sc_btn_bom"].every((x) => shown(s, m).indexOf(x) >= 0), shown(s, m));
    // F4: our own mode write (STANDARD) coming back after models._data lost track of it: nothing rebuilt, nothing asked
    const before = H.clone(v.stock_movement);
    delete s.self.models._data.sc_mode;
    const m2 = s.mark();
    await s.fire("sc_onChange_mode", { value: "STANDARD" });
    check("L1: a missed STANDARD echo on a linked IA: no BOM read, no question, the lines and picks untouched", s.reads("bill_of_materials", m2).length === 0 && s.calls("$confirm", m2).length === 0 &&
      same(s.v().stock_movement, before), s.calls("$confirm", m2).map((x) => x[1]));
  }
  {
    const s = session(F.header());
    await s.fire("sc_onClick_line");
    await s.fire("sc_onClick_pickLine", { rowIndex: 0, row: lineTable(s.v())[0] });
    check("L1b: an IA with its item but no line: linked and prepared (keyed lines, allocated)", same(keys(s.v()), ["C1|77|1", "C2|77|1", "N1|77|1"]) && (s.v().stock_movement[0] || {}).total_quantity === 20 &&
      (snapOf(s.v()) || {}).mode === "STANDARD", s.v().stock_movement);
    check("L1b: one SUMMARY", s.wf(PROJ).filter((x) => x[2].operation === "SUMMARY").length === 1, s.wf(PROJ).filter((x) => x[2].operation === "SUMMARY").length);
  }
  {
    // the moment between the link's mode write and its stamp: linked, STANDARD, no snapshot yet, models._data blank; the mode echo
    // arriving then must not rebuild the lines (the reviewer's missed-echo case)
    const values = F.header();
    const ls = await legacyLines(values);
    const s = session(Object.assign({}, values, { stock_movement: ls, source_so_id: "9001", source_so_line_id: "8001", bom_consumption_mode: "STANDARD" }));
    await s.fire("sc_onChange_mode", { value: "STANDARD" });
    check("L1c: a STANDARD echo before the stamp: no BOM read, no question, the lines and picks untouched", s.reads("bill_of_materials").length === 0 && !s.calls("$confirm").length &&
      same(s.v().stock_movement, ls), s.calls("$confirm").map((x) => x[1]));
  }
  // ---- L2: quantity 0: the suggestion fills planned + item_qty and goes through QTY once (with the platform's onChange echoes too)
  for (const fire of [false, true]) {
    const { s } = await linkNew(F.header({ item_qty: 0 }), { fireOnChange: fire });
    const v = s.v();
    const [c1, c2, n1] = (v.stock_movement || []).concat([{}, {}, {}]);
    check("L2" + (fire ? " (onChange echoes)" : "") + ": planned = item_qty = the suggestion 100", v.planned_output_qty === 100 && v.item_qty === 100, [v.planned_output_qty, v.item_qty]);
    check("L2" + (fire ? " (onChange echoes)" : "") + ": references at 100 (Frame 200, Screw 400, Labour 10)", c1.requested_qty === 200 && c2.requested_qty === 400 && n1.requested_qty === 10 && n1.total_quantity === 10,
      v.stock_movement.map((l) => [l.requested_qty, l.total_quantity]));
    check("L2" + (fire ? " (onChange echoes)" : "") + ": the lines allocated for the new references (Frame 150 of 200, short 50; Screw 400)", c1.total_quantity === 150 && picks(c1).length === 2 &&
      c2.total_quantity === 400 && s.calls("$message.warning").some((t) => /SC-FRAME \(50\)/.test(t[1])), [c1.total_quantity, c2.total_quantity]);
    check("L2" + (fire ? " (onChange echoes)" : "") + ": no question (no line had picks), no BOM re-scale by v36", s.calls("$confirm").length === 0 &&
      !s.since(0).some((t) => t[0] === "triggerEvent" && t[1] === "onChange_assembledItem" && t[2] && t[2].rescale), s.calls("$confirm"));
    const qtyRuns = s.since(0).filter((t) => /triggerEvent$/.test(t[0]) && t[1] === "sc_main" && t[2].scOp === "QTY");
    check("L2" + (fire ? " (onChange echoes)" : "") + ": the quantity echo comes back at most once and changes nothing", qtyRuns.length === (fire ? 1 : 0), qtyRuns.length);
    check("L2" + (fire ? " (onChange echoes)" : "") + ": one SUMMARY for the whole link", s.wf(PROJ).filter((x) => x[2].operation === "SUMMARY").length === 1,
      s.wf(PROJ).filter((x) => x[2].operation === "SUMMARY").length);
  }
  // ---- L2b: an IA with a quantity but no lines: planned = that quantity, then prepared at it
  {
    const s = session(F.header({ item_qty: 5, stock_movement: [] }));
    await s.fire("sc_onClick_line");
    await s.fire("sc_onClick_pickLine", { rowIndex: 0, row: lineTable(s.v())[0] });
    const v = s.v();
    check("L2b: no lines, quantity 5: planned 5, item_qty 5, 3 keyed lines prepared at 5", v.planned_output_qty === 5 && v.item_qty === 5 && (v.stock_movement || []).length === 3 &&
      (v.stock_movement[0] || {}).requested_qty === 10 && same(keys(v), ["C1|77|1", "C2|77|1", "N1|77|1"]), [v.planned_output_qty, v.item_qty, (v.stock_movement || []).map((l) => l.requested_qty)]);
  }
  // ---- L3: edited lines keep their numbers when linked
  {
    const values = F.header();
    const lines = await legacyLines(values);
    lines[1].total_quantity = 41;
    const s = session(Object.assign({}, values, { stock_movement: lines }));
    await s.fire("sc_onClick_line");
    await s.fire("sc_onClick_pickLine", { rowIndex: 0, row: lineTable(s.v())[0] });
    check("L3: the edited Screw line keeps 41, its reference 40, its key", (s.v().stock_movement[1] || {}).total_quantity === 41 && (s.v().stock_movement[1] || {}).requested_qty === 40 && (s.v().stock_movement[1] || {}).sc_ref_key === "C2|77|1");
  }
  {
    // Keep on a re-scale left the references at the old quantity: the link sets them from the snapshot at the current one
    const values = F.header();
    const ls = await legacyLines(values);
    const s = session(Object.assign({}, values, { item_qty: 20, stock_movement: ls }));
    await s.fire("sc_onClick_line");
    await s.fire("sc_onClick_pickLine", { rowIndex: 0, row: lineTable(s.v())[0] });
    check("L3b: lines kept at an older quantity: references set for 20 (Frame 40, Screw 80), totals and picks unchanged", same(s.v().stock_movement.map((l) => [l.requested_qty, l.total_quantity]),
      [[40, 20], [80, 40], [2, 1]]), s.v().stock_movement.map((l) => [l.requested_qty, l.total_quantity]));
  }
  // ---- L4 / L5: Unlink
  const linked = (await linkNew(F.header())).s.v();
  {
    const s = session(linked);
    const m = s.mark();
    await s.fire("sc_onClick_unlink");
    const v = s.v();
    check("L4: Unlink asks first", s.calls("$confirm", m).length === 1 && s.calls("$confirm", m)[0][1] === "Unlink");
    // BA handoff FIX-02: unlink clears only the link; the prepared BOM, plan and line keys stay, so the IA keeps its saved basis
    check("L4: STANDARD unlinked: only the link cleared; snapshot, root BOM, plan, line keys, mode and context kept", v.source_so_id === "" && v.source_so_line_id === "" &&
      v.bom_snapshot_json === linked.bom_snapshot_json && v.source_bom_id === linked.source_bom_id && v.planned_output_qty === linked.planned_output_qty &&
      same(keys(v), keys(linked)) && v.source_so_context_json === linked.source_so_context_json && v.bom_consumption_mode === "STANDARD",
      [v.bom_snapshot_json === linked.bom_snapshot_json, v.source_bom_id, v.planned_output_qty, keys(v)]);
    check("L4: the section shows not linked + the BOM", same(s.panel().split("\n"), ["Sales Order: not linked", "BOM: Standard · V1 · prepared " + snapOf(linked).preparedAt.slice(0, 10)]), s.panel());
    check("L4: the lines and picks untouched", same((v.stock_movement || []).map((l) => [l.total_quantity, l.temp_qty_data, l.requested_qty]), linked.stock_movement.map((l) => [l.total_quantity, l.temp_qty_data, l.requested_qty])));
    check("L4: the linked controls hidden, the plan and the section kept", ["sc_btn_unlink", "sc_btn_suggest", "sc_btn_refresh"].every((x) => hidden(s, m).indexOf(x) >= 0) &&
      ["planned_output_qty", "sc_info"].every((x) => hidden(s, m).indexOf(x) < 0), hidden(s, m));
    // and a later quantity change still works from the saved BOM (no BOM read)
    await s.self.setData({ item_qty: 20 });
    const m2 = s.mark();
    await s.fire("onChange_itemQty", { value: 20 });
    check("L4: after unlink, a quantity change recomputes the references from the snapshot", s.reads("bill_of_materials", m2).length === 0 &&
      (s.v().stock_movement[0] || {}).requested_qty === 40, [(s.v().stock_movement || []).map((l) => l.requested_qty), s.reads("bill_of_materials", m2).length]);
    const c = session(linked, { confirms: { Unlink: "cancel" } });
    await c.fire("sc_onClick_unlink");
    const panelOnly = (k) => /^sc_info_/.test(k);
    const rest = (x) => Object.keys(x).filter((k) => !panelOnly(k)).reduce((o, k) => Object.assign(o, { [k]: x[k] }), {});
    check("L4: Unlink cancelled changes nothing", same(rest(c.v()), rest(linked)) && c.calls("setData").every((t) => Object.keys(t[1]).every(panelOnly)));
  }
  {
    const flat = Object.assign({}, linked, { bom_consumption_mode: "FLAT", bom_snapshot_json: JSON.stringify(Object.assign(snapOf(linked) || {}, { mode: "FLAT", expand: [] })) });
    const s = session(flat);
    await s.fire("sc_onClick_unlink");
    check("L5: a FLAT IA unlinked stays enhanced (mode, snapshot, keys kept)", s.v().source_so_line_id === "" && s.v().bom_consumption_mode === "FLAT" && s.v().bom_snapshot_json === flat.bom_snapshot_json &&
      same(keys(s.v()), keys(flat)));
  }
  // ---- L6: Use Suggested Qty
  for (const fire of [false, true]) {
    const s = session(linked, { fireOnChange: fire });
    const m = s.mark();
    await s.fire("sc_onClick_suggest");
    const v = s.v();
    check("L6" + (fire ? " (onChange echoes)" : "") + ": planned = item_qty = 100", v.planned_output_qty === 100 && v.item_qty === 100);
    check("L6" + (fire ? " (onChange echoes)" : "") + ": one Re-allocate question (the lines had picks), then re-allocated at the new references",
      s.calls("$confirm", m).length === 1 && s.calls("$confirm", m)[0][1] === "Quantity Changed" && ((v.stock_movement || [])[0] || {}).requested_qty === 200 && ((v.stock_movement || [])[0] || {}).total_quantity === 150 &&
      ((v.stock_movement || [])[1] || {}).total_quantity === 400, [s.calls("$confirm", m).map((t) => t[1]), (v.stock_movement || []).map((l) => l.total_quantity)]);
    check("L6" + (fire ? " (onChange echoes)" : "") + ": no BOM read", s.reads("bill_of_materials", m).length === 0);
    check("L6" + (fire ? " (onChange echoes)" : "") + ": told both quantities changed (UI-01), once", s.calls("$message.success", m).filter((t) =>
      t[1] === "Use Suggestion: Planned Output and Output to Receive set to 100.").length === 1, s.calls("$message.success", m));
  }
  {
    const s = session(linked, { so: { ias: [{ id: "4100", no: "IA-1", status: "Draft", item_id: "P1", item_qty: "60", item_uom: F.EA, planned_output_qty: "60", mode: "STANDARD", is_deleted: 0, source_so_line_id: "8001" }] } });
    await s.fire("sc_onClick_suggest");
    check("L6: another open Draft of 60 -> suggestion 40", s.v().planned_output_qty === 40 && s.v().item_qty === 40 &&
      /^In Progress: 60 EA in other open IAs$/m.test(s.panel()) && /^Remaining to Plan: 40 EA = 100 ordered − 0 produced − 60 in progress$/m.test(s.panel()), s.panel());
  }
  {
    const s = session(linked, { so: { lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "100" })] } });
    await s.fire("sc_onClick_suggest");
    check("L6: a fully delivered line -> 'nothing left', nothing changed", s.v().item_qty === 10 && s.v().planned_output_qty === 10 && s.calls("$alert").some((t) => /suggested 0/.test(t[1]) &&
      t[2] === "Use Suggestion") && s.calls("$message.success").length === 0, s.calls("$alert"));
  }
  {
    const s = session(linked, { projectionDown: true });
    await s.fire("sc_onClick_suggest");
    check("L6: the projection down -> an error, nothing changed, the panel says unavailable", s.v().item_qty === 10 && s.calls("$alert").some((t) => /could not be read/.test(t[1])) &&
      same(s.panel().split("\n").filter((x) => !/^BOM: /.test(x)), ["Sales Order: figures unavailable right now: press Refresh Figures to try again"]), s.panel());
  }
  {
    const ctnLine = Object.assign({}, F.so().lines[0], { so_quantity: "10", so_item_uom: F.CTN });
    const s = session(linked, { so: { lines: [ctnLine] } });
    await s.fire("sc_onClick_suggest");
    check("L6: a line of 10 CTN -> 120 EA on the IA", s.v().planned_output_qty === 120 && s.v().item_qty === 120 && /^Remaining to Plan: 10 CTN = 10 ordered − 0 produced − 0 in progress$/m.test(s.panel()) &&
      /^After This IA: fully covered$/m.test(s.panel()), [s.v().item_qty, s.panel()]);
  }
  // ---- L7: the SO-line entry
  const entryValues = F.header({ item_name: "", item_desc: "", item_uom: "", item_qty: 0, source_so_id: "9001", source_so_line_id: "8001", bom_consumption_mode: "STANDARD",
    storage_location_id: "", location_id: "" });
  for (const fire of [false, true]) {
    const s = session(entryValues, { this: { isAdd: true }, params: { sc_entry: "1" }, fireOnChange: fire });
    await s.fire("mounted");
    const v = s.v();
    const ctx = J(v.source_so_context_json);
    check("L7" + (fire ? " (onChange echoes)" : "") + ": entry fills the item fields and the bin", v.item_name === "SC-BOX" && v.item_desc === "SC-BOX desc" && v.item_uom === F.EA && v.storage_location_id === "S1" &&
      v.location_id === "L0", [v.item_name, v.item_uom, v.storage_location_id, v.location_id]);
    check("L7" + (fire ? " (onChange echoes)" : "") + ": planned = item_qty = the suggestion 100; the baseline from the server line", v.planned_output_qty === 100 && v.item_qty === 100 && ctx.orderedQty === "100" &&
      ctx.headerStatus === "Issued", [v.planned_output_qty, v.item_qty, ctx]);
    check("L7" + (fire ? " (onChange echoes)" : "") + ": prepared: 3 keyed lines at 100, allocated, the snapshot saved", (v.stock_movement || []).length === 3 && same(keys(v), ["C1|77|1", "C2|77|1", "N1|77|1"]) &&
      v.stock_movement[0].requested_qty === 200 && v.stock_movement[0].total_quantity === 150 && v.stock_movement[1].total_quantity === 400 && (snapOf(v) || { root: {} }).root.bomId === "B1", v.stock_movement.map((l) => [l.requested_qty, l.total_quantity]));
    check("L7" + (fire ? " (onChange echoes)" : "") + ": prepared once", s.since(0).filter((t) => t[0] === "sc:setData" && "stock_movement" in t[1]).length === 1);
    check("L7" + (fire ? " (onChange echoes)" : "") + ": the snapshot and the lines written together, in one setData", s.since(0).filter((t) => t[0] === "sc:setData" && "stock_movement" in t[1] &&
      "bom_snapshot_json" in t[1] && "source_bom_id" in t[1]).length === 1);
    check("L7" + (fire ? " (onChange echoes)" : "") + ": one SUMMARY for the whole entry", s.wf(PROJ).filter((x) => x[2].operation === "SUMMARY").length === 1,
      s.wf(PROJ).filter((x) => x[2].operation === "SUMMARY").length);
    check("L7" + (fire ? " (onChange echoes)" : "") + ": the context's history is the server's to write", same(ctx.history, []), ctx.history);
  }
  {
    const s = session(entryValues, { this: { isAdd: true }, params: { sc_entry: "1" }, so: { header: Object.assign({}, F.so().header, { so_status: "Cancelled" }) } });
    await s.fire("mounted");
    const v = s.v();
    check("L7: a cancelled SO -> told why; the IA goes on as an ordinary IA for the item: no link, no mode, its name / UOM and today's BOM lines (v36)", v.source_so_line_id === "" &&
      v.source_so_id === "" && v.source_so_context_json === "" && v.bom_consumption_mode === "" && v.bom_snapshot_json === "" && v.item_name === "SC-BOX" && v.item_uom === F.EA &&
      (v.stock_movement || []).length === 3 && keys(v).every((k) => !k) && s.calls("$alert").some((t) => /no active demand/.test(t[1]) && /ordinary Item Assembly/.test(t[1])),
      [v.bom_consumption_mode, v.item_name, (v.stock_movement || []).length, s.calls("$alert").map((t) => t[1])]);
  }
  {
    const ctnLine = Object.assign({}, F.so().lines[0], { so_quantity: "10", so_item_uom: F.CTN });
    const s = session(entryValues, { this: { isAdd: true }, params: { sc_entry: "1" }, so: { lines: [ctnLine] } });
    await s.fire("mounted");
    check("L7b: an entry on a line of 10 CTN: planned = item_qty = 120 EA", s.v().planned_output_qty === 120 && s.v().item_qty === 120 && s.v().item_uom === F.EA, [s.v().planned_output_qty, s.v().item_qty]);
  }
  {
    const s = session(entryValues, { this: { isAdd: true }, params: { sc_entry: "1" }, so: { lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "40" })],
      ias: [{ id: "4100", no: "IA-1", status: "Completed", item_id: "P1", item_qty: "30", item_uom: F.EA, planned_output_qty: "30", mode: "STANDARD", is_deleted: 0, source_so_line_id: "8001" }] } });
    await s.fire("mounted");
    check("L7c: an entry whose remaining quantity is unavailable: told why, quantity and plan left for the planner", (s.v().item_qty === 0 || s.v().item_qty === "") &&
      (s.v().planned_output_qty === null || s.v().planned_output_qty === "") && s.calls("$message.warning").some((x) => /can.t be worked out/.test(String(x[1]))),
      [s.v().item_qty, s.v().planned_output_qty, s.calls("$message.warning")]);
  }
  // ---- L8: Edit of an enhanced Draft rehydrates only
  {
    const saved = Object.assign({}, linked, { id: "4001", page_status: "Edit", item_assembly_status: "Draft" });
    const s = session(saved, { this: { isEdit: true } });
    await s.fire("mounted");
    const sum = s.wf(PROJ).filter((t) => t[2].operation === "SUMMARY");
    check("L8: Edit Draft: SUMMARY excludes this IA", sum.length === 1 && sum[0][2].exclude_ia_id === "4001");
    check("L8: Edit Draft: no BOM read, no line written", s.reads("bill_of_materials").length === 0 && !s.since(0).some((t) => /setData$/.test(t[0]) && Object.keys(t[1]).some((k) => /^stock_movement/.test(k))));
    check("L8: Edit Draft: the linked controls shown, editable", ["planned_output_qty", "sc_info", "sc_btn_unlink"].every((x) => shown(s).indexOf(x) >= 0) &&
      s.calls("disabled").some((t) => same(t[1], ["bom_consumption_mode", "planned_output_qty"]) && t[2] === false));
    check("L8: Edit Draft: its own quantity proposed once, the coverage shown, the others' open quantity labelled 'other'", sum[0][2].proposal_qty === "10.00000000" &&
      /^After This IA: /m.test(s.panel()) && /^In Progress: 0 EA in other open IAs$/m.test(s.panel()), s.panel());
  }
  // ---- L9: View / Completed read-only; a removed line offers Re-link
  {
    const saved = Object.assign({}, linked, { id: "4001", page_status: "View", item_assembly_status: "Draft" });
    const s = session(saved, { this: { isView: true } });
    await s.fire("mounted");
    check("L9: View: no proposal (the IA is in the totals already), no coverage line, 'Open in Item Assemblies' (this one included)",
      s.wf(PROJ).some((t) => t[2].operation === "SUMMARY" && t[2].proposal_qty === "") && !/^(After This IA|Remaining to Plan): /m.test(s.panel()) &&
      /^In Progress: 0 EA in open IAs$/m.test(s.panel()), s.panel());
    check("L9: View: SUMMARY without exclusion, the widgets read-only, no edit button", s.wf(PROJ).some((t) => t[2].operation === "SUMMARY" && t[2].exclude_ia_id === "") &&
      s.calls("disabled").some((t) => same(t[1], ["bom_consumption_mode", "planned_output_qty"]) && t[2] === true) && ["sc_btn_line", "sc_btn_unlink", "sc_btn_suggest", "sc_btn_bom"].every((x) => hidden(s).indexOf(x) >= 0));
  }
  const removed = { lines: [Object.assign({}, F.so().lines[0], { is_deleted: 1 }), Object.assign({}, F.so().lines[0], { id: "8002", line_index: "2" })] };
  const completed = Object.assign({}, linked, { id: "4001", page_status: "Edit", item_assembly_status: "Completed", stock_movement_no: "IA-0001" });
  {
    const s = session(completed, { this: { isEdit: true }, so: removed });
    await s.fire("mounted");
    check("L9: Completed, line removed: LINE_REMOVED in the panel, Re-link shown", /^⚠ The linked line of SO-A no longer exists/m.test(s.panel()) && shown(s).indexOf("sc_btn_relink") >= 0, [s.panel(), shown(s)]);
    const live = session(completed, { this: { isEdit: true }, so: { ias: [{ id: "4001", no: "IA-0001", status: "Completed", item_id: "P1", item_qty: "10", item_uom: F.EA,
      planned_output_qty: "10", mode: "STANDARD", is_deleted: 0, source_so_line_id: "8001" }] } });
    await live.fire("mounted");
    check("L9: a Completed IA counted once: no proposal, no coverage, no excess", live.wf(PROJ).some((t) => t[2].operation === "SUMMARY" && t[2].proposal_qty === "") &&
      !/After This IA|more than ordered|exceeds/.test(live.panel()) && /^Produced: 10 EA$/m.test(live.panel()), live.panel());
    await s.fire("sc_onClick_relink");
    const rows = lineTable(s.v());
    check("L9: Re-link lists the current line of the same SO", rows.length === 1 && rows[0].line_id === "8002" && rows[0].so_no === "SO-A", rows);
    const m = s.mark();
    await s.fire("sc_onClick_pickLine", { rowIndex: 0, row: rows[0] });
    const call = s.wf(RELINK, m);
    // FIX-06: the link and status the IA was opened with, so a changed IA is refused instead of overwritten
    check("L9: IA_SC_RELINK called with the IA, the new line, the item, the org and the link + status as opened; the field and the list follow", call.length === 1 &&
      same(call[0][2], { ia_id: "4001", so_line_id: "8002", item_id: "P1", organization_id: F.ORG, expected_line_id: "8001", expected_status: "Completed" }) &&
      s.v().source_so_line_id === "8002" && s.since(m).some((t) => t[0] === "list.refresh"), call.map((t) => t[2]));
    const bad = session(completed, { this: { isEdit: true }, so: removed });
    bad.w.relinkAnswer = { data: { code: "400", message: "This Item Assembly is being processed in the background." } };
    await bad.fire("mounted");
    await bad.fire("sc_onClick_relink");
    await bad.fire("sc_onClick_pickLine", { rowIndex: 0, row: lineTable(bad.v())[0] });
    check("L9: a refused re-link: its message, the field unchanged", bad.v().source_so_line_id === "8001" && bad.calls("$alert").some((t) => /being processed/.test(t[1])));
  }
  {
    const s = session(Object.assign({}, completed, { page_status: "View", item_assembly_status: "Draft" }), { this: { isView: true }, so: removed });
    await s.fire("mounted");
    check("L9b: View of a Draft whose line is gone: warned, no Re-link (a Draft is re-linked by editing it)", /^⚠ .*no longer exists/m.test(s.panel()) && shown(s).indexOf("sc_btn_relink") < 0, s.panel());
  }
  {
    const s = session(completed, { this: { isEdit: true } });
    await s.fire("mounted");
    check("L9: Completed with a live line: no Re-link", hidden(s).indexOf("sc_btn_relink") >= 0 && shown(s).indexOf("sc_btn_relink") < 0);
  }
  // ---- L10 / L11: Clone
  {
    // an org-level login: v36 keeps a clone's lines (a plant-level login's plant handler clears them, below)
    const s = session(Object.assign({}, linked, { id: "4001" }), { this: { isCopy: true, system: { deptIds: "1001", uid: "77" } } });
    await s.fire("mounted");
    const v = s.v();
    check("L10: Clone of a linked STANDARD: link, context, plan, snapshot and keys dropped; lines kept; no BOM read", v.source_so_line_id === "" && v.source_so_id === "" && v.source_so_context_json === "" &&
      v.planned_output_qty === null && v.bom_snapshot_json === "" && v.source_bom_id === "" && keys(v).length === 3 && keys(v).every((k) => k === "") && s.reads("bill_of_materials").length === 0);
    const p = session(Object.assign({}, linked, { id: "4001" }), { this: { isCopy: true } });
    await p.fire("mounted");
    check("L10: a plant-level login: v36's plant handler clears the clone's lines; the Small Cycle PLANT op does not rebuild them", p.v().stock_movement.length === 0 &&
      p.since(0).some((t) => t[0] === "triggerEvent" && t[1] === "sc_main" && t[2].scOp === "PLANT") && !p.since(0).some((t) => t[0] === "sc:setData" && "stock_movement" in t[1]));
  }
  {
    const flatSnap = Object.assign(snapOf(linked) || {}, { mode: "FLAT", expand: ["C1"] });
    const s = session(Object.assign({}, linked, { id: "4001", item_qty: 5, bom_consumption_mode: "FLAT", bom_snapshot_json: JSON.stringify(flatSnap) }), { this: { isCopy: true } });
    await s.fire("mounted");
    const v = s.v();
    check("L11: Clone of a FLAT: link dropped, prepared again from the live BOM with its ticks, no dialog", v.source_so_line_id === "" && v.bom_consumption_mode === "FLAT" && ((snapOf(v) || {}).expand || [])[0] === "C1" &&
      s.reads("bill_of_materials").length > 0 && !s.calls("openDialog").length && same(v.stock_movement.map((l) => [l.item_selection, l.requested_qty]), [["C3", 30], ["C2", 20], ["N1", 0.5]]),
      v.stock_movement.map((l) => [l.item_selection, l.requested_qty]));
  }
  H.done("test_sc_link");
})();
