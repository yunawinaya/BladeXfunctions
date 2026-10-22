// RES-01 R3 + Created (BA, 10-22): an enrolled IA opened. The Materials row says where its reservation stands. A Created IA shows each
// line's Required / Reserved / Short, read from its own holds, and one still "Reserving" starts IA_HOLD again in the background; a Draft
// still marked gives back what it holds, quietly. A completed
// IA that still holds stock closes its holds (IA_HOLD CLOSE). A clone starts unreserved. Not enrolled: nothing. Switch off: no new reservation
// started; what is held is still shown and closed (review I4).
//   node scratchpad/iasc/client/test/test_res_mount.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

// the shipped build (RES-01 ON on DEV since 10-22) and its two switch variants
const SHIPPED = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const BUILT = H.resVariant(SHIPPED, false);
const ON = H.resVariant(SHIPPED, true);
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
const ia = (o) => F.header(Object.assign({ id: "4001", page_status: "Edit", item_assembly_status: "Created", material_hold_status: "PARTIAL", material_hold_at: "2026-10-21 14:00:00",
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
// the reservation's IA_HOLD calls; BA rev 1.2 C2's read-only CHECK apart (checkCalls)
const holdCalls = (r) => r.trace.filter((t) => /runWorkflow$/.test(t[0]) && t[1] === HOLD && t[2].operation !== "CHECK").map((t) => t[2]);
const checkCalls = (r) => r.trace.filter((t) => /runWorkflow$/.test(t[0]) && t[1] === HOLD && t[2].operation === "CHECK").map((t) => t[2]);
const summary = (r) => r.values.res_summary;
const cells = (r) => (r.values.stock_movement || []).map((l) => [l.res_reserved, l.res_short]);
const shown = (r) => r.trace.filter((t) => /display$/.test(t[0])).reduce((a, t) => a.concat(t[1]), []);

(async () => {
  // ---- a Created IA that reserves: the Materials row, the line figures from its own Allocated holds, no new run
  {
    const r = await run(ON, ia());
    check("Created PARTIAL: the Materials row says so, where to look, when it was checked, and that it is the last save's (MIN-06)", summary(r) ===
      "Raw material reservation: Partially reserved: see Unreserved on the lines · checked 2026-10-21 14:00:00 · Shown for the last save: changes not saved yet are not reserved.", summary(r));
    check("Created: Reserved / Unreserved per line with the reason (own Allocated holds only, not one in flight; the reference when no Required, not the allocated 15; " +
      "non-stock blank; serial / handling unit named not supported; MIN-06)",
      same(cells(r), [["20", "20 not allocated"], ["0", "20 not allocated"], ["", ""], ["0", "2 serial: not supported"], ["0", "3 handling unit: not supported"]]), cells(r));
    check("Created: the row and the three line columns shown", ["res_summary", "stock_movement.required_qty", "stock_movement.res_reserved", "stock_movement.res_short"]
      .every((m) => shown(r).indexOf(m) >= 0), shown(r));
    check("Created PARTIAL: no reservation started on open", holdCalls(r).length === 0, holdCalls(r));
    // review M5: an 830-line IA must not lose rows to the server's default read size: explicit limits (5,000 for its own holds, the id count
    // for the items)
    const reads = r.trace.filter((x) => /db\.get/.test(x[0]) && (x[1].collection === "on_reserved_gd" ||
      (x[1].collection === "item" && x[1].field === "stock_control,serial_number_management,based_uom,table_uom_conversion")));
    check("Created: the line-figure reads carry explicit limits", reads.length >= 2 && reads.every((x) => Number(x[1].limit) > 0) &&
      reads.filter((x) => x[1].collection === "on_reserved_gd").every((x) => Number(x[1].limit) === 5000), reads.map((x) => [x[1].collection, x[1].limit]));
  }
  // ---- a Created IA still Reserving (a background run, a mobile save): started again, the row follows its answer
  {
    const r = await run(ON, ia({ material_hold_status: "RESERVING" }), { isEdit: true }, () => ({ data: { code: "200", message: "All materials are reserved.",
      result_json: JSON.stringify({ status: "FULL", checkedAt: "2026-10-21 14:05:00", lines: [] }) } }));
    check("Created RESERVING: IA_HOLD RECONCILE (source FORM) started on open", same(holdCalls(r), [{ ia_id: "4001", organization_id: F.ORG, operation: "RECONCILE", source: "FORM" }]), holdCalls(r));
    check("Created RESERVING: the row and the header fields follow the answer", summary(r) ===
      "Raw material reservation: Fully reserved · checked 2026-10-21 14:05:00 · Shown for the last save: changes not saved yet are not reserved." &&
      r.values.material_hold_status === "FULL" && r.values.material_hold_at === "2026-10-21 14:05:00", [summary(r), r.values.material_hold_status]);
  }
  // ---- MIN-06 (BA 10-22): each line says what is reserved and why the rest is not, by IA_HOLD's rules (allocated stock not free,
  // not allocated, a category or a unit it does not support), and nothing it does not know: pending while reserving, review when unsure
  {
    const pk = (qty, o) => Object.assign({ location_id: "L0", batch_id: null, sm_quantity: qty, category: "Unrestricted" }, o || {});
    const ln = (id, item, uom, required, picks) => ({ id: id, item_selection: item, item_name: item, quantity_uom: uom, requested_qty: required, required_qty: required,
      total_quantity: picks.reduce((s, p) => s + p.sm_quantity, 0), temp_qty_data: JSON.stringify(picks), temp_hu_data: "" });
    const ls = [ln("5001", "C2", F.EA, 6, [pk(6)]), ln("5002", "C1", F.EA, 10, [pk(6)]), ln("5003", "C3", F.EA, 5, [pk(2), pk(3, { category: "Quality Inspection" })]),
      ln("5004", "C2", F.CTN, 1, [pk(1)]), ln("5005", "P1", F.CTN, 1, [pk(1)]), ln("5006", "C1", F.EA, 2, [pk(5)])];
    const held = [own("R1", "5001", "C2", 6), own("R2", "5002", "C1", 4), own("R3", "5003", "C3", 2), own("R5", "5005", "P1", 1, { item_uom: F.CTN }), own("R6", "5006", "C1", 1)];
    const at = async (hold, answer) => {
      const w = H.world({ db: H.tableDb(Object.assign(F.tables(), { on_reserved_gd: held })) });
      w.so = F.so();
      const self = H.makeThis(w, ON, { values: H.clone(ia({ material_hold_status: hold, stock_movement: H.clone(ls) })), stateful: true, isEdit: true,
        answer: F.answer(w, H.SC_TEST_IDS, (id) => (id === HOLD ? answer || { data: { code: "500", message: "down" } } : { data: { code: "200", message: "ok" } })) });
      const e = H.byName(ON, "mounted");
      H.compile(w, H.sourceOf(e), e.type === "rule").call(self);
      await H.drain(w);
      return { trace: w.trace, values: self.values };
    };
    const r = await at("PARTIAL");
    check("MIN-06: fully held; 6 of 10 allocated with 4 held (2 not free, 4 not allocated); a Quality Inspection pick; a carton with no conversion; a carton that converts; " +
      "5 allocated for 2 required, 1 held (1 not free, not 4)",
      same(cells(r), [["6", "0"], ["4", "6: 2 allocated stock not free, 4 not allocated"], ["2", "3 Quality Inspection stock: not supported"],
        ["0", "1 unit with no conversion: not supported"], ["1", "0"], ["1", "1 allocated stock not free"]]), cells(r));
    const p = await at("RESERVING");
    check("MIN-06: still Reserving (its run did not answer): the row says pending, a supported line's rest pending (an unsupported one still says so), not short",
      /^Raw material reservation: Pending: the saved materials are being reserved/.test(summary(p)) && same(cells(p).map((c) => c[1]), ["0", "6 pending", "3 Quality Inspection stock: not supported", "1 unit with no conversion: not supported", "0", "1 pending"]),
      [summary(p), cells(p)]);
    const v = await at("REVIEW");
    check("MIN-06: Needs review: the rest of each line needs review, not short", same(cells(v).map((c) => c[1]), ["0", "6 needs review", "3 Quality Inspection stock: not supported", "1 unit with no conversion: not supported", "0", "1 needs review"]), cells(v));
    const n = await at("SHORT");
    check("MIN-06: SHORT reads Nothing reserved, never a shortage it does not know of", /^Raw material reservation: Nothing reserved: see Unreserved on the lines · /.test(summary(n)),
      summary(n));
    const z = await at("NONE");
    check("MIN-06: NONE reads Nothing to reserve: no stock-controlled materials", /^Raw material reservation: Nothing to reserve: no stock-controlled materials · /.test(summary(z)), summary(z));
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
    check("Clone of a reserving IA: hold fields and any line figures cleared, the Draft row (a new Draft, MIN-06), nothing started", r.values.material_hold_status === "" &&
      r.values.material_hold_at === "" && cells(r).every((c) => !c[0] && !c[1]) && summary(r) === "Raw material reservation: No stock reserved (Draft). Save as Created to reserve the materials." &&
      holdCalls(r).length === 0, [r.values.material_hold_status, cells(r), summary(r)]);
    const n = await run(ON, ia({ material_hold_status: "" }));
    check("not enrolled: no row, no read of holds, nothing started", shown(n).indexOf("res_summary") < 0 && !n.trace.some((t) => /db\.get/.test(t[0]) && t[1].collection === "on_reserved_gd") &&
      holdCalls(n).length === 0, shown(n));
    // review I4: the switch only makes holds: off, a Created IA still shows what it holds but starts no reservation; a completed IA still closes
    const o = await run(BUILT, ia({ material_hold_status: "RESERVING" }));
    check("switch off, a Created IA still Reserving: the row and figures shown, no reservation started", shown(o).indexOf("res_summary") >= 0 && holdCalls(o).length === 0, [shown(o), holdCalls(o)]);
    const oc = await run(BUILT, ia({ item_assembly_status: "Completed", material_hold_status: "FULL" }));
    check("switch off, a completed IA that still holds stock: IA_HOLD CLOSE on open", same(holdCalls(oc), [{ ia_id: "4001", organization_id: F.ORG, operation: "CLOSE", source: "FORM" }]),
      holdCalls(oc));
  }
  // ---- RES-01 Created (BA, 10-22): a Draft never holds. One still marked (reverted, saved before Created existed) gives back what it
  // holds: one quiet IA_HOLD RECONCILE, no row, no line figures, whatever the switch; NONE / CLOSED / not marked: nothing
  {
    const DRAFT = "Raw material reservation: No stock reserved (Draft). Save as Created to reserve the materials.";
    const released = () => ({ data: { code: "200", message: "Released: this Item Assembly holds no material now.", result_json: JSON.stringify({ status: "NONE", lines: [] }) } });
    const r = await run(ON, ia({ item_assembly_status: "Draft", material_hold_status: "PARTIAL" }), { isEdit: true }, released);
    check("Draft still marked PARTIAL: one quiet IA_HOLD RECONCILE (source FORM), then the Draft row (MIN-06), no line figures", same(holdCalls(r), [{ ia_id: "4001", organization_id: F.ORG,
      operation: "RECONCILE", source: "FORM" }]) && summary(r) === DRAFT && shown(r).indexOf("res_summary") >= 0 && shown(r).indexOf("stock_movement.res_short") < 0, [holdCalls(r), summary(r)]);
    const rf = await run(ON, ia({ item_assembly_status: "Draft", material_hold_status: "PARTIAL" }), { isEdit: true }, () => ({ data: { code: "500", message: "down" } }));
    check("Draft still marked, the give-back failed: the row says it still holds its earlier reservation (never 'No stock reserved')",
      summary(rf) === "Raw material reservation: The earlier reservation could not be released now (Draft): open or save it again to retry.", summary(rf));
    const n = await run(ON, ia({ item_assembly_status: "Draft", material_hold_status: "NONE" }));
    check("Draft NONE: nothing started, the Draft row (MIN-06)", holdCalls(n).length === 0 && summary(n) === DRAFT && shown(n).indexOf("res_summary") >= 0, [holdCalls(n), summary(n)]);
    const u = await run(ON, ia({ item_assembly_status: "Draft", material_hold_status: "" }));
    check("Draft never marked: nothing started, the Draft row", holdCalls(u).length === 0 && summary(u) === DRAFT, [holdCalls(u), summary(u)]);
    const vw = await run(ON, ia({ item_assembly_status: "Draft", material_hold_status: "", page_status: "View" }), { isView: true });
    check("View of a Draft: the Draft row without the Created hint (no button there)", summary(vw) === "Raw material reservation: No stock reserved (Draft).", summary(vw));
    const ad = await run(ON, ia({ id: "", item_assembly_status: "", material_hold_status: "", page_status: "Add", stock_movement: [] }), { isAdd: true });
    check("Add: the Draft row", summary(ad) === DRAFT && holdCalls(ad).length === 0, summary(ad));
    const o = await run(BUILT, ia({ item_assembly_status: "Draft", material_hold_status: "RESERVING" }));
    check("switch off, a Draft still marked: its holds still given back (finishing is never switched off), no row", holdCalls(o).length === 1 && shown(o).indexOf("res_summary") < 0,
      [holdCalls(o), shown(o)]);
    const oa = await run(BUILT, ia({ id: "", item_assembly_status: "", material_hold_status: "", page_status: "Add", stock_movement: [] }), { isAdd: true });
    check("switch off, Add: no row (no Created button either)", shown(oa).indexOf("res_summary") < 0, shown(oa));
  }
  // ---- BA rev 1.2 C2: a stored completed IA (enrolled or not, whatever the switch) asks IA_HOLD CHECK how its completion ended, in the
  // background; a completion that did not finish (PARTIAL), was interrupted or is still running says so in its own row; anything else: nothing
  {
    const CHECK = { ia_id: "4001", organization_id: F.ORG, operation: "CHECK", source: "FORM" };
    const MSG = "This completion stopped while issuing its components: some components may not be issued. Needs review: check this Item Assembly's stock movements before correcting it.";
    const ans = (outcome, message, code) => (p) => (p.operation === "CHECK" ? { data: { code: code || "200", message: message || "",
      result_json: JSON.stringify({ outcome: outcome, step: "", message: message || "" }) } } : { data: { code: "200", message: "ok" } });
    const done = (o) => ia(Object.assign({ item_assembly_status: "Completed", material_hold_status: "" }, o || {}));
    let r = await run(ON, done({ page_status: "View" }), { isView: true }, ans("PARTIAL", MSG));
    check("C2: a completed IA not enrolled, opened to view: one IA_HOLD CHECK (source FORM), no reservation call", same(checkCalls(r), [CHECK]) && holdCalls(r).length === 0,
      r.trace.filter((t) => /runWorkflow$/.test(t[0])));
    check("C2: PARTIAL: the completion row = the server's message, shown", r.values.completion_check === MSG && shown(r).indexOf("completion_check") >= 0,
      [r.values.completion_check, shown(r)]);
    for (const o of ["INTERRUPTED", "RUNNING"]) {
      r = await run(ON, done(), { isEdit: true }, ans(o, "msg " + o));
      check("C2: " + o + " shown", r.values.completion_check === "msg " + o && shown(r).indexOf("completion_check") >= 0, [r.values.completion_check, shown(r)]);
    }
    for (const o of ["DONE", "NONE", "UNKNOWN", "NOT_COMPLETED"]) {
      r = await run(ON, done(), { isEdit: true }, ans(o, ""));
      check("C2: " + o + ": no completion row", !r.values.completion_check && shown(r).indexOf("completion_check") < 0, [r.values.completion_check, shown(r)]);
    }
    r = await run(ON, done(), { isEdit: true }, ans("DONE", "a message"));
    check("C2: only PARTIAL / INTERRUPTED / RUNNING are shown (DONE with a message: nothing)", !r.values.completion_check && shown(r).indexOf("completion_check") < 0, shown(r));
    r = await run(ON, done(), { isEdit: true }, ans("PARTIAL", MSG, "400"));
    check("C2: a refused check (400): nothing shown", !r.values.completion_check && shown(r).indexOf("completion_check") < 0, shown(r));
    r = await run(ON, done(), { isEdit: true }, (p) => (p.operation === "CHECK" ? { data: null } : { data: { code: "200" } }));
    check("C2: no answer: nothing shown", !r.values.completion_check && shown(r).indexOf("completion_check") < 0, shown(r));
    r = await run(ON, done({ item_assembly_status: "Fully Posted" }), { isEdit: true }, ans("PARTIAL", MSG));
    check("C2: Fully Posted checked too", same(checkCalls(r), [CHECK]) && r.values.completion_check === MSG, checkCalls(r));
    r = await run(ON, done({ material_hold_status: "FULL" }), { isEdit: true }, ans("DONE", ""));
    check("C2: a completed IA that still holds: CHECK and CLOSE", same(checkCalls(r), [CHECK]) && same(holdCalls(r).map((c) => c.operation), ["CLOSE"]),
      r.trace.filter((t) => /runWorkflow$/.test(t[0])));
    r = await run(BUILT, done(), { isEdit: true }, ans("PARTIAL", MSG));
    check("C2: switch off: still checked (read-only, not a reservation)", same(checkCalls(r), [CHECK]) && r.values.completion_check === MSG, checkCalls(r));
    for (const [what, values, flags] of [["Draft", ia({ item_assembly_status: "Draft", material_hold_status: "" }), { isEdit: true }], ["Created", ia(), { isEdit: true }],
      ["Cancelled", ia({ item_assembly_status: "Cancelled", material_hold_status: "" }), { isView: true }], ["a Clone of a completed IA", done({ page_status: "Clone" }), { isCopy: true }],
      ["Completed, not stored (no id)", done({ id: "" }), { isEdit: true }]]) {
      r = await run(ON, values, flags, ans("PARTIAL", MSG));
      check("C2: " + what + ": no CHECK", checkCalls(r).length === 0 && !r.values.completion_check, checkCalls(r));
    }
  }
  H.done("test_res_mount");
})();
