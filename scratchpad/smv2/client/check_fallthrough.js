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
// plain rows + one bundle parent with its children nested (the web form's shape); children wait for the server's allocation
const bundleRows = (plain, kids, kidExtra) => rows(plain).concat([{ id: "", item_bundle_id: "B1", item_selection: "", item_name: "BUNDLE", line_index: String(plain + 1),
  temp_qty_data: "", temp_hu_data: "", fm_key: "p1", children: Array.from({ length: kids }, (_, j) => Object.assign({ id: "", item_bundle_id: "B1", parent_fm_key: "p1",
    item_selection: "C" + j, requested_qty: 1, temp_qty_data: "", temp_hu_data: "" }, kidExtra ? kidExtra(j) : {})) }]);
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
    // bundles: flat stock lines count (the parent does not, its children do); 30 rows + 20 children = 50 flat lines
    await expectClassic("bundle form, 50 flat lines (51 rows incl. the parent) / " + field, field, base(0, { stock_movement: bundleRows(30, 20) }));
    await expectClassic("HU on a bundle child (> 50 flat lines) / " + field, field, base(0, { stock_movement: bundleRows(30, 25, (j) => (j === 7 ? { temp_hu_data: '[{"handling_unit_id":"9"}]' } : {})) }));
    await expectClassic("HU entry on a bundle child / " + field, field, base(0, { stock_movement: bundleRows(30, 25, (j) => (j === 3 ? { temp_qty_data: '[{"handling_unit_id":"5","sm_quantity":1}]' } : {})) }));
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
  // bundle transfers go V2 above 50 flat lines: 30 rows + a bundle of 25 children = 31 top-level rows, 55 flat lines
  for (const [field, saveAs] of [["button_save_as_draft", "Draft"], ["button_inprogress", "In Progress"], ["button_completed", "Completed"]]) {
    const r2 = await expectSubmit("bundle form, 55 flat lines in 31 rows -> V2 / " + field, field, base(0, { stock_movement: bundleRows(30, 25) }),
      { saveAs: saveAs, pageStatus: "Add", lot_id: "", key: NEWKEY });
    check("... the bundle reaches SUBMIT with its children nested / " + field, r2.submits.length === 1 && r2.submits[0].form.stock_movement.length === 31 &&
      r2.submits[0].form.stock_movement[30].children.length === 25, r2.submits.length);
  }
  await expectSubmit("bundle COMPLETE (In Progress, 55 flat lines) -> V2", "button_completed", base(0, edit("In Progress", { stock_movement: bundleRows(30, 25) })),
    { saveAs: "Completed", pageStatus: "Edit", lot_id: "77", key: KEY77, closed: 0 });
  await expectClassic("bundle COMPLETE counts as edited: COMPLETE_EDITED switched off -> classic", "button_completed",
    base(0, edit("In Progress", { stock_movement: bundleRows(30, 25) })), { offAction: "COMPLETE_EDITED", models: { _data: { lot_mount_fp: "LF1:31:0000000000000000" } } });
  const k1 = (await click("button_completed", base(60))).submits[0].idempotency_key, k2 = (await click("button_inprogress", base(60))).submits[0].idempotency_key;
  check("saveAs is part of the key's content", k1.split(":")[3] !== k2.split(":")[3], [k1, k2]);
  // a new transfer's job answered before SUBMIT linked it to its transfer (no lot_id; fix round 2): the form stays with the SAME
  // key and asks STATUS of that key every 3 s for up to 90 s (virtual clock) - linked -> the queued path; FAILED -> a new key;
  // still not linked -> the same key is kept, whichever button is clicked next
  const TWIN = { route: "STATUS", code: "200", job_id: "J1", job_status: "VALIDATING", terminal: "NO", lot_id: "", lot_no: "" };
  const LINKED = { route: "STATUS", code: "200", job_id: "J1", job_status: "VALIDATING", terminal: "NO", lot_id: "77", lot_no: "LOT-1" };
  const clickLinked = async (field, values, submitAnswer, statusAnswers, models) => {
    const log = { triggered: [], submits: [], statuses: [], workers: [], closed: 0, messages: [], alerts: [] };
    let now = 1000000;
    const queue = [];
    const later = (fn, ms) => { queue.push({ at: now + (ms || 0), fn: fn }); return queue.length; };
    const states = statusAnswers.slice();
    const form = {
      models: models,
      getValues: () => JSON.parse(JSON.stringify(values)),
      showLoading() {}, hideLoading() {}, hide() {},
      triggerEvent: (nm) => { log.triggered.push(nm); return Promise.resolve(); },
      runWorkflow: (id, params, ok) => {
        if (id === IDS.LOT_V2_SUBMIT && params.operation === "STATUS") { log.statuses.push(params); const a = states.length > 1 ? states.shift() : states[0]; later(() => ok({ data: a }), 0); }
        else if (id === IDS.LOT_V2_SUBMIT) { log.submits.push(params); later(() => ok({ data: submitAnswer }), 0); }
        else if (id === IDS.LOT_V2_WORKER) { log.workers.push(params); later(() => ok({ data: { processed: "1", job_id: "J1", job_status: "COMPLETED" } }), 0); }
        else throw new Error("unexpected workflow " + id);
      },
      $message: ["success", "error", "warning", "info"].reduce((m, k) => Object.assign(m, { [k]: (x) => log.messages.push(k + ": " + x) }), {}),
      $alert: (m, title) => { log.alerts.push(title + ": " + m); return Promise.resolve(); },
      parentGenerateForm: { $refs: { SuPageDialogRef: { hide: () => log.closed++ } }, refresh: () => {} },
    };
    new Function("console", "setTimeout", "Date", "return function () {\n" + SAVE[field] + "\n};")(quiet, later, { now: () => now }).call(form, {});
    for (let k = 0; k < 5000; k++) {
      await new Promise((r) => setImmediate(r));
      if (!queue.length) break;
      queue.sort((a, b) => a.at - b.at);
      const next = queue.shift();
      now = Math.max(now, next.at);
      next.fn();
    }
    log.elapsed = now - 1000000;
    return log;
  };
  const sameKeyPolls = (a) => a.statuses.length > 0 && a.statuses.every((x) => x.operation === "STATUS" && x.idempotency_key === a.submits[0].idempotency_key && x.lot_id === "0");
  {
    const models = { _data: {} };
    const a = await clickLinked("button_completed", base(51), TWIN, [TWIN, LINKED], models);
    check("Add answered STATUS without lot_id, linked during the poll -> the queued path (closed, worker kicked)", a.closed === 1 && a.workers.length >= 1 &&
      a.workers[0].job_id === "J1" && sameKeyPolls(a) && a.statuses.length === 2 && a.elapsed >= 6000 && a.elapsed < 9000 && a.triggered.length === 0 &&
      models._data.lot_gen === 1 && models._data.lot_pinned_new === "" && a.alerts.length === 0, a);
  }
  {
    const models = { _data: {} };
    const FAILED = { route: "STATUS", code: "200", job_id: "J1", job_status: "FAILED", terminal: "YES", lot_id: "", error_message: "Insufficient quantity - line 4 (FG-0042)" };
    const a = await clickLinked("button_completed", base(51), { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", lot_id: "" }, [FAILED], models);
    check("Add QUEUED without lot_id, the job FAILED during the poll -> its error, the form stays, the generation goes up", a.closed === 0 && a.workers.length === 0 &&
      sameKeyPolls(a) && a.alerts.length === 1 && /Insufficient quantity - line 4/.test(a.alerts[0]) && models._data.lot_gen === 2 && models._data.lot_pinned_new === "" &&
      models._data.lot_submitting === 0, a);
    const b = await clickLinked("button_completed", base(51), { route: "QUEUED", code: "200", job_id: "J2", job_status: "QUEUED", lot_id: "78", lot_no: "LOT-2" }, [LINKED], models);
    const ka = a.submits[0].idempotency_key, kb = (b.submits[0] || {}).idempotency_key || "";
    check("... and the next click sends a new key (generation 2)", NEWKEY.test(ka) && kb !== ka && kb.replace(/:2$/, ":1") === ka && b.closed === 1, [ka, kb, b.closed]);
  }
  {
    const models = { _data: {} };
    const a = await clickLinked("button_completed", base(51), TWIN, [TWIN], models);
    const ka = a.submits[0].idempotency_key;
    check("Add answered without lot_id, never linked within 90 s -> the form stays, the SAME key is kept, the message", a.closed === 0 && a.workers.length === 0 &&
      sameKeyPolls(a) && a.statuses.length >= 28 && a.statuses.length <= 31 && a.elapsed >= 90000 && a.elapsed < 95000 &&
      a.messages.join() === "warning: The save is still being prepared - check the Location Transfer list before saving again." &&
      models._data.lot_pinned_new === ka && models._data.lot_submitting === 0 && (models._data.lot_gen || 1) === 1, Object.assign({}, a, { statuses: a.statuses.length }));
    const after = Object.assign({}, models._data); // the form as the 90 s wait left it, for the other-button click
    const b = await clickLinked("button_completed", base(51), LINKED, [LINKED], models);
    const c2 = await clickLinked("button_inprogress", base(51), LINKED, [LINKED], { _data: after });
    check("... the next click (same or another button) re-sends the SAME key; linked -> the queued path", b.submits[0].idempotency_key === ka &&
      c2.submits[0].idempotency_key === ka && b.closed === 1 && c2.closed === 1, [ka, b.submits[0].idempotency_key, c2.submits[0].idempotency_key, b.closed, c2.closed]);
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
