// A legacy Item Assembly (no Sales Order line, no mode or STANDARD without a snapshot) on the ON build runs the v36 code call for
// call: the explode (new item, re-scale, Re-scale / Keep, no BOM), the item-quantity change, the plant change, mounted for every
// page and status (the Small Cycle calls - tagged sc:, the prologues' reads of the Small Cycle keys, the trigger of sc_main -
// removed), the four completion handlers with their BOM-variance check, Draft. With SC_ENABLED false or a workflow id "0" every
// patched handler is v36 exactly, nothing removed. The IA V2 record never carries the Small Cycle UI widgets.
//   node scratchpad/iasc/client/test/test_sc_legacy.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

const V36 = H.readJSON(H.FILES.formBase);
const ON = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const OFF_SWITCH = H.scVariant(H.readJSON(H.FILES.formOn), false, H.SC_TEST_IDS);
const OFF_IDS = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_OFF_IDS);
// the IA V2 handlers ship ON in v36 (real ids): their workflow calls are answered by the default
const IA_V2_IDS = ["2112141238600376321", "2112141277456408577"];

const run = async (doc, name, values, args, o) => {
  o = o || {};
  const w = H.world({ db: H.tableDb(o.tables || F.tables(), { clamp: o.clamp }) });
  w.so = F.so(o.so);
  const self = H.makeThis(w, doc, Object.assign({ values: H.clone(values), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, o.answer) }, o.this || {}));
  const e = H.byName(doc, name);
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self, args);
  await H.drain(w);
  return { w: w, self: self, trace: w.trace, values: self.values };
};
const explodedRows = async () => (await run(V36, "onChange_assembledItem", F.header(), { value: "P1" })).values.stock_movement;

// v36 vs a build: the build's trace with the Small Cycle calls removed (or nothing removed, `exact`) and the final values equal;
// o.scExtra = the display-only values the Small Cycle sets on top (UI-01: Actual Received on a completed IA), checked then dropped
const compare = async (what, name, values, args, o, docs) => {
  o = o || {};
  const a = await run(V36, name, values, args, o);
  for (const [label, doc, exact] of docs || [["ON", ON, false], ["SC_ENABLED false", OFF_SWITCH, true], ["workflow ids 0", OFF_IDS, true]]) {
    const b = await run(doc, name, values, args, o);
    // RES-01 Created review 1 (10-22): a new IA whose background save did not answer hides the Created button with the Draft one; the one
    // call where the build differs from v36 on purpose (a superset: the extra button is hidden by default)
    const t0 = b.trace.map((t) => (t[0] === "hide" && JSON.stringify(t[1]) === '["button_draft","button_created"]' ? ["hide", ["button_draft"]] : t));
    const tb = exact ? t0 : H.legacyTrace(t0);
    const firstDiff = tb.findIndex((t, i) => JSON.stringify(t) !== JSON.stringify(a.trace[i]));
    check(what + " [" + label + "]: v36 call for call" + (exact ? " (nothing removed)" : ""), same(tb, a.trace), { at: firstDiff, v36: a.trace[firstDiff], built: tb[firstDiff], lengths: [a.trace.length, tb.length] });
    const bv = H.clone(b.values);
    const extra = exact ? {} : o.scExtra || {};
    Object.keys(extra).forEach((k) => {
      check(what + " [" + label + "]: Small Cycle sets " + k + " = " + JSON.stringify(extra[k]), bv[k] === extra[k], bv[k]);
      delete bv[k];
    });
    check(what + " [" + label + "]: the same final values", same(bv, a.values));
    if (exact) check(what + " [" + label + "]: no Small Cycle call at all", !b.trace.some((t) => /^sc:/.test(t[0]) || (t[0] === "triggerEvent" && t[1] === "sc_main")));
  }
  return a;
};

(async () => {
  // ---- the explode
  const fresh = F.header();
  const ex = await compare("explode, new item", "onChange_assembledItem", fresh, { value: "P1" });
  const rows = ex.values.stock_movement;
  check("(the fixture explodes into 3 lines: Frame, Screw, Labour; REF dropped)", rows.length === 3 && same(rows.map((r) => r.item_selection), ["C1", "C2", "N1"]) &&
    rows[0].requested_qty === 20 && rows[1].requested_qty === 40 && rows[2].total_quantity === 1, rows.map((r) => [r.item_selection, r.requested_qty, r.total_quantity]));
  await compare("explode, new item, STANDARD without a snapshot", "onChange_assembledItem", F.header({ bom_consumption_mode: "STANDARD" }), { value: "P1" });
  await compare("explode, no BOM", "onChange_assembledItem", F.header({ item_id: "P9" }), { value: "P9" });
  await compare("explode, item cleared", "onChange_assembledItem", F.header({ stock_movement: rows }), { value: "" });
  await compare("explode, no plant", "onChange_assembledItem", F.header({ issuing_operation_faci: "" }), { value: "P1" });
  await compare("re-scale, lines as exploded", "onChange_assembledItem", F.header({ item_qty: 20, stock_movement: rows }), { value: "P1", rescale: true });
  const edited = H.clone(rows);
  edited[1].total_quantity = 41;
  await compare("re-scale, edited lines, Re-scale", "onChange_assembledItem", F.header({ item_qty: 20, stock_movement: edited }), { value: "P1", rescale: true });
  await compare("re-scale, edited lines, Keep", "onChange_assembledItem", F.header({ item_qty: 20, stock_movement: edited }), { value: "P1", rescale: true }, { this: { confirm: () => "cancel" } });
  // ---- the item quantity and the plant
  await compare("item quantity changed", "onChange_itemQty", F.header({ item_qty: 30, stock_movement: rows }), { value: 30 });
  await compare("item quantity changed, STANDARD without a snapshot", "onChange_itemQty", F.header({ item_qty: 30, stock_movement: rows, bom_consumption_mode: "STANDARD" }), { value: 30 });
  await compare("plant changed", "onChange_Plant", F.header({ stock_movement: rows }), { value: F.PLANT });
  await compare("plant cleared", "onChange_Plant", F.header({ stock_movement: rows }), { value: "" });

  // ---- mounted, every page and status (MIN-06, BA 10-22: a new IA or a Draft shows its display-only Draft row, RES-01 being on)
  const DRAFT_ROW = { res_summary: "Raw material reservation: No stock reserved (Draft). Save as Created to reserve the materials." };
  const pages = [
    ["Add, plant-level login", { isAdd: true }, F.header(), DRAFT_ROW],
    ["Add, org-level login", { isAdd: true, system: { deptIds: "1001", uid: "77" } }, F.header(), DRAFT_ROW],
    ["Clone", { isCopy: true }, F.header({ id: "4001", stock_movement: rows, batch_no: "X" }), DRAFT_ROW],
    ["Edit, Draft", { isEdit: true }, F.header({ id: "4001", page_status: "Edit", stock_movement: rows }), DRAFT_ROW],
    ["Edit, Completed", { isEdit: true }, F.header({ id: "4001", page_status: "Edit", item_assembly_status: "Completed", stock_movement: rows }), { sc_actual: "10" }],
    ["Edit, Fully Posted", { isEdit: true }, F.header({ id: "4001", page_status: "Edit", item_assembly_status: "Fully Posted", stock_movement: rows }), { sc_actual: "10" }],
    ["Edit, Processing", { isEdit: true }, F.header({ id: "4001", page_status: "Edit", item_assembly_status: "Processing", ia_v2_job_id: "7001", stock_movement: rows })],
    ["View, Completed", { isView: true }, F.header({ id: "4001", page_status: "View", item_assembly_status: "Completed", stock_movement: rows }), { sc_actual: "10" }],
  ];
  for (const [what, flags, values, extra] of pages) {
    await compare("mounted, " + what, "mounted", values, undefined, { this: flags, scExtra: extra });
  }
  // ON on a legacy page: the Small Cycle calls are display-only (no read, no write, no workflow)
  {
    const b = await run(ON, "mounted", F.header(), undefined, { this: { isAdd: true } });
    const sc = b.trace.filter((t) => /^sc:/.test(t[0]));
    check("mounted ON, legacy Add: Small Cycle shows its section with the radio and Select SO Line only, and the Draft row; reads / writes / calls nothing", sc.length > 0 &&
      sc.every((t) => ["sc:getValues", "sc:getParamsVariables", "sc:display", "sc:hide", "sc:disabled"].indexOf(t[0]) >= 0 ||
        (t[0] === "sc:setData" && same(Object.keys(t[1]), ["res_summary"]))) &&
      sc.some((t) => t[0] === "sc:display" && same(t[1], ["sc_section", "bom_consumption_mode", "sc_actions", "sc_btn_line"])), sc);
    const c = await run(ON, "mounted", F.header({ id: "4001", page_status: "Edit", item_assembly_status: "Completed", stock_movement: rows }), undefined, { this: { isEdit: true } });
    const sc2 = c.trace.filter((t) => /^sc:/.test(t[0]));
    // UI-01: only the read-only Actual Received row in place of the quantity; no read; BA rev 1.2 C2: one read-only IA_HOLD CHECK, no other workflow
    const calls = c.trace.filter((t) => /runWorkflow$/.test(t[0]));
    check("mounted ON, legacy Completed: only Actual Received shown, in place of the quantity", same(sc2.filter((t) => t[0] === "sc:display").map((t) => t[1]), [["sc_actual"]]) &&
      same(sc2.filter((t) => t[0] === "sc:setData").map((t) => t[1]), [{ sc_actual: "10" }]) && sc2.some((t) => t[0] === "sc:hide" && same(t[1], ["item_qty"])) &&
      sc2.every((t) => ["sc:getValues", "sc:getParamsVariables", "sc:hide", "sc:disabled", "sc:display", "sc:setData", "sc:runWorkflow"].indexOf(t[0]) >= 0) &&
      calls.length === 1 && calls[0][1] === H.SC_TEST_IDS.IA_HOLD && same(calls[0][2], { ia_id: "4001", organization_id: F.ORG, operation: "CHECK", source: "FORM" }), [sc2, calls]);
  }

  // ---- completion: the four BOM-variance copies, classic and V2, and Draft
  const changed = H.clone(rows);
  changed[1].total_quantity = 41;
  for (const [what, values] of [["lines = the BOM", F.header({ stock_movement: rows })], ["a changed line", F.header({ stock_movement: changed })]]) {
    for (const name of ["onClick_saveAsCompleted", "onClick_saveAsCompletedPost", "onClick_saveAsDraft"]) {
      await compare(name + ", " + what, name, values);
      await compare(name + ", " + what + ", Cancel", name, values, undefined, { this: { confirm: () => "cancel" } });
    }
    for (const name of ["iaV2_onClick_completed", "iaV2_onClick_completed_post"]) await compare(name + " (<= 50 picks), " + what, name, values);
  }
  // V2 above 50 picks: 60 lines of one pick each
  const big = [];
  for (let i = 0; i < 60; i++) {
    big.push({ item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 1, total_quantity: 1,
      temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", balance_id: "BL2", sm_quantity: 1, category: "Unrestricted" }]), temp_hu_data: "" });
  }
  for (const name of ["iaV2_onClick_completed", "iaV2_onClick_completed_post"]) {
    await compare(name + " (60 picks: IA_V2_SUBMIT)", name, F.header({ stock_movement: big }), undefined, { this: { confirm: () => "confirm" } });
  }
  // the IA V2 record: the Small Cycle data keys go, its UI widgets never do
  {
    const ui = { sc_info: "", sc_info_so: "x", sc_info_ordered: "x", sc_info_produced: "x", sc_info_open: "x", sc_info_suggest: "x", sc_info_cover: "x", sc_info_bom: "x",
      sc_info_warn: "x", sc_actions: "", sc_btn_line: "", sc_btn_unlink: "", sc_btn_relink: "", sc_btn_suggest: "", sc_btn_bom: "", sc_btn_refresh: "",
      sc_line_dialog: { sc_line_table: [] }, sc_expand_dialog: { sc_expand_table: [] },
      // UI-01's sections, their grids, the Actual Received row and the Production buttons
      sc_sec_production: "", sc_prod_grid: "", sc_sec_output: "", sc_output_grid: "", sc_sec_more: "", sc_more_grid: "", sc_actual: "x", sc_prod_actions: "" };
    const values = Object.assign(F.header({ stock_movement: big, bom_consumption_mode: "STANDARD", source_bom_id: "B1" }), ui);
    const b = await run(ON, "iaV2_onClick_completed", values, undefined, {});
    const submit = b.trace.find((t) => t[0] === "runWorkflow" && t[1] === IA_V2_IDS[0]);
    const form = submit && submit[2] && submit[2].form;
    check("IA V2 record: no Small Cycle UI widget, every Small Cycle data key", !!form && Object.keys(ui).every((k) => !(k in form)) && H.SC_KEYS.every((k) => k in form), form && Object.keys(form));
  }
  H.done("test_sc_legacy");
})();
