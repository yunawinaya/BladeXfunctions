// Transfer requests from a reserved IA on the Item Assembly form (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 9): tr_main + sc_main GAP
// on the ON build.
//   mount     a Draft: nothing, no call (a Draft reserves nothing); a Created IA reads its organisation's Item Assembly Setup first - off or
//             no row: nothing, no call (D12); on: STATUS; a linked request: STATUS. In transit: a read-only notice + View; Requested: View,
//             Refresh, Cancel; received: View, Request Replacement (something missing, or its reservation ready), Report Defect
//   reload    a request just received with something missing offers the replacement; declined, the button stays (D6)
//   replace   something missing: sc_main GAP allocates it, never from the staging bin, the staging picks kept, nothing saved; the
//             reservation ready: REPLACE to the staging bin
//   defect    the dialog of the IA's picks at the staging bin (per batch); DEFECT with the quantities and one reason per line (D2)
//   node scratchpad/iasc/client/test/test_tr_reserve.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

const ON = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const IATR = "1985966508400201729";
const STG = "L1";
const SL = "S1";
const pk = (item, bin, qty, o) => Object.assign({ material_id: item, location_id: bin, storage_location_id: null, batch_id: null, balance_id: "B-" + bin, sm_quantity: qty,
  category: "Unrestricted", plant_id: F.PLANT, organization_id: F.ORG, is_deleted: 0, expired_date: null, manufacturing_date: null }, o || {});
const lines = () => [
  { id: "5001", item_selection: "C1", item_name: "SC-FRAME", quantity_uom: F.EA, requested_qty: 20, required_qty: 20, line_index: "1", total_quantity: 15,
    temp_qty_data: JSON.stringify([pk("C1", STG, 15)]), temp_hu_data: "" },
  { id: "5002", item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 40, required_qty: null, line_index: "2", total_quantity: 40,
    temp_qty_data: JSON.stringify([pk("C2", STG, 30, { batch_id: "BT1" }), pk("C2", STG, 10, { batch_id: "BT2" })]), temp_hu_data: "" },
];
const ia = (o) => F.header(Object.assign({ id: "4001", page_status: "Edit", item_assembly_status: "Created", stock_movement_no: "IA-7", stock_movement: lines(), item_qty: 2,
  transfer_request_id: "", transfer_request_no: "", tr_storage_location_id: "", tr_location_id: "", tr_required_date: "" }, o || {}));
const req = (o) => Object.assign({ id: "2114100000000000001", no: "LOT-20261030/0007", status: "Requested", rev: 1, stale: "NO", sl: SL, bin: STG }, o || {});
const statusOf = (r, o) => ({ data: { code: "200", message: "", result_json: JSON.stringify(Object.assign({ request: r, history: r ? [r] : [], setup_on: "YES", can_create: "NO",
  can_replace: "NO", staging: r && r.status === "Completed" ? { sl: SL, bin: STG } : null, gap: [], replace_ready: "NO" }, o || {})) } });
const SETUP_ON = [{ id: "9001", organization_id: F.ORG, plant_id: F.PLANT, transfer_request_enabled: 1, is_deleted: 0 }];
const SETUP_OFF = [{ id: "9001", organization_id: F.ORG, plant_id: F.PLANT, transfer_request_enabled: 0, is_deleted: 0 }];
const tables = (setup) => Object.assign(F.tables(), { item_assembly_setup: setup === undefined ? SETUP_ON : setup,
  batch: [{ id: "BT1", batch_number: "BATCH-1", is_deleted: 0 }, { id: "BT2", batch_number: "BATCH-2", is_deleted: 0 }] });
const session = (values, opt) => {
  const o = opt || {};
  const w = H.world({ db: H.tableDb(tables(o.setup)), storage: o.storage, storageThrows: o.storageThrows });
  w.so = F.so();
  const calls = [];
  const self = H.makeThis(w, ON, Object.assign({ values: H.clone(values), stateful: true, confirm: o.confirm,
    answer: (id, params) => {
      if (id !== IATR) return { data: { code: "200", message: "ok" } };
      calls.push(params);
      return o.answer ? o.answer(params) : statusOf(null, { can_create: "YES" });
    } }, o.flags || {}));
  const fire = async (op, extra) => {
    self.triggerEvent("tr_main", Object.assign({ trOp: op }, extra || {}));
    await H.drain(w);
  };
  return { w, self, calls, fire };
};
const shown = (w) => w.trace.filter((t) => /display$/.test(t[0])).reduce((a, t) => a.concat(t[1]), []);
const said = (w) => w.trace.filter((t) => /\$message\.[a-z]+$/.test(t[0])).map((t) => t[0].replace(/^.*\$message\./, "") + ": " + t[1]);
const sets = (w, k) => w.trace.filter((t) => /setData$/.test(t[0]) && t[1] && k in t[1]).map((t) => t[1][k]);
const TRB = ["tr_btn_new", "tr_btn_create", "tr_btn_view", "tr_btn_refresh", "tr_btn_cancel", "tr_btn_replace", "tr_btn_defect", "tr_section", "tr_pick"];
const trShown = (w) => shown(w).filter((m) => TRB.indexOf(m) >= 0 && m !== "tr_section");
const triggered = (w, op) => w.trace.filter((x) => /triggerEvent$/.test(x[0]) && x[1] === "sc_main" && x[2] && x[2].scOp === op).map((x) => x[2]);
const info = (w) => sets(w, "tr_info").slice(-1)[0] || "";
// the defect dialog's table: a dialog's children are addressed through it on the platform (sc_main's "sc_line_dialog.sc_line_table")
const DT = "tr_defect_dialog.tr_defect_table";
// a browser that was already offered the replacement of request 2114100000000000001 (D6: once per receipt and browser)
const offeredStore = () => ({ "iatr-offer:2114100000000000001": "1" });
// the session's today (the harness's virtual clock, the handlers' Date)
const today = (w) => {
  const d = new w.Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

(async () => {
  // ---- mount
  let s = session(ia({ item_assembly_status: "Draft" }));
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Draft" });
  check("a Draft without a request: nothing, no call (a Draft reserves nothing)", trShown(s.w).length === 0 && s.calls.length === 0, [trShown(s.w), s.calls]);
  s = session(ia(), { setup: SETUP_OFF });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("a Created IA, the setup off: no section, no call (D12)", trShown(s.w).length === 0 && s.calls.length === 0, [trShown(s.w), s.calls]);
  s = session(ia(), { setup: [] });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("a Created IA, no setup row (off): no section, no call", trShown(s.w).length === 0 && s.calls.length === 0, [trShown(s.w), s.calls]);
  s = session(ia());
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("a Created IA, the setup on: STATUS, Request Materials only", s.calls.map((p) => p.operation).join() === "STATUS" && same(trShown(s.w), ["tr_btn_new"]), [s.calls, trShown(s.w)]);
  s = session(ia(), { answer: () => statusOf(null, { can_create: "NO" }) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("  may not create (the server says): nothing", trShown(s.w).length === 0, trShown(s.w));
  const linked = (r, o, page, values, opt) => {
    const x = session(ia(Object.assign({ transfer_request_id: r.id, transfer_request_no: r.no }, values || {})), Object.assign({ answer: () => statusOf(r, o) }, opt || {}));
    return x.fire("MOUNT", { pageStatus: page || "Edit", status: (values || {}).item_assembly_status || "Created" }).then(() => x);
  };
  s = await linked(req({ status: "In Progress" }));
  check("in transit: a read-only notice and View only", same(trShown(s.w), ["tr_btn_view"]) && /^In transit \(LOT-20261030\/0007\): this Item Assembly can't be changed until/.test(info(s.w)),
    [trShown(s.w), info(s.w)]);
  s = await linked(req({ status: "Processing" }));
  check("  Processing too", /^In transit/.test(info(s.w)) && same(trShown(s.w), ["tr_btn_view"]), info(s.w));
  s = await linked(req());
  check("Requested: View, Refresh, Cancel", same(trShown(s.w).sort(), ["tr_btn_cancel", "tr_btn_refresh", "tr_btn_view"]), trShown(s.w));
  s = await linked(req({ stale: "YES" }));
  check("  stale: refresh it, said", /reservation changed since it was made: refresh it$/.test(info(s.w)), info(s.w));
  const GAP = [{ iaLineId: "5001", missing: "5" }];
  s = await linked(req({ status: "Completed" }), { gap: GAP });
  check("received, something missing: View, Request Replacement, Report Defect; said", same(trShown(s.w).sort(), ["tr_btn_defect", "tr_btn_replace", "tr_btn_view"]) &&
    /received: its materials are reserved for this Item Assembly at the staging bin\. 1 line\(s\) still need materials/.test(info(s.w)), [trShown(s.w), info(s.w)]);
  s = await linked(req({ status: "Completed" }));
  check("received, nothing missing: View and Report Defect", same(trShown(s.w).sort(), ["tr_btn_defect", "tr_btn_view"]), trShown(s.w));
  s = await linked(req({ status: "Completed" }), { replace_ready: "YES" });
  check("received, the replacement's reservation ready: Request Replacement", trShown(s.w).indexOf("tr_btn_replace") >= 0 && /request the replacement/.test(info(s.w)), [trShown(s.w), info(s.w)]);
  s = await linked(req({ status: "Completed" }), { gap: GAP }, "View");
  check("received, viewed: View only", same(trShown(s.w), ["tr_btn_view"]), trShown(s.w));
  s = await linked(req({ status: "Completed" }), { gap: GAP });
  check("received: no staging pick any more (B21 retired: Receive moved the picks)", triggered(s.w, "STAGING").length === 0, triggered(s.w, "STAGING"));

  // ---- RELOAD: the offer after a receipt (D6)
  let phase = "In Progress";
  const reloaded = (confirm) => {
    phase = "In Progress";
    const x = session(ia({ transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261030/0007" }),
      { confirm: confirm, answer: () => (phase === "In Progress" ? statusOf(req({ status: "In Progress" })) : statusOf(req({ status: "Completed" }), { gap: GAP })) });
    return x;
  };
  s = reloaded(() => "cancel");
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  phase = "Completed";
  await s.fire("RELOAD");
  const offers = (w) => w.trace.filter((t) => /\$confirm$/.test(t[0]) && t[1] === "Request a replacement");
  check("RELOAD, just received with something missing: the replacement offered", offers(s.w).length === 1, s.w.trace.filter((t) => /\$confirm$/.test(t[0])));
  check("  declined: the button stays, nothing allocated", trShown(s.w).indexOf("tr_btn_replace") >= 0 && triggered(s.w, "GAP").length === 0, [trShown(s.w), triggered(s.w, "GAP")]);
  s = reloaded();
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  phase = "Completed";
  await s.fire("RELOAD");
  check("  accepted: sc_main GAP with the missing lines and the staging bin", same(triggered(s.w, "GAP").map((g) => [g.gap, g.bin]), [[GAP, STG]]), triggered(s.w, "GAP"));
  s = session(ia({ transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261030/0007" }), { answer: () => statusOf(req({ status: "Completed" })) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("RELOAD");
  check("RELOAD, already received before, nothing missing: no offer", offers(s.w).length === 0);

  // ---- REPLACE
  s = await linked(req({ status: "Completed" }), { gap: GAP }, "Edit", {}, { storage: offeredStore() });
  s.calls.length = 0;
  await s.fire("REPLACE");
  check("Request Replacement, something missing: sc_main GAP, no call", triggered(s.w, "GAP").length === 1 && s.calls.length === 0, [triggered(s.w, "GAP"), s.calls]);
  let ops = [];
  s = session(ia({ transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261030/0007" }), { answer: (p) => {
    ops.push(p);
    return p.operation === "REPLACE" ? { data: { code: "200", message: "Replacement request LOT-20261030/0008 created.", result_json: JSON.stringify({ request: req({ id: "2114100000000000002",
      no: "LOT-20261030/0008" }), created: "YES" }) } } : statusOf(req({ status: "Completed" }), { replace_ready: "YES" });
  } });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("REPLACE");
  const rp = ops.find((p) => p.operation === "REPLACE") || {};
  check("Request Replacement, its reservation ready: REPLACE to the staging bin, dated today, with the IA as shown", rp.storage_location_id === SL && rp.location_id === STG &&
    rp.required_date === today(s.w) && /^IA1:2:[0-9a-f]{16}$/.test(rp.expected_fp || "") && /^[A-Za-z0-9|:_.-]{8,128}$/.test(rp.idempotency_key || ""), rp);
  check("  its answer said, the link moved to it, the section re-read", /Replacement request LOT-20261030\/0008 created/.test(said(s.w)[0] || "") &&
    same(sets(s.w, "transfer_request_no"), ["LOT-20261030/0008"]) && ops.slice(-1)[0].operation === "STATUS", [said(s.w), ops.map((p) => p.operation)]);

  // ---- sc_main GAP: the replacement's allocation never picks the staging bin (the fixture: C1 100 at L0, 50 at L1)
  const gapRun = async (staging, missing, values) => {
    const x = session(ia(values || {}));
    x.self.triggerEvent("sc_main", { scOp: "GAP", gap: [{ iaLineId: "5001", missing: missing }], bin: staging });
    await H.drain(x.w);
    const picks = sets(x.w, "stock_movement.0.temp_qty_data").slice(-1)[0];
    return { x: x, picks: picks === undefined ? null : JSON.parse(picks || "[]"), total: sets(x.w, "stock_movement.0.total_quantity").slice(-1)[0] };
  };
  let g = await gapRun(STG, "5");
  check("GAP: the missing 5 from L0, never the staging bin L1; the staging pick kept; total 20", g.picks && same(g.picks.map((p) => [p.location_id, p.sm_quantity]), [[STG, 15], ["L0", 5]]) &&
    g.total === 20, g.picks);
  g = await gapRun("L0", "5", { stock_movement: [Object.assign(lines()[0], { temp_qty_data: JSON.stringify([pk("C1", "L0", 15)]) }), lines()[1]] });
  check("GAP with L0 as the staging bin: from L1 only (even L0 being the default bin)", g.picks && same(g.picks.map((p) => [p.location_id, p.sm_quantity]), [["L0", 15], ["L1", 5]]), g.picks);
  g = await gapRun(STG, "200");
  check("GAP beyond the stock outside the staging bin: what there is, the shortfall said", g.picks && same(g.picks.map((p) => p.location_id), [STG, "L0"]) &&
    said(g.x.w).some((m) => /^warning: Not enough/.test(m)), [g.picks, said(g.x.w)]);
  g = await gapRun(STG, "5", { item_assembly_status: "Draft" });
  check("GAP on a Draft IA: nothing (only a Created IA replaces)", g.picks === null, g.picks);
  const st = session(ia());
  st.self.triggerEvent("sc_main", { scOp: "STAGING", bin: STG });
  await H.drain(st.w);
  check("sc_main STAGING retired: nothing picked", sets(st.w, "stock_movement.0.temp_qty_data").length === 0);

  // ---- Report Defect (D2)
  ops = [];
  const defectAnswer = (p) => {
    ops.push(p);
    return p.operation === "DEFECT" ? { data: { code: "200", message: "Defect reported: moved to Blocked at the staging bin.", result_json: JSON.stringify({ defect: "YES" }) } }
      : statusOf(req({ status: "Completed" }));
  };
  s = await linked(req({ status: "Completed" }), {}, "Edit", {}, { answer: defectAnswer });
  await s.fire("DEFECT_OPEN");
  const rows = sets(s.w, DT).slice(-1)[0] || [];
  check("Report Defect: the dialog of the IA's picks at the staging bin, per batch", same(rows.map((r) => [r.line_id, r.item, r.batch, r.at_bin, r.defect]),
    [["5001", "SC-FRAME", "", 15, 0], ["5002", "SC-SCREW", "BATCH-1", 30, 0], ["5002", "SC-SCREW", "BATCH-2", 10, 0]]) &&
    s.w.trace.some((t) => /openDialog$/.test(t[0]) && t[1] === "tr_defect_dialog"), rows);
  const withRows = async (edit) => {
    const x = await linked(req({ status: "Completed" }), {}, "Edit", {}, { answer: defectAnswer });
    await x.fire("DEFECT_OPEN");
    const r0 = H.clone(sets(x.w, DT).slice(-1)[0] || []);
    edit(r0);
    x.self.setData({ [DT]: r0 });
    x.w.trace.length = 0;
    ops = [];
    await x.fire("DEFECT");
    return x;
  };
  s = await withRows((r) => {
    r[0].defect = 2;
    r[0].reason = "Damaged";
    r[2].defect = 1;
    r[2].reason = "Wet";
  });
  const df = ops.find((p) => p.operation === "DEFECT") || {};
  check("DEFECT: per line, a batch line per batch, one reason each", same(JSON.parse(df.defects || "{}"), { 5001: { qty: "2", reason: "Damaged" }, 5002: { batches: { BT2: "1" }, reason: "Wet" } }) &&
    /^[A-Za-z0-9|:_.-]{8,128}$/.test(df.idempotency_key || "") && df.ia_id === "4001", df);
  check("  the dialog closed, the answer said, the section re-read", s.w.trace.some((t) => /closeDialog$/.test(t[0]) && t[1] === "tr_defect_dialog") &&
    /^success: Defect reported/.test(said(s.w)[0] || "") && ops.slice(-1)[0].operation === "STATUS", [said(s.w), ops.map((p) => p.operation)]);
  for (const [label, edit, re] of [
    ["a defect without a reason", (r) => (r[0].defect = 1), /reason/],
    ["more than is at the staging bin", (r) => Object.assign(r[0], { defect: 16, reason: "Damaged" }), /at most 15/],
    ["nothing entered", () => {}, /Enter/],
    ["one line's batches with two reasons", (r) => Object.assign(r[1], { defect: 1, reason: "Wet" }) && Object.assign(r[2], { defect: 1, reason: "Damaged" }), /one reason/]]) {
    s = await withRows(edit);
    check("DEFECT refused here, " + label + ": said, no call", ops.length === 0 && said(s.w).length === 1 && re.test(said(s.w)[0]), [said(s.w), ops]);
  }
  s = await linked(req({ status: "Completed" }), {}, "Edit", {}, { answer: defectAnswer });
  await s.fire("DEFECT_OPEN");
  await s.fire("DEFECT_CLOSE");
  check("the defect dialog closed without a call", s.w.trace.some((t) => /closeDialog$/.test(t[0]) && t[1] === "tr_defect_dialog") && ops.every((p) => p.operation === "STATUS"));
  s = await linked(req({ status: "Completed" }), {}, "Edit", { stock_movement: [Object.assign(lines()[0], { temp_qty_data: JSON.stringify([pk("C1", STG, 15), pk("C1", "L0", 4),
    pk("C1", STG, 3, { handling_unit_id: "HU9" })]) }), lines()[1]] }, { answer: defectAnswer });
  await s.fire("DEFECT_OPEN");
  check("Report Defect: a pick at another bin or in a handling unit is no row", same((sets(s.w, DT).slice(-1)[0] || []).map((r) => [r.line_id, r.at_bin]),
    [["5001", 15], ["5002", 30], ["5002", 10]]), sets(s.w, DT).slice(-1)[0]);
  ops = [];
  const refused = await linked(req({ status: "Completed" }), {}, "Edit", {}, { answer: (p) => {
    ops.push(p);
    return p.operation === "DEFECT" ? { data: { code: "409", message: "Its picks changed since the dialog opened: open Report Defect again.", result_json: "{}" } }
      : statusOf(req({ status: "Completed" }));
  } });
  await refused.fire("DEFECT_OPEN");
  const r1 = H.clone(sets(refused.w, DT).slice(-1)[0] || []);
  Object.assign(r1[0], { defect: 1, reason: "Damaged" });
  refused.self.setData({ [DT]: r1 });
  refused.w.trace.length = 0;
  ops = [];
  await refused.fire("DEFECT");
  check("DEFECT refused by the server: its reason said, the dialog left open, nothing re-read", /^error: Its picks changed/.test(said(refused.w)[0] || "") &&
    !refused.w.trace.some((t) => /closeDialog$/.test(t[0])) && ops.map((p) => p.operation).join() === "DEFECT", [said(refused.w), ops.map((p) => p.operation)]);

  // the setup unreadable: as off (no section, no call)
  const down = H.world({ db: H.tableDb(tables()), dbThrows: (name) => name === "item_assembly_setup" });
  const downCalls = [];
  const downSelf = H.makeThis(down, ON, { values: H.clone(ia()), stateful: true, answer: (id, params) => {
    if (id === IATR) downCalls.push(params);
    return statusOf(null, { can_create: "YES" });
  } });
  downSelf.triggerEvent("tr_main", { trOp: "MOUNT", pageStatus: "Edit", status: "Created" });
  await H.drain(down);
  check("mount, the setup unreadable: as off - no section, no call", trShown(down).length === 0 && downCalls.length === 0, [trShown(down), downCalls]);
  // RELOAD offers only for a request just received, on an editable Created IA
  s = session(ia({ transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261030/0007" }), { storage: offeredStore(),
    answer: () => statusOf(req({ status: "Completed" }), { gap: GAP }) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("RELOAD");
  check("RELOAD, received before with something missing: no offer again (the button is there)", offers(s.w).length === 0 && trShown(s.w).indexOf("tr_btn_replace") >= 0);
  phase = "In Progress";
  s = session(ia({ page_status: "View", transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261030/0007" }),
    { answer: () => (phase === "In Progress" ? statusOf(req({ status: "In Progress" })) : statusOf(req({ status: "Completed" }), { gap: GAP })) });
  await s.fire("MOUNT", { pageStatus: "View", status: "Created" });
  phase = "Completed";
  await s.fire("RELOAD");
  check("RELOAD on a viewed IA, just received with something missing: no offer", offers(s.w).length === 0);
  phase = "In Progress";
  s = session(ia({ item_assembly_status: "Draft", transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261030/0007" }),
    { answer: () => (phase === "In Progress" ? statusOf(req({ status: "In Progress" })) : statusOf(req({ status: "Completed" }), { gap: GAP })) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Draft" });
  phase = "Completed";
  await s.fire("RELOAD");
  check("RELOAD on an IA saved as Draft, just received with something missing: no offer (only a Created IA replaces)", offers(s.w).length === 0);
  s = await linked(req({ status: "Completed" }));
  s.calls.length = 0;
  await s.fire("REPLACE");
  check("REPLACE with nothing missing and nothing reserved for a replacement: no call, no allocation", s.calls.length === 0 && triggered(s.w, "GAP").length === 0, s.calls);
  // the offer at the next open (D6: "a Receive done from the Location Transfer list shows the offer the next time the IA is opened"),
  // once per receipt and browser; right after a Receive (RELOAD) it is remembered too
  let store = {};
  s = await linked(req({ status: "Completed" }), { gap: GAP }, "Edit", {}, { storage: store, confirm: () => "cancel" });
  check("mount, received with something missing, not yet offered in this browser: the replacement offered", offers(s.w).length === 1 && triggered(s.w, "GAP").length === 0 &&
    store["iatr-offer:2114100000000000001"] === "1", [offers(s.w), store]);
  s = await linked(req({ status: "Completed" }), { gap: GAP }, "Edit", {}, { storage: store });
  check("  the next open: not again (the button is there)", offers(s.w).length === 0 && trShown(s.w).indexOf("tr_btn_replace") >= 0);
  s = await linked(req({ status: "Completed" }), { gap: GAP }, "Edit", {}, { storage: {} });
  check("  accepted: sc_main GAP with the missing lines and the staging bin", same(triggered(s.w, "GAP").map((x) => [x.gap, x.bin]), [[GAP, STG]]), triggered(s.w, "GAP"));
  for (const [label, r, o, page, values] of [["viewed", req({ status: "Completed" }), { gap: GAP }, "View", {}], ["on an IA saved as Draft", req({ status: "Completed" }), { gap: GAP }, "Edit",
    { item_assembly_status: "Draft" }], ["with nothing missing", req({ status: "Completed" }), {}, "Edit", {}], ["in transit", req({ status: "In Progress" }), { gap: GAP }, "Edit", {}]]) {
    s = await linked(r, o, page, values, { storage: {} });
    check("mount, " + label + ": no offer", offers(s.w).length === 0, offers(s.w));
  }
  s = await linked(req({ status: "Completed" }), { gap: GAP }, "Edit", {}, { storageThrows: true });
  check("mount, the browser's storage unreadable: no offer at open (it could not be remembered)", offers(s.w).length === 0);
  store = {};
  phase = "In Progress";
  s = session(ia({ transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261030/0007" }), { storage: store, confirm: () => "cancel",
    answer: () => (phase === "In Progress" ? statusOf(req({ status: "In Progress" })) : statusOf(req({ status: "Completed" }), { gap: GAP })) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  phase = "Completed";
  await s.fire("RELOAD");
  s = await linked(req({ status: "Completed" }), { gap: GAP }, "Edit", {}, { storage: store });
  check("the offer right after a Receive remembered: the next open does not offer again", store["iatr-offer:2114100000000000001"] === "1" && offers(s.w).length === 0, store);
  // the list of the IA's requests (the design's IA form row): every request, newest first, once there is more than one
  const replacement = req({ id: "2114100000000000002", no: "LOT-20261030/0008", status: "In Progress" });
  s = await linked(replacement, { history: [replacement, req({ status: "Completed" }), req({ id: "2114100000000000000", no: "LOT-20261030/0006", status: "Cancelled" })] });
  check("the requests listed, newest first, after the open one's line", info(s.w) === "In transit (LOT-20261030/0008): this Item Assembly can't be changed until the request is received." +
    " · Requests: LOT-20261030/0008 (In Progress), LOT-20261030/0007 (Completed), LOT-20261030/0006 (Cancelled)", info(s.w));
  s = await linked(req({ status: "Completed" }));
  check("  one request only: no list", !/Requests:/.test(info(s.w)), info(s.w));
  H.done("test_tr_reserve");
})();
