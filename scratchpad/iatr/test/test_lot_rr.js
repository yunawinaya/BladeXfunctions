// node scratchpad/iatr/test/test_lot_rr.js - the Location Transfer form's reserved-request layer (lot_client/patch_lot_ui.py
// rr_behaviour; scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 10) on the full build, its handlers on scratchpad/iasc's mock form:
//   picker   the pick dialog counts the request's own Item Assembly line's holds as free stock where they are - never another line's,
//            another document's or the staging bin's; an ordinary transfer's dialog as before
//   receive  a reserved request (its Item Assembly Created): the Receive dialog, a row per line and dispatched batch; Good + Defect =
//            dispatched, a defect needs its reason, one reason per line (SUBMIT's rrReceivePlan); the receipts go with the Completed save
//            (form.iatr_receipts); a request of a Draft Item Assembly: v118's confirm, no receipts
//   info     "replacement for LOT-…"; the bins to count, from LOT_V2_COMMIT's DISPATCH entry in the request's log
//   IATR_UI_PATCHER=<copy of patch_lot_ui.py> tests another patcher (mutants_lot_ui.js)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const H = require("../../iasc/client/test/harness");
const IATR = path.join(__dirname, "..");

// the checks are the harness's (H.check / H.done: an uncaught error in a handler fails the test too)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => H.check(label, same(got, want), { got: got, want: want });
const yes = (label, v, show) => H.check(label, !!v, show);

const PATCHER = process.env.IATR_UI_PATCHER || path.join(IATR, "lot_client", "patch_lot_ui.py");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-rr-"));
const b = spawnSync("python3", [PATCHER, "--write"], { env: Object.assign({}, process.env, { IATR_UI_OUT: dir }), encoding: "utf8" });
if (b.status !== 0) throw new Error(b.stderr.slice(-800));
const FULL = JSON.parse(fs.readFileSync(path.join(dir, "full", "LOTform.json"), "utf8"));
const SUBMIT = "2110992282596540417";
const IA = "2113088440365826050";
const STG = "9";
const W = (m) => {
  let hit = null;
  const walk = (x) => {
    if (hit || !x || typeof x !== "object") return;
    if (!Array.isArray(x) && x.model === m && x.type) hit = x;
    else Object.values(x).forEach(walk);
  };
  walk(FULL.list);
  return hit;
};
const EV = (name) => FULL.config.eventScript.filter((e) => e.name === name)[0];

const pick = (bin, qty, o) => Object.assign({ material_id: "M1", location_id: bin, batch_id: null, sm_quantity: qty, category: "Unrestricted", material_uom: "77" }, o || {});
const line = (i, o) => Object.assign({ id: "60" + i, fm_key: "k" + i, item_selection: "M1", item_name: "Bolt", line_index: String(i + 1), location_id: STG, storage_location_id: "S9",
  requested_qty: 2, total_quantity: 2, quantity_uom: "77", source_ia_line_id: "IAL" + i, temp_qty_data: JSON.stringify([pick("8", 2)]), temp_hu_data: "[]" }, o || {});
const req = (o) => Object.assign({ page_status: "Edit", id: "2114100000000000001", stock_movement_no: "LOT-20261030/0007", stock_movement_status: "In Progress", transfer_purpose: "IA_SUPPLY",
  source_ia_id: IA, source_ia_no: "IA-2610-030", organization_id: "1123598813738675201", issuing_operation_faci: "P1", issue_date: "2026-10-30 00:00:00",
  required_date: "2026-10-30 00:00:00", requested_by: "Planner", requested_at: "2026-10-30 09:00:00", source_ia_rev: "1", lot_v2_job_id: "", request_log: "",
  replacement_for_id: "", stock_movement: [line(0)] }, o || {});
const hold = (o) => Object.assign({ id: "H" + Math.random().toString(36).slice(2, 8), doc_type: "Item Assembly", doc_id: IA, doc_line_id: "IAL0", status: "Allocated",
  material_id: "M1", bin_location: "8", batch_id: null, item_uom: "77", open_qty: 2, reserved_qty: 2, from_category: "Unrestricted", plant_id: "P1",
  organization_id: "1123598813738675201", is_deleted: 0 }, o || {});
const tables = (o) => Object.assign({
  sm_item_assembly: [{ id: IA, item_assembly_status: "Created", is_deleted: 0 }],
  batch: [{ id: "B1", batch_number: "BATCH-1", is_deleted: 0 }, { id: "B2", batch_number: "BATCH-2", is_deleted: 0 }],
  Item: [{ id: "M1", material_code: "BOLT-01", material_name: "Bolt", based_uom: "77", table_uom_conversion: [], item_batch_management: 0, serial_number_management: 0,
    stock_control: 1, is_deleted: 0 }],
  unit_of_measurement: [{ id: "77", uom_name: "EA" }],
  on_reserved_gd: [], handling_unit_atu7sreg_sub: [], handling_unit: [],
  item_balance: [], item_batch_balance: [],
  bin_location: [{ id: "8", bin_location_combine: "A-8" }, { id: "7", bin_location_combine: "A-7" }, { id: STG, bin_location_combine: "PROD-1" }],
  sm_location_transfer: [{ id: "2114100000000000000", stock_movement_no: "LOT-20261030/0006", is_deleted: 0 }],
}, o || {});
const session = (values, opt) => {
  const o = opt || {};
  const w = H.world({ db: H.tableDb(tables(o.tables)), dbThrows: o.dbThrows });
  const calls = [];
  const self = H.makeThis(w, FULL, { values: H.clone(values), stateful: true, isEdit: true, confirm: o.confirm, answer: (id, params) => {
    calls.push([id, params]);
    return { data: o.answer ? o.answer(id, params) : { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", lot_id: values.id, lot_no: "LOT-1" } };
  } });
  // the Location Transfer form's own component calls (mounted's table.hideChildRecord ...): any method, a no-op
  self.getComponent = () => new Proxy({ options: {} }, { get: (o, k) => (k in o ? o[k] : () => {}) });
  const fire = async (name, args) => {
    self.triggerEvent(name, args);
    await H.drain(w);
  };
  return { w, self, calls, fire };
};
const sets = (w, k) => w.trace.filter((t) => /setData$/.test(t[0]) && t[1] && k in t[1]).map((t) => t[1][k]);
const said = (w) => w.trace.filter((t) => /\$message\.[a-z]+$/.test(t[0])).map((t) => t[0].replace(/^.*\$message\./, "") + ": " + t[1]);
const dialogs = (w, kind) => w.trace.filter((t) => new RegExp(kind + "Dialog$").test(t[0])).map((t) => t[1]);
const triggered = (w, name) => w.trace.filter((t) => /triggerEvent$/.test(t[0]) && t[1] === name).length;
const RT = "iatr_receive_dialog.iatr_receive_table";
const submits = (calls) => calls.filter((c) => c[0] === SUBMIT && c[1].operation === "SUBMIT").map((c) => c[1]);

(async () => {
  // ================================================================ the pick dialog (the design's step 3)
  const balance = (bin, unr, res) => ({ id: "BAL" + bin, material_id: "M1", plant_id: "P1", organization_id: "1123598813738675201", location_id: bin, batch_id: null,
    unrestricted_qty: unr, reserved_qty: res, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0, balance_quantity: unr + res, is_deleted: 0 });
  // this line's (A-8 2, A-7 6 + 1 in a 12-unit pack); another line's, another IA's (the same line id), a GD's, the staging bin's, a Blocked
  // one and a handling unit's never
  const holds = [hold(), hold({ bin_location: "7", open_qty: 6 }), hold({ bin_location: "7", item_uom: "78", open_qty: 1 }), hold({ doc_line_id: "IAL1", open_qty: 5 }),
    hold({ doc_id: "2113088440365826999", open_qty: 7 }), hold({ doc_type: "Goods Delivery", doc_id: "GD1", doc_line_id: "GL1", open_qty: 3 }), hold({ bin_location: STG, open_qty: 4 }),
    hold({ from_category: "Blocked", open_qty: 9 }), hold({ handling_unit_id: "HU1", open_qty: 11 })];
  const conv = { Item: tables().Item.map((it) => Object.assign({}, it, { table_uom_conversion: [{ alt_uom_id: "78", base_qty: 12 }] })) };
  const pickTables = Object.assign({ on_reserved_gd: holds, item_balance: [balance("8", 10, 37), balance("7", 1, 18), balance(STG, 0, 4)] }, conv);
  const shownAt = async (values, more) => {
    const s = session(values, { tables: Object.assign({}, pickTables, more || {}) });
    await s.fire("onClick_select_stock", { row: values.stock_movement[0], rowIndex: 0 });
    const rows = sets(s.w, "sm_item_balance.table_item_balance").slice(-1)[0] || [];
    const at = {};
    rows.forEach((r) => (at[r.location_id + (r.batch_id ? "/" + r.batch_id : "")] = [Number(r.unrestricted_qty), Number(r.reserved_qty)]));
    return at;
  };
  let at = await shownAt(req({ stock_movement_status: "Requested" }));
  eq("picker, a reserved request: its line's own holds free where they are (A-8 +2, A-7 +6 +12); nobody else's, nor the staging bin's", [at["8"], at["7"], at[STG]],
    [[12, 35], [19, 0], undefined]);
  at = await shownAt(req({ stock_movement_status: "Requested", transfer_purpose: "", source_ia_id: "", stock_movement: [line(0, { source_ia_line_id: "" })] }));
  eq("picker, an ordinary transfer: the stock as it is", [at["8"], at["7"], at[STG]], [[10, 37], [1, 18], undefined]);
  at = await shownAt(req({ stock_movement_status: "Requested", stock_movement: [line(0, { source_ia_line_id: "IAL1" })] }));
  eq("picker, the request's other line: only its own hold (5 at A-8)", [at["8"], at["7"]], [[15, 32], [1, 18]]);
  const bItem = { Item: [Object.assign({}, tables().Item[0], { id: "M3", item_batch_management: 1 })] };
  const bbal = (bat, unr, res) => Object.assign(balance("8", unr, res), { id: "BB" + bat, material_id: "M3", batch_id: bat });
  at = await shownAt(req({ stock_movement_status: "Requested", stock_movement: [line(0, { item_selection: "M3", temp_qty_data: JSON.stringify([pick("8", 2, { material_id: "M3", batch_id: "B1" })]) })] }),
    Object.assign({ on_reserved_gd: [hold({ material_id: "M3", batch_id: "B1" })], item_batch_balance: [bbal("B1", 4, 2), bbal("B2", 5, 0)] }, bItem));
  eq("picker, a batch item: the hold back in its own batch only", [at["8/B1"], at["8/B2"]], [[6, 0], [5, 0]]);

  // ================================================================ Receive (D5, D7, D10)
  const recv = () => req({ stock_movement: [line(0), line(1, { item_name: "Nut", item_selection: "M2", source_ia_line_id: "IAL1",
    temp_qty_data: JSON.stringify([pick("8", 3, { material_id: "M2", batch_id: "B1" }), pick("7", 1, { material_id: "M2", batch_id: "B2" })]) })] });
  let s = session(recv());
  await s.fire("lotIatr_onClick_receive");
  const rows = sets(s.w, RT).slice(-1)[0] || [];
  eq("Receive, a reserved request: the dialog, a row per line and dispatched batch, all good to start", rows.map((r) => [r.line_id, r.line_no, r.item, r.batch_id, r.batch, r.dispatched, r.good,
    r.defect, r.reason]), [["600", "1", "Bolt", "", "", 2, 2, 0, ""], ["601", "2", "Nut", "B1", "BATCH-1", 3, 3, 0, ""], ["601", "2", "Nut", "B2", "BATCH-2", 1, 1, 0, ""]]);
  yes("  its dialog opened, nothing saved yet", same(dialogs(s.w, "open"), ["iatr_receive_dialog"]) && triggered(s.w, "lotV2_onClick_save_completed") === 0 && submits(s.calls).length === 0,
    [dialogs(s.w, "open"), s.calls.map((c) => c[1].operation)]);
  const confirmWith = async (edit, values) => {
    const x = session(values || recv());
    await x.fire("lotIatr_onClick_receive");
    const r0 = H.clone(sets(x.w, RT).slice(-1)[0] || []);
    edit(r0);
    x.self.setData({ [RT]: r0 });
    x.w.trace.length = 0;
    await x.fire("lotRr_onConfirm_receive");
    return x;
  };
  s = await confirmWith((r) => {
    Object.assign(r[0], { good: 1, defect: 1, reason: "Damaged" });
    Object.assign(r[2], { good: 0, defect: 1, reason: "Wet" });
  });
  const sub = submits(s.calls)[0] || {};
  eq("Receive confirmed: the Completed save, the receipts with it (per batch for the batch line, one reason per line)", [sub.saveAs, sub.form && sub.form.iatr_receipts],
    ["Completed", { 600: { good: "1", defect: "1", reason: "Damaged" }, 601: { good: "3", defect: "1", reason: "Wet", batches: { B1: { good: "3", defect: "0" }, B2: { good: "0", defect: "1" } } } }]);
  yes("  the dialog closed first, its table not sent", same(dialogs(s.w, "close"), ["iatr_receive_dialog"]) && sub.form && !("iatr_receive_dialog" in sub.form) && !("iatr_receive_table" in sub.form),
    [dialogs(s.w, "close"), Object.keys(sub.form || {}).filter((k) => /iatr_receive/.test(k))]);
  s = await confirmWith(() => {});
  eq("Receive with everything good: defect 0, no reason needed", (submits(s.calls)[0] || {}).form.iatr_receipts,
    { 600: { good: "2", defect: "0", reason: "" }, 601: { good: "4", defect: "0", reason: "", batches: { B1: { good: "3", defect: "0" }, B2: { good: "1", defect: "0" } } } });
  for (const [label, edit, re] of [
    ["Good + Defect short of what was dispatched (lost not counted)", (r) => Object.assign(r[0], { good: 1, defect: 0 }), /Line 1 \(Bolt\): Good \+ Defect must equal the 2 dispatched/],
    ["more than was dispatched", (r) => Object.assign(r[1], { good: 3, defect: 1, reason: "Wet" }), /Line 2 \(Nut, batch BATCH-1\): Good \+ Defect must equal the 3 dispatched/],
    ["a defect without a reason", (r) => Object.assign(r[0], { good: 1, defect: 1 }), /Line 1 \(Bolt\): choose the reason/],
    ["two reasons on one line's batches", (r) => Object.assign(r[1], { good: 2, defect: 1, reason: "Wet" }) && Object.assign(r[2], { good: 0, defect: 1, reason: "Damaged" }), /Line 2 \(Nut\): one reason per line/],
    ["a negative quantity", (r) => Object.assign(r[0], { good: 3, defect: -1 }), /Line 1 \(Bolt\): Good and Defect are quantities of 0 or more/]]) {
    s = await confirmWith(edit);
    yes("Receive refused here, " + label + ": said, nothing saved, the dialog left open", said(s.w).length === 1 && re.test(said(s.w)[0]) && submits(s.calls).length === 0 &&
      dialogs(s.w, "close").length === 0, said(s.w));
  }
  s = session(recv());
  await s.fire("lotIatr_onClick_receive");
  await s.fire("lotRr_onCancel_receive");
  yes("Receive dialog cancelled: closed, nothing saved", same(dialogs(s.w, "close"), ["iatr_receive_dialog"]) && submits(s.calls).length === 0);
  await s.fire("lotV2_onClick_save_completed");
  eq("  a Completed save after a cancelled dialog carries no receipts", "iatr_receipts" in ((submits(s.calls)[0] || {}).form || {}), false);
  s = session(recv(), { tables: { sm_item_assembly: [{ id: IA, item_assembly_status: "Draft", is_deleted: 0 }] } });
  await s.fire("lotIatr_onClick_receive");
  yes("Receive, a Draft Item Assembly's request: v118's confirm, then the Completed save, no receipts, no dialog", s.w.trace.some((t) => /\$confirm$/.test(t[0])) &&
    dialogs(s.w, "open").length === 0 && submits(s.calls).length === 1 && !("iatr_receipts" in submits(s.calls)[0].form), s.calls.map((c) => c[1].operation));
  s = session(recv(), { dbThrows: (name) => name === "sm_item_assembly" });
  await s.fire("lotIatr_onClick_receive");
  yes("Receive, the Item Assembly unreadable: said, nothing opened or saved", said(s.w).length === 1 && /^error: /.test(said(s.w)[0]) && dialogs(s.w, "open").length === 0 && s.calls.length === 0,
    said(s.w));
  // (51 lines: an ordinary transfer that big is saved through SUBMIT)
  s = session(req({ transfer_purpose: "", source_ia_id: "", stock_movement: Array.from({ length: 51 }, (_, i) => line(i, { source_ia_line_id: "" })) }));
  s.self.models._iatr_receipts = { 600: { good: "2", defect: "0", reason: "" } };
  await s.fire("lotV2_onClick_save_completed");
  yes("an ordinary transfer's Completed save (through SUBMIT) never carries receipts", submits(s.calls).length === 1 && !("iatr_receipts" in submits(s.calls)[0].form),
    s.calls.map((c) => c[1].operation));

  // ================================================================ the request's line: the replacement, the bins to count
  const info = async (values) => {
    const x = session(values);
    await x.fire("mounted");
    return sets(x.w, "iatr_info").slice(-1)[0] || "";
  };
  let line1 = await info(req({ stock_movement_status: "Requested", replacement_for_id: "2114100000000000000" }));
  yes("info, a replacement: names the request it follows", / · replacement for LOT-20261030\/0006$/.test(line1), line1);
  const log = JSON.stringify([{ at: "2026-10-30 10:00:00", op: "CREATE" }, { at: "2026-10-30 11:00:00", op: "DISPATCH", marker: "IATR|J1",
    count: [{ item: "M1", from: { bin: "8", batch: "" }, reserved: [{ bin: "7", batch: "" }] }, { item: "M1", from: { bin: "8", batch: "B2" }, reserved: [{ bin: "7", batch: "B1" }] }] }]);
  line1 = await info(req({ request_log: log }));
  yes("info, a dispatch made away from the reservation: the bins to count, by name", / · bins to count: A-7 \(Bolt picked from A-8 instead\); A-7 \/ BATCH-1 \(Bolt picked from A-8 \/ BATCH-2 instead\)$/.test(line1),
    line1);
  line1 = await info(req({ request_log: JSON.stringify([{ op: "CREATE" }]) }));
  yes("info, no swap: no bins to count", !/bins to count|replacement/.test(line1) && /^Transfer request for Item Assembly IA-2610-030/.test(line1), line1);
  line1 = await info(req({ request_log: "{not json" }));
  yes("info, an unreadable log: the line as before", /^Transfer request for Item Assembly IA-2610-030 · required 2026-10-30/.test(line1) && !/count/.test(line1), line1);

  // ================================================================ structure
  const t = W("iatr_receive_table");
  const cols = ((t && t.tableColumns) || []).map((c) => [c.model, c.type, c.options.disabled === true, c.options.hidden === true]);
  eq("the Receive dialog's table: item, batch and dispatched read-only; good, defect and reason the inputs", cols, [["item", "input", true, false], ["batch", "input", true, false],
    ["dispatched", "number", true, false], ["good", "number", false, false], ["defect", "number", false, false], ["reason", "select", false, false], ["line_id", "input", true, true],
    ["line_no", "input", true, true], ["batch_id", "input", true, true]]);
  const rsn = ((t && t.tableColumns) || []).find((c) => c.model === "reason") || { options: { datasource: { rules: { list: [] } }, props: {} } };
  eq("  the reason: Category Transfer Reason of the user's organisation, its text", [rsn.options.datasource.source, rsn.options.datasource.rules.list.map((x) => [x.prop, x.operator, x.value]),
    rsn.options.props.value, rsn.options.props.label], ["Category Transfer Reason:Table:2113116113794039809", [["organization_id", "equal", "{{global:firstLvDeptId}}"]], "reason", "reason"]);
  const dlg = W("iatr_receive_dialog") || { events: {}, options: {} };
  eq("  the dialog: confirm and cancel bound to their handlers", [(FULL.config.eventScript.find((e) => e.key === dlg.events.onConfirm) || {}).name,
    (FULL.config.eventScript.find((e) => e.key === dlg.events.onCancel) || {}).name, dlg.options.title], ["lotRr_onConfirm_receive", "lotRr_onCancel_receive", "Receive Transfer Request"]);
  eq("  the table: no Add Row or Delete, its own height", t && [t.options.isAdd, t.options.isDelete, t.options.rowActions, t.options.tableHeightMode, t.options.generateSubTable],
    [false, false, [], "auto", false]);
  yes("every new handler compiles", ["lotRr_onConfirm_receive", "lotRr_onCancel_receive", "lotIatr_onClick_receive"].every((nm) => {
    try {
      new Function("db", EV(nm).func);
      return true;
    } catch (e) {
      return false;
    }
  }));
  H.done("test_lot_rr");
})();
