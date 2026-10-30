// The Location Transfer form's request behaviour (scratchpad/iatr/lot_client/patch_lot_ui.py phase full) on top of the fields build
// (= the published dev v114):
//   structure  full minus its 7 widgets and 4 events, every patched handler undone (mounted, the 3 V2 saves, Apply Target Location)
//              == fields, widget for widget; every changed / new script compiles; the buttons' wiring and permissions
//   behaviour  the handlers run on a mock form (scratchpad/smv2/client/check_fallthrough.js's way): a request's Save Picks -> the
//              classic; Dispatch / Receive -> SUBMIT at any size, a NOT_ELIGIBLE answer said (never the classic); ordinary saves as
//              before; the Dispatch / Receive / Cancel / View handlers; Apply Target refused for a request; mounted shows a request's
//              badge, info, buttons and locks, and an ordinary transfer's exactly as before
//   node scratchpad/iatr/test/test_lot_ui_full.js   (IATR_UI_PATCHER=<copy of patch_lot_ui.py> tests another patcher: mutants_lot_ui.js)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IATR = path.join(__dirname, "..");

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1200) + "\n  want " + JSON.stringify(want).slice(0, 1200));
};
const yes = (label, v) => eq(label, !!v, true);
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);

// IATR_UI_PATCHER: another copy of the patcher (mutants_lot_ui.js): its build AND its patch texts are the ones tested
const PATCHER = process.env.IATR_UI_PATCHER || path.join(IATR, "lot_client", "patch_lot_ui.py");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-uif-"));
const b = spawnSync("python3", [PATCHER, "--write"], { env: Object.assign({}, process.env, { IATR_UI_OUT: dir }), encoding: "utf8" });
if (b.status !== 0) throw new Error(b.stderr.slice(-800));
const FIELDS = JSON.parse(fs.readFileSync(path.join(dir, "fields", "LOTform.json"), "utf8"));
const FULL = JSON.parse(fs.readFileSync(path.join(dir, "full", "LOTform.json"), "utf8"));
const P = JSON.parse(spawnSync("python3", [PATCHER, "--patches"], { encoding: "utf8" }).stdout);
const SUBMIT = "2110992282596540417";
const IATR_WF = P.iatr_wf;
const NEW = ["requested_status", "iatr_info", "button_view_ia", "button_save_picks", "button_dispatch", "button_cancel_request", "button_receive", "iatr_link", "iatr_ia_no"];
const NEW_EVENTS = ["lotIatr_onClick_dispatch", "lotIatr_onClick_receive", "lotIatr_onClick_cancelRequest", "lotIatr_onClick_viewIa"];
const all = (doc) => {
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      if (typeof x.model === "string" && x.type) out.push(x);
      Object.values(x).forEach(walk);
    }
  };
  walk(doc.list);
  return out;
};
const W = (doc, m) => all(doc).filter((w) => w.model === m)[0];
const EV = (doc, name) => doc.config.eventScript.filter((e) => e.name === name)[0];
const byKey = (doc, k) => doc.config.eventScript.filter((e) => e.key === k)[0];
// the reserved-request layer (patch_lot_ui.py rr_behaviour, Task 10; test_lot_rr.js tests what it does) peeled off: its widgets and
// events gone, its text pairs and the Receive handler undone - what is left is the v7 request behaviour these checks are about
const unrr = (doc) => {
  const d = JSON.parse(JSON.stringify(doc));
  const cut = (x) => {
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) if (x[i] && typeof x[i] === "object" && P.rr.widgets.indexOf(x[i].model) >= 0 && x[i].type) x.splice(i, 1);
      x.forEach(cut);
    } else if (x && typeof x === "object") Object.values(x).forEach(cut);
  };
  cut(d.list);
  d.config.eventScript = d.config.eventScript.filter((e) => P.rr.events.indexOf(e.name) < 0);
  const back = (f, pairs, where) => pairs.reduce((g, [o, nw]) => {
    eq("unrr " + where + ": its change once (" + o.slice(0, 40).replace(/\n/g, " ") + ")", g.split(nw).length - 1, 1);
    return g.replace(nw, o);
  }, f);
  EV(d, "mounted").func = back(EV(d, "mounted").func, P.rr.mounted.slice().reverse(), "mounted");
  for (const nm of P.v2_handlers) EV(d, nm).func = back(EV(d, nm).func, P.rr.v2.slice().reverse(), nm);
  const js = EV(d, "onClick_select_stock").rules.filter((r) => r.action === "js")[0];
  js.options.func = back(js.options.func, P.rr.pick, "onClick_select_stock");
  eq("unrr: the Receive handler is the v8 one", EV(d, "lotIatr_onClick_receive").func, P.rr.receive[1]);
  EV(d, "lotIatr_onClick_receive").func = P.rr.receive[0];
  return d;
};
const V7 = unrr(FULL);

// ================================================================ structure
{
  const u = JSON.parse(JSON.stringify(V7));
  const drop = (x) => {
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) if (x[i] && typeof x[i] === "object" && NEW.indexOf(x[i].model) >= 0 && x[i].type) x.splice(i, 1);
      x.forEach(drop);
    } else if (x && typeof x === "object") Object.values(x).forEach(drop);
  };
  drop(u.list);
  u.config.eventScript = u.config.eventScript.filter((e) => NEW_EVENTS.indexOf(e.name) < 0);
  const undo = (func, pairs, where) => pairs.reduce((f, [o, nw]) => {
    eq("undo " + where + ": its change once (" + o.slice(0, 50).replace(/\n/g, " ") + ")", f.split(nw).length - 1, 1);
    return f.replace(nw, o);
  }, func);
  const um = EV(u, "mounted");
  um.func = undo(um.func, P.mounted, "mounted");
  for (const nm of P.v2_handlers) EV(u, nm).func = undo(EV(u, nm).func, P.v2, nm);
  const ap = EV(u, "onTableSmfunc_applyTargetLocation");
  const i = ap.func.indexOf(P.apply_head);
  yes("Apply Target: its guard once", i >= 0 && ap.func.split(P.apply_head).length === 2 && ap.func.endsWith("\n}"));
  ap.func = ap.func.slice(0, i) + ap.func.slice(i + P.apply_head.length, -2).split("\n").map((l) => (l.startsWith("  ") ? l.slice(2) : l)).join("\n");
  eq("full minus the request behaviour == fields (= dev v114): widgets", JSON.stringify(canon(u.list)) === JSON.stringify(canon(FIELDS.list)), true);
  eq("full minus the request behaviour == fields (= dev v114): events and config", JSON.stringify(canon(u.config)) === JSON.stringify(canon(FIELDS.config)), true);
}
for (const e of FULL.config.eventScript.filter((x) => NEW_EVENTS.concat(P.v2_handlers, ["mounted", "onTableSmfunc_applyTargetLocation"]).indexOf(x.name) >= 0)) {
  let ok = true;
  try {
    new Function("console", e.func);
  } catch (err) {
    ok = false;
  }
  yes("compiles: " + e.name, ok);
  yes("no build token left: " + e.name, !/__[A-Z_]+__/.test(e.func));
}
eq("the 4 new events, then the reserved-request layer's 2, at the end, js", FULL.config.eventScript.slice(-6).map((e) => [e.name, e.type]), NEW_EVENTS.concat(P.rr.events).map((x) => [x, "js"]));
const btn = (m) => {
  const w = W(FULL, m);
  return [w.options.hidden, w.options.buttonName, w.options.permission || null, (byKey(FULL, w.events.onClick) || {}).name];
};
eq("Save Picks: hidden, no permission (as Save as Draft), the Draft save", btn("button_save_picks"), [true, "Save Picks", null, "lotV2_onClick_save_draft"]);
eq("Dispatch: hidden, lot_ia_dispatch, its confirm", btn("button_dispatch"), [true, "Dispatch", "lot_ia_dispatch", "lotIatr_onClick_dispatch"]);
eq("Cancel Request: hidden, ia_create_transfer_request", btn("button_cancel_request"), [true, "Cancel Request", "ia_create_transfer_request", "lotIatr_onClick_cancelRequest"]);
eq("Receive: hidden, lot_ia_receive, its confirm", btn("button_receive"), [true, "Receive", "lot_ia_receive", "lotIatr_onClick_receive"]);
eq("View Item Assembly: hidden, its handler", btn("button_view_ia"), [true, "View Item Assembly", null, "lotIatr_onClick_viewIa"]);
eq("the request buttons after the save buttons in the action bar", all({ list: [W(FULL, "flex_t6y2yh5r")] }).map((w) => w.model).slice(1),
  ["button_save_as_draft", "button_inprogress", "button_completed", "button_save_picks", "button_dispatch", "button_cancel_request", "button_receive"]);
eq("the info line: UI only, hidden; the badge: hidden, cyan, Requested", [W(FULL, "iatr_info").options.dataBind, W(FULL, "iatr_info").options.hidden, W(FULL, "requested_status").options.hidden,
  /Requested<\/div>/.test(W(FULL, "requested_status").options.defaultValue), /#0891B2/.test(W(FULL, "requested_status").options.defaultValue)], [false, true, true, true, true]);
eq("the badge next to the others in the title row", W(FULL, "flex_2det1nd2").list.map((w) => w.model).indexOf("requested_status") ===
  W(FULL, "flex_2det1nd2").list.map((w) => w.model).indexOf("lot_processing_status") + 1, true);
const top = FULL.list.map((w) => w.model);
// the user, 10-29: a request shows its Item Assembly as a production order's transfer shows its order - the link and the number, where
// Production Order sits (that pair is never shown any more)
const col = all({ list: [W(FULL, "grid_x46134mc")] }).map((w) => w.model);
eq("Link to Item Assembly + Item Assembly No right after Production Order No in the header grid", col.slice(col.indexOf("production_order_id"), col.indexOf("production_order_id") + 3),
  ["production_order_id", "iatr_link", "iatr_ia_no"]);
eq("  both UI only, hidden, no event; a switch and a text", ["iatr_link", "iatr_ia_no"].map((m) => [W(FULL, m).type, W(FULL, m).name, W(FULL, m).options.dataBind, W(FULL, m).options.hidden,
  Object.values(W(FULL, m).events || {}).filter((x) => x).length]), [["switch", "Link to Item Assembly", false, true, 0], ["input", "Item Assembly No", false, true, 0]]);
eq("the info line + View right after the header grid", top.slice(top.indexOf("grid_x46134mc"), top.indexOf("grid_x46134mc") + 3), ["grid_x46134mc", "iatr_info", "button_view_ia"]);
for (const nm of P.v2_handlers) {
  const f = EV(FULL, nm).func;
  yes(nm + ": the request buttons in SAVE_BUTTONS, the UI models in NOT_RECORD", /const SAVE_BUTTONS = \[[^\]]*"button_save_picks", "button_dispatch", "button_cancel_request", "button_receive"\]/.test(f)
    && /"requested_status", "iatr_info", "button_view_ia", "iatr_link", "iatr_ia_no", "iatr_receive_dialog"\]\.concat\(SAVE_BUTTONS\)/.test(f));
}

// ================================================================ behaviour: the handlers on a mock form
const quiet = { log: () => {}, error: () => {} };
const wait = async () => {
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
};
const fakeDoc = { querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {} }), head: { appendChild() {} } };
const runFunc = async (func, values, opt) => {
  const o = opt || {};
  const log = { triggered: [], runs: [], messages: [], closed: 0, display: [], hide: [], disabled: [], setData: [], views: [], dialogs: [], confirms: 0, refreshed: 0, parentEvents: [] };
  const timers = [];
  const form = {
    models: { _data: {} },
    isAdd: o.page === "Add", isEdit: o.page === "Edit", isView: o.page === "View", isCopy: o.page === "Clone",
    getValues: () => JSON.parse(JSON.stringify(values)),
    getValue: (k) => values[k],
    getVarGlobal: () => "1123598813738675201",
    getVarSystem: () => "1123598813738675201",
    showLoading() {}, hideLoading() {},
    display: (x) => log.display.push(...[].concat(x)),
    hide: (x) => log.hide.push(...[].concat(x)),
    disabled: (x, v) => log.disabled.push([[].concat(x), v]),
    setData: (x) => log.setData.push(x),
    triggerEvent: (nm) => {
      log.triggered.push(nm);
      return Promise.resolve();
    },
    runWorkflow: (id, params, ok) => {
      log.runs.push([id, params]);
      setImmediate(() => ok({ data: (o.answer && o.answer(id, params)) || { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", lot_id: values.id, lot_no: "LOT-1" } }));
    },
    $message: ["success", "error", "warning", "info"].reduce((m, k) => Object.assign(m, { [k]: (x) => log.messages.push(k + ": " + x) }), {}),
    $alert: () => Promise.resolve(),
    $confirm: () => {
      log.confirms++;
      return o.decline ? Promise.reject(new Error("cancel")) : Promise.resolve();
    },
    toView: (v) => log.views.push(v),
    openDialog: (d) => log.dialogs.push(d),
    onDropdownVisible: () => Promise.resolve(null),
    getComponent: () => ({ options: {} }), getOptionData: () => [], setOptionData() {},
    // the opener: the Location Transfer list (o.fromIa: the Item Assembly form, View Transfer Request)
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.closed++ } }, refresh: () => log.refreshed++,
      models: o.fromIa ? { _data: {}, item_assembly_status: "Draft", transfer_request_id: values.id } : { _data: {} },
      triggerEvent: (nm, args) => log.parentEvents.push([nm, args]) },
  };
  const fn = new Function("console", "setTimeout", "document", "localStorage", "return function () {\n" + func + "\n};")(quiet,
    o.fastTimers ? (f) => setImmediate(f) : (f, ms) => timers.push([f, ms]), fakeDoc,
    { getItem: () => null, setItem() {} });
  fn.call(form, { field: "x", $eventArgs: [] });
  await wait();
  log.timers = timers;
  return log;
};
const line = (i, o) => Object.assign({ id: "60" + i, item_selection: "M" + i, line_index: String(i + 1), location_id: "9", storage_location_id: "S9", requested_qty: 2, source_ia_line_id: "IAL" + i,
  temp_qty_data: JSON.stringify([{ material_id: "M" + i, location_id: "8", sm_quantity: 2, category: "Unrestricted", material_uom: "77" }]), temp_hu_data: "[]" }, o || {});
const req = (o) => Object.assign({ page_status: "Edit", id: "2114100000000000001", stock_movement_no: "LOT-20261028/0007", stock_movement_status: "Requested", transfer_purpose: "IA_SUPPLY",
  source_ia_id: "2113088440365826050", source_ia_no: "IA-2610-030", organization_id: "1123598813738675201", issue_date: "2026-10-30 00:00:00", required_date: "2026-10-30 00:00:00",
  requested_by: "Production Planner", requested_at: "2026-10-28 12:00:00", source_ia_rev: "1", lot_v2_job_id: "", stock_movement: [line(0), line(1), line(2)] }, o || {});
const plain = (o) => req(Object.assign({ transfer_purpose: "", source_ia_id: "", stock_movement_status: "Draft", stock_movement: [line(0, { source_ia_line_id: "" })] }, o || {}));
const save = (nm) => EV(FULL, nm).func;

(async () => {
  let r = await runFunc(save("lotV2_onClick_save_draft"), req());
  eq("Save Picks on a request: the classic Draft save, no SUBMIT", [r.triggered, r.runs.length], [["onClick_draft"], 0]);
  r = await runFunc(save("lotV2_onClick_save_inprogress"), req());
  const subs = (x) => x.runs.filter((q) => q[0] === SUBMIT);
  eq("Dispatch of a 3-line request: SUBMIT (whatever the size), never the classic", [r.triggered, subs(r).length], [[], 1]);
  eq("  queued: the form closes, the save goes on in the background (a STAGE, not an edit that stays to follow)", [r.closed, r.messages.filter((x) => /being saved in the background/.test(x)).length],
    [1, 1]);
  eq("  as In Progress, the stored request", [r.runs[0][1].saveAs, r.runs[0][1].pageStatus, r.runs[0][1].lot_id, r.runs[0][1].form.transfer_purpose], ["In Progress", "Edit", "2114100000000000001", "IA_SUPPLY"]);
  eq("  the record without the UI models", ["requested_status", "iatr_info", "button_view_ia", "button_dispatch"].filter((k) => k in r.runs[0][1].form), []);
  r = await runFunc(save("lotV2_onClick_save_inprogress"), req(Object.assign({ requested_status: "<html/>", iatr_info: "x", button_dispatch: "" })));
  eq("  UI models given by the form are dropped", ["requested_status", "iatr_info", "button_dispatch"].filter((k) => k in r.runs[0][1].form), []);
  r = await runFunc(save("lotV2_onClick_save_inprogress"), req(), { answer: () => ({ route: "NOT_ELIGIBLE", code: "300", reason: "it has handling units" }) });
  eq("a request answered NOT_ELIGIBLE: said, never the classic", [r.triggered, r.messages], [[], ["error: This transfer request can't be saved: it has handling units."]]);
  r = await runFunc(save("lotV2_onClick_save_inprogress"), req(), { answer: () => ({ route: "STOP", code: "400", message: "Line 2 (Bolt): picked 1.5 of 2." }) });
  eq("a request refused: the server's reason", [r.triggered, r.messages], [[], ["error: Line 2 (Bolt): picked 1.5 of 2."]]);
  r = await runFunc(save("lotV2_onClick_save_completed"), req({ stock_movement_status: "In Progress" }));
  eq("Receive of a 3-line request: SUBMIT as Completed", [r.triggered, r.runs.length && r.runs[0][1].saveAs], [[], "Completed"]);
  // the user, 10-29: a receipt finished while the form waited - "saved." once (kickLoop said it again), and opened from its Item
  // Assembly the IA form is not refreshed (a refresh re-initialises it without its mounted: badge, buttons, sections gone)
  const WORKER = "2110992316335521793";
  const done = (id, params) => (id === SUBMIT && params.operation === "STATUS" ? { route: "STATUS", job_id: "J1", job_status: "COMPLETED", terminal: "YES" }
    : id === WORKER ? { job_id: "J1", job_status: "COMPLETED" } : { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", lot_id: "2114100000000000001", lot_no: "LOT-1" });
  const ip = () => req({ stock_movement_status: "In Progress" });
  const settle = async () => {
    for (let i = 0; i < 40; i++) await new Promise((res) => setImmediate(res));
  };
  r = await runFunc(save("lotV2_onClick_save_completed"), ip(), { answer: done, fastTimers: true });
  await settle();
  eq("Receive finished while the form waited: one 'saved.' toast, the form closed once, no worker call after it", [r.messages.filter((x) => /saved\.$/.test(x)).length,
    r.closed, r.runs.filter((q) => q[0] === WORKER).length], [1, 1, 1]);
  eq("  opened from the list: the list refreshed", [r.refreshed > 0, r.parentEvents], [true, []]);
  r = await runFunc(save("lotV2_onClick_save_completed"), ip(), { answer: done, fastTimers: true, fromIa: true });
  await settle();
  eq("  opened from its Item Assembly: the IA form not refreshed, its request section redrawn instead", [r.refreshed, r.parentEvents, r.closed],
    [0, [["tr_main", { trOp: "RELOAD" }]], 1]);
  r = await runFunc(save("lotV2_onClick_save_inprogress"), req({ stock_movement_status: "In Progress" }));
  eq("an edit of a dispatched request: to SUBMIT (it refuses with its reason)", [r.triggered, subs(r).length], [[], 1]);
  r = await runFunc(save("lotV2_onClick_save_completed"), req());
  eq("Completed on a Requested request: to SUBMIT (it refuses), never the classic", [r.triggered, subs(r).length], [[], 1]);
  r = await runFunc(save("lotV2_onClick_save_inprogress"), plain());
  eq("an ordinary 1-line Draft saved In Progress: the classic, as before", [r.triggered, r.runs.length], [["onClick_inProgress"], 0]);
  r = await runFunc(save("lotV2_onClick_save_inprogress"), plain({ stock_movement: Array.from({ length: 51 }, (_, i) => line(i, { source_ia_line_id: "" })) }),
    { answer: () => ({ route: "NOT_ELIGIBLE", code: "300", reason: "x" }) });
  eq("an ordinary 51-line transfer answered NOT_ELIGIBLE: the classic, as before", [r.triggered, subs(r).length], [["onClick_inProgress"], 1]);
  r = await runFunc(save("lotV2_onClick_save_draft"), plain({ page_status: "Add", id: "" }));
  eq("an ordinary Add Draft, 1 line: the classic, as before", r.triggered, ["onClick_draft"]);

  r = await runFunc(EV(FULL, "lotIatr_onClick_dispatch").func, req());
  eq("Dispatch: confirmed -> the In Progress save", [r.confirms, r.triggered], [1, ["lotV2_onClick_save_inprogress"]]);
  r = await runFunc(EV(FULL, "lotIatr_onClick_dispatch").func, req(), { decline: true });
  eq("Dispatch: not confirmed -> nothing", r.triggered, []);
  // (v118's Receive: a request of a Draft Item Assembly still runs it - test_lot_rr.js)
  r = await runFunc(EV(V7, "lotIatr_onClick_receive").func, req({ stock_movement_status: "In Progress" }));
  eq("Receive (v118): confirmed -> the Completed save", r.triggered, ["lotV2_onClick_save_completed"]);
  r = await runFunc(EV(FULL, "lotIatr_onClick_cancelRequest").func, req(), { answer: () => ({ code: "200", message: "Transfer request LOT-20261028/0007 cancelled." }) });
  const cp = (r.runs[0] || [])[1] || {};
  eq("Cancel Request: IA_TRANSFER_REQUEST CANCEL for this request", [r.runs.length, r.runs[0] && r.runs[0][0], cp.operation, cp.ia_id, cp.lot_id, cp.organization_id,
    /^[A-Za-z0-9|:_.-]{8,128}$/.test(cp.idempotency_key || "")], [1, IATR_WF, "CANCEL", "2113088440365826050", "2114100000000000001", "1123598813738675201", true]);
  eq("  its answer said, the form closed", [r.messages, r.closed], [["success: Transfer request LOT-20261028/0007 cancelled."], 1]);
  r = await runFunc(EV(FULL, "lotIatr_onClick_cancelRequest").func, req(), { answer: () => ({ code: "400", message: "Only a Requested transfer request can be cancelled here." }) });
  eq("Cancel Request refused: said, the form stays", [r.messages, r.closed], [["error: Only a Requested transfer request can be cancelled here."], 0]);
  r = await runFunc(EV(FULL, "lotIatr_onClick_cancelRequest").func, req(), { decline: true });
  eq("Cancel Request not confirmed: no call", r.runs.length, 0);
  r = await runFunc(EV(FULL, "lotIatr_onClick_viewIa").func, req());
  eq("View Item Assembly: the IA form, read-only, this request's IA, on the right (rtl: the user 10-28)", r.views.map((v) => [v.target, v.type, v.data.id, v.viewMode, v.position]),
    [["2098256587713404929", "view", "2113088440365826050", "disabled", "rtl"]]);
  r = await runFunc(EV(FULL, "lotIatr_onClick_viewIa").func, plain());
  eq("View Item Assembly with no source IA: nothing", r.views.length, 0);
  r = await runFunc(EV(FULL, "onTableSmfunc_applyTargetLocation").func, req());
  eq("Apply Target Location on a request: refused, no dialog", [r.dialogs, r.messages.length, /Item Assembly/.test(r.messages[0] || "")], [[], 1, true]);
  r = await runFunc(EV(FULL, "onTableSmfunc_applyTargetLocation").func, plain());
  eq("Apply Target Location on an ordinary transfer: the dialog, as before", [r.dialogs, r.messages], [["dialog_apply_location"], []]);

  const mount = (v, page) => runFunc(EV(FULL, "mounted").func, v, { page: page || "Edit" });
  const mountBase = (v, page) => runFunc(EV(FIELDS, "mounted").func, v, { page: page || "Edit" });
  r = await mount(req());
  const SAVE3 = ["button_save_as_draft", "button_inprogress", "button_completed"];
  eq("mounted, a Requested request: the badge, its 3 buttons, its info + View, Requested Qty", ["requested_status", "button_save_picks", "button_dispatch", "button_cancel_request", "iatr_info",
    "button_view_ia", "stock_movement.requested_qty"].filter((x) => r.display.indexOf(x) < 0), []);
  eq("  none of the ordinary save buttons, not Receive", SAVE3.concat(["button_receive"]).filter((x) => r.display.indexOf(x) >= 0), []);
  eq("  its info line", r.setData.filter((x) => "iatr_info" in x).map((x) => x.iatr_info),
    ["Transfer request for Item Assembly IA-2610-030 · required 2026-10-30 · requested by Production Planner on 2026-10-28 12:00"]);
  eq("  item / bin / storage locked", r.disabled.filter((d) => d[0].indexOf("stock_movement.location_id") >= 0 && d[0].indexOf("stock_movement.item_selection") >= 0 && d[1] === true).length, 1);
  yes("  the row actions hidden (a timer)", r.timers.some(([f, ms]) => ms === 500 && /lot-hide-row-actions/.test(String(f))));
  eq("  Link to Item Assembly on, its Item Assembly No, both shown and locked", [r.setData.filter((x) => "iatr_link" in x).map((x) => [x.iatr_link, x.iatr_ia_no]),
    ["iatr_link", "iatr_ia_no"].filter((x) => r.display.indexOf(x) < 0), r.disabled.filter((d) => d[0].indexOf("iatr_link") >= 0 && d[0].indexOf("iatr_ia_no") >= 0 && d[1] === true).length],
  [[[1, "IA-2610-030"]], [], 1]);
  eq("  Production Order never shown", ["is_production_order", "production_order_id"].filter((x) => r.display.indexOf(x) >= 0), []);
  r = await mount(req({ stock_movement_status: "In Progress" }));
  eq("mounted, a dispatched request: Receive only", ["button_receive"].concat(SAVE3, ["button_save_picks", "button_dispatch", "button_cancel_request"]).filter((x) => r.display.indexOf(x) >= 0),
    ["button_receive"]);
  const failed = () => ({ route: "STATUS", job_id: "777", job_status: "FAILED", error_message: "Line 2 (Bolt): picked 1.5 of 2." });
  r = await runFunc(EV(FULL, "mounted").func, req({ lot_v2_job_id: "777" }), { page: "Edit", answer: failed });
  eq("mounted, a request whose dispatch failed: told why", r.messages.filter((x) => /last background save failed - Line 2 \(Bolt\)/.test(x)).length, 1);
  r = await runFunc(EV(FIELDS, "mounted").func, req({ lot_v2_job_id: "777" }), { page: "Edit", answer: failed });
  eq("  (v114 did not tell it for Requested)", r.messages.filter((x) => /last background save failed/.test(x)).length, 0);
  r = await mount(req({ source_ia_rev: "3" }));
  yes("mounted: a refreshed request shows its revision", r.setData.some((x) => /revision 3$/.test(x.iatr_info || "")));
  r = await mount(req(), "View");
  eq("mounted, a request viewed: its info, no buttons", [r.display.indexOf("iatr_info") >= 0, ["button_save_picks", "button_dispatch", "button_receive"].filter((x) => r.display.indexOf(x) >= 0)],
    [true, []]);
  for (const [label, v, page] of [["an ordinary Draft", plain(), "Edit"], ["an ordinary In Progress", plain({ stock_movement_status: "In Progress" }), "Edit"],
    ["an ordinary Completed", plain({ stock_movement_status: "Completed" }), "View"], ["a new transfer", plain({ page_status: "Add", id: "", stock_movement_status: "" }), "Add"]]) {
    const a = await mount(v, page);
    const z = await mountBase(v, page);
    // the one intended difference: the request's buttons are hidden with the save buttons
    const strip = (x) => JSON.parse(JSON.stringify({ display: x.display, hide: x.hide.filter((h) => NEW.indexOf(h) < 0), disabled: x.disabled, setData: x.setData,
      triggered: x.triggered, messages: x.messages }));
    // the user, 10-29: the Production Order switch is never shown (v114 showed it, off, on every Add / Edit)
    const zz = strip(z);
    zz.display = zz.display.filter((d) => d !== "is_production_order");
    eq("mounted, " + label + ": every call as v114's but the Production Order switch", strip(a), zz);
    eq("mounted, " + label + ": no Production Order, no Item Assembly link", ["is_production_order", "production_order_id", "iatr_link", "iatr_ia_no"].filter((x) => a.display.indexOf(x) >= 0), []);
  }

  // reserved requests (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 3): four new fields, hidden and data-bound with no event, in
  // both builds; the full build minus them is the live dev v118, so no existing widget or key moved
  const RR = ["replacement_for_id", "defect_reason", "defect_qty", "defect_detail"];
  const V118 = JSON.parse(fs.readFileSync(path.join(IATR, "base", "rr_sm_location_transfer_v118.json"), "utf8"));
  const rrOf = (doc) => {
    const got = [];
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (!o || typeof o !== "object") return;
      if (RR.indexOf(o.model) >= 0 && o.type) got.push(o);
      Object.keys(o).forEach((k) => walk(o[k]));
    };
    walk(doc.list);
    return got;
  };
  const strip = (doc) => {
    const d = JSON.parse(JSON.stringify(doc));
    const cut = (o) => {
      if (Array.isArray(o)) {
        for (let i = o.length - 1; i >= 0; i--) {
          if (o[i] && typeof o[i] === "object" && RR.indexOf(o[i].model) >= 0 && o[i].type) o.splice(i, 1);
          else cut(o[i]);
        }
      } else if (o && typeof o === "object") Object.keys(o).forEach((k) => cut(o[k]));
    };
    cut(d.list);
    return d;
  };
  eq("fields (RR): full minus the four new and the reserved-request layer == the live v118", JSON.stringify(canon(strip(V7))) === JSON.stringify(canon(V118)), true);
  // B22 publishes the rrfields build: the live v118 + the four fields, the reserved-request layer not yet (it goes with B27)
  const RRF = JSON.parse(fs.readFileSync(path.join(dir, "rrfields", "LOTform.json"), "utf8"));
  eq("rrfields (B22) == full minus the reserved-request layer; minus its four fields == the live v118", [JSON.stringify(canon(RRF)) === JSON.stringify(canon(V7)),
    JSON.stringify(canon(strip(RRF))) === JSON.stringify(canon(V118))], [true, true]);
  eq("fields (RR): four new in the full build, hidden, data-bound, no event bound",
    rrOf(FULL).map((w) => [w.model, w.options.hidden === true, w.options.dataBind === true, Object.values(w.events || {}).every((v) => v === "")]).sort(),
    [["defect_detail", true, true, true], ["defect_qty", true, true, true], ["defect_reason", true, true, true], ["replacement_for_id", true, true, true]]);
  eq("fields (RR): the same four in the fields build", rrOf(FIELDS).map((w) => w.model).sort(), RR.slice().sort());
  eq("fields (RR): defect_qty a number with 8 decimals; defect_detail a textarea", rrOf(FULL).filter((w) => /defect_(qty|detail)/.test(w.model))
    .map((w) => [w.model, w.type, w.options.precision]).sort(), [["defect_detail", "textarea", undefined], ["defect_qty", "number", 8]]);
  console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
  process.exit(fails ? 1 : 0);
})();
