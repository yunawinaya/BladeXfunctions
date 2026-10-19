// Switch-ON sanity check on the SHIPPED files exactly as they are (switches ON, the real ids from ids.json): a small SA /
// review still hands over to the classic; a large one reaches SA_V2_SUBMIT with the real id and kicks the real worker; the
// mounted views and the list kicks call the real ids.
//   node test/test_shipped.js
const H = require("./harness");
const { check, same } = H;

const SUBMIT = H.REAL.SUBMIT;
const WORKER = H.REAL.WORKER;
const CLASSIC_SA = "2032025505853816833";
const CLASSIC_SC = "2066808904123076610";
const SA = H.readJSON(H.FILES.saForm);
const SC = H.readJSON(H.FILES.scForm);
const SAL = H.readJSON(H.FILES.saList);
const SCL = H.readJSON(H.FILES.scList);
const boundTo = (doc, model) => H.byKey(doc, H.findModel(doc.list, model).events.onClick);
const named = (trace, n) => trace.filter((t) => t[0] === n);
const wf = (trace, id, op) => trace.filter((t) => t[0] === "runWorkflow" && t[1] === id && (!op || t[2].operation === op));

const answers = (id, params) => {
  if (id === SUBMIT && params.operation === "SUBMIT") return { data: { route: "QUEUED", code: "200", job_id: "777", job_status: "QUEUED", terminal: "NO", sa_id: "88", sa_no: "SA/88" } };
  if (id === SUBMIT) return { data: { route: "STATUS", code: "200", job_id: "777", job_status: "COMPLETED", terminal: "YES", sa_id: "88", sa_no: "SA/88" } };
  if (id === WORKER) return { data: { processed: "0", job_id: "777", job_status: "COMPLETED" } };
  return { data: { code: "200", message: "ok", stockAdjustmentId: "" } };
};
const saLines = (entries) => {
  const out = [];
  for (let i = 0, left = entries; left > 0; i++, left -= 10) {
    const n = Math.min(10, left);
    out.push({ material_id: "M" + i, uom_id: "77", total_quantity: String(n), line_index: i + 1, is_serialized_item: 0,
      balance_index: JSON.stringify(Array.from({ length: n }, (_, j) => ({ location_id: "L" + j, sa_quantity: 1, movement_type: "In", category: "Unrestricted" }))) });
  }
  return out;
};
const saRecord = (entries) => ({ page_status: "Add", id: "", organization_id: "1001", plant_id: "2002", adjustment_type: "Stock Count", stock_adjustment_status: "", stock_adjustment: saLines(entries), _data: {} });
const scRecord = (n) => ({ id: "500", page_status: "Edit", organization_id: "1001", stock_count_status: "In Progress", review_status: "To Be Reviewed",
  table_stock_count: Array.from({ length: n }, (_, i) => ({ id: String(7000 + i), line_status: "Approved", review_status: "Approved", variance_qty: 1, is_counted: 1, is_serialized: 0 })) });

(async () => {
  check("ids.json has the real SUBMIT / WORKER ids", /^[1-9][0-9]{0,19}$/.test(SUBMIT) && /^[1-9][0-9]{0,19}$/.test(WORKER) && SUBMIT !== WORKER, H.REAL);
  // ---- SA form, both buttons
  for (const [model, classic] of [["button_completed", "onClick_completed"], ["button_completed_posted", "onClick_completed_post"]]) {
    let w = H.world();
    let self = H.makeThis(w, SA, { values: saRecord(50), answer: answers });
    await H.click(w, SA, boundTo(SA, model), self, model);
    check("shipped SA " + model + ", 50 entries -> triggerEvent(" + classic + "), the classic save, no V2 call", same(named(w.trace, "triggerEvent").map((t) => t[1]), [classic]) &&
      wf(w.trace, CLASSIC_SA).length === 1 && wf(w.trace, SUBMIT).length === 0 && wf(w.trace, WORKER).length === 0, w.trace.map((t) => t[0] + ":" + (t[1] || "")));
    w = H.world();
    self = H.makeThis(w, SA, { values: saRecord(51), answer: answers });
    await H.click(w, SA, boundTo(SA, model), self, model);
    const sub = wf(w.trace, SUBMIT, "SUBMIT");
    check("shipped SA " + model + ", 51 entries -> SA_V2_SUBMIT " + SUBMIT + ", worker " + WORKER + " kicked, STATUS, closed; no classic", sub.length === 1 && sub[0][2].source === "FORM" &&
      sub[0][2].saveAs === "Completed" && wf(w.trace, WORKER).length >= 1 && same(wf(w.trace, WORKER)[0][2], { job_id: "777" }) && wf(w.trace, SUBMIT, "STATUS").length >= 1 &&
      named(w.trace, "dialog.hide").length === 1 && named(w.trace, "triggerEvent").length === 0 && wf(w.trace, CLASSIC_SA).length === 0, w.trace.map((t) => t[0] + ":" + (t[1] || "")));
  }
  // ---- SA mounted: a Processing adjustment follows its job through the real ids
  {
    const w = H.world({ db: (n) => (n === "accounting_integration" ? { data: [{ acc_integration_type: "No Accounting Integration" }] } : { data: [] }) });
    const self = H.makeThis(w, SA, { isEdit: true, answer: (id, p) => (id === SUBMIT ? { data: { route: "STATUS", code: "200", job_id: "777", job_status: "VALIDATING", terminal: "NO", sa_id: "77" } } : answers(id, p)),
      values: { page_status: "Edit", id: "77", adjustment_no: "SA-77", stock_adjustment_status: "Processing", organization_id: "1001", sa_v2_job_id: "777", stock_adjustment: [] } });
    H.compile(w, H.byName(SA, "mounted").func, false).call(self, {});
    await H.drain(w);
    check("shipped SA mounted, Processing: STATUS on " + SUBMIT + " by sa_id, worker " + WORKER + " re-kicked every 15 s", wf(w.trace, SUBMIT, "STATUS").length >= 50 &&
      wf(w.trace, SUBMIT, "STATUS").every((t) => t[2].sa_id === "77") && wf(w.trace, WORKER).length >= 12 && wf(w.trace, WORKER).every((t) => same(t[2], { job_id: "777" })),
      { status: wf(w.trace, SUBMIT, "STATUS").length, kicks: wf(w.trace, WORKER).length });
  }
  // ---- SC form, the Review button
  {
    let w = H.world();
    let self = H.makeThis(w, SC, { values: scRecord(50), answer: answers });
    await H.click(w, SC, boundTo(SC, "button_review"), self, "button_review");
    check("shipped SC Review, 50 approved variance lines -> the classic STOCK_COUNT review, no V2 call", wf(w.trace, CLASSIC_SC).length === 1 && wf(w.trace, SUBMIT).length === 0 && wf(w.trace, WORKER).length === 0,
      w.trace.map((t) => t[0] + ":" + (t[1] || "")));
    w = H.world();
    self = H.makeThis(w, SC, { values: scRecord(51), answer: answers });
    await H.click(w, SC, boundTo(SC, "button_review"), self, "button_review");
    const sub = wf(w.trace, SUBMIT, "SUBMIT");
    check("shipped SC Review, 51 lines -> SA_V2_SUBMIT " + SUBMIT + " (REVIEW), worker " + WORKER + " kicked, closed; no classic", sub.length === 1 && sub[0][2].source === "REVIEW" &&
      sub[0][2].sc_id === "500" && sub[0][2].create_adjustment === "Yes" && wf(w.trace, WORKER).length >= 1 && wf(w.trace, CLASSIC_SC).length === 0 && named(w.trace, "dialog.hide").length === 1,
      w.trace.map((t) => t[0] + ":" + (t[1] || "")));
  }
  // ---- SC mounted: a Processing SA from this count -> read-only + its job followed through the real ids
  {
    const w = H.world({ db: (n, q) => (n === "stock_adjustment" && q.where && q.where.stock_count_id === "500" ? { data: [{ id: "900", adjustment_no: "SA/900", stock_adjustment_status: "Processing", sa_v2_job_id: "777", organization_id: "1001" }] } : { data: [] }) });
    const self = H.makeThis(w, SC, { isEdit: true, params: { is_review: "1" }, values: scRecord(5), answer: answers });
    H.compile(w, H.byName(SC, "mounted").func, false).call(self, {});
    await H.drain(w);
    check("shipped SC mounted with a Processing SA: buttons hidden, STATUS on " + SUBMIT + " (sa 900)", w.trace.some((t) => t[0] === "hide" && Array.isArray(t[1]) && t[1].indexOf("button_review") >= 0) &&
      wf(w.trace, SUBMIT, "STATUS").length >= 1 && wf(w.trace, SUBMIT, "STATUS").every((t) => t[2].sa_id === "900" && t[2].sc_id === "500"), w.trace.map((t) => t[0] + ":" + (t[1] || "")));
  }
  // ---- the list kicks
  for (const [name, doc] of [["SA list", SAL], ["SC list", SCL]]) {
    const w = H.world();
    const self = H.makeThis(w, { config: { eventScript: [] } }, { answer: answers });
    H.compile(w, H.byName(doc, "mounted").func, false).call(self, {});
    await H.drain(w);
    check("shipped " + name + " mounted -> one kick of worker " + WORKER + " { job_id: \"\" }", same(wf(w.trace, WORKER).map((t) => t[2]), [{ job_id: "" }]) && w.trace.filter((t) => t[0] === "runWorkflow").length === 1, w.trace);
  }
  H.done("shipped ON sanity");
})();
