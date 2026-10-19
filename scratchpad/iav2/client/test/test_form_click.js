// IA form, the Completed / Complete & Post buttons: the switch-OFF fall-through (= the base v32 click, call for call), the
// routing, the V2 path (switch on, test ids), Complete & Post (the classic posting code once, on COMPLETED only), awaitLink.
// Every variant is derived from the shipped file whatever state it ships in.
//   node test/test_form_click.js
const H = require("./harness");
const { check, same } = H;

const BASE = H.readJSON(H.FILES.formBase);
const BUILT = H.readJSON(H.FILES.form);
const T = H.TEST_IDS;
const SUBMIT = T.IA_V2_SUBMIT;
const WORKER = T.IA_V2_WORKER;
const IA_SAVE = "2098335576774463489";
const ACC = "2013511169625042946";
const ORG = "1996787068457861121";
const BUTTONS = { button_completed: "onClick_saveAsCompleted", comp_post_button: "onClick_saveAsCompletedPost" };
const bound = (doc, model) => H.byKey(doc, H.findModel(doc.list, model).events.onClick);
const isV2 = (e) => e.name.indexOf("iaV2_") === 0;
const docWith = (sw, wf) => {
  const d = H.clone(BUILT);
  for (const e of d.config.eventScript) if (isV2(e)) e.func = H.variant(e.func, sw, wf);
  return d;
};
const OFFDOC = docWith({ master: false }, H.OFF_IDS);
const ON = docWith({ master: true }, T);
const ON_NO_POST = docWith({ master: true, completePost: false }, T);
const ON_POST_ONLY = docWith({ master: true, complete: false }, T);
const ON_NONE = docWith({ master: true, complete: false, completePost: false }, T);
const ON_IDS_0 = docWith({ master: true }, H.OFF_IDS);

const pick = (j, o) => Object.assign({ material_id: "M", location_id: "L" + j, storage_location_id: null, batch_id: null, balance_id: "B" + j, sm_quantity: 2,
  category: "Unrestricted", plant_id: "2002", organization_id: ORG, is_deleted: 0, expired_date: null, manufacturing_date: null, unrestricted_qty: 100, balance_quantity: 100 }, o || {});
const line = (i, n, o) => Object.assign({ item_selection: "I" + i, item_name: "Item " + i, item_desc: "", requested_qty: n * 2, total_quantity: n * 2, quantity_uom: "77",
  uom_options: "[]", item_remark: "", project_id: "", organization_id: ORG, issuing_plant: "2002", line_index: i + 1, balance_id: "", fm_key: "k" + i,
  temp_qty_data: JSON.stringify(Array.from({ length: n }, (_, j) => pick(j, { material_id: "I" + i }))), temp_hu_data: "", stock_summary: "x" }, o || {});
// a record as getValues() returns it (prod run 2111001816408920065's keys + the dialog model and the new fields), `picks` picks
const record = (picks, o) => {
  const lines = [];
  for (let i = 0, left = picks; left > 0; i++, left -= 10) lines.push(line(i, Math.min(10, left)));
  return Object.assign({
    $_v: 82, _vts: 1792136665344, isTrusted: true, batch_no: "", button_completed: "", button_draft: "", completed_status: "<html>c</html>", draft_status: "<html>d</html>",
    expired_date: null, flex_2det1nd2: "", flex_t6y2yh5r: "", fullyposted_status: "<html>f</html>", issued_status: "<html>i</html>", processing_status: "<html>p</html>",
    inventory_category: "Unrestricted", issued_by: "jean", issuing_operation_faci: "2002", item_assembly_date: "2026-10-19", item_assembly_status: "", item_desc: "",
    item_id: "P1", item_name: "Assembly", item_qty: 1, item_uom: "77", location_id: "L9", manufacturing_date: null, organization_id: ORG, page_status: "Add",
    posted_status: "", project_id: "", reference_documents: [], remarks: "", remarks_2: "", remarks_3: "", sia_uuid: "", stock_movement: lines, stock_movement_no: "",
    stock_movement_no_type: 2033, storage_location_id: "S1", sm_item_balance: { material_id: "X", table_item_balance: [] }, ia_v2_job_id: "", ia_idem_key: "",
    dialog_manufacturing_date: null,
  }, o || {});
};
const edit = (status, o) => Object.assign({ page_status: "Edit", id: "77", item_assembly_status: status, stock_movement_no: "IA-77" }, o || {});
const NOT_RECORD = ["ia_v2_job_id", "ia_idem_key", "_data", "$_v", "_vts", "isTrusted", "sm_item_balance", "button_draft", "button_completed", "comp_post_button",
  "button_post", "draft_status", "issued_status", "completed_status", "fullyposted_status", "processing_status", "flex_2det1nd2", "flex_t6y2yh5r", "item_assembly_tittle",
  "dialog_manufacturing_date"];

// a BOM whose components differ from the record's (the classic confirm fires)
const BOM = { parent_mat_bom_version: "V1", parent_mat_is_default: 1, subform_sub_material: [{ bom_material_code: "OTHER", consume_type: "", sub_material_name: "Other" }] };
const dbOf = (o) => (name, q) => {
  if (name === "bill_of_materials") return { data: o.bom ? [BOM] : [] };
  if (name === "accounting_integration") return { data: o.noAcc ? [] : [{ acc_integration_type: o.accType || "SQL Accounting V2", agent_id: "A1", organization_id: q.where && q.where.organization_id }] };
  return { data: [] };
};
// answers: SUBMIT (operation SUBMIT / STATUS), WORKER, the classic IA_SAVE, ACC_PRODUCER
const answers = (s) => (id, params, w) => {
  if (id === SUBMIT) {
    if (params.operation === "SUBMIT") {
      s.submitCalls = (s.submitCalls || 0) + 1;
      const a = typeof s.submit === "function" ? s.submit(params, w, s.submitCalls) : s.submit;
      return a && (a.reject !== undefined || a.envelope) ? (a.envelope ? a.envelope : a) : { data: a };
    }
    const list = s.status || [{ route: "STATUS", code: "200", job_id: "J1", job_status: "COMPLETED", terminal: "YES", ia_id: "77" }];
    s.statusCalls = (s.statusCalls || 0) + 1;
    return { data: list[Math.min(s.statusCalls - 1, list.length - 1)] };
  }
  if (id === WORKER) return { data: s.worker || { worker_route: "WORKED", processed: "1", job_id: params.job_id, job_status: "VALIDATING" } };
  if (id === IA_SAVE) return s.classic && s.classic.reject !== undefined ? s.classic : { data: s.classic || { code: "200", message: "ok", id: ["77"] } };
  if (id === ACC) return { data: { code: "200" } };
  return { data: {} };
};
const QUEUED_NEW = { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", terminal: "NO", ia_id: "88", ia_no: "IA-88" };
const QUEUED_EDIT = { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", terminal: "NO", ia_id: "77", ia_no: "IA-77" };
const st = (job_status, o) => Object.assign({ route: "STATUS", code: "200", job_id: "J1", job_status: job_status,
  terminal: ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"].indexOf(job_status) >= 0 ? "YES" : "NO", ia_id: "77", ia_no: "IA-77", progress_percent: "10", action: "DIRECT" }, o || {});

const run = async (doc, model, values, o) => {
  o = o || {};
  const w = H.world({ storage: o.storage, db: dbOf(o) });
  const self = H.makeThis(w, doc, { values: values, data: o.data, answer: answers(o.script || {}), getValuesThrows: o.getValuesThrows, alertRejects: o.alertRejects,
    invalid: o.invalid, confirm: o.confirm });
  await H.fire(w, bound(doc, model), self);
  return { w: w, self: self, trace: w.trace, calls: (id, op) => w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === id && (!op || t[2].operation === op)) };
};
const named = (trace, name) => trace.filter((t) => t[0] === name);
const v2calls = (trace) => trace.filter((t) => t[0] === "runWorkflow" && [SUBMIT, WORKER].indexOf(t[1]) >= 0);
// the classic Complete & Post's posting segment: from the accounting_integration read to the ACC_PRODUCER call
const postSegment = (trace) => {
  const a = trace.findIndex((t) => t[0] === "db.get" && t[1].collection === "accounting_integration");
  const b = trace.findIndex((t) => t[0] === "runWorkflow" && t[1] === ACC);
  return a < 0 ? [] : trace.slice(a, b < 0 ? undefined : b + 1).filter((t) => t[0] !== "hideLoading");
};

(async () => {
  // ---- wiring
  for (const [model, classic] of Object.entries(BUTTONS)) {
    const b0 = H.byKey(BASE, H.findModel(BASE.list, model).events.onClick);
    const b1 = bound(BUILT, model);
    check("wiring " + model + ": base bound " + classic, b0.name === classic, b0.name);
    check("wiring " + model + ": built bound to its iaV2_ handler (js)", b1.name === (model === "button_completed" ? "iaV2_onClick_completed" : "iaV2_onClick_completed_post") && b1.type === "js", b1.name);
    check("wiring " + model + ": classic entry byte-identical", same(H.byName(BUILT, classic), b0), classic);
    check("wiring " + model + ": the handler names its classic and its post flag", b1.func.indexOf('const IA_CLASSIC = "' + classic + '";') > 0 &&
      b1.func.indexOf("const IA_BUTTON_POSTS = " + (model === "comp_post_button") + ";") > 0);
    const shipped = H.shippedState(b1.func);
    check("shipped " + model + " " + (H.EXPECT_ON ? "ON" : "OFF") + " with the ids.json ids", same(shipped.switches, { ASYNC_IA_ENABLED: H.EXPECT_ON, ASYNC_IA_REVERT_ENABLED: H.EXPECT_ON }) &&
      same(shipped.ids, { IA_V2_SUBMIT: H.IDS.IA_V2_SUBMIT, IA_V2_WORKER: H.IDS.IA_V2_WORKER, IA_REVERT_V2_SUBMIT: H.IDS.IA_REVERT_V2_SUBMIT, IA_REVERT_V2_WORKER: H.IDS.IA_REVERT_V2_WORKER }), shipped);
  }

  // ---- switch OFF: the built click == the base click, call for call (the triggerEvent hop aside)
  const offCases = [
    ["Add, 60 picks", record(60)], ["Add, 10 picks", record(10)], ["Clone, 80 picks", record(80, { page_status: "Clone", id: "55" })],
    ["Edit Draft, 60 picks", record(60, edit("Draft"))], ["Edit Draft, HU", record(60, edit("Draft", { stock_movement: [line(0, 60, { temp_hu_data: "[{\"x\":1}]" })] }))],
    ["Edit Completed", record(60, edit("Completed"))], ["View", record(60, { page_status: "View", id: "77", item_assembly_status: "Draft" })],
  ];
  const offOpts = [["", {}], [" (BOM variance, confirmed)", { bom: true }], [" (BOM variance, cancelled)", { bom: true, confirm: () => "cancel" }], [" (invalid form)", { invalid: [{ field: "item_qty", message: "Quantity is required" }] }]];
  const offAnswers = [["classic 200", { code: "200", message: "ok", id: ["77"] }], ["classic 400", { code: "400", message: "Plant is required" }], ["classic rejected", { reject: { data: null, msg: "boom" } }]];
  for (const [model, classic] of Object.entries(BUTTONS)) {
    for (const [what, values] of offCases) {
      for (const [ow, o] of offOpts) {
        for (const [aw, classicAnswer] of offAnswers) {
          const oo = Object.assign({}, o, { script: { classic: classicAnswer } });
          const a = await run(BASE, model, values, oo);
          const b = await run(OFFDOC, model, values, oo);
          check("OFF " + model + " / " + what + ow + " / " + aw + ": exactly the classic",
            same(b.trace[0], ["triggerEvent", classic, "(no args)"]) && same(b.trace.slice(1), a.trace) && same(a.self.models, b.self.models) &&
            !b.trace.some((t) => t[0].indexOf("localStorage") === 0) && v2calls(b.trace).length === 0,
            { base: a.trace.slice(0, 6), built: b.trace.slice(0, 7) });
        }
      }
    }
  }
  // the shipped ON shape with the ids still "0" (the integration step not done yet) behaves as OFF
  for (const [model, classic] of Object.entries(BUTTONS)) {
    const a = await run(BASE, model, record(60, edit("Draft")), {});
    const b = await run(ON_IDS_0, model, record(60, edit("Draft")), {});
    check("ON with workflow ids 0 " + model + ": exactly the classic", same(b.trace.slice(1), a.trace) && same(b.trace[0], ["triggerEvent", classic, "(no args)"]));
  }

  // ---- switch ON: routing to the classic (once), no SUBMIT
  for (const [model, classic] of Object.entries(BUTTONS)) {
    const classicCases = [["50 picks", record(50), {}], ["50 picks + picks of 0", record(50, { stock_movement: [line(0, 50), line(1, 3, { temp_qty_data: JSON.stringify([pick(1, { sm_quantity: 0 }), pick(2, { sm_quantity: "0" })]) })] }), {}],
      ["HU on a line (temp_hu_data)", record(60, { stock_movement: [line(0, 60, { temp_hu_data: "[{\"handling_unit_id\":\"H1\"}]" })] }), {}],
      ["HU pick", record(60, { stock_movement: [line(0, 60, { temp_qty_data: JSON.stringify(Array.from({ length: 60 }, (_, j) => pick(j, j === 7 ? { handling_unit_id: "H1" } : {}))) })] }), {}],
      ["serial pick", record(60, { stock_movement: [line(0, 60, { temp_qty_data: JSON.stringify(Array.from({ length: 60 }, (_, j) => pick(j, { serial_number: j === 3 ? "SN1" : "" }))) })] }), {}],
      ["stored Completed", record(60, edit("Completed")), {}], ["stored Processing", record(60, edit("Processing")), {}], ["stored Fully Posted", record(60, edit("Fully Posted")), {}],
      ["View", record(60, { page_status: "View", id: "77", item_assembly_status: "Draft" }), {}], ["Edit without id", record(60, { page_status: "Edit", item_assembly_status: "Draft" }), {}],
      ["getValues throws", record(60), { getValuesThrows: true }], ["invalid form", record(60), { invalid: [{ field: "item_qty", message: "Quantity is required" }] }]];
    for (const [what, values, o] of classicCases) {
      const r = await run(ON, model, values, o);
      const tr = named(r.trace, "triggerEvent");
      check("ON " + model + " " + what + " -> the classic handler once, no SUBMIT", r.calls(SUBMIT).length === 0 && r.calls(WORKER).length === 0 && tr.length === 1 && tr[0][1] === classic &&
        r.calls(IA_SAVE).length === (o.invalid || o.getValuesThrows ? 0 : 1), r.trace.map((t) => t[0] + ":" + (t[1] || "")));
    }
    // the invalid form reaches the classic, which shows its own message
    const inv = await run(ON, model, record(60), { invalid: [{ field: "item_qty", message: "Quantity is required" }] });
    check("ON " + model + " invalid form: the classic shows the field message", named(inv.trace, "$message.error").some((t) => t[1] === "Quantity is required"));
    // the BOM variance confirm cancelled: the click ends (no SUBMIT, no classic)
    const cancel = await run(ON, model, record(60, edit("Draft")), { bom: true, confirm: () => "cancel" });
    check("ON " + model + " BOM variance cancelled: nothing else", cancel.calls(SUBMIT).length === 0 && named(cancel.trace, "triggerEvent").length === 0 && cancel.calls(IA_SAVE).length === 0 &&
      named(cancel.trace, "$confirm").length === 1);
    // NOT_ELIGIBLE / INVALID -> the classic handler once (the classic shows the variance confirm a second time: accepted)
    for (const route of ["NOT_ELIGIBLE", "INVALID"]) {
      const r = await run(ON, model, record(60), { bom: true, script: { submit: { route: route, code: route === "INVALID" ? "400" : "300", reason: "serial numbers" } } });
      const tr = named(r.trace, "triggerEvent");
      check("ON " + model + " " + route + " -> the classic handler once", r.calls(SUBMIT, "SUBMIT").length === 1 && tr.length === 1 && tr[0][1] === classic &&
        r.calls(IA_SAVE).length === 1 && r.calls(WORKER).length === 0 && r.calls(SUBMIT, "STATUS").length === 0 && named(r.trace, "$confirm").length === 2 &&
        r.self.models._data.ia_submitting === 0, r.trace.map((t) => t[0] + ":" + (t[1] || "")));
    }
    // a double click while V2 runs
    const dbl = await run(ON, model, record(60), { data: { ia_submitting: 1 } });
    check("ON " + model + " double click -> already in progress", named(dbl.trace, "$message.warning").length === 1 && dbl.calls(SUBMIT).length === 0 && named(dbl.trace, "triggerEvent").length === 0);
  }
  // per-action switches
  {
    let r = await run(ON_POST_ONLY, "button_completed", record(60), {});
    check("COMPLETE off: the Completed button -> classic", named(r.trace, "triggerEvent").length === 1 && r.calls(SUBMIT).length === 0);
    r = await run(ON_POST_ONLY, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("COMPLETE off, COMPLETE_POST on: Complete & Post -> V2 and posts", r.calls(SUBMIT, "SUBMIT").length === 1 && r.calls(ACC).length === 1);
    r = await run(ON_NONE, "comp_post_button", record(60), {});
    check("both actions off: Complete & Post -> classic", named(r.trace, "triggerEvent").length === 1 && r.calls(SUBMIT).length === 0);
    r = await run(ON_NO_POST, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("COMPLETE_POST off, COMPLETE on: Complete & Post completes via V2, no post, 'post it from the list'", r.calls(SUBMIT, "SUBMIT").length === 1 && r.calls(ACC).length === 0 &&
      !r.trace.some((t) => t[0] === "db.get" && t[1].collection === "accounting_integration") && named(r.trace, "$message.success").some((t) => /Post it from the Item Assembly list/.test(t[1])) &&
      named(r.trace, "dialog.hide").length === 1, r.trace.map((t) => t[0] + ":" + JSON.stringify(t[1] || "").slice(0, 80)));
    r = await run(ON_NO_POST, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMMITTING_IA", { progress_percent: "80" })], worker: { processed: "0", job_id: "J1", job_status: "COMPLETED" } } });
    check("COMPLETE_POST off: at 80 % -> closed with the postLater text, no post", named(r.trace, "$message.success").some((t) => /post it from the list once it shows Completed/.test(t[1])) &&
      r.calls(ACC).length === 0 && named(r.trace, "dialog.hide").length === 1);
  }

  // ---- CONTRACT ruling 9: a background completion only while Revert V2 is on too (its switch and its workflow ids)
  {
    const NO_REVERT = docWith({ master: true, revert: false }, T);
    const NO_REVERT_IDS = docWith({ master: true, revert: true }, Object.assign({}, T, { IA_REVERT_V2_SUBMIT: "0", IA_REVERT_V2_WORKER: "0" }));
    for (const [what, doc] of [["the revert switch off", NO_REVERT], ["the revert workflow ids 0", NO_REVERT_IDS]]) {
      for (const [model, classic] of Object.entries(BUTTONS)) {
        const a = await run(BASE, model, record(60, edit("Draft")), {});
        const b = await run(doc, model, record(60, edit("Draft")), {});
        check("ruling 9, " + what + ": " + model + " with 60 picks = exactly the classic", same(b.trace[0], ["triggerEvent", classic, "(no args)"]) && same(b.trace.slice(1), a.trace) &&
          v2calls(b.trace).length === 0);
      }
    }
  }

  // ---- switch ON: the V2 path (both buttons)
  const NEWKEY = new RegExp("^IA:" + ORG + ":new-[a-z0-9]+:[0-9a-f]{16}:1$");
  const KEY77 = new RegExp("^IA:" + ORG + ":77:[0-9a-f]{16}:1$");
  for (const model of Object.keys(BUTTONS)) {
    const posts = model === "comp_post_button";
    let r = await run(ON, model, record(51), { script: { submit: QUEUED_NEW, status: [st("VALIDATING", { ia_id: "88" }), st("COMPLETED", { ia_id: "88", ia_no: "IA-88" })] } });
    const p = (r.calls(SUBMIT, "SUBMIT")[0] || [])[2] || {};
    check("ON " + model + " Add: one SUBMIT with the section 7 request", r.calls(SUBMIT, "SUBMIT").length === 1 &&
      same(Object.keys(p).sort(), ["form", "ia_id", "idempotency_key", "operation", "pageStatus", "saveAs", "source"]) && p.operation === "SUBMIT" && p.saveAs === "Completed" &&
      p.pageStatus === "Add" && p.ia_id === "" && p.source === "FORM" && NEWKEY.test(p.idempotency_key) && Object.keys(p).every((k) => k === "form" || typeof p[k] === "string"),
      Object.assign({}, p, { form: Object.keys(p.form || {}) }));
    check("ON " + model + " Add: the record without the NOT_RECORD / dialog_ keys", p.form && Array.isArray(p.form.stock_movement) && p.form.stock_movement.length === 6 &&
      NOT_RECORD.every((k) => !(k in p.form)) && p.form.page_status === "Add" && p.form.sia_uuid === "" && p.form.organization_id === ORG && p.form.item_id === "P1", p.form && Object.keys(p.form));
    check("ON " + model + " Add: worker kicked with the job; STATUS by key + linked ia_id until COMPLETED; closed", same(r.calls(WORKER)[0][2], { job_id: "J1" }) &&
      r.calls(SUBMIT, "STATUS").length === 2 && r.calls(SUBMIT, "STATUS").every((t) => t[2].idempotency_key === p.idempotency_key && t[2].ia_id === "88" && same(t[2].form, {}) &&
        t[2].pageStatus === "Edit" && t[2].saveAs === "Completed") && named(r.trace, "dialog.hide").length === 1 && named(r.trace, "triggerEvent").length === 0 &&
      r.self.models._data.ia_submitting === 0 && r.calls(IA_SAVE).length === 0, r.trace.map((t) => t[0] + ":" + (t[1] || "")));
    check("ON " + model + " Add: polls every 2.5 s", r.w.now - 1800000000000 >= 5000 && r.w.now - 1800000000000 < 6000, r.w.now - 1800000000000);
    if (posts) {
      const acc = r.trace.filter((t) => t[0] === "runWorkflow" && t[1] === ACC);
      check("ON Complete & Post (Add) COMPLETED: the classic post once, on the linked id", acc.length === 1 && same(acc[0][2], { agent_id: "A1", task_type: "post_item_assembly", payload: ["88"], priority: "0" }) &&
        r.trace.filter((t) => t[0] === "db.update").length === 1 && same(r.trace.find((t) => t[0] === "db.update").slice(1), [{ collection: "sm_item_assembly", doc: "88" }, { posted_status: "Pending Post" }]) &&
        named(r.trace, "$message.success").some((t) => t[1] === "Item Assembly completed successfully."), r.trace.map((t) => t[0] + ":" + JSON.stringify(t[1] || "").slice(0, 60)));
    } else {
      check("ON Completed (Add) COMPLETED: success, no post", named(r.trace, "$message.success").some((t) => t[1] === "Item Assembly IA-88 completed.") && r.calls(ACC).length === 0 &&
        !r.trace.some((t) => t[0] === "db.update"));
    }

    // Edit of a stored Draft: pageStatus Edit, ia_id 77, the key on the id
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const p2 = r.calls(SUBMIT, "SUBMIT")[0][2];
    check("ON " + model + " Edit: pageStatus Edit, ia_id 77, key on the id", p2.pageStatus === "Edit" && p2.ia_id === "77" && KEY77.test(p2.idempotency_key) && named(r.trace, "dialog.hide").length === 1, p2.idempotency_key);
    // Clone: pageStatus Clone, ia_id "" (SUBMIT strips the source id)
    r = await run(ON, model, record(60, { page_status: "Clone", id: "55", item_assembly_status: "Completed" }), { script: { submit: QUEUED_NEW, status: [st("COMPLETED", { ia_id: "88" })] } });
    const p3 = r.calls(SUBMIT, "SUBMIT")[0][2];
    check("ON " + model + " Clone: pageStatus Clone, ia_id empty, new- key", p3.pageStatus === "Clone" && p3.ia_id === "" && NEWKEY.test(p3.idempotency_key));

    // the verdict at 80 %: the Completed button closes and drives the worker on; Complete & Post waits for COMPLETED
    const waits = Array.from({ length: 8 }, () => st("VALIDATING"));
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: waits.concat([st("COMMITTING_IA", { progress_percent: "80" }), st("COMMITTING_IA", { progress_percent: "85" }), st("COMPLETED")]),
      worker: { processed: "1", job_id: "J1", job_status: "COMPLETED" } } });
    if (posts) {
      check("ON Complete & Post: at 80 % it keeps waiting, posts on COMPLETED (once)", r.calls(SUBMIT, "STATUS").length === 11 && r.calls(ACC).length === 1 &&
        named(r.trace, "dialog.hide").length === 1, { status: r.calls(SUBMIT, "STATUS").length, acc: r.calls(ACC).length });
    } else {
      check("ON Completed: verdict at 80 % -> closed, success, the kick loop", r.calls(SUBMIT, "STATUS").length === 9 && named(r.trace, "dialog.hide").length === 1 &&
        named(r.trace, "$message.success").some((t) => /the stock has moved/.test(t[1])) && r.calls(WORKER).length >= 3, { status: r.calls(SUBMIT, "STATUS").length, kicks: r.calls(WORKER).length });
    }
    // under 80 % while COMMITTING_IA (op 1 only): not a verdict
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMMITTING_IA", { progress_percent: "75" }), st("COMPLETED")] } });
    check("ON " + model + " COMMITTING_IA at 75 %: keeps waiting", r.calls(SUBMIT, "STATUS").length === 2 && named(r.trace, "dialog.hide").length === 1);

    // FAILED (Edit): the error, the form stays, generation + 1, no post; the next click is a new key
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("FAILED", { error_message: "Insufficient quantity - line 4 (RM-0042), bin A1-B2 (Unrestricted)" })] } });
    check("ON " + model + " FAILED (Edit): the error, the form stays, gen 2, seen once, no post", named(r.trace, "$alert").length === 1 && /Insufficient quantity - line 4/.test(named(r.trace, "$alert")[0][1]) &&
      named(r.trace, "dialog.hide").length === 0 && r.self.models._data.ia_gen === 2 && r.self.models._data.ia_submitting === 0 && r.w.storage["ia_v2_failed_seen_J1"] === "1" &&
      r.calls(ACC).length === 0 && !r.trace.some((t) => t[0] === "db.get" && t[1].collection === "accounting_integration"));
    const again = await run(ON, model, record(60, edit("Draft")), { data: r.self.models._data, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("ON " + model + " FAILED -> the next click sends generation 2", again.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === p2.idempotency_key.replace(/:1$/, ":2"));
    r = await run(ON, model, record(60, edit("Draft")), { alertRejects: true, script: { submit: QUEUED_EDIT, status: [st("FAILED", { error_message: "x" })] } });
    check("ON " + model + " FAILED with the alert closed by X: released", r.self.models._data.ia_submitting === 0 && named(r.trace, "hideLoading").length >= 1);
    r = await run(ON, model, record(60), { script: { submit: QUEUED_NEW, status: [st("FAILED", { ia_id: "88", error_message: "x" })] } });
    check("ON " + model + " FAILED (Add): the form closes (a saved Draft now)", named(r.trace, "dialog.hide").length === 1 && named(r.trace, "$alert").length === 1);
    // REQUIRES_REVIEW: warning, closed, no post
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("REQUIRES_REVIEW", { error_message: "IA_RECEIPT_TIMEOUT" })] } });
    check("ON " + model + " REQUIRES_REVIEW: warning, closed, no post", named(r.trace, "$alert").length === 1 && /under review/.test(named(r.trace, "$alert")[0][1]) &&
      named(r.trace, "dialog.hide").length === 1 && r.calls(ACC).length === 0);
    // no job any more
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [{ route: "STATUS", code: "200", job_id: "", job_status: "NONE", terminal: "YES" }] } });
    check("ON " + model + " STATUS NONE while following: warning, closed", named(r.trace, "$message.warning").length === 1 && named(r.trace, "dialog.hide").length === 1 && r.calls(ACC).length === 0);
    // timeout: still QUEUED after 420 s
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("QUEUED")] } });
    const elapsed = r.w.now - 1800000000000;
    check("ON " + model + " 420 s without a verdict: " + (posts ? "postLater" : "info") + " + closed; kicks every 15 s; no post",
      (posts ? named(r.trace, "$message.warning").some((t) => /post it from the list once it shows Completed/.test(t[1])) : named(r.trace, "$message.info").length === 1) &&
      named(r.trace, "dialog.hide").length === 1 && elapsed >= 420000 && elapsed < 425000 && r.calls(WORKER).length >= 28 && r.calls(WORKER).length <= 30 && r.calls(ACC).length === 0,
      { elapsed: elapsed, kicks: r.calls(WORKER).length });
    if (posts) {
      r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMMITTING_IA", { progress_percent: "85" })] } });
      check("ON Complete & Post: stuck at 85 % until the wait ends -> postLater, no post", named(r.trace, "$message.warning").some((t) => t[1] === "Item Assembly IA-77: Still completing in the background; post it from the list once it shows Completed.") &&
        r.calls(ACC).length === 0 && !r.trace.some((t) => t[0] === "db.update"));
    }
    // BUSY / STALE / STOP 400: the message, nothing else
    for (const [route, code] of [["BUSY", "409"], ["STALE", "409"], ["STOP", "400"]]) {
      r = await run(ON, model, record(60, edit("Draft")), { script: { submit: { route: route, code: code, message: "the " + route + " text" } } });
      check("ON " + model + " " + route + " " + code + ": its message only", named(r.trace, route === "STOP" ? "$message.error" : "$message.warning").some((t) => t[1] === "the " + route + " text") &&
        named(r.trace, "triggerEvent").length === 0 && r.calls(WORKER).length === 0 && r.self.models._data.ia_submitting === 0 && r.calls(ACC).length === 0);
    }
    // no answer twice / STOP 500 / the platform envelope (resolved or rejected): the key pinned, re-sent by the next click with other content
    const env = { code: 400, success: false, data: null, msg: "执行工作流节点[Generate Batch]报错[Duplicate Batch Format found.]" };
    for (const [what, submit, text] of [["transport failure", { reject: new Error("Network Error") }, "No response from workflow. Please try again - the same completion is sent again."],
      ["STOP 500", { route: "STOP", code: "500", message: "The completion could not be queued: please try again." }, "The completion could not be queued: please try again."],
      ["envelope resolved", { envelope: env }, "Duplicate Batch Format found."], ["envelope rejected", { reject: env }, "Duplicate Batch Format found."]]) {
      r = await run(ON, model, record(60, edit("Draft")), { script: { submit: submit } });
      const ks = r.calls(SUBMIT, "SUBMIT").map((t) => t[2].idempotency_key);
      const b = await run(ON, model, record(61, edit("Draft")), { data: r.self.models._data, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
      check("ON " + model + " " + what + ": its message, the key pinned and re-used by the next click", named(r.trace, "$message.error").some((t) => t[1] === text) &&
        ks.length === (what === "STOP 500" || what === "envelope resolved" ? 1 : 2) && ks.every((k) => k === ks[0]) && b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === ks[0] &&
        r.self.models._data.ia_pinned_edit === ks[0], { ks: ks, msgs: named(r.trace, "$message.error") });
      const add = await run(ON, model, record(60), { script: { submit: submit } });
      check("ON " + model + " " + what + " on an Add: Save as Draft hidden", same(named(add.trace, "hide").map((x) => x[1]), [["button_draft"]]) && named(add.trace, "dialog.hide").length === 0);
    }
    // the key's job already exists: STATUS answers
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: st("COMPLETED") } });
    check("ON " + model + " STATUS COMPLETED at submit: already completed, closed, never posted twice", named(r.trace, "$message.success").some((t) => /is already completed/.test(t[1])) &&
      named(r.trace, "dialog.hide").length === 1 && r.calls(ACC).length === 0 && r.calls(SUBMIT, "STATUS").length === 0);
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: st("FAILED", { error_message: "Insufficient quantity" }) } });
    check("ON " + model + " STATUS FAILED at submit: the reason, gen 2", named(r.trace, "$alert").length === 1 && r.self.models._data.ia_gen === 2);
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: st("VALIDATING"), status: [st("COMPLETED")] } });
    check("ON " + model + " STATUS running at submit: followed", r.calls(SUBMIT, "STATUS").length === 1 && named(r.trace, "dialog.hide").length === 1);
  }

  // ---- Complete & Post: the posting segment is the classic's, call for call
  {
    const a = await run(BASE, "comp_post_button", record(10, edit("Draft")), { script: { classic: { code: "200", message: "ok", id: ["77"] } } });
    const b = await run(ON, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("Complete & Post V2: the posting calls = the classic's (accounting read by the global organization, Pending Post, message, close, ACC_PRODUCER)",
      postSegment(a.trace).length >= 5 && same(postSegment(a.trace), postSegment(b.trace)), { classic: postSegment(a.trace), v2: postSegment(b.trace) });
    for (const acc of ["AutoCount Accounting V2", "No Accounting Integration"]) {
      const c1 = await run(BASE, "comp_post_button", record(10, edit("Draft")), { accType: acc });
      const c2 = await run(ON, "comp_post_button", record(60, edit("Draft")), { accType: acc, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
      check("Complete & Post V2 with " + acc + ": the classic's posting calls", same(postSegment(c1.trace), postSegment(c2.trace)) && c2.calls(ACC).length === (acc === "No Accounting Integration" ? 0 : 1));
    }
    const noAcc = await run(ON, "comp_post_button", record(60, edit("Draft")), { noAcc: true, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("Complete & Post V2 without an accounting row: 'completed, but posting could not be started', closed", named(noAcc.trace, "$message.warning").some((t) => /posting could not be started/.test(t[1])) &&
      named(noAcc.trace, "dialog.hide").length === 1 && noAcc.calls(ACC).length === 0);
  }

  // ---- a new assembly's job answered before it was linked: the SAME key is kept until linked, whichever button
  const TWIN = st("VALIDATING", { ia_id: "", ia_no: "" });
  {
    const r = await run(ON, "button_completed", record(51), { script: { submit: TWIN, status: [TWIN, st("COMPLETED", { ia_id: "88" })] } });
    const key = r.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    const polls = r.calls(SUBMIT, "STATUS");
    check("Add answered without ia_id, linked on the 2nd poll -> follows the job, closed", polls.length >= 2 && polls.slice(0, 2).every((t) => t[2].idempotency_key === key && t[2].ia_id === "0") &&
      named(r.trace, "dialog.hide").length === 1 && r.self.models._data.ia_pinned_new === "" && named(r.trace, "triggerEvent").length === 0, polls.map((t) => [t[2].ia_id, t[2].idempotency_key === key]));
  }
  {
    const r = await run(ON, "button_completed", record(51), { script: { submit: TWIN, status: [TWIN] } });
    const key = r.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    const elapsed = r.w.now - 1800000000000;
    check("never linked within 90 s -> the form stays, Save as Draft hidden, the SAME key pinned", named(r.trace, "dialog.hide").length === 0 && same(named(r.trace, "hide").map((x) => x[1]), [["button_draft"]]) &&
      r.self.models._data.ia_pinned_new === key && r.self.models._data.ia_submitting === 0 && elapsed >= 90000 && elapsed < 95000 &&
      named(r.trace, "$message.warning").some((t) => /still being prepared/.test(t[1])), { elapsed: elapsed, data: r.self.models._data });
    const b = await run(ON, "comp_post_button", record(52), { data: r.self.models._data, script: { submit: st("VALIDATING", { ia_id: "88" }), status: [st("COMPLETED", { ia_id: "88" })] } });
    check("... the next click on the OTHER button re-sends the SAME key; linked -> followed, posted on the linked id", b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === key &&
      b.calls(ACC).length === 1 && same(b.calls(ACC)[0][2].payload, ["88"]));
  }
  {
    const r = await run(ON, "button_completed", record(51), { script: { submit: { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", ia_id: "" }, status: [st("FAILED", { ia_id: "", error_message: "IA_INVALID_REQUEST" })] } });
    check("Add QUEUED without ia_id, FAILED while waiting for the link -> the error, the form stays, gen 2, unpinned", named(r.trace, "$alert").length === 1 && named(r.trace, "dialog.hide").length === 0 &&
      r.self.models._data.ia_gen === 2 && r.self.models._data.ia_pinned_new === "");
  }
  // ---- R8: an Add whose job failed before its link answers FAILED with the assembly's id (PREPARE links it with FAILED)
  {
    const r = await run(ON, "button_completed", record(51), { script: { submit: TWIN, status: [TWIN, st("FAILED", { ia_id: "88",
      error_message: "The completion stopped before the Item Assembly was linked to its job: please complete it again." })] } });
    check("R8: Add, FAILED with the assembly's id while waiting for the link -> the reason, the form closes (a saved Draft), gen 2, unpinned",
      named(r.trace, "$alert").length === 1 && /stopped before the Item Assembly was linked/.test(named(r.trace, "$alert")[0][1]) && named(r.trace, "dialog.hide").length === 1 &&
      r.self.models._data.ia_gen === 2 && r.self.models._data.ia_pinned_new === "" && named(r.trace, "triggerEvent").length === 0 && r.calls(SUBMIT, "STATUS").every((x) => x[2].ia_id === "0"));
    const pinned = "IA:" + ORG + ":new-t1:0123456789abcdef:1";
    const b = await run(ON, "comp_post_button", record(51), { data: { ia_pinned_new: pinned }, script: { submit: st("FAILED", { ia_id: "88", error_message: "x" }) } });
    check("R8: Add re-sending its pinned key, the job FAILED with the assembly's id -> the reason, the form closes, no post", named(b.trace, "$alert").length === 1 &&
      named(b.trace, "dialog.hide").length === 1 && b.calls(ACC).length === 0 && b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === pinned && b.self.models._data.ia_gen === 2);
  }
  // the two buttons send the same request for the same content (one job between them)
  {
    const a = await run(ON, "button_completed", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const b = await run(ON, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("Completed and Complete & Post: the same SUBMIT request for the same content", same(a.calls(SUBMIT, "SUBMIT")[0][2], b.calls(SUBMIT, "SUBMIT")[0][2]));
  }
  H.done("form click");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("form click");
});
