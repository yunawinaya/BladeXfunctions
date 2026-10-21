// Small Cycle client, the Sales Order Link section (sc_section > sc_collapse > sc_info): one read-only row per fact, a row without a
// fact hidden; the line on the left, the production figures on the right, the BOM and the messages full width. The suggestion
// shows its sum (the larger of delivered / produced is the one taken off), "After This IA" follows the quantity live, over the
// order is a message (the server's EXCESS warning is not repeated), an inactive line suggests 0, warnings are marked, a BOM
// without a version or not prepared yet, an unlinked Flat IA, unit ids shown as names; the section on every editable page and on
// a read-only page only for a Small Cycle IA.
//   node scratchpad/iasc/client/test/test_sc_panel.js
const H = require("./harness");
const F = require("./fixture");
const { session, legacyLines, snapOf } = require("./session");
const { check, same } = H;

const lineTable = (v) => (v.sc_line_dialog || {}).sc_line_table || [];
const linkNew = async (values, o) => {
  const lines = await legacyLines(values, o);
  const s = session(Object.assign({}, values, { stock_movement: lines }), o);
  await s.fire("sc_onClick_line");
  await s.fire("sc_onClick_pickLine", { rowIndex: 0, row: lineTable(s.v())[0] });
  return s;
};
const completedIa = (id, qty) => ({ id: id, no: "IA-" + id, status: "Completed", item_id: "P1", item_qty: String(qty), item_uom: F.EA, planned_output_qty: String(qty), mode: "STANDARD",
  is_deleted: 0, source_so_line_id: "8001" });
const draftIa = (id, qty) => Object.assign(completedIa(id, qty), { status: "Draft" });
const rows = (s) => s.panel().split("\n");
const row = (s, label) => rows(s).find((x) => x.indexOf(label + ": ") === 0) || null;
const messages = (s) => rows(s).filter((x) => x.indexOf("⚠ ") === 0);
const MINUS = " − ";

(async () => {
  const linked = (await linkNew(F.header())).v();
  const prepared = "prepared " + String(snapOf(linked).preparedAt).slice(0, 10);
  // the figures as Refresh Figures reads them for this linked Add IA (10 EA)
  const refreshed = async (so, values) => {
    const s = session(values || linked, { so: so });
    await s.fire("sc_onClick_refresh");
    return s;
  };

  // ---- PN1: delivered 40 and produced 30 may overlap (nothing records which delivery came from which IA): no figure (FIX-01)
  {
    const s = await refreshed({ lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "40" })], ias: [completedIa("4101", 30), draftIa("4102", 20)] });
    check("PN1: the line, then the production figures, one per row", same(rows(s).slice(0, 6), ["Sales Order: SO-A · line 1", "Customer: ACME", "Ordered: 100 EA", "Delivered: 40 EA",
      "Produced: 30 EA", "In Progress: 20 EA in other open IAs"]), s.panel());
    check("PN1: Remaining to Plan unavailable, with why, and the quantity left to the planner", row(s, "Remaining to Plan") ===
      "Remaining to Plan: Unavailable: nothing records whether the 40 EA delivered came from the 30 EA produced, so enter the quantity yourself", s.panel());
    check("PN1: After This IA unavailable too", row(s, "After This IA") === "After This IA: Unavailable: the delivered and produced quantities may overlap", s.panel());
    check("PN1: Use Suggested Qty disabled", s.calls("disabled").some((x) => same(x[1], ["sc_btn_suggest"]) && x[2] === true), s.calls("disabled"));
  }
  // ---- PN2: exact when only one of delivered / produced is above 0
  {
    const p1 = await refreshed({ ias: [completedIa("4101", 30)] });
    check("PN2: produced 30, nothing delivered: 70 EA = 100 ordered - 30 produced - 0 in progress", row(p1, "Remaining to Plan") === "Remaining to Plan: 70 EA = 100 ordered" + MINUS + "30 produced" +
      MINUS + "0 in progress", p1.panel());
    check("PN2: Use Suggested Qty enabled", p1.calls("disabled").some((x) => same(x[1], ["sc_btn_suggest"]) && x[2] === false), p1.calls("disabled"));
    const p2 = await refreshed({ lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "40" })] });
    check("PN2: delivered 40, nothing produced: 60 EA = 100 ordered - 40 delivered - 0 in progress", row(p2, "Remaining to Plan") === "Remaining to Plan: 60 EA = 100 ordered" + MINUS + "40 delivered" +
      MINUS + "0 in progress", p2.panel());
  }
  // ---- PN3: over the order: one message instead of After This IA; the server's EXCESS warning not repeated
  {
    const s = await refreshed({ ias: [completedIa("4101", 95)] });
    check("PN3: SUMMARY did warn EXCESS (the proposal of 10 over the 5 left)", s.wf(H.SC_TEST_IDS.SO_IA_PROJECTION).some((t) => t[2].operation === "SUMMARY" && t[2].proposal_qty === "10.00000000"));
    check("PN3: the over-the-order message, alone", same(messages(s), ["⚠ This Item Assembly makes 5 EA more than ordered. You can still save."]), s.panel());
    check("PN3: no After This IA row", row(s, "After This IA") === null, s.panel());
  }
  // ---- PN15: over the order whatever the overlap: "at least", and the exact 0 left
  {
    const s = await refreshed({ lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "100" })], ias: [completedIa("4101", 30)] });
    check("PN15: Remaining to Plan 0 EA (both bounds 0)", row(s, "Remaining to Plan") === "Remaining to Plan: 0 EA = 100 ordered" + MINUS + "100 delivered" + MINUS + "0 in progress", s.panel());
    check("PN15: at least 10 EA more than ordered", same(messages(s), ["\u26a0 This Item Assembly makes at least 10 EA more than ordered. You can still save."]), s.panel());
  }
  // ---- PN16: Use Suggested Qty on an unavailable figure: told why, nothing changed
  {
    const s = await refreshed({ lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "40" })], ias: [completedIa("4101", 30)] });
    const m = s.mark();
    await s.fire("sc_onClick_suggest");
    check("PN16: told why, quantity and plan unchanged", s.calls("$alert", m).some((x) => /can.t be worked out/.test(String(x[1]))) && s.v().item_qty === 10 &&
      s.v().planned_output_qty === 10, [s.calls("$alert", m).map((x) => x[1]), s.v().item_qty, s.v().planned_output_qty]);
  }
  // ---- PN4: a cancelled SO: suggestion 0, nothing after, the warning
  {
    const s = await refreshed({ header: Object.assign({}, F.so().header, { so_status: "Cancelled" }) });
    check("PN4: Remaining to Plan 0, the line has no remaining demand", row(s, "Remaining to Plan") === "Remaining to Plan: 0 EA: the line has no remaining demand", s.panel());
    check("PN4: no After This IA row", row(s, "After This IA") === null, s.panel());
    check("PN4: the warning", same(messages(s), ["⚠ SO-A is cancelled: it has no remaining demand."]), s.panel());
  }
  // ---- PN5: two warnings, each marked, the UOM id shown as its name
  {
    const s = await refreshed({ header: Object.assign({}, F.so().header, { so_status: "Cancelled" }), lines: [Object.assign({}, F.so().lines[0], { so_quantity: "80" })] });
    check("PN5: both warnings, marked, 'EA' not its id", same(messages(s), ["⚠ SO-A is cancelled: it has no remaining demand.   ⚠ SO-A line 1 was reduced from 100 to 80 EA since it was linked."]),
      s.panel());
  }
  // ---- PN6: a snapshot without a BOM version: no empty part
  {
    const snap = snapOf(linked);
    snap.root.version = "";
    const s = session(Object.assign({}, linked, { id: "4001", page_status: "Edit", bom_snapshot_json: JSON.stringify(snap) }), { this: { isEdit: true } });
    await s.fire("mounted");
    check("PN6: BOM: Standard · prepared <date>", row(s, "BOM") === "BOM: Standard · " + prepared, s.panel());
  }
  // ---- PN7: linked, BOM not prepared yet: the button named when editable, not on a view
  {
    const bare = Object.assign({}, linked, { id: "4001", bom_snapshot_json: "", source_bom_id: "" });
    const e = session(Object.assign({}, bare, { page_status: "Edit" }), { this: { isEdit: true } });
    await e.fire("mounted");
    check("PN7: Edit Draft: BOM not prepared yet: press Prepare BOM", row(e, "BOM") === "BOM: not prepared yet: press Prepare BOM", e.panel());
    const r = session(Object.assign({}, bare, { page_status: "View" }), { this: { isView: true } });
    await r.fire("mounted");
    check("PN7: View: BOM not prepared yet (no button to name)", row(r, "BOM") === "BOM: not prepared yet", r.panel());
  }
  // ---- PN8: a Flat IA unlinked: not linked + its BOM; every figure row hidden again
  {
    const flat = Object.assign({}, linked, { bom_consumption_mode: "FLAT", bom_snapshot_json: JSON.stringify(Object.assign(snapOf(linked), { mode: "FLAT", expand: ["C1"] })) });
    const s = session(flat);
    await s.fire("sc_onClick_refresh");
    check("PN8: linked Flat first: every figure row shown", rows(s).length >= 9, s.panel());
    await s.fire("sc_onClick_unlink");
    check("PN8: unlinked: not linked + Flat · V1 · 1 sub-assembly expanded", same(rows(s), ["Sales Order: not linked", "BOM: Flat · V1 · 1 sub-assembly expanded · " + prepared]), s.panel());
  }
  // ---- PN10: the unit changed since the link: the baseline's unit is named too (neither this IA's nor the line's unit now)
  {
    const ctx = JSON.parse(linked.source_so_context_json);
    ctx.uomId = "79";
    const uoms = F.tables().unit_of_measurement.concat([{ id: "79", uom_name: "BOX", is_deleted: 0 }]);
    const s = session(Object.assign({}, linked, { source_so_context_json: JSON.stringify(ctx) }), { so: { lines: [Object.assign({}, F.so().lines[0], { so_item_uom: F.CTN })] },
      tables: F.tables({ extra: { unit_of_measurement: uoms } }) });
    await s.fire("sc_onClick_refresh");
    check("PN10: the unit change in names (BOX to CTN)", messages(s).some((x) => /changed its unit from BOX to CTN since it was linked/.test(x)), s.panel());
  }
  // ---- PN11: another IA in a unit that cannot convert: its unit named (a 19-digit id), the suggestion unavailable
  {
    const LONG = "2105190589240086999";
    const uoms = F.tables().unit_of_measurement.concat([{ id: LONG, uom_name: "PLT", is_deleted: 0 }]);
    const s = session(linked, { so: { ias: [Object.assign(draftIa("4103", 5), { item_uom: LONG })] }, tables: F.tables({ extra: { unit_of_measurement: uoms } }) });
    await s.fire("sc_onClick_refresh");
    check("PN11: the other IA's unit named (PLT), never its id", messages(s).some((x) => /is in PLT, which cannot be converted to EA/.test(x)) && s.panel().indexOf(LONG) < 0, s.panel());
    check("PN11: Remaining to Plan unavailable", row(s, "Remaining to Plan") === "Remaining to Plan: Unavailable: a unit conversion is missing", s.panel());
  }
  // ---- PN12-14: the Sales Order Link section: on every editable page (its Select SO Line), on a read-only page only for a Small
  // Cycle IA (an ordinary IA's view stays as before)
  {
    const lastShown = (s, m) => {
      let on;
      s.w.trace.forEach((t) => {
        const k = String(t[0]).replace(/^sc:/, "");
        if ((k === "display" || k === "hide") && [].concat(t[1]).indexOf(m) >= 0) on = k === "display";
      });
      return on;
    };
    const add = session(F.header(), { this: { isAdd: true } });
    await add.fire("mounted");
    check("PN12: Add, not linked: the section shown with Select SO Line, no figures", lastShown(add, "sc_section") === true && lastShown(add, "sc_btn_line") === true &&
      lastShown(add, "sc_info") !== true, [lastShown(add, "sc_section"), lastShown(add, "sc_btn_line"), lastShown(add, "sc_info")]);
    const view = session(Object.assign(F.header(), { id: "4300", page_status: "View", item_assembly_status: "Completed", stock_movement_no: "IA-0300" }), { this: { isView: true } });
    await view.fire("mounted");
    check("PN13: View of an ordinary IA: the section never shown", lastShown(view, "sc_section") !== true, lastShown(view, "sc_section"));
    const linkedView = session(Object.assign({}, linked, { id: "4001", page_status: "View" }), { this: { isView: true } });
    await linkedView.fire("mounted");
    check("PN14: View of a linked IA: the section and its figures shown", lastShown(linkedView, "sc_section") === true && lastShown(linkedView, "sc_info") === true);
  }
  // ---- PN17-PN20: UI-01 (BA handoff): Quantity is "Output to Receive" until the IA is completed, then a read-only "Actual Received"
  // row takes its place; Use Suggestion and Prepare BOM sit in Production, shown with their buttons; the BOM row only on a Small Cycle IA
  {
    const lastShown = (s, m) => {
      let on;
      s.w.trace.forEach((t) => {
        const k = String(t[0]).replace(/^sc:/, "");
        if ((k === "display" || k === "hide") && [].concat(t[1]).indexOf(m) >= 0) on = k === "display";
      });
      return on;
    };
    for (const [what, flags, status] of [["Edit, Completed", { isEdit: true }, "Completed"], ["View, Fully Posted", { isView: true }, "Fully Posted"], ["View, Completed", { isView: true }, "Completed"]]) {
      for (const [kind, base] of [["an ordinary IA", F.header()], ["a linked IA", linked]]) {
        const s = session(Object.assign({}, base, { id: "4300", page_status: flags.isEdit ? "Edit" : "View", item_assembly_status: status, stock_movement_no: "IA-0300", item_qty: 12.5 }),
          { this: flags });
        await s.fire("mounted");
        check("PN17: " + what + ", " + kind + ": Actual Received 12.5 in place of Output to Receive (the quantity itself unchanged)", s.v().sc_actual === "12.5" &&
          lastShown(s, "sc_actual") === true && lastShown(s, "item_qty") === false && s.v().item_qty === 12.5, [s.v().sc_actual, lastShown(s, "sc_actual"), lastShown(s, "item_qty")]);
      }
    }
    for (const [what, flags, values] of [["Add", { isAdd: true }, F.header()], ["Edit, Draft", { isEdit: true }, Object.assign({}, linked, { id: "4300", page_status: "Edit" })],
      ["Edit, Processing", { isEdit: true }, F.header({ id: "4300", page_status: "Edit", item_assembly_status: "Processing", ia_v2_job_id: "7001" })],
      ["Clone of a Completed IA", { isCopy: true }, F.header({ id: "4300", item_assembly_status: "Completed" })]]) {
      const s = session(values, { this: flags });
      await s.fire("mounted");
      check("PN18: " + what + ": the quantity stays Output to Receive", lastShown(s, "sc_actual") !== true && lastShown(s, "item_qty") !== false && !("sc_actual" in s.v()),
        [lastShown(s, "sc_actual"), lastShown(s, "item_qty"), s.v().sc_actual]);
    }
    const draft = session(Object.assign({}, linked, { id: "4300", page_status: "Edit" }), { this: { isEdit: true } });
    await draft.fire("mounted");
    check("PN19: a linked Draft: Use Suggestion and Prepare BOM shown in Production", lastShown(draft, "sc_prod_actions") === true && lastShown(draft, "sc_btn_suggest") === true &&
      lastShown(draft, "sc_btn_bom") === true);
    const flat = session(F.header({ bom_consumption_mode: "FLAT" }), { this: { isAdd: true } });
    await flat.fire("mounted");
    check("PN19: an unlinked Flat Add: Prepare BOM shown, Use Suggestion not", lastShown(flat, "sc_prod_actions") === true && lastShown(flat, "sc_btn_bom") === true &&
      lastShown(flat, "sc_btn_suggest") !== true);
    const plain = session(F.header(), { this: { isAdd: true } });
    await plain.fire("mounted");
    check("PN20: an ordinary Add: no Production buttons, no BOM row", lastShown(plain, "sc_prod_actions") !== true && lastShown(plain, "sc_info_bom") !== true);
    const linkedView = session(Object.assign({}, linked, { id: "4001", page_status: "View", item_assembly_status: "Completed" }), { this: { isView: true } });
    await linkedView.fire("mounted");
    check("PN20: a linked Completed view: the BOM row shown, no Production buttons", lastShown(linkedView, "sc_info_bom") === true && lastShown(linkedView, "sc_prod_actions") !== true &&
      /^BOM: Standard · V1 · prepared /m.test(linkedView.panel()), linkedView.panel());
    // PN21: Change Item on a linked Standard IA makes it an ordinary IA without a re-render: the BOM row (no longer inside the
    // Sales Order card, which hides with it) must go too
    const tables = F.tables();
    tables.bill_of_materials.push(F.bom("B8", "P8", 1, [F.row("C2", 3)]));
    tables.item.push(F.item("P8", "OTHER"));
    const ls = await linkNew(F.header(), { tables: tables });
    const shownBefore = lastShown(ls, "sc_info_bom");
    await ls.self.setData({ item_id: "P8" });
    await ls.fire("onChange_assembledItem", { value: "P8" });
    check("PN21: Change Item on a linked Standard IA: unlinked, and the BOM row hidden", shownBefore === true && ls.v().source_so_line_id === "" && ls.v().bom_snapshot_json === "" &&
      lastShown(ls, "sc_info_bom") === false, [shownBefore, ls.v().source_so_line_id, lastShown(ls, "sc_info_bom")]);
  }
  // ---- PN22: FIX-03: a refusal (the user is not assigned to the organisation) says so, instead of "unavailable, try again"
  {
    const NO = "Your user is not assigned to this organisation, so its Sales Order figures cannot be shown.";
    const s = session(Object.assign({}, linked, { id: "4300", page_status: "Edit" }), { this: { isEdit: true } });
    s.w.projectionRefuse = NO;
    await s.fire("mounted");
    check("PN22: a refused SUMMARY: the server's reason in the section, no figure", same(rows(s), ["Sales Order: " + NO]) || same(rows(s).filter((x) => !/^BOM: /.test(x)), ["Sales Order: " + NO]),
      s.panel());
    const m = s.mark();
    await s.fire("sc_onClick_line");
    check("PN22: a refused Select SO Line: the server's reason", s.calls("$alert", m).some((t) => t[1] === NO), s.calls("$alert", m));
    s.w.projectionRefuse = "";
    await s.fire("sc_onClick_refresh");
    check("PN22: the next good read shows the figures again", /^Ordered: 100 EA$/m.test(s.panel()) && s.panel().indexOf(NO) < 0, s.panel());
    s.w.projectionDown = true;
    await s.fire("sc_onClick_refresh");
    check("PN22: a later failed read says unavailable, not the old refusal", /^Sales Order: figures unavailable right now/m.test(s.panel()) && s.panel().indexOf(NO) < 0, s.panel());
  }
  // ---- PN9: the rows never carry the old one-box wording
  {
    const s = await refreshed({});
    check("PN9: no 'Covered with' / 'Suggested for' / 'This Item Assembly: planned' / 'Undelivered' / 'Coverage'",
      !/Covered with|Suggested for|This Item Assembly: planned|Undelivered|Coverage/.test(s.panel()), s.panel());
  }
  H.done("test_sc_panel");
})();
