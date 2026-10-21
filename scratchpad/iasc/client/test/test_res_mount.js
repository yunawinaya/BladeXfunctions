// RES-01 R3: an enrolled IA opened. The Materials row says where its reservation stands. A Draft shows each line's Required /
// Reserved / Short, read from its own holds, and a Draft still "Reserving" starts IA_HOLD again in the background. A completed
// IA that still holds stock closes its holds (IA_HOLD CLOSE). A clone starts unreserved. Not enrolled: nothing. Switch off: no new reservation
// started; what is held is still shown and closed (review I4).
//   node scratchpad/iasc/client/test/test_res_mount.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

const BUILT = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const ON = H.resVariant(BUILT, true);
const HOLD = H.SC_TEST_IDS.IA_HOLD;
const own = (id, lineId, mat, qty, o) => Object.assign({ id: id, doc_type: "Item Assembly", doc_id: "4001", status: "Allocated", doc_line_id: lineId, material_id: mat, bin_location: "L0",
  batch_id: null, from_category: "Unrestricted", open_qty: qty, reserved_qty: qty, item_uom: F.EA, plant_id: F.PLANT, organization_id: F.ORG, is_deleted: 0 }, o || {});
const lines = () => [
  { id: "5001", item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 40, required_qty: 40, total_quantity: 40, temp_qty_data: "", temp_hu_data: "" },
  { id: "5002", item_selection: "C1", item_name: "SC-FRAME", quantity_uom: F.EA, requested_qty: 20, required_qty: null, total_quantity: 15, temp_qty_data: "", temp_hu_data: "" },
  { id: "5003", item_selection: "N1", item_name: "SC-LAB", quantity_uom: F.EA, requested_qty: 1, required_qty: 1, total_quantity: 1, temp_qty_data: "", temp_hu_data: "" },
  { id: "5004", item_selection: "S1", item_name: "SC-SN", quantity_uom: F.EA, requested_qty: 2, required_qty: 2, total_quantity: 2, temp_qty_data: "", temp_hu_data: "" },
  { id: "5005", item_selection: "C3", item_name: "SC-PANEL", quantity_uom: F.EA, requested_qty: 3, required_qty: 3, total_quantity: 3, temp_qty_data: "",
    temp_hu_data: JSON.stringify([{ handling_unit_id: "H1", sm_quantity: 3 }]) },
];
const ia = (o) => F.header(Object.assign({ id: "4001", page_status: "Edit", item_assembly_status: "Draft", material_hold_status: "PARTIAL", material_hold_at: "2026-10-21 14:00:00",
  stock_movement: lines() }, o || {}));
const run = async (doc, values, flags, answer) => {
  const w = H.world({ db: H.tableDb(Object.assign(F.tables(), { on_reserved_gd: [own("R1", "5001", "C2", 20), own("R2", "5002", "C1", 6, { status: "Releasing" }),
    own("R3", "5001", "C2", 9, { doc_id: "4999" })] })) });
  w.so = F.so();
  const self = H.makeThis(w, doc, Object.assign({ values: H.clone(values), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, (id, params) => (id === HOLD && answer ? answer(params) : { data: { code: "200", message: "ok" } })) },
    flags || { isEdit: true }));
  const e = H.byName(doc, "mounted");
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self);
  await H.drain(w);
  return { trace: w.trace, values: self.values };
};
const holdCalls = (r) => r.trace.filter((t) => /runWorkflow$/.test(t[0]) && t[1] === HOLD).map((t) => t[2]);
const summary = (r) => r.values.res_summary;
const cells = (r) => (r.values.stock_movement || []).map((l) => [l.res_reserved, l.res_short]);
const shown = (r) => r.trace.filter((t) => /display$/.test(t[0])).reduce((a, t) => a.concat(t[1]), []);

(async () => {
  // ---- a Draft that reserves: the Materials row, the line figures from its own Allocated holds, no new run
  {
    const r = await run(ON, ia());
    check("Draft PARTIAL: the Materials row says so, when it was checked, and when it updates", summary(r) ===
      "Raw material reservation: Partially reserved · checked 2026-10-21 14:00:00 · Reservations update when this Item Assembly is saved.", summary(r));
    check("Draft: Reserved / Short per line (own Allocated holds only, not one in flight; the reference when no Required, not the allocated 15; non-stock blank; serial / handling unit not reserved)",
      same(cells(r), [["20", "20"], ["0", "20"], ["", ""], ["not reserved", ""], ["not reserved", ""]]), cells(r));
    check("Draft: the row and the three line columns shown", ["res_summary", "stock_movement.required_qty", "stock_movement.res_reserved", "stock_movement.res_short"]
      .every((m) => shown(r).indexOf(m) >= 0), shown(r));
    check("Draft PARTIAL: no reservation started on open", holdCalls(r).length === 0, holdCalls(r));
    // review M5: an 830-line IA must not lose rows to the server's default read size: explicit limits (5,000 for its own holds, the id count
    // for the items)
    const reads = r.trace.filter((x) => /db\.get/.test(x[0]) && (x[1].collection === "on_reserved_gd" ||
      (x[1].collection === "item" && x[1].field === "stock_control,serial_number_management")));
    check("Draft: the line-figure reads carry explicit limits", reads.length >= 2 && reads.every((x) => Number(x[1].limit) > 0) &&
      reads.filter((x) => x[1].collection === "on_reserved_gd").every((x) => Number(x[1].limit) === 5000), reads.map((x) => [x[1].collection, x[1].limit]));
  }
  // ---- a Draft still Reserving (a background run, a mobile save): started again, the row follows its answer
  {
    const r = await run(ON, ia({ material_hold_status: "RESERVING" }), { isEdit: true }, () => ({ data: { code: "200", message: "All materials are reserved.",
      result_json: JSON.stringify({ status: "FULL", checkedAt: "2026-10-21 14:05:00", lines: [] }) } }));
    check("Draft RESERVING: IA_HOLD RECONCILE (source FORM) started on open", same(holdCalls(r), [{ ia_id: "4001", organization_id: F.ORG, operation: "RECONCILE", source: "FORM" }]), holdCalls(r));
    check("Draft RESERVING: the row and the header fields follow the answer", summary(r) ===
      "Raw material reservation: Fully reserved · checked 2026-10-21 14:05:00 · Reservations update when this Item Assembly is saved." &&
      r.values.material_hold_status === "FULL" && r.values.material_hold_at === "2026-10-21 14:05:00", [summary(r), r.values.material_hold_status]);
  }
  // ---- a completed IA that still holds stock: its holds closed
  {
    const r = await run(ON, ia({ item_assembly_status: "Completed", material_hold_status: "FULL" }), { isEdit: true }, () => ({ data: { code: "200",
      message: "Closed: what the completion used is delivered and the rest is released.", result_json: JSON.stringify({ status: "CLOSED", checkedAt: "2026-10-21 14:06:00", lines: [] }) } }));
    check("Completed FULL: IA_HOLD CLOSE (source FORM) on open", same(holdCalls(r), [{ ia_id: "4001", organization_id: F.ORG, operation: "CLOSE", source: "FORM" }]), holdCalls(r));
    check("Completed: the row follows the answer, no line figures", summary(r) === "Raw material reservation: Closed at completion · checked 2026-10-21 14:06:00" &&
      shown(r).indexOf("stock_movement.res_short") < 0, [summary(r), shown(r)]);
    // review M10: a completed IA cannot be saved again: its review says to open it again
    const rv = await run(ON, ia({ item_assembly_status: "Completed", material_hold_status: "REVIEW" }));
    check("Completed REVIEW: the row says to open it again (not save), CLOSE started", /^Raw material reservation: Needs review: the last close did not finish\. Open this Item Assembly again to retry\./
      .test(summary(rv)) && holdCalls(rv).length === 1, [summary(rv), holdCalls(rv)]);
    const c = await run(ON, ia({ item_assembly_status: "Completed", material_hold_status: "CLOSED" }));
    check("Completed CLOSED: nothing started, the row says closed", holdCalls(c).length === 0 && summary(c) === "Raw material reservation: Closed at completion · checked 2026-10-21 14:00:00",
      summary(c));
  }
  // ---- a clone starts unreserved; not enrolled or switch off: nothing at all
  {
    const r = await run(ON, ia({ page_status: "Clone" }), { isCopy: true });
    check("Clone of a reserving IA: hold fields and any line figures cleared, no row, nothing started", r.values.material_hold_status === "" && r.values.material_hold_at === "" &&
      cells(r).every((c) => !c[0] && !c[1]) && shown(r).indexOf("res_summary") < 0 && holdCalls(r).length === 0, [r.values.material_hold_status, cells(r)]);
    const n = await run(ON, ia({ material_hold_status: "" }));
    check("not enrolled: no row, no read of holds, nothing started", shown(n).indexOf("res_summary") < 0 && !n.trace.some((t) => /db\.get/.test(t[0]) && t[1].collection === "on_reserved_gd") &&
      holdCalls(n).length === 0, shown(n));
    // review I4: the switch only makes holds: off, a Draft still shows what it holds but starts no reservation; a completed IA still closes
    const o = await run(BUILT, ia({ material_hold_status: "RESERVING" }));
    check("switch off, a Draft still Reserving: the row and figures shown, no reservation started", shown(o).indexOf("res_summary") >= 0 && holdCalls(o).length === 0, [shown(o), holdCalls(o)]);
    const oc = await run(BUILT, ia({ item_assembly_status: "Completed", material_hold_status: "FULL" }));
    check("switch off, a completed IA that still holds stock: IA_HOLD CLOSE on open", same(holdCalls(oc), [{ ia_id: "4001", organization_id: F.ORG, operation: "CLOSE", source: "FORM" }]),
      holdCalls(oc));
  }
  H.done("test_res_mount");
})();
