// SA form: the Completed / Completed & Post fall-through (switch OFF = the base v313 click, call for call), the V2 path
// (switch ON, test ids), the Draft re-read and the mounted Processing view. Every variant is derived from the shipped file
// whatever state it ships in; the shipped state itself (ON, the ids.json ids) is asserted under "wiring".
//   node test/test_sa_form.js
const H = require("./harness");
const { check, same, replaceOnce } = H;

const BASE = H.readJSON(H.FILES.saFormBase);
const BUILT = H.readJSON(H.FILES.saForm);
const SUBMIT = "9001";
const WORKER = "9002";
const CLASSIC_WF = "2032025505853816833";
const ORG = "1971187973669224450";
const BUTTONS = { button_completed: "onClick_completed", button_completed_posted: "onClick_completed_post" };
const bound = (doc, model) => H.byKey(doc, H.findModel(doc.list, model).events.onClick);

// the fall-through variant (switches false, ids "0") and the V2 variants (switch on, test ids) of the shipped form
const OFFDOC = H.clone(BUILT);
for (const e of OFFDOC.config.eventScript) if (e.name.startsWith("saV2_") || e.name === "mounted") e.func = H.variant(e.func, false, H.OFF_IDS);
const ON = H.clone(BUILT);
for (const e of ON.config.eventScript) if (e.name.startsWith("saV2_")) e.func = H.variant(e.func, true, { SUBMIT: SUBMIT, WORKER: WORKER });
const mountedOn = H.clone(BUILT);
H.byName(mountedOn, "mounted").func = H.variant(H.byName(mountedOn, "mounted").func, true, { SUBMIT: SUBMIT, WORKER: WORKER });

const entry = (j, o) => Object.assign({ balance_id: "B" + j, material_id: "M", location_id: "L" + j, batch_id: null, category: "Unrestricted", movement_type: "In", sa_quantity: 1 }, o || {});
const line = (i, n, o) => Object.assign({ material_id: "M" + i, material_name: "Item " + i, uom_id: "77", total_quantity: String(n), unit_price: 1.5, line_index: i + 1,
  plant_id: "2002", is_serialized_item: 0, adj_summary: "x", balance_index: JSON.stringify(Array.from({ length: n }, (_, j) => entry(j))) }, o || {});
// a form record as getValues() returns it (prod run 2111031784815857666's keys), `entries` entries over lines of 10
const record = (entries, o) => {
  const lines = [];
  for (let i = 0, left = entries; left > 0; i++, left -= 10) lines.push(line(i, Math.min(10, left)));
  return Object.assign({
    $_v: 8, _data: {}, acc_integration_type: "SQL Accounting V2", adjusted_by: "jean", adjustment_date: "2026-10-16", adjustment_no: "", adjustment_no_type: "2033",
    adjustment_remarks: "", adjustment_type: "Stock Count", button_completed: "", button_completed_posted: "", button_posted: "", button_save_as_draft: "",
    completed_status: "<html>c</html>", draft_status: "<html>d</html>", fullyposted_status: "<html>f</html>", processing_status: "<html>p</html>", cancel_status: "<html>x</html>",
    flex_shjmh0gq: "", flex_tp9swgvv: "", id: "", organization_id: ORG, page_status: "Add", plant_id: "2002", previous_status: "", row_index: 0, is_serialized: 0,
    sa_item_balance: { material_id: "X" }, table_item_balance: [], stock_adjustment: lines, stock_adjustment_status: "", stock_count_id: "", sa_v2_job_id: "", sa_idem_key: "",
  }, o || {});
};
const edit = (status, o) => Object.assign({ page_status: "Edit", id: "77", stock_adjustment_status: status, adjustment_no: "SA-77" }, o || {});

// answers: SUBMIT (operation SUBMIT / STATUS), WORKER, the classic STOCK_ADJUSTMENT
const answers = (s) => (id, params, w) => {
  if (id === SUBMIT) {
    if (params.operation === "SUBMIT") {
      const a = typeof s.submit === "function" ? s.submit(params, w) : s.submit;
      return a && a.reject ? a : { data: a };
    }
    const list = s.status || [{ route: "STATUS", code: "200", job_id: "J1", job_status: "COMPLETED", terminal: "YES", sa_id: "77" }];
    s.statusCalls = (s.statusCalls || 0) + 1;
    return { data: list[Math.min(s.statusCalls - 1, list.length - 1)] };
  }
  if (id === WORKER) return { data: s.worker || { worker_route: "WORKED", processed: "1", job_id: params.job_id, job_status: "VALIDATING" } };
  if (id === CLASSIC_WF) return { data: s.classic || { code: "200", message: "Stock Adjustment saved successfully" } };
  return { data: {} };
};
const QUEUED_NEW = { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", terminal: "NO", sa_id: "88", sa_no: "SA/88" };
const QUEUED_EDIT = { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", terminal: "NO", sa_id: "77", sa_no: "SA-77" };
const st = (job_status, o) => Object.assign({ route: "STATUS", code: "200", job_id: "J1", job_status: job_status, terminal: ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"].indexOf(job_status) >= 0 ? "YES" : "NO", sa_id: "77", sa_no: "SA-77", progress_percent: "10" }, o || {});

const run = async (doc, model, values, o) => {
  o = o || {};
  const w = H.world({ storage: o.storage, storageThrows: o.storageThrows });
  const self = H.makeThis(w, doc, { values: values, data: o.data, answer: answers(o.script || {}), getValuesThrows: o.getValuesThrows, alertRejects: o.alertRejects });
  await H.click(w, doc, bound(doc, model), self, "button_other");
  return { w: w, self: self, trace: w.trace, calls: (id, op) => w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === id && (!op || t[2].operation === op)) };
};
const named = (trace, name) => trace.filter((t) => t[0] === name);

(async () => {
  // ---- wiring: each button is bound to its new handler; the classic handler is still there, byte-identical
  for (const [model, classic] of Object.entries(BUTTONS)) {
    const b0 = H.byKey(BASE, H.findModel(BASE.list, model).events.onClick);
    const b1 = bound(BUILT, model);
    check("wiring " + model + ": base bound " + classic, b0.name === classic, b0.name);
    check("wiring " + model + ": built bound to saV2_*", b1.name === (model === "button_completed" ? "saV2_onClick_completed" : "saV2_onClick_completed_post") && b1.type === "js", b1.name);
    check("wiring " + model + ": classic entry byte-identical", same(H.byName(BUILT, classic), b0), classic);
    check("wiring " + model + ": the V2 handler names its classic", b1.func.indexOf('const SA_CLASSIC = "' + classic + '";') > 0);
    const shipped = H.shippedState(b1.func);
    check("shipped ON with the ids.json ids " + model, same(shipped, { on: true, SUBMIT: H.REAL.SUBMIT, WORKER: H.REAL.WORKER }), shipped);
  }

  // ---- switch OFF: the built click == the base click, call for call (the triggerEvent hop aside)
  const offCases = [
    ["Add, 60 entries", record(60)],
    ["Add, 10 entries", record(10)],
    ["Clone, 80 entries", record(80, { page_status: "Clone", id: "55" })],
    ["Edit Draft, 60 entries", record(60, edit("Draft"))],
    ["Edit Draft, serialized", record(60, edit("Draft", { stock_adjustment: [line(0, 60, { is_serialized_item: 1 })] }))],
    ["Edit Completed", record(60, edit("Completed"))],
    ["View", record(60, { page_status: "View", id: "77", stock_adjustment_status: "Draft" })],
  ];
  const offData = [["", {}], [" (classic is_processing)", { is_processing: 1 }], [" (classic is_error)", { is_error: 1 }]];
  const offAnswers = [["classic 200", { code: "200", message: "Stock Adjustment saved successfully" }], ["classic 400", { code: "400", message: "Plant is required" }]];
  for (const [model, classic] of Object.entries(BUTTONS)) {
    for (const [what, values] of offCases) {
      for (const [dw, data] of offData) {
        for (const [aw, classicAnswer] of offAnswers) {
          const a = await run(BASE, model, values, { data: data, script: { classic: classicAnswer } });
          const b = await run(OFFDOC, model, values, { data: data, script: { classic: classicAnswer } });
          const hop = b.trace[0];
          const rest = b.trace.slice(1);
          check("OFF " + model + " / " + what + dw + " / " + aw + ": exactly the classic",
            same(hop, ["triggerEvent", classic, "(no args)"]) && same(rest, a.trace) && same(a.self.models, b.self.models) &&
            !b.trace.some((t) => t[0] === "localStorage.getItem" || t[0] === "localStorage.setItem" || (t[0] === "runWorkflow" && t[1] !== CLASSIC_WF) || t[0] === "db.get"),
            { hop: hop, base: a.trace.slice(0, 8), built: rest.slice(0, 8), dataA: a.self.models, dataB: b.self.models });
        }
      }
    }
  }
  // a rejected / thrown classic workflow call: the same error path
  for (const model of Object.keys(BUTTONS)) {
    const a = await run(BASE, model, record(60), { script: { classic: undefined }, data: {} });
    const b = await run(OFFDOC, model, record(60), { script: { classic: undefined }, data: {} });
    check("OFF " + model + " / workflow without data: identical", same(b.trace.slice(1), a.trace) && same(a.self.models, b.self.models));
  }

  // ---- switch ON: the V2 path
  const NEWKEY = new RegExp("^SA:" + ORG + ":new-[a-z0-9]+:[0-9a-f]{16}:1$");
  const KEY77 = new RegExp("^SA:" + ORG + ":77:[0-9a-f]{16}:1$");
  const NOT_RECORD = ["sa_v2_job_id", "sa_idem_key", "_data", "$_v", "sa_item_balance", "table_item_balance", "draft_status", "completed_status", "fullyposted_status",
    "processing_status", "cancel_status", "button_completed", "button_completed_posted", "button_posted", "button_save_as_draft", "flex_shjmh0gq", "flex_tp9swgvv", "row_index", "is_serialized"];
  for (const model of Object.keys(BUTTONS)) {
    const classic = BUTTONS[model];
    // DIRECT (Add): SUBMIT params per CONTRACT section 7, then QUEUED -> kick -> wait -> COMPLETED
    let r = await run(ON, model, record(51), { script: { submit: QUEUED_NEW, status: [st("VALIDATING", { sa_id: "88" }), st("COMPLETED", { sa_id: "88", sa_no: "SA/88" })] } });
    const sub = r.calls(SUBMIT, "SUBMIT");
    const p = (sub[0] || [])[2] || {};
    const keys = ["operation", "source", "saveAs", "pageStatus", "sa_id", "sc_id", "idempotency_key", "form", "organization_id", "nickname", "adjustment_date", "create_adjustment"];
    check("ON " + model + " DIRECT: one SUBMIT with the section 7 request", sub.length === 1 && same(Object.keys(p).sort(), keys.slice().sort()) && p.operation === "SUBMIT" && p.source === "FORM" &&
      p.saveAs === "Completed" && p.pageStatus === "Add" && p.sa_id === "" && p.sc_id === "" && NEWKEY.test(p.idempotency_key) && p.organization_id === ORG && p.nickname === "" &&
      p.adjustment_date === "" && p.create_adjustment === "" && Object.keys(p).every((k) => k === "form" || typeof p[k] === "string"), p && Object.assign({}, p, { form: Object.keys(p.form || {}) }));
    check("ON " + model + " DIRECT: the record without the non-record keys", p.form && Array.isArray(p.form.stock_adjustment) && p.form.stock_adjustment.length === 6 &&
      NOT_RECORD.every((k) => !(k in p.form)) && p.form.adjustment_type === "Stock Count" && p.form.organization_id === ORG, p.form && Object.keys(p.form));
    const kicks = r.calls(WORKER);
    check("ON " + model + " DIRECT: QUEUED -> the worker kicked with the job", kicks.length >= 1 && same(kicks[0][2], { job_id: "J1" }), kicks);
    const stat = r.calls(SUBMIT, "STATUS");
    check("ON " + model + " DIRECT: STATUS by key + the linked sa_id until COMPLETED, then closed", stat.length === 2 && stat.every((t) => t[2].idempotency_key === p.idempotency_key && t[2].sa_id === "88" &&
      t[2].source === "FORM" && same(t[2].form, {})) && named(r.trace, "dialog.hide").length === 1 && named(r.trace, "$message.success").length === 1 &&
      named(r.trace, "triggerEvent").length === 0 && r.self.models._data.sa_submitting === 0, { stat: stat.length, trace: r.trace.map((t) => t[0]) });
    check("ON " + model + " DIRECT: polls every 2.5 s", r.w.now - 1800000000000 >= 5000 && r.w.now - 1800000000000 < 6000, r.w.now - 1800000000000);

    // COMPLETE (Edit of a stored Draft): pageStatus Edit, sa_id, key on the SA id
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const p2 = r.calls(SUBMIT, "SUBMIT")[0][2];
    check("ON " + model + " COMPLETE: pageStatus Edit, sa_id 77, key on the id", p2.pageStatus === "Edit" && p2.sa_id === "77" && KEY77.test(p2.idempotency_key) && named(r.trace, "dialog.hide").length === 1, p2.idempotency_key);

    // the verdict: progress >= 80 while COMMITTING_SA (stock moved) -> closed, the worker driven on; re-kicks every 15 s while waiting
    const waits = Array.from({ length: 8 }, () => st("VALIDATING"));
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: waits.concat([st("COMMITTING_SA", { progress_percent: "80" })]), worker: { processed: "1", job_id: "J1", job_status: "COMPLETED" } } });
    check("ON " + model + " verdict at 80 % (COMMITTING_SA): closed, success", named(r.trace, "dialog.hide").length === 1 && named(r.trace, "$message.success").length === 1 &&
      r.calls(SUBMIT, "STATUS").length === 9, r.trace.map((t) => t[0] + (t[0] === "runWorkflow" ? ":" + t[1] : "")));
    const kickTimes = r.calls(WORKER).length;
    check("ON " + model + " re-kicks while waiting (start, 15 s) + the drive-on loop", kickTimes >= 3, kickTimes);

    // FAILED (Edit): error shown, form intact (not closed, buttons not hidden), generation + 1; the next click is a new key
    const models = { _data: {} };
    r = await run(ON, model, record(60, edit("Draft")), { data: models._data, script: { submit: QUEUED_EDIT, status: [st("FAILED", { error_message: "Insufficient quantity - line 4 (FG-0042), bin A1-B2 (Unrestricted)" })] } });
    check("ON " + model + " FAILED (Edit): the error, the form stays, gen 2", named(r.trace, "$alert").length === 1 && /Insufficient quantity - line 4/.test(named(r.trace, "$alert")[0][1]) &&
      named(r.trace, "dialog.hide").length === 0 && named(r.trace, "hide").length === 0 && r.self.models._data.sa_gen === 2 && r.self.models._data.sa_submitting === 0 &&
      r.w.storage["sa_v2_failed_seen_J1"] === "1", { trace: r.trace.map((t) => t[0]), data: r.self.models._data });
    const again = await run(ON, model, record(60, edit("Draft")), { data: r.self.models._data, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const k1 = p2.idempotency_key;
    const k2 = again.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    check("ON " + model + " FAILED -> the next click sends generation 2", k2 === k1.replace(/:1$/, ":2"), [k1, k2]);
    // an alert closed with its X (Element rejects) does not break the flow
    r = await run(ON, model, record(60, edit("Draft")), { alertRejects: true, script: { submit: QUEUED_EDIT, status: [st("FAILED", { error_message: "x" })] } });
    check("ON " + model + " FAILED with the alert closed by X: no unhandled error, released", r.self.models._data.sa_submitting === 0 && named(r.trace, "hideLoading").length >= 1);

    // FAILED (Add, linked): the new adjustment is a Draft now -> never stay in Add mode
    r = await run(ON, model, record(60), { script: { submit: QUEUED_NEW, status: [st("FAILED", { sa_id: "88", error_message: "x" })] } });
    check("ON " + model + " FAILED (Add): the form closes", named(r.trace, "dialog.hide").length === 1 && named(r.trace, "$alert").length === 1);

    // NOT_ELIGIBLE / INVALID -> the classic handler (once), loading released first
    for (const route of ["NOT_ELIGIBLE", "INVALID"]) {
      r = await run(ON, model, record(60), { script: { submit: { route: route, code: route === "INVALID" ? "400" : "300", reason: "serialized items" } } });
      const tr = named(r.trace, "triggerEvent");
      check("ON " + model + " " + route + " -> the classic handler once", r.calls(SUBMIT, "SUBMIT").length === 1 && tr.length === 1 && tr[0][1] === classic &&
        r.calls(CLASSIC_WF).length === 1 && r.calls(WORKER).length === 0 && r.calls(SUBMIT, "STATUS").length === 0, r.trace.map((t) => t[0] + ":" + (t[1] || "")));
    }
    // classic without any SUBMIT: <= 50 entries, a serialized line, serial numbers, a stored Completed, a View page, an error before SUBMIT, a classic save state
    const classicCases = [["50 entries", record(50), {}], ["serialized line", record(60, { stock_adjustment: [line(0, 60, { is_serialized_item: 1 })] }), {}],
      ["serial numbers in an entry", record(60, { stock_adjustment: [line(0, 60, { balance_index: JSON.stringify(Array.from({ length: 60 }, (_, j) => entry(j, { serial_number: "SN" + j }))) })] }), {}],
      ["stored Completed", record(60, edit("Completed")), {}], ["View", record(60, { page_status: "View", id: "77" }), {}], ["getValues throws", record(60), { getValuesThrows: true }],
      ["unreadable balance_index", record(60, { stock_adjustment: [line(0, 60, { balance_index: "[{bad" })] }), {}], ["classic is_processing", record(60), { data: { is_processing: 1 } }],
      ["classic is_error", record(60), { data: { is_error: 1 } }]];
    for (const [what, values, o] of classicCases) {
      r = await run(ON, model, values, o);
      const tr = named(r.trace, "triggerEvent");
      check("ON " + model + " " + what + " -> the classic handler, no SUBMIT", r.calls(SUBMIT).length === 0 && r.calls(WORKER).length === 0 && tr.length === 1 && tr[0][1] === classic, r.trace.map((t) => t[0] + ":" + (t[1] || "")));
    }
    // a double click while V2 runs
    r = await run(ON, model, record(60), { data: { sa_submitting: 1 } });
    check("ON " + model + " double click -> already in progress", named(r.trace, "$message.warning").length === 1 && r.calls(SUBMIT).length === 0 && named(r.trace, "triggerEvent").length === 0);
    // BUSY / STALE / STOP 400: the message, nothing else
    for (const [route, code] of [["BUSY", "409"], ["STALE", "409"], ["STOP", "400"]]) {
      r = await run(ON, model, record(60, edit("Draft")), { script: { submit: { route: route, code: code, message: "the " + route + " text" } } });
      check("ON " + model + " " + route + " " + code + ": its message only", named(r.trace, route === "STOP" ? "$message.error" : "$message.warning").some((t) => t[1] === "the " + route + " text") &&
        named(r.trace, "triggerEvent").length === 0 && r.calls(WORKER).length === 0 && r.self.models._data.sa_submitting === 0);
    }
    // no answer (transport failure twice) / STOP 500: the key is pinned - the next click re-sends it whatever the content
    for (const [what, submit] of [["transport failure", { reject: new Error("network") }], ["STOP 500", { route: "STOP", code: "500", message: "SA_QUEUE_FAILED" }]]) {
      r = await run(ON, model, record(60, edit("Draft")), { script: { submit: submit } });
      const ks = r.calls(SUBMIT, "SUBMIT").map((t) => t[2].idempotency_key);
      const b = await run(ON, model, record(61, edit("Draft")), { data: r.self.models._data, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
      check("ON " + model + " " + what + ": pinned key re-used by the next click (other content)", ks.length === (what === "STOP 500" ? 1 : 2) && ks.every((k) => k === ks[0]) &&
        b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === ks[0] && r.self.models._data.sa_pinned_edit === ks[0], [ks, b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key]);
    }
    // an Add whose completion may have been saved: Save as Draft is hidden (it would add a second adjustment); an Edit keeps it
    // (the Draft re-read refuses a Processing one)
    for (const [what, submit] of [["transport failure", { reject: new Error("network") }], ["STOP 500", { route: "STOP", code: "500", message: "SA_QUEUE_FAILED" }]]) {
      const add = await run(ON, model, record(60), { script: { submit: submit } });
      const ed = await run(ON, model, record(60, edit("Draft")), { script: { submit: submit } });
      check("ON " + model + " " + what + ": Add hides Save as Draft, Edit does not", named(add.trace, "hide").length === 1 && same(named(add.trace, "hide")[0][1], ["button_save_as_draft"]) &&
        named(ed.trace, "hide").length === 0 && named(add.trace, "dialog.hide").length === 0, { add: named(add.trace, "hide"), edit: named(ed.trace, "hide") });
    }
    // timeout: still QUEUED after 180 s -> closed with an info; the worker re-kicked every 15 s
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("QUEUED")] } });
    const elapsed = r.w.now - 1800000000000;
    check("ON " + model + " 180 s without a verdict: info + closed; kicks every 15 s", named(r.trace, "$message.info").length === 1 && named(r.trace, "dialog.hide").length === 1 &&
      elapsed >= 180000 && elapsed < 185000 && r.calls(WORKER).length >= 12 && r.calls(WORKER).length <= 14, { elapsed: elapsed, kicks: r.calls(WORKER).length });
  }

  // ---- a new adjustment's job answered before it was linked (f8's fix): the SAME key is kept until linked, whichever button
  const TWIN = st("VALIDATING", { sa_id: "", sa_no: "" });
  const LINKED = st("VALIDATING", { sa_id: "88", sa_no: "SA/88" });
  {
    const r = await run(ON, "button_completed", record(51), { script: { submit: TWIN, status: [TWIN, st("COMPLETED", { sa_id: "88" })] } });
    const key = r.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    const polls = r.calls(SUBMIT, "STATUS");
    check("Add answered without sa_id, linked on the 2nd poll -> follows the job, closed", polls.length >= 2 && polls.slice(0, 2).every((t) => t[2].idempotency_key === key && t[2].sa_id === "0") &&
      named(r.trace, "dialog.hide").length === 1 && r.self.models._data.sa_pinned_new === "" && named(r.trace, "triggerEvent").length === 0, { polls: polls.map((t) => [t[2].sa_id, t[2].idempotency_key === key]) });
  }
  {
    const r = await run(ON, "button_completed", record(51), { script: { submit: TWIN, status: [TWIN] } });
    const key = r.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    const elapsed = r.w.now - 1800000000000;
    check("never linked within 90 s -> the form stays, Save as Draft hidden, the SAME key pinned, the message", named(r.trace, "dialog.hide").length === 0 &&
      same(named(r.trace, "hide").map((x) => x[1]), [["button_save_as_draft"]]) && r.self.models._data.sa_pinned_new === key &&
      r.self.models._data.sa_submitting === 0 && (r.self.models._data.sa_gen || 1) === 1 && elapsed >= 90000 && elapsed < 95000 &&
      named(r.trace, "$message.warning").some((t) => /still being prepared/.test(t[1])), { elapsed: elapsed, data: r.self.models._data });
    const b = await run(ON, "button_completed_posted", record(52), { data: r.self.models._data, script: { submit: LINKED, status: [st("COMPLETED", { sa_id: "88" })] } });
    check("... the next click on the OTHER button re-sends the SAME key (new content), linked -> closed", b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === key && named(b.trace, "dialog.hide").length === 1, [key, b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key]);
  }
  {
    const r = await run(ON, "button_completed", record(51), { script: { submit: { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", sa_id: "" }, status: [st("FAILED", { sa_id: "", error_message: "SA_REVIEW x" })] } });
    check("Add QUEUED without sa_id, FAILED while waiting for the link -> the error, the form stays, gen 2, unpinned", named(r.trace, "$alert").length === 1 && named(r.trace, "dialog.hide").length === 0 &&
      r.self.models._data.sa_gen === 2 && r.self.models._data.sa_pinned_new === "", r.self.models._data);
  }
  {
    const r = await run(ON, "button_completed", record(51), { script: { submit: st("REQUIRES_REVIEW", { sa_id: "", error_message: "under review" }) } });
    const key = r.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    const b = await run(ON, "button_completed", record(55), { data: r.self.models._data, script: { submit: st("REQUIRES_REVIEW", { sa_id: "" }) } });
    check("Add answered STATUS REQUIRES_REVIEW before its link -> the key stays pinned (other content re-sends it), Save as Draft hidden",
      r.self.models._data.sa_pinned_new === key && same(named(r.trace, "hide").map((x) => x[1]), [["button_save_as_draft"]]) && (r.self.models._data.sa_gen || 1) === 1 &&
      b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === key, r.self.models._data);
  }
  // the two buttons send the same request for the same content (one job between them)
  {
    const a = await run(ON, "button_completed", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const b = await run(ON, "button_completed_posted", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("Completed and Completed & Post: the same SUBMIT request for the same content", same(a.calls(SUBMIT, "SUBMIT")[0][2], b.calls(SUBMIT, "SUBMIT")[0][2]));
  }

  // ---- onClick_draft (rule uk4w8v1h): Edit re-reads the stored status; only Draft is saved
  {
    const draftRun = async (doc, values, stored, missing) => {
      const db = (name, q) => (name === "stock_adjustment" && q.where && q.where.id === "77" ? { data: missing ? [] : [{ id: "77", stock_adjustment_status: stored }] } : { data: [] });
      const w2 = H.world({ db: db });
      const self2 = H.makeThis(w2, doc, { values: values });
      await H.click(w2, doc, H.byName(doc, "onClick_draft"), self2, "button_save_as_draft");
      return w2.trace;
    };
    const values = record(10, edit("Draft"));
    const baseTrace = await draftRun(BASE, values, "Draft");
    const draftTrace = await draftRun(BUILT, values, "Draft");
    const reads = draftTrace.filter((t) => t[0] === "db.get");
    check("Draft (Edit, stored Draft): one status read (field-limited), then the unchanged update", reads.length === 1 && same(reads[0][1], { collection: "stock_adjustment", where: { id: "77" }, field: "stock_adjustment_status" }) &&
      same(draftTrace.filter((t) => t[0] !== "db.get"), baseTrace), { base: baseTrace.map((t) => t[0]), built: draftTrace.map((t) => t[0]) });
    for (const stored of ["Processing", "Completed", "Fully Posted", "Cancelled"]) {
      const t = await draftRun(BUILT, record(10, edit("Draft")), stored);
      check("Draft (Edit, stored " + stored + "): refused, no write", t.filter((x) => x[0] === "db.update" || x[0] === "db.add").length === 0 &&
        t.some((x) => x[0] === "$message.error" && x[1] === "This Stock Adjustment is " + stored + " and can't be saved as Draft.") && t.some((x) => x[0] === "hideLoading"), t.map((x) => x[0]));
    }
    const gone = await draftRun(BUILT, record(10, edit("Draft")), "Draft", true);
    check("Draft (Edit, record gone): refused", gone.some((x) => x[0] === "$message.error" && /no longer available/.test(x[1])) && !gone.some((x) => x[0] === "db.update"));
    for (const [what, v] of [["Add", record(10)], ["Clone", record(10, { page_status: "Clone", id: "55" })], ["Edit, a field missing", record(10, edit("Draft", { plant_id: "" }))]]) {
      const a = await draftRun(BASE, v, "Draft");
      const b = await draftRun(BUILT, v, "Draft");
      check("Draft (" + what + "): unchanged, no extra read", same(a, b) && !b.some((x) => x[0] === "db.get"), { a: a.map((x) => x[0]), b: b.map((x) => x[0]) });
    }
  }

  // ---- mounted: OFF = base for the classic statuses; Processing / Cancelled get their badge and lose every save + Post button
  {
    const mount = async (doc, values, flags, o) => {
      o = o || {};
      const db = (name) => (name === "accounting_integration" ? { data: [{ acc_integration_type: "SQL Accounting V2" }] } : { data: [] });
      const w = H.world({ db: db, storage: o.storage });
      const self = H.makeThis(w, doc, Object.assign({ values: values, answer: answers(o.script || {}) }, flags));
      H.compile(w, H.byName(doc, "mounted").func, false).call(self, {});
      await H.drain(w);
      return { w: w, trace: w.trace };
    };
    for (const status of ["Draft", "Completed", "Fully Posted"]) {
      for (const flags of [{ isEdit: true }, { isView: true }]) {
        const v = record(10, edit(status));
        const a = await mount(BASE, v, flags);
        const b = await mount(OFFDOC, v, flags);
        check("mounted OFF " + status + " " + Object.keys(flags)[0] + ": identical to base", same(a.trace, b.trace), { a: a.trace.slice(0, 12), b: b.trace.slice(0, 12) });
        // the shipped switch ON: an adjustment no V2 job ever held opens exactly as before
        const c = await mount(BUILT, v, flags);
        check("mounted shipped " + status + " " + Object.keys(flags)[0] + " (no V2 job on it): identical to base", same(a.trace, c.trace), { a: a.trace.slice(0, 12), c: c.trace.slice(0, 12) });
      }
    }
    for (const flags of [{ isAdd: true }, { isCopy: true }]) {
      const a = await mount(BASE, record(10), flags);
      const b = await mount(OFFDOC, record(10), flags);
      check("mounted OFF " + Object.keys(flags)[0] + ": identical to base", same(a.trace, b.trace));
      const c = await mount(BUILT, record(10), flags);
      check("mounted shipped " + Object.keys(flags)[0] + ": identical to base", same(a.trace, c.trace));
    }
    for (const status of ["Processing", "Cancelled"]) {
      const b = await mount(OFFDOC, record(10, edit(status, { sa_v2_job_id: "J1" })), { isEdit: true });
      const hides = b.trace.filter((t) => t[0] === "hide").map((t) => JSON.stringify(t[1])).join(" ");
      check("mounted OFF " + status + ": its badge, no save / Post button, no V2 call", b.trace.some((t) => t[0] === "display" && same(t[1], [status === "Processing" ? "processing_status" : "cancel_status"])) &&
        ["button_posted", "button_save_as_draft", "button_completed", "button_completed_posted"].every((x) => hides.indexOf(x) >= 0) &&
        !b.trace.some((t) => t[0] === "display" && same(t[1], ["button_posted"])) && !b.trace.some((t) => t[0] === "runWorkflow" || t[0].indexOf("localStorage") === 0), b.trace.map((t) => t[0] + " " + JSON.stringify(t[1] || "")));
    }
    // ON: Processing -> STATUS + kicks until COMPLETED; FAILED shown once per browser
    let r = await mount(mountedOn, record(10, edit("Processing", { sa_v2_job_id: "J1" })), { isEdit: true }, { script: { status: [st("VALIDATING"), st("VALIDATING"), st("COMPLETED")] } });
    check("mounted ON Processing: STATUS by sa_id, worker kicked, completed message", r.trace.filter((t) => t[0] === "runWorkflow" && t[1] === SUBMIT && t[2].operation === "STATUS" && t[2].sa_id === "77").length === 3 &&
      r.trace.filter((t) => t[0] === "runWorkflow" && t[1] === WORKER).length >= 1 && r.trace.some((t) => t[0] === "$message.success"), r.trace.map((t) => t[0]));
    const storage = {};
    const failed = st("FAILED", { job_id: "5001", error_message: "Insufficient quantity" });
    r = await mount(mountedOn, record(10, edit("Draft", { sa_v2_job_id: "5001" })), { isEdit: true }, { storage: storage, script: { status: [failed] } });
    const r2 = await mount(mountedOn, record(10, edit("Draft", { sa_v2_job_id: "5001" })), { isEdit: true }, { storage: storage, script: { status: [failed] } });
    check("mounted ON Draft after a FAILED job: shown once per browser", r.trace.filter((t) => t[0] === "$message.warning" && /Insufficient quantity/.test(t[1])).length === 1 &&
      r2.trace.filter((t) => t[0] === "$message.warning").length === 0 && r2.trace.filter((t) => t[0] === "runWorkflow").length === 0);
  }
  H.done("SA form");
})();
