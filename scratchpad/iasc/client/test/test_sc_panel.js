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

  // ---- PN1: delivered 40 > produced 30: the suggestion takes the delivered off
  {
    const s = await refreshed({ lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "40" })], ias: [completedIa("4101", 30), draftIa("4102", 20)] });
    check("PN1: the line, then the production figures, one per row", same(rows(s).slice(0, 6), ["Sales Order: SO-A · line 1", "Customer: ACME", "Ordered: 100 EA", "Delivered: 40 EA",
      "Produced: 30 EA", "In Progress: 20 EA in other open IAs"]), s.panel());
    check("PN1: Suggested Qty = 100 ordered - 40 delivered - 20 in progress", row(s, "Suggested Qty") === "Suggested Qty: 40 EA = 100 ordered" + MINUS + "40 delivered" + MINUS + "20 in progress",
      s.panel());
    check("PN1: After This IA: 40 + 20 + this 10 of 100 -> 30 still needed", row(s, "After This IA") === "After This IA: 30 EA still needed", s.panel());
  }
  // ---- PN2: produced 30 > delivered 10: the produced is taken off
  {
    const s = await refreshed({ lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "10" })], ias: [completedIa("4101", 30)] });
    check("PN2: Suggested Qty = 100 ordered - 30 produced - 0 in progress", row(s, "Suggested Qty") === "Suggested Qty: 70 EA = 100 ordered" + MINUS + "30 produced" + MINUS + "0 in progress",
      s.panel());
  }
  // ---- PN3: over the order: one message instead of After This IA; the server's EXCESS warning not repeated
  {
    const s = await refreshed({ ias: [completedIa("4101", 95)] });
    check("PN3: SUMMARY did warn EXCESS (the proposal of 10 over the 5 left)", s.wf(H.SC_TEST_IDS.SO_IA_PROJECTION).some((t) => t[2].operation === "SUMMARY" && t[2].proposal_qty === "10.00000000"));
    check("PN3: the over-the-order message, alone", same(messages(s), ["⚠ This Item Assembly makes 5 EA more than ordered. You can still save."]), s.panel());
    check("PN3: no After This IA row", row(s, "After This IA") === null, s.panel());
  }
  // ---- PN4: a cancelled SO: suggestion 0, nothing after, the warning
  {
    const s = await refreshed({ header: Object.assign({}, F.so().header, { so_status: "Cancelled" }) });
    check("PN4: Suggested Qty 0, the line has no remaining demand", row(s, "Suggested Qty") === "Suggested Qty: 0 EA: the line has no remaining demand", s.panel());
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
    check("PN11: Suggested Qty unavailable", row(s, "Suggested Qty") === "Suggested Qty: unavailable: a unit conversion is missing", s.panel());
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
  // ---- PN9: the rows never carry the old one-box wording
  {
    const s = await refreshed({});
    check("PN9: no 'Covered with' / 'Suggested for' / 'This Item Assembly: planned' / 'Undelivered' / 'Coverage'",
      !/Covered with|Suggested for|This Item Assembly: planned|Undelivered|Coverage/.test(s.panel()), s.panel());
  }
  H.done("test_sc_panel");
})();
