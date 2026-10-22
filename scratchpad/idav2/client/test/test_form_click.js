// IDA form, the Completed / Complete & Post buttons: the switch-OFF fall-through (= the base v35 click, call for call), the
// routing (moves, HU, serial, stored status, validateForSave), the V2 path (switch on, test ids), Complete & Post (the classic
// posting code once, on COMPLETED only), awaitLink. Every variant is derived from the shipped file whatever state it ships in.
//   node test/test_form_click.js
const H = require("./harness");
const { check, same } = H;

const BASE = H.readJSON(H.FILES.formBase);
const BUILT = H.readJSON(H.FILES.form);
const T = H.TEST_IDS;
const SUBMIT = T.IDA_V2_SUBMIT;
const WORKER = T.IDA_V2_WORKER;
const IDA_SAVE = "2107305535347552257";
const ACC = "2013511169625042946";
const ORG = "1123598813738675201";
const BUTTONS = { button_completed: "onClick_saveAsCompleted", comp_post_button: "onClick_saveAsCompletedPost" };
const bound = (doc, model) => H.byKey(doc, H.findModel(doc.list, model).events.onClick);
const isV2 = (e) => e.name.indexOf("idaV2_") === 0;
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

// a source pick on the header (temp_qty_data entry, the Select Stock dialog's shape)
const pick = (j, o) => Object.assign({ material_id: "P1", location_id: "L" + j, storage_location_id: "S1", batch_id: null, serial_number: "", balance_id: "B" + j,
  sm_quantity: 2, category: "Unrestricted", plant_id: "2002", organization_id: ORG, is_deleted: 0, expired_date: null, manufacturing_date: null, unrestricted_qty: 100,
  balance_quantity: 100 }, o || {});
// a recovery line (the explode's shape)
const line = (i, o) => Object.assign({ item_selection: "I" + i, item_name: "Item " + i, item_desc: "", requested_qty: 2, bom_ratio: 2, total_quantity: 2, quantity_uom: "77",
  storage_location_id: "S1", location_id: "L1", batch_number: "-", manufacturing_date: "", expired_date: "", item_remark: "", item_remark_2: "", item_remark_3: "",
  project_id: "", organization_id: ORG, issuing_plant: "2002", line_index: i + 1, uom_options: "[]", fm_key: "k" + i }, o || {});
const picksText = (n, o) => JSON.stringify(Array.from({ length: n }, (_, j) => pick(j, o)));
// a record as getValues() returns it (dev run 2108127883327025153's keys + the new fields): `lines` recovery lines, 1 pick
const record = (lines, o) => Object.assign({
  $_v: 82, _vts: 1792136665344, isTrusted: true, button_completed: "", button_draft: "", button_post: "", comp_post_button: "", button_kdsxzl2q: "",
  completed_status: "<html>c</html>", draft_status: "<html>d</html>", fullyposted_status: "<html>f</html>", issued_status: "<html>i</html>", processing_status: "<html>p</html>",
  flex_2det1nd2: "", flex_t6y2yh5r: "", ida_source_stock_mode: "single", item_display_table: [{ item_selection: "P1", item_qty: 2, stock_summary: "x" }],
  issued_by: "jean", issuing_operation_faci: "2002", item_code: "FG-1", item_desc: "", item_disassembly_date: "2026-10-21", item_disassembly_status: "", item_id: "P1",
  item_name: "Assembly", item_qty: 2, item_uom: "77", organization_id: ORG, page_status: "Add", posted_status: "", project_id: "", reference_documents: [], remarks: "",
  remarks_2: "", remarks_3: "", sid_uuid: "", stock_movement: Array.from({ length: lines }, (_, i) => line(i)), stock_movement_no: "", stock_movement_no_type: 2033,
  stock_summary: "x", table_hu: [], table_item_balance: [], temp_hu_data: "", temp_qty_data: picksText(1), sm_item_balance: { material_id: "X", table_item_balance: [] },
  ida_v2_job_id: "", ida_idem_key: "", dialog_manufacturing_date: null, dialog_expired_date: null,
}, o || {});
const edit = (status, o) => Object.assign({ page_status: "Edit", id: "77", item_disassembly_status: status, stock_movement_no: "IDA-77", create_user: "1", tenant_id: "000000" }, o || {});
const NOT_RECORD = ["ida_v2_job_id", "ida_idem_key", "_data", "$_v", "_vts", "isTrusted", "sm_item_balance", "button_draft", "button_completed", "comp_post_button",
  "button_post", "button_kdsxzl2q", "draft_status", "issued_status", "completed_status", "fullyposted_status", "processing_status", "flex_2det1nd2", "flex_t6y2yh5r",
  "ida_source_stock_mode", "item_display_table", "dialog_manufacturing_date", "dialog_expired_date"];
// validate() errors validateForSave filters out (the stock dialog's rules, Batch No's asterisk): the click goes on
const FILTERED = { "sm_item_balance.table_item_balance.0.sm_quantity": { message: "Quantity exceeds the balance" }, "stock_movement.3.batch_number": { message: "Batch No is required" } };
const INVALID = { "issuing_operation_faci": { message: "Plant is required" }, "stock_movement.3.batch_number": { message: "Batch No is required" } };

// a BOM whose components differ from the record's (the classic confirm fires)
const BOM = { parent_mat_bom_version: "V1", parent_mat_is_default: 1, subform_sub_material: [{ bom_material_code: "OTHER", consume_type: "", sub_material_name: "Other" }] };
// the stored rows Complete & Post re-reads before it posts (a COMPLETED job left its IDA Completed + Unposted)
const STORED = () => ({ 77: { item_disassembly_status: "Completed", posted_status: "Unposted" }, 88: { item_disassembly_status: "Completed", posted_status: "Unposted" } });
const dbOf = (o) => {
  const stored = o.stored || STORED();
  return (name, q) => {
    if (name === "bill_of_materials") return { data: o.bom ? [o.bomDoc || BOM] : [] };
    if (name === "accounting_integration") return { data: o.noAcc ? [] : [{ acc_integration_type: o.accType || "SQL Accounting V2", agent_id: "A1", organization_id: q.where && q.where.organization_id }] };
    if (name === "sm_item_disassembly") {
      const id = String((q.where && q.where.id) || q.doc || "");
      return { data: stored[id] ? [Object.assign({ id: id }, stored[id])] : [] };
    }
    return { data: [] };
  };
};
// the stored rows see the posting's own Pending Post write
const writesInto = (stored) => (name, q, o) => {
  if (name === "sm_item_disassembly" && stored[String(q.doc)]) Object.assign(stored[String(q.doc)], o);
};
// answers: SUBMIT (operation SUBMIT / STATUS), WORKER, the classic IDA_SAVE, ACC_PRODUCER
const answers = (s) => (id, params, w) => {
  if (id === SUBMIT) {
    if (params.operation === "SUBMIT") {
      s.submitCalls = (s.submitCalls || 0) + 1;
      const a = typeof s.submit === "function" ? s.submit(params, w, s.submitCalls) : s.submit;
      return a && (a.reject !== undefined || a.envelope) ? (a.envelope ? a.envelope : a) : { data: a };
    }
    const list = s.status || [{ route: "STATUS", code: "200", job_id: "J1", job_status: "COMPLETED", terminal: "YES", ida_id: "77" }];
    s.statusCalls = (s.statusCalls || 0) + 1;
    return { data: list[Math.min(s.statusCalls - 1, list.length - 1)] };
  }
  if (id === WORKER) return { data: s.worker || { worker_route: "WORKED", processed: "1", job_id: params.job_id, job_status: "VALIDATING" } };
  if (id === IDA_SAVE) return s.classic && s.classic.reject !== undefined ? s.classic : { data: s.classic || { code: "200", message: "ok", id: ["77"] } };
  if (id === ACC) return { data: { code: "200" } };
  return { data: {} };
};
const QUEUED_NEW = { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", terminal: "NO", ida_id: "88", ida_no: "IDA-88" };
const QUEUED_EDIT = { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", terminal: "NO", ida_id: "77", ida_no: "IDA-77" };
const st = (job_status, o) => Object.assign({ route: "STATUS", code: "200", job_id: "J1", job_status: job_status,
  terminal: ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"].indexOf(job_status) >= 0 ? "YES" : "NO", ida_id: "77", ida_no: "IDA-77", progress_percent: "10", action: "DIRECT" }, o || {});

const run = async (doc, model, values, o) => {
  o = o || {};
  const w = H.world({ storage: o.storage, storageThrows: o.storageThrows, db: dbOf(o), dbThrows: o.dbThrows, onUpdate: o.stored ? writesInto(o.stored) : undefined });
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

// the classic handlers carry the same three escapes (user, 10-22): base -> built, independently of the builder
const ESC_HELPER = "// the BOM-variance dialog renders HTML: names go in escaped\nconst idaEscHtml = (value) =>\n  String(value === null || value === undefined ? \"\" : value)\n    .replace(/&/g, \"&amp;\")\n    .replace(/</g, \"&lt;\")\n    .replace(/>/g, \"&gt;\")\n    .replace(/\"/g, \"&quot;\")\n    .replace(/'/g, \"&#39;\");\n\n";
const ESC_EDITS = [["const label = line.item_name || line.item_selection;", "const label = idaEscHtml(line.item_name || line.item_selection);"],
  ["`Removed: ${sub.sub_material_name || sub.bom_material_code}`", "`Removed: ${idaEscHtml(sub.sub_material_name || sub.bom_material_code)}`"],
  ["`These components differ from BOM ${bom.parent_mat_bom_version}:<br><br>`", "`These components differ from BOM ${idaEscHtml(bom.parent_mat_bom_version)}:<br><br>`"]];
const escapeClassic = (func) => ESC_EDITS.reduce((t, [a, b]) => t.replace(a, b), func.replace("const confirmBomVariance = async (data) => {", ESC_HELPER + "const confirmBomVariance = async (data) => {"));

(async () => {
  // ---- wiring
  for (const [model, classic] of Object.entries(BUTTONS)) {
    const b0 = H.byKey(BASE, H.findModel(BASE.list, model).events.onClick);
    const b1 = bound(BUILT, model);
    check("wiring " + model + ": base bound " + classic, b0.name === classic, b0.name);
    check("wiring " + model + ": built bound to its idaV2_ handler (js)", b1.name === (model === "button_completed" ? "idaV2_onClick_completed" : "idaV2_onClick_completed_post") && b1.type === "js", b1.name);
    check("wiring " + model + ": classic entry = base + its BOM-variance names HTML-escaped", same(H.byName(BUILT, classic), Object.assign({}, b0, { func: escapeClassic(b0.func) })), classic);
    check("wiring " + model + ": the handler names its classic and its post flag", b1.func.indexOf('const IDA_CLASSIC = "' + classic + '";') > 0 &&
      b1.func.indexOf("const IDA_BUTTON_POSTS = " + (model === "comp_post_button") + ";") > 0);
    const shipped = H.shippedState(b1.func);
    check("shipped " + model + " " + (H.EXPECT_ON ? "ON" : "OFF") + " with the ids.json ids", same(shipped.switches, { ASYNC_IDA_ENABLED: H.EXPECT_ON }) &&
      same(shipped.ids, { IDA_V2_SUBMIT: H.IDS.IDA_V2_SUBMIT, IDA_V2_WORKER: H.IDS.IDA_V2_WORKER }), shipped);
  }

  // ---- switch OFF: the built click == the base click, call for call (the triggerEvent hop aside)
  const offCases = [
    ["Add, 51 moves", record(50)], ["Add, 10 moves", record(9)], ["Clone, 80 moves", record(79, { page_status: "Clone", id: "55" })],
    ["Edit Draft, 61 moves", record(60, edit("Draft"))], ["Edit Draft, HU", record(60, edit("Draft", { temp_hu_data: "[{\"handling_unit_id\":\"H1\"}]" }))],
    ["Edit Completed", record(60, edit("Completed"))], ["View", record(60, { page_status: "View", id: "77", item_disassembly_status: "Draft" })],
  ];
  const offOpts = [["", {}], [" (BOM variance, confirmed)", { bom: true }], [" (BOM variance, cancelled)", { bom: true, confirm: () => "cancel" }],
    [" (invalid form)", { invalid: INVALID }], [" (stock-dialog / Batch No errors only)", { invalid: FILTERED }]];
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
  // the shipped ON shape with the ids still "0" behaves as OFF
  for (const [model, classic] of Object.entries(BUTTONS)) {
    const a = await run(BASE, model, record(60, edit("Draft")), {});
    const b = await run(ON_IDS_0, model, record(60, edit("Draft")), {});
    check("ON with workflow ids 0 " + model + ": exactly the classic", same(b.trace.slice(1), a.trace) && same(b.trace[0], ["triggerEvent", classic, "(no args)"]));
  }

  // ---- switch ON: routing to the classic (once), no SUBMIT
  for (const [model, classic] of Object.entries(BUTTONS)) {
    const classicCases = [
      ["50 moves (1 pick + 49 lines)", record(49), {}],
      ["50 moves (picks of 0 and lines without an item do not count)", record(49, { temp_qty_data: JSON.stringify([pick(0), pick(1, { sm_quantity: 0 }), pick(2, { sm_quantity: "0" })]),
        stock_movement: Array.from({ length: 49 }, (_, i) => line(i)).concat([line(90, { item_selection: "" }), line(91, { item_selection: null })]) }), {}],
      ["50 moves (2 picks + 48 lines)", record(48, { temp_qty_data: picksText(2) }), {}],
      ["HU (temp_hu_data)", record(60, { temp_hu_data: "[{\"handling_unit_id\":\"H1\",\"sm_quantity\":1}]" }), {}],
      ["HU pick (handling_unit_id)", record(60, { temp_qty_data: JSON.stringify([pick(0), pick(1, { handling_unit_id: "H1" })]) }), {}],
      ["HU (table_hu)", record(60, { table_hu: [{ handling_unit_id: "H1" }] }), {}],
      ["serial pick", record(60, { temp_qty_data: JSON.stringify([pick(0, { serial_number: "SN1" })]) }), {}],
      ["serial pick of 0 qty", record(60, { temp_qty_data: JSON.stringify([pick(0), pick(1, { serial_number: "SN1", sm_quantity: 0 })]) }), {}],
      ["stored Completed", record(60, edit("Completed")), {}], ["stored Processing", record(60, edit("Processing")), {}], ["stored Fully Posted", record(60, edit("Fully Posted")), {}],
      ["stored Issued", record(60, edit("Issued")), {}], ["stored blank", record(60, edit("")), {}],
      ["View", record(60, { page_status: "View", id: "77", item_disassembly_status: "Draft" }), {}], ["Edit without id", record(60, { page_status: "Edit", item_disassembly_status: "Draft" }), {}],
      ["no page status", record(60, { page_status: "" }), {}], ["getValues throws", record(60), { getValuesThrows: true }], ["invalid form", record(60), { invalid: INVALID }]];
    for (const [what, values, o] of classicCases) {
      const r = await run(ON, model, values, o);
      const tr = named(r.trace, "triggerEvent");
      check("ON " + model + " " + what + " -> the classic handler once, no SUBMIT", r.calls(SUBMIT).length === 0 && r.calls(WORKER).length === 0 && tr.length === 1 && tr[0][1] === classic &&
        r.calls(IDA_SAVE).length === (o.invalid || o.getValuesThrows ? 0 : 1), r.trace.map((t) => t[0] + ":" + (t[1] || "")));
    }
    // the invalid form reaches the classic, which shows its own message
    const inv = await run(ON, model, record(60), { invalid: INVALID });
    check("ON " + model + " invalid form: the classic shows the field message", named(inv.trace, "$message.error").some((t) => t[1] === "Plant is required"));
    // validateForSave lets the stock dialog's rules and Batch No's asterisk through: a dialog-picked IDA stays on V2
    const filt = await run(ON, model, record(60, edit("Draft")), { invalid: FILTERED, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("ON " + model + " only stock-dialog / Batch No validation errors: V2 (SUBMIT once, no classic)", filt.calls(SUBMIT, "SUBMIT").length === 1 &&
      named(filt.trace, "triggerEvent").length === 0 && filt.calls(IDA_SAVE).length === 0, filt.trace.map((t) => t[0] + ":" + (t[1] || "")));
    // the BOM variance confirm cancelled: the click ends (no SUBMIT, no classic)
    const cancel = await run(ON, model, record(60, edit("Draft")), { bom: true, confirm: () => "cancel" });
    check("ON " + model + " BOM variance cancelled: nothing else", cancel.calls(SUBMIT).length === 0 && named(cancel.trace, "triggerEvent").length === 0 && cancel.calls(IDA_SAVE).length === 0 &&
      named(cancel.trace, "$confirm").length === 1);
    // the variance dialog renders HTML: the line name, the removed component and the BOM version go in escaped
    const XSS = '<img src=x onerror="alert(1)">';
    const xssRec = record(60, edit("Draft"));
    xssRec.stock_movement[0].item_name = XSS;
    let shown = "";
    await run(ON, model, xssRec, { bom: true, bomDoc: Object.assign({}, BOM, { parent_mat_bom_version: XSS, subform_sub_material: [{ bom_material_code: "OTHER", consume_type: "", sub_material_name: XSS }] }),
      confirm: (m) => ((shown = m), "cancel") });
    check("ON " + model + " BOM variance message: names HTML-escaped", shown.indexOf("<img") < 0 && shown.split("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;").length === 4, shown.slice(0, 200));
    // NOT_ELIGIBLE / INVALID -> the classic handler once (the classic shows the variance confirm a second time: accepted)
    for (const route of ["NOT_ELIGIBLE", "INVALID"]) {
      const r = await run(ON, model, record(60), { bom: true, script: { submit: { route: route, code: route === "INVALID" ? "400" : "300", reason: "costing migration" } } });
      const tr = named(r.trace, "triggerEvent");
      check("ON " + model + " " + route + " -> the classic handler once", r.calls(SUBMIT, "SUBMIT").length === 1 && tr.length === 1 && tr[0][1] === classic &&
        r.calls(IDA_SAVE).length === 1 && r.calls(WORKER).length === 0 && r.calls(SUBMIT, "STATUS").length === 0 && named(r.trace, "$confirm").length === 2 &&
        r.self.models._data.ida_submitting === 0, r.trace.map((t) => t[0] + ":" + (t[1] || "")));
    }
    // the classic fallback shows its own variance confirm: escaped too
    const shownAll = [];
    const xr = record(60);
    xr.stock_movement[0].item_name = XSS;
    await run(ON, model, xr, { bom: true, bomDoc: Object.assign({}, BOM, { parent_mat_bom_version: XSS, subform_sub_material: [{ bom_material_code: "OTHER", consume_type: "", sub_material_name: XSS }] }),
      confirm: (m) => (shownAll.push(m), "confirm"), script: { submit: { route: "NOT_ELIGIBLE", code: "300", reason: "costing migration" } } });
    check("ON " + model + " NOT_ELIGIBLE: the V2 and the classic variance confirms both escape the names", shownAll.length === 2 &&
      shownAll.every((m) => m.indexOf("<img") < 0 && m.split("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;").length === 4), shownAll.map((m) => m.slice(0, 120)));
    // a double click while V2 runs
    const dbl = await run(ON, model, record(60), { data: { ida_submitting: 1 } });
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
    r = await run(ON_NONE, "button_completed", record(60), {});
    check("both actions off: Completed -> classic", named(r.trace, "triggerEvent").length === 1 && r.calls(SUBMIT).length === 0);
    r = await run(ON_NO_POST, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("COMPLETE_POST off, COMPLETE on: Complete & Post completes via V2, no post, 'post it from the list'", r.calls(SUBMIT, "SUBMIT").length === 1 && r.calls(ACC).length === 0 &&
      !r.trace.some((t) => t[0] === "db.get" && t[1].collection === "accounting_integration") && named(r.trace, "$message.success").some((t) => /Post it from the Item Disassembly list/.test(t[1])) &&
      named(r.trace, "dialog.hide").length === 1, r.trace.map((t) => t[0] + ":" + JSON.stringify(t[1] || "").slice(0, 80)));
    r = await run(ON_NO_POST, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMMITTING_IDA", { progress_percent: "80" })], worker: { processed: "0", job_id: "J1", job_status: "COMPLETED" } } });
    check("COMPLETE_POST off: at 80 % -> closed with the postLater text, no post", named(r.trace, "$message.success").some((t) => t[1] === "Item Disassembly IDA-77: Still completing in the background; post it from the list once it shows Completed.") &&
      r.calls(ACC).length === 0 && named(r.trace, "dialog.hide").length === 1);
    r = await run(ON_NO_POST, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("QUEUED")] } });
    check("COMPLETE_POST off: the wait ends first -> postLater warning, no post", named(r.trace, "$message.warning").some((t) => /Still completing in the background; post it from the list/.test(t[1])) &&
      r.calls(ACC).length === 0 && !r.trace.some((t) => t[0] === "db.update"));
  }

  // ---- switch ON: the V2 path (both buttons)
  const NEWKEY = new RegExp("^IDA:" + ORG + ":new-[a-z0-9]+:[0-9a-f]{16}:1$");
  const KEY77 = new RegExp("^IDA:" + ORG + ":77:[0-9a-f]{16}:1$");
  for (const model of Object.keys(BUTTONS)) {
    const posts = model === "comp_post_button";
    let r = await run(ON, model, record(50), { script: { submit: QUEUED_NEW, status: [st("VALIDATING", { ida_id: "88" }), st("COMPLETED", { ida_id: "88", ida_no: "IDA-88" })] } });
    const p = (r.calls(SUBMIT, "SUBMIT")[0] || [])[2] || {};
    check("ON " + model + " Add, 51 moves: one SUBMIT with the section 7 request", r.calls(SUBMIT, "SUBMIT").length === 1 &&
      same(Object.keys(p).sort(), ["form", "ida_id", "idempotency_key", "operation", "pageStatus", "saveAs", "source"]) && p.operation === "SUBMIT" && p.saveAs === "Completed" &&
      p.pageStatus === "Add" && p.ida_id === "" && p.source === "FORM" && NEWKEY.test(p.idempotency_key) && Object.keys(p).every((k) => k === "form" || typeof p[k] === "string"),
      Object.assign({}, p, { form: Object.keys(p.form || {}) }));
    check("ON " + model + " Add: the record without the NOT_RECORD / dialog_ keys, columns kept", p.form && Array.isArray(p.form.stock_movement) && p.form.stock_movement.length === 50 &&
      NOT_RECORD.every((k) => !(k in p.form)) && p.form.page_status === "Add" && p.form.sid_uuid === "" && p.form.organization_id === ORG && p.form.item_id === "P1" &&
      p.form.temp_qty_data === picksText(1) && same(p.form.table_hu, []) && same(p.form.table_item_balance, []) && p.form.stock_summary === "x", p.form && Object.keys(p.form));
    check("ON " + model + " Add: worker kicked with the job; STATUS by key + linked ida_id until COMPLETED; closed", same(r.calls(WORKER)[0][2], { job_id: "J1" }) &&
      r.calls(SUBMIT, "STATUS").length === 2 && r.calls(SUBMIT, "STATUS").every((t) => t[2].idempotency_key === p.idempotency_key && t[2].ida_id === "88" && same(t[2].form, {}) &&
        t[2].pageStatus === "Edit" && t[2].saveAs === "Completed" && t[2].source === "FORM" && Object.keys(t[2]).length === 7) && named(r.trace, "dialog.hide").length === 1 &&
      named(r.trace, "triggerEvent").length === 0 && r.self.models._data.ida_submitting === 0 && r.calls(IDA_SAVE).length === 0, r.trace.map((t) => t[0] + ":" + (t[1] || "")));
    check("ON " + model + " Add: polls every 2.5 s", r.w.now - 1800000000000 >= 5000 && r.w.now - 1800000000000 < 6000, r.w.now - 1800000000000);
    if (posts) {
      const acc = r.trace.filter((t) => t[0] === "runWorkflow" && t[1] === ACC);
      check("ON Complete & Post (Add) COMPLETED: the classic post once, on the linked id", acc.length === 1 && same(acc[0][2], { agent_id: "A1", task_type: "post_item_disassembly", payload: ["88"], priority: "0" }) &&
        r.trace.filter((t) => t[0] === "db.update").length === 1 && same(r.trace.find((t) => t[0] === "db.update").slice(1), [{ collection: "sm_item_disassembly", doc: "88" }, { posted_status: "Pending Post" }]) &&
        named(r.trace, "$message.success").some((t) => t[1] === "Item Disassembly completed successfully."), r.trace.map((t) => t[0] + ":" + JSON.stringify(t[1] || "").slice(0, 60)));
    } else {
      check("ON Completed (Add) COMPLETED: success, no post", named(r.trace, "$message.success").some((t) => t[1] === "Item Disassembly IDA-88 completed.") && r.calls(ACC).length === 0 &&
        !r.trace.some((t) => t[0] === "db.update"));
    }

    // Edit of a stored Draft: pageStatus Edit, ida_id 77, the key on the id
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const p2 = r.calls(SUBMIT, "SUBMIT")[0][2];
    check("ON " + model + " Edit: pageStatus Edit, ida_id 77, key on the id", p2.pageStatus === "Edit" && p2.ida_id === "77" && KEY77.test(p2.idempotency_key) && named(r.trace, "dialog.hide").length === 1 &&
      p2.form.id === "77" && p2.form.create_user === "1", p2.idempotency_key);
    // Clone: pageStatus Clone, ida_id "" (SUBMIT strips the source id)
    r = await run(ON, model, record(60, { page_status: "Clone", id: "55", item_disassembly_status: "Completed" }), { script: { submit: QUEUED_NEW, status: [st("COMPLETED", { ida_id: "88" })] } });
    const p3 = r.calls(SUBMIT, "SUBMIT")[0][2];
    check("ON " + model + " Clone: pageStatus Clone, ida_id empty, new- key", p3.pageStatus === "Clone" && p3.ida_id === "" && NEWKEY.test(p3.idempotency_key));
    // 2,000 lines: one SUBMIT with every line
    r = await run(ON, model, record(2000, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("ON " + model + " 2,000 lines: one SUBMIT carrying every line", r.calls(SUBMIT, "SUBMIT").length === 1 && r.calls(SUBMIT, "SUBMIT")[0][2].form.stock_movement.length === 2000);

    // the verdict at 80 %: the Completed button closes and drives the worker on; Complete & Post waits for COMPLETED
    const waits = Array.from({ length: 8 }, () => st("VALIDATING"));
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: waits.concat([st("COMMITTING_IDA", { progress_percent: "80" }), st("COMMITTING_IDA", { progress_percent: "85" }), st("COMPLETED")]),
      worker: { processed: "1", job_id: "J1", job_status: "COMPLETED" } } });
    if (posts) {
      check("ON Complete & Post: at 80 % it keeps waiting, posts on COMPLETED (once)", r.calls(SUBMIT, "STATUS").length === 11 && r.calls(ACC).length === 1 &&
        named(r.trace, "dialog.hide").length === 1, { status: r.calls(SUBMIT, "STATUS").length, acc: r.calls(ACC).length });
    } else {
      check("ON Completed: verdict at 80 % -> closed, success, the kick loop", r.calls(SUBMIT, "STATUS").length === 9 && named(r.trace, "dialog.hide").length === 1 &&
        named(r.trace, "$message.success").some((t) => /the stock has moved/.test(t[1])) && r.calls(WORKER).length >= 3, { status: r.calls(SUBMIT, "STATUS").length, kicks: r.calls(WORKER).length });
    }
    // under 80 % while COMMITTING_IDA (op 1 only): not a verdict
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMMITTING_IDA", { progress_percent: "75" }), st("COMPLETED")] } });
    check("ON " + model + " COMMITTING_IDA at 75 %: keeps waiting", r.calls(SUBMIT, "STATUS").length === 2 && named(r.trace, "dialog.hide").length === 1);

    // FAILED (Edit): the error, the form stays, generation + 1, no post; the next click is a new key
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("FAILED", { error_message: "Insufficient quantity - source pick 1 (FG-0001), bin A1-B2 (Unrestricted)" })] } });
    check("ON " + model + " FAILED (Edit): the error, the form stays, gen 2, seen once, no post", named(r.trace, "$alert").length === 1 && /Insufficient quantity - source pick 1/.test(named(r.trace, "$alert")[0][1]) &&
      named(r.trace, "dialog.hide").length === 0 && r.self.models._data.ida_gen === 2 && r.self.models._data.ida_submitting === 0 && r.w.storage["ida_v2_failed_seen_J1"] === "1" &&
      r.calls(ACC).length === 0 && !r.trace.some((t) => t[0] === "db.get" && t[1].collection === "accounting_integration"));
    const again = await run(ON, model, record(60, edit("Draft")), { data: r.self.models._data, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("ON " + model + " FAILED -> the next click sends generation 2", again.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === p2.idempotency_key.replace(/:1$/, ":2"));
    r = await run(ON, model, record(60, edit("Draft")), { alertRejects: true, script: { submit: QUEUED_EDIT, status: [st("FAILED", { error_message: "x" })] } });
    check("ON " + model + " FAILED with the alert closed by X: released", r.self.models._data.ida_submitting === 0 && named(r.trace, "hideLoading").length >= 1);
    r = await run(ON, model, record(60), { script: { submit: QUEUED_NEW, status: [st("FAILED", { ida_id: "88", error_message: "x" })] } });
    check("ON " + model + " FAILED (Add): the form closes (a saved Draft now)", named(r.trace, "dialog.hide").length === 1 && named(r.trace, "$alert").length === 1);
    // REQUIRES_REVIEW: warning, closed, no post
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("REQUIRES_REVIEW", { error_message: "IDA_RECEIPT_TIMEOUT" })] } });
    check("ON " + model + " REQUIRES_REVIEW: warning, closed, no post", named(r.trace, "$alert").length === 1 && /under review/.test(named(r.trace, "$alert")[0][1]) &&
      named(r.trace, "dialog.hide").length === 1 && r.calls(ACC).length === 0);
    // no job any more
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [{ route: "STATUS", code: "200", job_id: "", job_status: "NONE", terminal: "YES", message: "no background save" }] } });
    check("ON " + model + " STATUS NONE while following: warning, closed", named(r.trace, "$message.warning").length === 1 && named(r.trace, "dialog.hide").length === 1 && r.calls(ACC).length === 0);
    // timeout: still QUEUED after 420 s
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("QUEUED")] } });
    const elapsed = r.w.now - 1800000000000;
    check("ON " + model + " 420 s without a verdict: " + (posts ? "postLater" : "info") + " + closed; kicks every 15 s; no post",
      (posts ? named(r.trace, "$message.warning").some((t) => t[1] === "Item Disassembly IDA-77: Still completing in the background; post it from the list once it shows Completed.") : named(r.trace, "$message.info").length === 1) &&
      named(r.trace, "dialog.hide").length === 1 && elapsed >= 420000 && elapsed < 425000 && r.calls(WORKER).length >= 28 && r.calls(WORKER).length <= 30 && r.calls(ACC).length === 0,
      { elapsed: elapsed, kicks: r.calls(WORKER).length });
    if (posts) {
      r = await run(ON, model, record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMMITTING_IDA", { progress_percent: "85" })] } });
      check("ON Complete & Post: stuck at 85 % until the wait ends -> postLater, no post", named(r.trace, "$message.warning").some((t) => t[1] === "Item Disassembly IDA-77: Still completing in the background; post it from the list once it shows Completed.") &&
        r.calls(ACC).length === 0 && !r.trace.some((t) => t[0] === "db.update"));
    }
    // BUSY / STALE / STOP 400: the message, nothing else
    for (const [route, code] of [["BUSY", "409"], ["STALE", "409"], ["STOP", "400"]]) {
      r = await run(ON, model, record(60, edit("Draft")), { script: { submit: { route: route, code: code, message: "the " + route + " text" } } });
      check("ON " + model + " " + route + " " + code + ": its message only", named(r.trace, route === "STOP" ? "$message.error" : "$message.warning").some((t) => t[1] === "the " + route + " text") &&
        named(r.trace, "triggerEvent").length === 0 && r.calls(WORKER).length === 0 && r.self.models._data.ida_submitting === 0 && r.calls(ACC).length === 0);
    }
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: { route: "BUSY", code: "409", message: "" } } });
    check("ON " + model + " BUSY without a message: the busy text", named(r.trace, "$message.warning").some((t) => t[1] === "This Item Disassembly is being processed in the background - please wait for it to finish."));
    // no answer twice / STOP 500 / the platform envelope (resolved or rejected): the key pinned, re-sent by the next click with other content
    const env = { code: 400, success: false, data: null, msg: "执行工作流节点[Generate Batch]报错[Duplicate Batch Format found.]" };
    for (const [what, submit, text] of [["transport failure", { reject: new Error("Network Error") }, "No response from workflow. Please try again - the same completion is sent again."],
      ["STOP 500", { route: "STOP", code: "500", message: "" }, "The completion could not be queued: please try again."],
      ["envelope resolved", { envelope: env }, "Duplicate Batch Format found."], ["envelope rejected", { reject: env }, "Duplicate Batch Format found."]]) {
      r = await run(ON, model, record(60, edit("Draft")), { script: { submit: submit } });
      const ks = r.calls(SUBMIT, "SUBMIT").map((t) => t[2].idempotency_key);
      const b = await run(ON, model, record(61, edit("Draft")), { data: r.self.models._data, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
      check("ON " + model + " " + what + ": its message, the key pinned and re-used by the next click", named(r.trace, "$message.error").some((t) => t[1] === text) &&
        ks.length === (what === "STOP 500" || what === "envelope resolved" ? 1 : 2) && ks.every((k) => k === ks[0]) && b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === ks[0] &&
        r.self.models._data.ida_pinned_edit === ks[0], { ks: ks, msgs: named(r.trace, "$message.error") });
      const add = await run(ON, model, record(60), { script: { submit: submit } });
      check("ON " + model + " " + what + " on an Add: Save as Draft hidden", same(named(add.trace, "hide").map((x) => x[1]), [["button_draft"]]) && named(add.trace, "dialog.hide").length === 0);
    }
    // the key's job already exists: STATUS answers
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: st("COMPLETED") } });
    check("ON " + model + " STATUS COMPLETED at submit: already completed, closed, never posted twice", named(r.trace, "$message.success").some((t) => /is already completed/.test(t[1])) &&
      named(r.trace, "dialog.hide").length === 1 && r.calls(ACC).length === 0 && r.calls(SUBMIT, "STATUS").length === 0 && !r.trace.some((t) => t[0] === "db.update"));
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: st("FAILED", { error_message: "Insufficient quantity" }) } });
    check("ON " + model + " STATUS FAILED at submit: the reason, gen 2", named(r.trace, "$alert").length === 1 && r.self.models._data.ida_gen === 2);
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: st("VALIDATING"), status: [st("COMPLETED")] } });
    check("ON " + model + " STATUS running at submit: followed", r.calls(SUBMIT, "STATUS").length === 1 && named(r.trace, "dialog.hide").length === 1);
    r = await run(ON, model, record(60, edit("Draft")), { script: { submit: { route: "STATUS", code: "200", job_id: "", job_status: "NONE", terminal: "YES", message: "no background save" } } });
    check("ON " + model + " STATUS NONE at submit: its message, nothing else", named(r.trace, "$message.warning").some((t) => t[1] === "no background save") && r.calls(WORKER).length === 0);
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
    const fail = await run(ON, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("FAILED", { error_message: "x" })] } });
    check("Complete & Post V2, FAILED: no post, no accounting read", fail.calls(ACC).length === 0 && !fail.trace.some((t) => t[0] === "db.get" && t[1].collection === "accounting_integration"));
  }

  // ---- a new disassembly's job answered before it was linked: the SAME key is kept until linked, whichever button
  const TWIN = st("VALIDATING", { ida_id: "", ida_no: "" });
  {
    const r = await run(ON, "button_completed", record(50), { script: { submit: TWIN, status: [TWIN, st("COMPLETED", { ida_id: "88" })] } });
    const key = r.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    const polls = r.calls(SUBMIT, "STATUS");
    check("Add answered without ida_id, linked on the 2nd poll -> follows the job, closed", polls.length >= 2 && polls.slice(0, 2).every((t) => t[2].idempotency_key === key && t[2].ida_id === "0") &&
      named(r.trace, "dialog.hide").length === 1 && r.self.models._data.ida_pinned_new === "" && named(r.trace, "triggerEvent").length === 0, polls.map((t) => [t[2].ida_id, t[2].idempotency_key === key]));
  }
  {
    const r = await run(ON, "button_completed", record(50), { script: { submit: TWIN, status: [TWIN] } });
    const key = r.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    const elapsed = r.w.now - 1800000000000;
    check("never linked within 90 s -> the form stays, Save as Draft hidden, the SAME key pinned", named(r.trace, "dialog.hide").length === 0 && same(named(r.trace, "hide").map((x) => x[1]), [["button_draft"]]) &&
      r.self.models._data.ida_pinned_new === key && r.self.models._data.ida_submitting === 0 && elapsed >= 90000 && elapsed < 95000 &&
      named(r.trace, "$message.warning").some((t) => /still being prepared/.test(t[1])), { elapsed: elapsed, data: r.self.models._data });
    const b = await run(ON, "comp_post_button", record(51), { data: r.self.models._data, script: { submit: st("VALIDATING", { ida_id: "88" }), status: [st("COMPLETED", { ida_id: "88" })] } });
    check("... the next click on the OTHER button re-sends the SAME key; linked -> followed, posted on the linked id", b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === key &&
      b.calls(ACC).length === 1 && same(b.calls(ACC)[0][2].payload, ["88"]));
  }
  {
    const r = await run(ON, "button_completed", record(50), { script: { submit: { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", ida_id: "" }, status: [st("FAILED", { ida_id: "", error_message: "IDA_INVALID_REQUEST" })] } });
    check("Add QUEUED without ida_id, FAILED while waiting for the link -> the error, the form stays, gen 2, unpinned", named(r.trace, "$alert").length === 1 && named(r.trace, "dialog.hide").length === 0 &&
      r.self.models._data.ida_gen === 2 && r.self.models._data.ida_pinned_new === "");
  }
  // an Add whose job failed before its link answers FAILED with the disassembly's id (PREPARE links it with FAILED)
  {
    const r = await run(ON, "button_completed", record(50), { script: { submit: TWIN, status: [TWIN, st("FAILED", { ida_id: "88",
      error_message: "The completion stopped before the Item Disassembly was linked to its job: please complete it again." })] } });
    check("unlinked: Add, FAILED with the disassembly's id while waiting for the link -> the reason, the form closes (a saved Draft), gen 2, unpinned",
      named(r.trace, "$alert").length === 1 && /stopped before the Item Disassembly was linked/.test(named(r.trace, "$alert")[0][1]) && named(r.trace, "dialog.hide").length === 1 &&
      r.self.models._data.ida_gen === 2 && r.self.models._data.ida_pinned_new === "" && named(r.trace, "triggerEvent").length === 0 && r.calls(SUBMIT, "STATUS").every((x) => x[2].ida_id === "0"));
    const pinned = "IDA:" + ORG + ":new-t1:0123456789abcdef:1";
    const b = await run(ON, "comp_post_button", record(51), { data: { ida_pinned_new: pinned }, script: { submit: st("FAILED", { ida_id: "88", error_message: "x" }) } });
    check("unlinked: Add re-sending its pinned key, the job FAILED with the disassembly's id -> the reason, the form closes, no post", named(b.trace, "$alert").length === 1 &&
      named(b.trace, "dialog.hide").length === 1 && b.calls(ACC).length === 0 && b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === pinned && b.self.models._data.ida_gen === 2);
  }
  // the two buttons send the same request for the same content (one job between them); the key follows the content
  {
    const a = await run(ON, "button_completed", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const b = await run(ON, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const c = await run(ON, "button_completed", record(60, edit("Draft", { remarks: "changed" })), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const d = await run(ON, "button_completed", record(60, edit("Draft", { $_v: 99, _vts: 1, isTrusted: false, ida_source_stock_mode: "multiple", item_display_table: [] })), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const ka = a.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
    check("Completed and Complete & Post: the same SUBMIT request for the same content", same(a.calls(SUBMIT, "SUBMIT")[0][2], b.calls(SUBMIT, "SUBMIT")[0][2]));
    check("the key: other content -> another key; NOT_RECORD keys only -> the same key", c.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key !== ka && d.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === ka);
  }
  // ---- review fix 1: the click is claimed before its first await; one post per job
  const CLICK = { field: "button_x", fieldNode: "button_x", currentRef: {}, $eventArgs: [] };
  const handlerOf = (w, doc, model, storage) => {
    const e = bound(doc, model);
    return H.compile(storage ? Object.assign({}, w, { localStorage: storage }) : w, H.sourceOf(e), e.type === "rule");
  };
  const posts = (trace) => ({ acc: trace.filter((t) => t[0] === "runWorkflow" && t[1] === ACC).length,
    pending: trace.filter((t) => t[0] === "db.update" && t[1].collection === "sm_item_disassembly" && t[2].posted_status === "Pending Post").length });
  {
    // two clicks fired before the mock runs either (the first is still in validate / the BOM read)
    for (const [first, second] of [["comp_post_button", "comp_post_button"], ["button_completed", "button_completed"], ["button_completed", "comp_post_button"]]) {
      const single = await run(ON, first, record(60, edit("Draft")), { bom: true, script: { submit: QUEUED_EDIT, status: [st("VALIDATING"), st("COMPLETED")] } });
      const stored = STORED();
      const w = H.world({ db: dbOf({ bom: true, stored: stored }), onUpdate: writesInto(stored) });
      const self = H.makeThis(w, ON, { values: record(60, edit("Draft")), answer: answers({ submit: QUEUED_EDIT, status: [st("VALIDATING"), st("COMPLETED")] }) });
      handlerOf(w, ON, first).call(self, CLICK);
      const flag1 = self.models._data.ida_submitting;
      handlerOf(w, ON, second).call(self, CLICK);
      const flag2 = self.models._data.ida_submitting;
      await H.drain(w);
      const subs = w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === SUBMIT && t[2].operation === "SUBMIT");
      const p = posts(w.trace);
      check("two clicks before either runs (" + first + ", then " + second + "): one SUBMIT flow, the second refused at once, " + (first === "comp_post_button" ? "one post" : "no post"),
        flag1 === 1 && flag2 === 1 && subs.length === 1 && named(w.trace, "$message.warning").filter((t) => t[1] === "Workflow is already in progress. Please wait.").length === 1 &&
        p.acc === (first === "comp_post_button" ? 1 : 0) && p.pending === p.acc && named(w.trace, "triggerEvent").length === 0 && self.models._data.ida_submitting === 0,
        { flag1: flag1, flag2: flag2, subs: subs.length, posts: p });
      // the refused click touches neither the flag nor the loading overlay of the running one (the twin release() is gone)
      check("two clicks (" + first + ", " + second + "): the refused click releases nothing", named(w.trace, "hideLoading").length === named(single.trace, "hideLoading").length &&
        w.trace.findIndex((t) => t[0] === "$message.warning") < w.trace.findIndex((t) => t[0] === "hideLoading"), { two: named(w.trace, "hideLoading").length, one: named(single.trace, "hideLoading").length });
    }
    // every exit before SUBMIT releases the claim: the classic hand-off, Cancel, an invalid form, an error
    for (const [what, values, o] of [["classic hand-off (50 moves)", record(49), {}], ["BOM variance cancelled", record(60, edit("Draft")), { bom: true, confirm: () => "cancel" }],
      ["invalid form", record(60), { invalid: INVALID }], ["getValues throws", record(60), { getValuesThrows: true }]]) {
      const r = await run(ON, "comp_post_button", values, o);
      check("ON " + what + ": the click's claim released", r.self.models._data.ida_submitting === 0 && r.calls(SUBMIT).length === 0);
    }
  }
  {
    // a second tab on the same Draft builds the same key and follows the same job: one post between them
    const tab = (w, stored, storage, delay, label) => {
      const script = { submit: (p, ww, n) => (label === "A" ? QUEUED_EDIT : st("VALIDATING")), status: [st("VALIDATING"), st("VALIDATING"), st("COMPLETED")] };
      const self = H.makeThis(w, ON, { values: record(60, edit("Draft")), answer: answers(script) });
      w.setTimeout(() => handlerOf(w, ON, "comp_post_button", storage).call(self, CLICK), delay);
      return self;
    };
    for (const [what, otherBrowser] of [["the same browser (its post mark)", false], ["another browser, 1 s later (the stored Pending Post)", true]]) {
      const stored = STORED();
      const w = H.world({ db: dbOf({ stored: stored }), onUpdate: writesInto(stored) });
      const other = { s: {}, getItem: (k) => (Object.prototype.hasOwnProperty.call(other.s, k) ? other.s[k] : null), setItem: (k, v) => (other.s[k] = String(v)) };
      tab(w, stored, null, 0, "A");
      tab(w, stored, otherBrowser ? other : null, 1000, "B");
      await H.drain(w);
      const p = posts(w.trace);
      const msgs = w.trace.filter((t) => /^\$message/.test(t[0])).map((t) => t[1]);
      check("second tab, " + what + ": two SUBMITs, both follow the job, ONE post (ACC_PRODUCER x1, Pending Post x1)", w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === SUBMIT && t[2].operation === "SUBMIT").length === 2 &&
        p.acc === 1 && p.pending === 1 && stored["77"].posted_status === "Pending Post" &&
        msgs.some((m) => m === (otherBrowser ? "Item Disassembly IDA-77 completed; not posted from here (Completed, Pending Post)." : "Item Disassembly IDA-77 completed; its posting was already started.")),
        { posts: p, msgs: msgs });
    }
  }
  {
    // the stored row decides even for the only follower: posted meanwhile (the list), gone, or unreadable -> no post
    for (const [what, stored, o, text] of [["already Pending Post", { 77: { item_disassembly_status: "Completed", posted_status: "Pending Post" } }, {}, "Item Disassembly IDA-77 completed; not posted from here (Completed, Pending Post)."],
      ["already Posted (a dict)", { 77: { item_disassembly_status: { dict_key: "Completed" }, posted_status: { dict_key: "Posted" } } }, {}, "Item Disassembly IDA-77 completed; not posted from here (Completed, Posted)."],
      ["gone", {}, {}, "Item Disassembly completed, but posting could not be started. Please post it from the Item Disassembly list."],
      ["unreadable", STORED(), { dbThrows: (name) => name === "sm_item_disassembly" }, "Item Disassembly completed, but posting could not be started. Please post it from the Item Disassembly list."]]) {
      const r = await run(ON, "comp_post_button", record(60, edit("Draft")), Object.assign({ stored: stored, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } }, o));
      check("Complete & Post, COMPLETED but the stored row " + what + ": no post, its message, closed", posts(r.trace).acc === 0 && posts(r.trace).pending === 0 &&
        named(r.trace, "$message.warning").some((t) => t[1] === text) && named(r.trace, "dialog.hide").length === 1, r.trace.filter((t) => /^\$message/.test(t[0])));
    }
    for (const posted of ["Failed Post", "", null]) {
      const r = await run(ON, "comp_post_button", record(60, edit("Draft")), { stored: { 77: { item_disassembly_status: "Completed", posted_status: posted } }, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
      check("Complete & Post, COMPLETED, stored posted_status " + JSON.stringify(posted) + ": posted once", posts(r.trace).acc === 1 && posts(r.trace).pending === 1);
    }
    const blocked = await run(ON, "comp_post_button", record(60, edit("Draft")), { storageThrows: true, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("Complete & Post with browser storage blocked: still posted once (the stored row decides)", posts(blocked.trace).acc === 1 && posts(blocked.trace).pending === 1);
    const marked = await run(ON, "comp_post_button", record(60, edit("Draft")), { storage: { ida_v2_posted_J1: "1" }, script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    check("Complete & Post of a job this browser already posted: no stored read, no post", posts(marked.trace).acc === 0 &&
      !marked.trace.some((t) => t[0] === "db.get" && t[1].collection === "sm_item_disassembly") && named(marked.trace, "$message.success").some((t) => /its posting was already started/.test(t[1])));
    const one = await run(ON, "comp_post_button", record(60, edit("Draft")), { script: { submit: QUEUED_EDIT, status: [st("COMPLETED")] } });
    const read = one.trace.filter((t) => t[0] === "db.get" && t[1].collection === "sm_item_disassembly");
    check("Complete & Post: the stored read is field-limited, by the job's IDA; the mark set", read.length === 1 && same(read[0][1], { collection: "sm_item_disassembly", where: { id: "77", is_deleted: 0 },
      field: "item_disassembly_status,posted_status" }) && one.w.storage.ida_v2_posted_J1 === "1");
  }
  H.done("form click");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("form click");
});
