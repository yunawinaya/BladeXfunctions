// Quick mock run of the fall-through (the only check kept, by the user's call): each save button's V2 handler - taken
// from the built LOTform.json through the button's own onClick binding - runs exactly ITS button's classic handler (the
// one base v107 bound to that button) once and as before; the V2 cases reach LOT_V2_SUBMIT with the contract's request.
//   node check_fallthrough.js
const fs = require("fs");
const ROOT = __dirname + "/../../../";
const FORM = JSON.parse(fs.readFileSync(ROOT + "Stock Movement/Location Transfer/AsyncV2/LOTform.json", "utf8"));
const BASE = JSON.parse(fs.readFileSync(__dirname + "/../base/lot_form_v107.json", "utf8"));
const CANCEL = fs.readFileSync(ROOT + "Bulk Actions/Warehouse Management/Location Transfer/Cancel.js", "utf8");
const IDS = JSON.parse(fs.readFileSync(__dirname + "/../ids.json", "utf8"));
const CLASSIC_WF = "2013133675374927874";
const findModel = (n, m) => { if (n && typeof n === "object") { if (n.model === m) return n; for (const v of Object.values(n)) { const r = findModel(v, m); if (r) return r; } } return null; };
const byKey = (doc, k) => doc.config.eventScript.find((e) => e.key === k);
// per button: the classic handler base v107 bound to it, and the V2 handler the built form binds to it
const CLASSIC = {}, SAVE = {}, WIRING = [];
for (const model of ["button_save_as_draft", "button_inprogress", "button_completed"]) {
  const classic = byKey(BASE, findModel(BASE.list, model).events.onClick);
  const v2 = byKey(FORM, findModel(FORM.list, model).events.onClick);
  CLASSIC[model] = classic.name;
  SAVE[model] = v2.func;
  WIRING.push([model, classic.key + " " + classic.name, v2.key + " " + v2.name, JSON.stringify(byKey(FORM, classic.key)) === JSON.stringify(classic)]);
}
const rows = (n, extra) => Array.from({ length: n }, (_, i) => Object.assign({ id: "", item_selection: "I" + i, line_index: String(i + 1), location_id: "9",
  temp_qty_data: JSON.stringify([{ material_id: "I" + i, location_id: "8", sm_quantity: 1, category: "Unrestricted" }]), temp_hu_data: "" }, extra ? extra(i) : {}));
const base = (n, o) => Object.assign({ page_status: "Add", id: "", organization_id: "1123598813738675201", stock_movement_status: "", stock_movement_no: "",
  $_v: 3, _vts: 17908, sm_item_balance: { table_item_balance: [] }, draft_status: "<html/>", stock_movement: rows(n) }, o || {});
const edit = (status, o) => Object.assign({ page_status: "Edit", id: "77", stock_movement_status: status }, o || {});
const wait = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 1)); };
const quiet = { log: () => {}, error: () => {} };
const load = (code) => new Function("console", "return function () {\n" + code + "\n};")(quiet);

async function click(field, values, opt) {
  opt = opt || {};
  let code = SAVE[field];
  if (opt.off) code = code.replace("const ASYNC_LOT_ENABLED = true;", "const ASYNC_LOT_ENABLED = false;");
  if (opt.offAction) code = code.replace(opt.offAction + ": true", opt.offAction + ": false");
  const log = { triggered: [], submits: [], workers: [], closed: 0, messages: [] };
  const form = {
    models: opt.models || { _data: {} },
    getValues: () => { if (opt.throws) throw new Error("boom"); return JSON.parse(JSON.stringify(values)); },
    showLoading() {}, hideLoading() {}, hide() {},
    triggerEvent: (n, p) => { log.triggered.push(n + (p === undefined ? "" : " +params")); return Promise.resolve(); },
    runWorkflow: (id, params, ok) => {
      if (id === IDS.LOT_V2_SUBMIT) { log.submits.push(params); setTimeout(() => ok({ data: opt.answer || { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", lot_id: "77", lot_no: "LOT-1" } }), 0); }
      else if (id === IDS.LOT_V2_WORKER) { log.workers.push(params); setTimeout(() => ok({ data: { processed: "1", job_id: "J1", job_status: "COMPLETED" } }), 0); }
      else throw new Error("unexpected workflow " + id);
    },
    $message: ["success", "error", "warning", "info"].reduce((m, k) => Object.assign(m, { [k]: (x) => log.messages.push(k + ": " + x) }), {}),
    $alert: () => Promise.resolve(),
    parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.closed++ } }, refresh: () => {} },
  };
  // the handler must not depend on its arguments: give it another button's name
  load(code).call(form, { field: "button_other", fieldNode: "button_other", currentRef: {}, $eventArgs: [] });
  await wait();
  return log;
}

let fails = 0, n = 0;
const check = (what, ok, x) => { n++; if (!ok) { fails++; console.log("FAIL " + what + " " + JSON.stringify(x).slice(0, 700)); } };
const expectClassic = async (what, field, values, opt) => {
  const r = await click(field, values, opt);
  const asked = opt && opt.answer ? 1 : 0; // a NOT_ELIGIBLE / INVALID answer comes after one SUBMIT call
  check(what, r.triggered.length === 1 && r.triggered[0] === CLASSIC[field] && r.submits.length === asked && r.workers.length === 0 && r.closed === 0,
    { triggered: r.triggered, submits: r.submits.length, workers: r.workers, closed: r.closed });
};
const expectSubmit = async (what, field, values, want, opt) => {
  const r = await click(field, values, opt);
  const p = r.submits[0] || {};
  const ok = r.triggered.length === 0 && r.submits.length === 1 && p.operation === "SUBMIT" && p.source === "FORM" && p.saveAs === want.saveAs &&
    p.pageStatus === want.pageStatus && p.lot_id === want.lot_id && want.key.test(p.idempotency_key) && Array.isArray(p.form.stock_movement) &&
    ["$_v", "_vts", "sm_item_balance", "draft_status", "_data"].every((k) => !(k in p.form)) && (want.closed === undefined || r.closed === want.closed);
  check(what, ok, { triggered: r.triggered, submits: r.submits.length, p: Object.assign({}, p, { form: Object.keys(p.form || {}) }), closed: r.closed, workers: r.workers });
  return r;
};
const NEWKEY = /^LOT:1123598813738675201:new-[a-z0-9]+:[0-9a-f]{16}:1$/, KEY77 = /^LOT:1123598813738675201:77:[0-9a-f]{16}:1$/;
// which action each button is in each stored status (CONTRACT section 2)
const ACTIONS = [["DRAFT", "button_save_as_draft", {}], ["STAGE", "button_inprogress", {}], ["DIRECT", "button_completed", {}],
  ["EDIT", "button_inprogress", edit("In Progress")]];

(async () => {
  for (const [model, classic, v2, unchanged] of WIRING) {
    console.log("wiring " + model + ": base " + classic + " -> built " + v2 + "; classic entry unchanged: " + unchanged);
    check("wiring " + model, unchanged && v2.indexOf("lotV2_onClick_save_") > 0 && new RegExp('const button = \\{ saveAs: "[^"]+", classic: "' + CLASSIC[model] + '" \\};').test(SAVE[model]), [classic, v2]);
  }
  for (const field of Object.keys(CLASSIC)) {
    await expectClassic("switch off / " + field, field, base(60), { off: true });
    await expectClassic("<= 50 lines / " + field, field, base(50));
    await expectClassic("exception before SUBMIT / " + field, field, base(60), { throws: true });
    await expectClassic("bundle rows / " + field, field, base(60, { stock_movement: rows(60, (i) => (i === 3 ? { item_bundle_id: "B1" } : {})) }));
    await expectClassic("bundle child rows / " + field, field, base(60, { stock_movement: rows(60, (i) => (i === 3 ? { parent_fm_key: "x" } : {})) }));
    await expectClassic("HU rows / " + field, field, base(60, { stock_movement: rows(60, (i) => (i === 5 ? { temp_hu_data: '[{"handling_unit_id":"1"}]' } : {})) }));
    await expectClassic("HU entry / " + field, field, base(60, { stock_movement: rows(60, (i) => (i === 5 ? { temp_qty_data: '[{"handling_unit_id":"5","sm_quantity":1}]' } : {})) }));
    await expectClassic("View page / " + field, field, base(60, { page_status: "View" }));
    await expectClassic("Created status / " + field, field, base(60, edit("Created")));
    await expectClassic("Completed status / " + field, field, base(60, edit("Completed")));
    await expectClassic("NOT_ELIGIBLE / " + field, field, base(60, edit(field === "button_save_as_draft" ? "Draft" : "In Progress")), { answer: { route: "NOT_ELIGIBLE", code: "300", reason: "serialized items" } });
    await expectClassic("INVALID / " + field, field, base(60), { answer: { route: "INVALID", code: "400", message: "bad request" } });
  }
  await expectClassic("In Progress saved as Draft", "button_save_as_draft", base(60, edit("In Progress")));
  for (const [action, field, o] of ACTIONS) await expectClassic(action + " switched off", field, base(60, o), { offAction: action });
  // In Progress -> Completed is COMPLETE or COMPLETE_EDITED: with no fingerprint at open it is COMPLETE_EDITED
  await expectClassic("COMPLETE_EDITED switched off", "button_completed", base(60, edit("In Progress")), { offAction: "COMPLETE_EDITED" });

  // every action on (the shipped default): > 50 flat lines reach SUBMIT
  const r = await expectSubmit("DIRECT (Add) -> SUBMIT, closed", "button_completed", base(51), { saveAs: "Completed", pageStatus: "Add", lot_id: "", key: NEWKEY, closed: 1 });
  check("DIRECT kicks its job", r.workers.length === 1 && r.workers[0].job_id === "J1", r.workers);
  await expectSubmit("DIRECT (Clone) -> pageStatus Clone, no lot id", "button_completed", base(51, { page_status: "Clone", id: "55" }), { saveAs: "Completed", pageStatus: "Clone", lot_id: "", key: NEWKEY, closed: 1 });
  await expectSubmit("DIRECT (stored Draft)", "button_completed", base(60, edit("Draft")), { saveAs: "Completed", pageStatus: "Edit", lot_id: "77", key: KEY77, closed: 1 });
  await expectSubmit("STAGE (Add)", "button_inprogress", base(60), { saveAs: "In Progress", pageStatus: "Add", lot_id: "", key: NEWKEY, closed: 1 });
  await expectSubmit("DRAFT (Add) -> SAVED, closed", "button_save_as_draft", base(60), { saveAs: "Draft", pageStatus: "Add", lot_id: "", key: NEWKEY, closed: 1 },
    { answer: { route: "SAVED", code: "200", lot_id: "77", lot_no: "LOT-1" } });
  await expectSubmit("EDIT (In Progress) -> SUBMIT, waits", "button_inprogress", base(60, edit("In Progress")), { saveAs: "In Progress", pageStatus: "Edit", lot_id: "77", key: KEY77, closed: 0 });
  await expectSubmit("COMPLETE (In Progress) -> SUBMIT, waits", "button_completed", base(60, edit("In Progress")), { saveAs: "Completed", pageStatus: "Edit", lot_id: "77", key: KEY77, closed: 0 });
  const k1 = (await click("button_completed", base(60))).submits[0].idempotency_key, k2 = (await click("button_inprogress", base(60))).submits[0].idempotency_key;
  check("saveAs is part of the key's content", k1.split(":")[3] !== k2.split(":")[3], [k1, k2]);
  // a new transfer's job without a linked transfer (QUEUED / STATUS of the same key, no lot_id): the form stays open, the next
  // click of the same form sends a new key
  for (const [what, field, answer] of [["DIRECT (Add) answered QUEUED without lot_id", "button_completed", { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", lot_id: "" }],
    ["STAGE (Clone) answered STATUS (running) without lot_id", "button_inprogress", { route: "STATUS", code: "200", job_id: "J1", job_status: "VALIDATING", lot_id: "", terminal: "NO" }]]) {
    const models = { _data: {} };
    const values = base(51, field === "button_inprogress" ? { page_status: "Clone", id: "55" } : {});
    const a = await click(field, values, { models: models, answer: answer });
    check(what + " -> stays open, no kick, asks to save again", a.closed === 0 && a.workers.length === 0 && a.triggered.length === 0 && a.submits.length === 1 &&
      a.messages.join() === "error: The save did not complete - please save again." && models._data.lot_submitting === 0, a);
    const b = await click(field, values, { models: models });
    const ka = a.submits[0].idempotency_key, kb = (b.submits[0] || {}).idempotency_key || "";
    check(what + " -> the next click sends a new key", NEWKEY.test(ka) && kb !== ka && kb.replace(/:2$/, ":1") === ka && b.closed === 1, [ka, kb, b.closed]);
  }

  // the list's Cancel: switched off -> the classic call exactly as before; on -> SUBMIT CANCEL (ids only), NOT_ELIGIBLE -> the
  // classic call, QUEUED -> the worker, no classic call
  const lot = (id) => ({ id: id, stock_movement_no: "LOT-" + id, stock_movement_status: "In Progress", organization_id: "9", update_time: "2026-10-16 10:00:00", remarks: "x" });
  const runCancel = async (off, answer) => {
    // answer "REJECT": every SUBMIT call fails in transport (the platform's error callback)
    const code = off ? CANCEL.replace("const LOT_V2_CANCEL = true;", "const LOT_V2_CANCEL = false;") : CANCEL;
    const calls = [];
    const page = {
      showLoading() {}, hideLoading() {}, refresh() {},
      getComponent: () => ({ $refs: { crud: { tableSelect: [lot("11"), lot("12")] } } }),
      $confirm: () => Promise.resolve(), $message: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
      runWorkflow: (id, params, ok, bad) => { calls.push({ id, params }); setTimeout(() => (id === IDS.LOT_V2_SUBMIT && answer === "REJECT" ? bad(new Error("network"))
        : ok({ data: id === IDS.LOT_V2_SUBMIT ? answer : id === IDS.LOT_V2_WORKER ? { job_id: "J1", job_status: "COMPLETED", processed: "1" } : { code: "200" } })), 0); },
    };
    load(code).call(page);
    await wait();
    return calls;
  };
  const classicCalls = (c) => c.filter((x) => x.id === CLASSIC_WF);
  const asBefore = (c) => classicCalls(c).length === 2 && classicCalls(c).every((x, i) => JSON.stringify(x.params) === JSON.stringify({ allData: lot(String(11 + i)), saveAs: "Cancelled", pageStatus: "Edit" }));
  let c = await runCancel(true);
  check("cancel switched off -> classic as before, no SUBMIT", c.length === 2 && asBefore(c), c);
  c = await runCancel(false, { route: "NOT_ELIGIBLE", code: "300", reason: "HU" });
  const subs = c.filter((x) => x.id === IDS.LOT_V2_SUBMIT);
  check("cancel NOT_ELIGIBLE -> SUBMIT (ids only) then the classic call as before", subs.length === 2 && asBefore(c) && subs[0].params.source === "LIST" && subs[0].params.saveAs === "Cancelled" &&
    subs[0].params.pageStatus === "Edit" && subs[0].params.lot_id === "11" && /^LOT:9:11:[a-z0-9]{8,}$/.test(subs[0].params.idempotency_key) && subs[1].params.idempotency_key.split(":")[3] === subs[0].params.idempotency_key.split(":")[3] &&
    Object.keys(subs[0].params.form).join() === "id,stock_movement_status,stock_movement_no,organization_id" && subs.every((x) => x.params.min_lines === "50"), c);
  // SUBMIT answers NOT_ELIGIBLE "classic" for a transfer of <= min_lines stored lines (test/submit/test_min_lines.js): the classic call
  c = await runCancel(false, { route: "NOT_ELIGIBLE", code: "300", reason: "classic", action: "CANCEL", line_count: "50" });
  check("cancel of a <= 50-line LOT: min_lines 50 sent, NOT_ELIGIBLE classic -> the classic call as before", asBefore(c) &&
    c.filter((x) => x.id === IDS.LOT_V2_SUBMIT).length === 2 && c.filter((x) => x.id === IDS.LOT_V2_SUBMIT).every((x) => x.params.min_lines === "50") &&
    c.filter((x) => x.id === IDS.LOT_V2_WORKER).length === 0, c);
  c = await runCancel(false, "REJECT");
  check("cancel, SUBMIT transport failure (twice) -> the classic call as before", asBefore(c) && c.filter((x) => x.id === IDS.LOT_V2_SUBMIT).length === 4 &&
    c.filter((x) => x.id === IDS.LOT_V2_WORKER).length === 0, c);
  c = await runCancel(false, { success: false, msg: "Internal error" });
  check("cancel, success false without a contract answer -> the classic call as before", asBefore(c) && c.filter((x) => x.id === IDS.LOT_V2_WORKER).length === 0, c);
  c = await runCancel(false, undefined);
  check("cancel, empty answer -> the classic call as before", asBefore(c), c);
  c = await runCancel(false, { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED" });
  check("cancel QUEUED -> worker, no classic call", classicCalls(c).length === 0 && c.filter((x) => x.id === IDS.LOT_V2_WORKER).length >= 1, c);
  c = await runCancel(false, { route: "STOP", code: "400", message: "x" });
  check("cancel STOP -> failed, no classic call", classicCalls(c).length === 0, c);

  console.log("fall-through check: " + (n - fails) + "/" + n + " passed");
  process.exit(fails ? 1 : 0);
})();
