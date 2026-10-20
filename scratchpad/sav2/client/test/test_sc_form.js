// SC form: the Review button (switch OFF = the base v497 click, call for call, through every confirmation path), the inserted
// V2 branch (switch ON, test ids) and the mounted Processing-SA view. Every variant is derived from the shipped file whatever
// state it ships in; the shipped state itself (ON, the ids.json ids) is asserted under "wiring".
//   node test/test_sc_form.js
const H = require("./harness");
const { check, same, replaceOnce } = H;

const BASE = H.readJSON(H.FILES.scFormBase);
// mounted is compared call for call with the base + the Phase C 2,000-line blocks (test_sc_2k.js: those blocks vs the real base)
const BASE2K = H.withSc2k(BASE);
const BUILT = H.readJSON(H.FILES.scForm);
const SUBMIT = "9001";
const WORKER = "9002";
const SC_WF = "2066808904123076610";
const SA_WF = "2032025505853816833";
const bound = (doc) => H.byKey(doc, H.findModel(doc.list, "button_review").events.onClick);

// the fall-through variant (switches false, ids "0") and the V2 variant (switches on, test ids) of the shipped form
const OFFDOC = H.clone(BUILT);
const ON = H.clone(BUILT);
for (const [doc, on, ids] of [[OFFDOC, false, H.OFF_IDS], [ON, true, { SUBMIT: SUBMIT, WORKER: WORKER }]]) {
  bound(doc).func = H.variant(bound(doc).func, on, ids);
  H.byName(doc, "mounted").func = H.variant(H.byName(doc, "mounted").func, on, ids);
}

const scLine = (i, o) => Object.assign({ id: String(7000 + i), line_index: i + 1, material_id: "M" + i, location_id: "LOC" + i, base_uom_id: "U", uom_id: "U", batch_id: null, plant_id: "2002",
  is_counted: 1, count_qty: 10, system_qty: 9, variance_qty: 1, adjusted_qty: 1, line_status: "Approved", review_status: "Approved", is_serialized: 0, fm_key: "f" + i }, o || {});
// a Stock Count in review as getValues() returns it (prod run 2110939127284371457's keys)
const scRecord = (lines, o) => Object.assign({ id: "500", page_status: "Edit", stock_count_no: "STC/20261016/0069", stock_count_no_type: "2028", stock_count_status: "In Progress",
  review_status: "To Be Reviewed", organization_id: "1001", plant_id: "2002", count_type: "Location", count_method: "Cycle Count", blind_count: 0, previous_status: "In Progress",
  item_list: [{ item_id: "I1" }], total_counted: "1 / 57", total_variance: "1%", _data: {}, dialog_select_stock: { location: {} }, location: "{}", batch_balance: "{}",
  storage_location_id: [], selectedRowIndex: 0, button_review: "", button_sync: "", log_button: "", draft_status: "<html>d</html>", in_review_status: "<html>r</html>",
  flex_0gstrtzk: "", utext_0yczt7nl: "", table_stock_count: lines }, o || {});
const lines = (n, o) => Array.from({ length: n }, (_, i) => scLine(i, typeof o === "function" ? o(i) : o));

const answers = (s) => (id, params) => {
  if (id === SUBMIT) {
    if (params.operation === "SUBMIT") {
      const a = typeof s.submit === "function" ? s.submit(params) : s.submit;
      return a && a.reject ? a : { data: a };
    }
    const list = s.status || [{ route: "STATUS", code: "200", job_id: "J1", job_status: "COMPLETED", terminal: "YES", sa_id: "900", sa_no: "SA/900" }];
    s.statusCalls = (s.statusCalls || 0) + 1;
    return { data: list[Math.min(s.statusCalls - 1, list.length - 1)] };
  }
  if (id === WORKER) return { data: s.worker || { worker_route: "WORKED", processed: "1", job_id: params.job_id, job_status: "VALIDATING" } };
  if (id === SC_WF) return { data: s.sc || { code: "200", message: "Review saved", stockAdjustmentId: "900" } };
  if (id === SA_WF) return { data: s.sa || { code: "200", message: "Stock Adjustment saved successfully" } };
  return { data: {} };
};
const dbOf = (s) => (name, q) => {
  if (name === "stock_adjustment" && q.where && q.where.id === "900") return { data: s.saGone ? [] : [{ id: "900", adjustment_no: "SA/900", stock_adjustment_status: "Draft", stock_adjustment: [] }] };
  if (name === "stock_adjustment" && q.where && q.where.stock_count_id) return { data: s.processing ? [{ id: "900", adjustment_no: "SA/900", stock_adjustment_status: "Processing", sa_v2_job_id: "5001", organization_id: "1001" }] : [] };
  return { data: [] };
};
const run = async (doc, values, o) => {
  o = o || {};
  const s = o.script || {};
  const w = H.world({ db: dbOf(s), storage: o.storage });
  const self = H.makeThis(w, doc, { values: values, data: o.data, answer: answers(s), confirm: o.confirm, getValuesThrows: o.getValuesThrows });
  await H.click(w, doc, bound(doc), self, "button_review");
  return { w: w, self: self, trace: w.trace, calls: (id, op) => w.trace.filter((t) => t[0] === "runWorkflow" && t[1] === id && (!op || t[2].operation === op)) };
};
const named = (trace, name) => trace.filter((t) => t[0] === name);
const st = (job_status, o) => Object.assign({ route: "STATUS", code: "200", job_id: "J1", job_status: job_status, terminal: ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"].indexOf(job_status) >= 0 ? "YES" : "NO",
  sa_id: "900", sa_no: "SA/900", progress_percent: "10" }, o || {});
const QUEUED = { route: "QUEUED", code: "200", job_id: "J1", job_status: "QUEUED", terminal: "NO", sa_id: "900", sa_no: "SA/900", sc_id: "500" };

(async () => {
  // ---- wiring
  const b0 = H.byKey(BASE, H.findModel(BASE.list, "button_review").events.onClick);
  const b1 = bound(BUILT);
  check("wiring: base binds onButtonReviewClick, built binds scV2_onButtonReviewClick", b0.name === "onButtonReviewClick" && b1.name === "scV2_onButtonReviewClick" && b1.type === "js");
  check("wiring: the classic onButtonReviewClick is byte-identical", same(H.byName(BUILT, "onButtonReviewClick"), b0));
  const real = { on: true, SUBMIT: H.REAL.SUBMIT, WORKER: H.REAL.WORKER };
  check("shipped ON with the ids.json ids (Review handler + mounted)", same(H.shippedState(b1.func), real) && same(H.shippedState(H.byName(BUILT, "mounted").func), real),
    [H.shippedState(b1.func), H.shippedState(H.byName(BUILT, "mounted").func)]);

  // ---- switch OFF: the built click == the base click, call for call, through every confirmation path
  const mixed = (n, extra) => lines(n).concat(extra);
  const offCases = [
    ["all approved, 60 variance lines", scRecord(lines(60)), {}],
    ["all approved, 10 lines", scRecord(lines(10)), {}],
    ["60 approved + 3 pending, both confirmed", scRecord(mixed(60, [scLine(60, { line_status: "Pending", review_status: "" }), scLine(61, { line_status: "Pending", review_status: "" }), scLine(62, { line_status: "Counted", review_status: "" })])), {}],
    ["60 approved + 1 pending, adjustment skipped", scRecord(mixed(60, [scLine(60, { line_status: "Pending", review_status: "" })])), { confirm: (m, t) => (t === "Create Stock Adjustment" ? "cancel" : "confirm") }],
    ["pending cancelled", scRecord(mixed(60, [scLine(60, { line_status: "Pending", review_status: "" })])), { confirm: () => "cancel" }],
    ["recount confirmed", scRecord(mixed(60, [scLine(60, { line_status: "Recount", review_status: "Recount" })])), {}],
    ["recount cancelled", scRecord(mixed(60, [scLine(60, { line_status: "Recount", review_status: "Recount" })])), { confirm: () => "cancel" }],
    ["all Cancel lines", scRecord(lines(3, { line_status: "Cancel" })), {}],
    ["STOCK_COUNT 400", scRecord(lines(60)), { script: { sc: { code: 400, msg: "A Stock Adjustment from this Stock Count is being processed" } } }],
    ["no SA created", scRecord(lines(60)), { script: { sc: { code: "200", message: "Review saved" } } }],
    ["SA completion 400", scRecord(lines(60)), { script: { sa: { code: "400", message: "Insufficient quantity" } } }],
    ["SA record gone", scRecord(lines(60)), { script: { saGone: true } }],
    ["serialized lines", scRecord(lines(60, { is_serialized: 1 })), {}],
    ["zero variance", scRecord(lines(60, { variance_qty: 0 })), {}],
    ["getValues throws", scRecord(lines(60)), { getValuesThrows: true }],
  ];
  for (const [what, values, o] of offCases) {
    const a = await run(BASE, values, o);
    const b = await run(OFFDOC, values, o);
    check("OFF " + what + ": exactly the classic", same(a.trace, b.trace) && same(a.self.models, b.self.models) && !b.trace.some((t) => t[0].indexOf("localStorage") === 0 || (t[0] === "runWorkflow" && (t[1] === "0" || t[1] === SUBMIT))),
      { base: a.trace.map((t) => t[0]), built: b.trace.map((t) => t[0]) });
  }

  // ---- switch ON
  const KEY = /^SCR:1001:500:[0-9a-f]{16}:1$/;
  let r = await run(ON, scRecord(lines(60)), { script: { submit: QUEUED, status: [st("VALIDATING", { sa_id: "" }), st("COMPLETED")] } });
  const p = (r.calls(SUBMIT, "SUBMIT")[0] || [])[2] || {};
  const keys = ["operation", "source", "saveAs", "pageStatus", "sa_id", "sc_id", "idempotency_key", "form", "organization_id", "nickname", "adjustment_date", "create_adjustment"];
  const today = new Date(r.w.now - (r.w.now - 1800000000000)).toISOString().split("T")[0];
  check("ON 60 approved variance lines: one SUBMIT REVIEW with the section 7 request", same(Object.keys(p).sort(), keys.slice().sort()) && p.operation === "SUBMIT" && p.source === "REVIEW" &&
    p.saveAs === "Completed" && p.pageStatus === "Edit" && p.sa_id === "" && p.sc_id === "500" && KEY.test(p.idempotency_key) && p.organization_id === "1001" && p.nickname === "tester" &&
    p.adjustment_date === today && p.create_adjustment === "Yes" && Object.keys(p).every((k) => k === "form" || typeof p[k] === "string"), Object.assign({}, p, { form: Object.keys(p.form || {}) }));
  const NR = ["_data", "dialog_select_stock", "location", "batch_balance", "storage_location_id", "selectedRowIndex", "button_review", "button_sync", "log_button", "draft_status", "in_review_status"];
  check("ON: the SC record without the non-record keys (item_list / previous_status / totals kept)", p.form && p.form.table_stock_count.length === 60 && NR.every((k) => !(k in p.form)) &&
    same(p.form.item_list, [{ item_id: "I1" }]) && p.form.previous_status === "In Progress" && p.form.total_counted === "1 / 57" && "flex_0gstrtzk" in p.form, p.form && Object.keys(p.form));
  const stat = r.calls(SUBMIT, "STATUS");
  check("ON: QUEUED -> worker kicked, STATUS by key (source REVIEW, sc_id) until COMPLETED -> success, closed, no classic call", r.calls(WORKER).length >= 1 && same(r.calls(WORKER)[0][2], { job_id: "J1" }) &&
    stat.length === 2 && stat.every((t) => t[2].idempotency_key === p.idempotency_key && t[2].source === "REVIEW" && t[2].sc_id === "500" && same(t[2].form, {})) && stat[0][2].sa_id === "900" &&
    named(r.trace, "dialog.hide").length === 1 && named(r.trace, "$message.success").length === 1 && r.calls(SC_WF).length === 0 && r.calls(SA_WF).length === 0 &&
    named(r.trace, "db.get").length === 0 && r.self.models._data.scr_submitting === 0, r.trace.map((t) => t[0] + (t[0] === "runWorkflow" ? ":" + t[1] : "")));
  // the verdict at 80 % (stock moved): closed, the worker driven on
  r = await run(ON, scRecord(lines(60)), { script: { submit: QUEUED, status: [st("COMMITTING_SA", { progress_percent: "80" })], worker: { processed: "1", job_id: "J1", job_status: "COMPLETED" } } });
  check("ON: COMMITTING_SA at 80 % -> success, closed", named(r.trace, "dialog.hide").length === 1 && named(r.trace, "$message.success").length === 1 && r.calls(WORKER).length >= 2);
  // FAILED: the error, the form and its review stay, generation + 1, the next click a new key
  r = await run(ON, scRecord(lines(60)), { script: { submit: QUEUED, status: [st("FAILED", { error_message: "Stock changed since the review - rebuild failed" })] } });
  check("ON FAILED: the error, the form stays, gen 2", named(r.trace, "$alert").length === 1 && named(r.trace, "dialog.hide").length === 0 && r.self.models._data.scr_gen === 2 &&
    r.self.models._data.scr_submitting === 0 && r.calls(SC_WF).length === 0, r.self.models._data);
  const again = await run(ON, scRecord(lines(60)), { data: r.self.models._data, script: { submit: QUEUED, status: [st("COMPLETED")] } });
  const k2 = again.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key;
  check("ON FAILED -> the next click sends generation 2", k2 === p.idempotency_key.replace(/:1$/, ":2"), [p.idempotency_key, k2]);
  // NOT_ELIGIBLE / INVALID: the classic review goes on - the same STOCK_COUNT call the base makes
  const baseRun = await run(BASE, scRecord(lines(60)), {});
  const baseSC = baseRun.calls(SC_WF).map((t) => t[2]);
  for (const route of ["NOT_ELIGIBLE", "INVALID"]) {
    r = await run(ON, scRecord(lines(60)), { script: { submit: { route: route, code: route === "INVALID" ? "400" : "300", reason: "serialized items" } } });
    const after = r.trace.slice(r.trace.findIndex((t) => t[0] === "runWorkflow" && t[1] === SUBMIT) + 1).filter((t) => !(t[0] === "hideLoading"));
    const baseAfter = baseRun.trace.slice(baseRun.trace.findIndex((t) => t[0] === "showLoading")).filter((t) => !(t[0] === "hideLoading"));
    check("ON " + route + " -> the classic review goes on as the base would", r.calls(SUBMIT, "SUBMIT").length === 1 && same(r.calls(SC_WF).map((t) => t[2]), baseSC) &&
      same(after, baseAfter) && r.calls(WORKER).length === 0, { after: after.map((t) => t[0]), base: baseAfter.map((t) => t[0]) });
  }
  // the classic path without SUBMIT (identical to the base): <= 50 lines, adjustment skipped, no variance, serialized, recount, getValues throws
  const classicCases = [["50 approved variance lines", scRecord(lines(50)), {}], ["60 approved, 10 with variance", scRecord(lines(60, (i) => ({ variance_qty: i < 10 ? 1 : 0 }))), {}],
    ["adjustment skipped", scRecord(lines(60).concat([scLine(60, { line_status: "Pending", review_status: "" })])), { confirm: (m, t) => (t === "Create Stock Adjustment" ? "cancel" : "confirm") }],
    ["serialized variance line", scRecord(lines(60, (i) => ({ is_serialized: i === 3 ? 1 : 0 }))), {}], ["recount, no adjustment", scRecord(lines(60, { line_status: "Recount", review_status: "Recount" })), {}],
    ["approved but already Adjusted", scRecord(lines(60, { line_status: "Adjusted" })), {}]];
  for (const [what, values, o] of classicCases) {
    const a = await run(BASE, values, o);
    const b = await run(ON, values, o);
    check("ON " + what + " -> the classic review exactly as the base", same(a.trace, b.trace) && b.calls(SUBMIT).length === 0, { base: a.trace.map((t) => t[0]), built: b.trace.map((t) => t[0]) });
  }
  // the eligibility mirrors code_review_prep's strict `variance_qty !== 0` on the form values: a text "0" counts as a variance there
  r = await run(ON, scRecord(lines(60, { variance_qty: "0" })), { script: { submit: QUEUED, status: [st("COMPLETED")] } });
  check("ON: variance_qty text \"0\" counts as prep counts it (strict !== 0) -> SUBMIT", r.calls(SUBMIT, "SUBMIT").length === 1 && r.calls(SC_WF).length === 0);
  // a double click while V2 runs; BUSY / STALE / STOP; no answer / STOP 500 pin the key
  r = await run(ON, scRecord(lines(60)), { data: { scr_submitting: 1 } });
  check("ON double click -> already in progress, nothing else", named(r.trace, "$message.warning").length === 1 && r.calls(SUBMIT).length === 0 && r.calls(SC_WF).length === 0);
  for (const [route, code] of [["BUSY", "409"], ["STALE", "409"], ["STOP", "400"]]) {
    r = await run(ON, scRecord(lines(60)), { script: { submit: { route: route, code: code, message: "the " + route + " text" } } });
    check("ON " + route + ": its message, no classic call", named(r.trace, route === "STOP" ? "$message.error" : "$message.warning").some((t) => t[1] === "the " + route + " text") &&
      r.calls(SC_WF).length === 0 && r.calls(WORKER).length === 0 && r.self.models._data.scr_submitting === 0);
  }
  for (const [what, submit] of [["transport failure", { reject: new Error("network") }], ["STOP 500", { route: "STOP", code: "500", message: "SA_QUEUE_FAILED" }]]) {
    r = await run(ON, scRecord(lines(60)), { script: { submit: submit } });
    const ks = r.calls(SUBMIT, "SUBMIT").map((t) => t[2].idempotency_key);
    const b = await run(ON, scRecord(lines(61)), { data: r.self.models._data, script: { submit: QUEUED, status: [st("COMPLETED")] } });
    check("ON " + what + ": the key is pinned for the next click (other content), no classic call", r.calls(SC_WF).length === 0 && ks.every((k) => k === ks[0]) &&
      b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key === ks[0], [ks, b.calls(SUBMIT, "SUBMIT")[0][2].idempotency_key]);
  }
  // timeout
  r = await run(ON, scRecord(lines(60)), { script: { submit: QUEUED, status: [st("VALIDATING")] } });
  const elapsed = r.w.now - 1800000000000;
  check("ON 180 s without a verdict: info + closed, re-kicked every 15 s", named(r.trace, "$message.info").length === 1 && named(r.trace, "dialog.hide").length === 1 &&
    elapsed >= 180000 && elapsed < 185000 && r.calls(WORKER).length >= 12, { elapsed: elapsed, kicks: r.calls(WORKER).length });

  // ---- mounted
  const mount = async (doc, values, flags, o) => {
    o = o || {};
    const s = o.script || {};
    const w = H.world({ db: dbOf(s), storage: o.storage });
    const self = H.makeThis(w, doc, Object.assign({ values: values, answer: answers(s), params: o.params || {} }, flags));
    H.compile(w, H.byName(doc, "mounted").func, false).call(self, {});
    await H.drain(w);
    return w.trace;
  };
  const mountCases = [["Edit review", { isEdit: true }, { is_review: "1" }], ["Edit stock count", { isEdit: true }, { is_stock_count: "1" }], ["Edit", { isEdit: true }, {}], ["View", { isView: true }, {}], ["Add", { isAdd: true }, {}]];
  for (const [what, flags, params] of mountCases) {
    const v = scRecord(lines(5));
    const a = await mount(BASE2K, v, flags, { params: params, script: { processing: true } });
    const b = await mount(OFFDOC, v, flags, { params: params, script: { processing: true } });
    check("mounted OFF " + what + " (a Processing SA exists): identical to base, no read", same(a, b) && !b.some((t) => t[0] === "db.get" || t[0] === "runWorkflow"), { a: a.length, b: b.length });
    // the shipped switch ON, no Processing SA for this count: the base mounted plus one Stock Adjustment read (none on Add)
    const a2 = await mount(BASE2K, v, flags, { params: params, script: { processing: false } });
    const c = await mount(BUILT, v, flags, { params: params, script: { processing: false } });
    const reads = c.filter((x) => x[0] === "db.get");
    check("mounted shipped " + what + " (no Processing SA): the base + " + (what === "Add" ? "nothing" : "one read"), same(c.filter((x) => x[0] !== "db.get" && !(x[0] === "getValue" && x[1] === "id")), a2) &&
      reads.length === (what === "Add" ? 0 : 1) && !c.some((x) => x[0] === "runWorkflow"), { base: a2.length, built: c.length, reads: reads.length });
  }
  let t = await mount(ON, scRecord(lines(5)), { isEdit: true }, { params: { is_review: "1" }, script: { processing: true, status: [st("VALIDATING"), st("COMPLETED")] } });
  const reads = t.filter((x) => x[0] === "db.get");
  const hides = t.filter((x) => x[0] === "hide" && Array.isArray(x[1]) && x[1].indexOf("button_review") >= 0);
  check("mounted ON with a Processing SA: one field-limited read, save buttons hidden, STATUS + kick, completed", reads.length === 1 &&
    same(reads[0][1].where, { stock_count_id: "500", stock_adjustment_status: "Processing", is_deleted: 0 }) && /sa_v2_job_id/.test(reads[0][1].field) && hides.length === 1 &&
    t.filter((x) => x[0] === "runWorkflow" && x[1] === SUBMIT && x[2].operation === "STATUS" && x[2].sa_id === "900" && x[2].sc_id === "500").length === 2 &&
    t.some((x) => x[0] === "runWorkflow" && x[1] === WORKER) && t.some((x) => x[0] === "$message.success"), t.map((x) => x[0]));
  // the button hiding comes after the classic mounted displayed them
  const lastDisplay = t.map((x, i) => (x[0] === "display" && JSON.stringify(x[1]).indexOf("button_review") >= 0 ? i : -1)).filter((i) => i >= 0).pop();
  check("mounted ON: the hide follows the classic display of button_review", lastDisplay !== undefined && t.indexOf(hides[0]) > lastDisplay, { lastDisplay: lastDisplay, hide: t.indexOf(hides[0]) });
  t = await mount(ON, scRecord(lines(5)), { isEdit: true }, { params: { is_review: "1" }, script: { processing: false } });
  check("mounted ON, no Processing SA: one read, nothing hidden, no workflow", t.filter((x) => x[0] === "db.get").length === 1 && !t.some((x) => x[0] === "runWorkflow") &&
    !t.some((x) => x[0] === "hide" && Array.isArray(x[1]) && x[1].indexOf("button_review") >= 0));
  const storage = {};
  const failed = [st("FAILED", { job_id: "5001", error_message: "Insufficient quantity" })];
  t = await mount(ON, scRecord(lines(5)), { isEdit: true }, { storage: storage, params: { is_review: "1" }, script: { processing: true, status: failed } });
  const t2 = await mount(ON, scRecord(lines(5)), { isEdit: true }, { storage: storage, params: { is_review: "1" }, script: { processing: true, status: failed } });
  check("mounted ON, its job FAILED: alert once per browser", t.filter((x) => x[0] === "$alert").length === 1 && t2.filter((x) => x[0] === "$alert").length === 0);
  H.done("SC form");
})();
