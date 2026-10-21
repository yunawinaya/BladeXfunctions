// The ON build exactly as built (client/out/on/, or IDA_FORM / IDA_LIST): while ids.json still holds "0" for a workflow, every
// path that needs it stays classic (a dead switch does nothing); with the real ids: a small IDA -> the classic, a big one ->
// IDA_V2_SUBMIT with the real id and the real worker kicked; the list kicks the real worker; a Processing IDA is followed.
//   node test/test_shipped.js
const H = require("./harness");
const { check, same } = H;

const FORM = H.readJSON(process.env.IDA_FORM || H.FILES.formOn);
const LIST = H.readJSON(process.env.IDA_LIST || H.FILES.listOn);
const BASE = H.readJSON(H.FILES.formBase);
const ID = H.IDS;
const real = (k) => /^[1-9][0-9]{0,19}$/.test(String(ID[k]));
const IDA_SAVE = "2107305535347552257";
const named = (trace, n) => trace.filter((t) => t[0] === n);
const wf = (trace, id, op) => trace.filter((t) => t[0] === "runWorkflow" && t[1] === id && (!op || t[2].operation === op));
const boundTo = (doc, model) => H.byKey(doc, H.findModel(doc.list, model).events.onClick);

const rec = (lines) => ({ page_status: "Edit", id: "77", item_disassembly_status: "Draft", stock_movement_no: "IDA-77", organization_id: "1001", item_id: "P1", item_qty: 2,
  issuing_operation_faci: "2002", temp_qty_data: JSON.stringify([{ balance_id: "B1", sm_quantity: 2, category: "Unrestricted" }]), temp_hu_data: "", table_hu: [],
  stock_movement: Array.from({ length: lines }, (_, i) => ({ item_selection: "I" + i, total_quantity: 1, requested_qty: 1, batch_number: "-" })) });
const answers = (id, params) => {
  if (id === ID.IDA_V2_SUBMIT && params.operation === "SUBMIT") return { data: { route: "QUEUED", code: "200", job_id: "777", job_status: "QUEUED", terminal: "NO", ida_id: "77", ida_no: "IDA-77" } };
  if (id === ID.IDA_V2_SUBMIT) return { data: { route: "STATUS", code: "200", job_id: "777", job_status: "COMPLETED", terminal: "YES", ida_id: "77" } };
  return { data: { code: "200", message: "ok", id: ["77"], processed: "0" } };
};
const click = async (doc, model, values) => {
  const w = H.world({ db: (n) => (n === "accounting_integration" ? { data: [{ acc_integration_type: "No Accounting Integration" }] } : { data: [] }) });
  const self = H.makeThis(w, doc, { values: values, answer: answers });
  await H.fire(w, boundTo(doc, model), self);
  return w;
};

(async () => {
  const on = real("IDA_V2_SUBMIT") && real("IDA_V2_WORKER");
  console.log("ids.json: IDA_V2_SUBMIT / IDA_V2_WORKER " + (on ? "set (" + ID.IDA_V2_SUBMIT + " / " + ID.IDA_V2_WORKER + ")" : "not created yet (\"0\")"));
  for (const [model, classic] of [["button_completed", "onClick_saveAsCompleted"], ["comp_post_button", "onClick_saveAsCompletedPost"]]) {
    let w = await click(FORM, model, rec(49));
    check("shipped " + model + ", 50 moves -> the classic, no V2 call", same(named(w.trace, "triggerEvent").map((t) => t[1]), [classic]) && wf(w.trace, IDA_SAVE).length === 1 &&
      w.trace.filter((t) => t[0] === "runWorkflow" && t[1] !== IDA_SAVE).length === 0);
    w = await click(FORM, model, rec(50));
    if (on) {
      check("shipped " + model + ", 51 moves -> IDA_V2_SUBMIT " + ID.IDA_V2_SUBMIT + ", worker " + ID.IDA_V2_WORKER + " kicked, closed; no classic",
        wf(w.trace, ID.IDA_V2_SUBMIT, "SUBMIT").length === 1 && wf(w.trace, ID.IDA_V2_WORKER).length >= 1 && named(w.trace, "triggerEvent").length === 0 && named(w.trace, "dialog.hide").length === 1);
    } else {
      const base = await click(BASE, model, rec(50));
      check("shipped ON with the ids \"0\", " + model + ", 51 moves: exactly the classic", same(w.trace.slice(1), base.trace) && same(w.trace[0], ["triggerEvent", classic, "(no args)"]));
    }
  }
  // the list kick
  {
    const w = H.world();
    const self = H.makeThis(w, LIST, { answer: answers });
    H.compile(w, H.byName(LIST, "mounted").func, false).call(self, {});
    await H.drain(w);
    const kicked = w.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]);
    check("shipped list mounted: kicks the worker exactly when its id is set", same(kicked, on ? [ID.IDA_V2_WORKER] : []) && (kicked.length > 0 || w.trace.length === 0), kicked);
  }
  // a Processing IDA opened
  {
    const w = H.world({ db: () => ({ data: [] }) });
    const self = H.makeThis(w, FORM, { isEdit: true, values: Object.assign(rec(3), { item_disassembly_status: "Processing", ida_v2_job_id: "777" }), answer: answers });
    H.compile(w, H.byName(FORM, "mounted").func, false).call(self, {});
    await H.drain(w);
    check("shipped mounted, Processing: " + (on ? "followed on the real SUBMIT id" : "read-only, no call"), on ? wf(w.trace, ID.IDA_V2_SUBMIT, "STATUS").length >= 1 :
      w.trace.filter((t) => t[0] === "runWorkflow").length === 0);
  }
  H.done("shipped ON build");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("shipped ON build");
});
