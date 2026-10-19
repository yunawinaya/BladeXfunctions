// The ON build exactly as built (client/out/on/, or IA_FORM / IA_LIST): while ids.json still holds "0" for a workflow, every
// path that needs it must stay classic (a dead switch does nothing); with the real ids: a small IA -> the classic, a big one ->
// IA_V2_SUBMIT with the real id and the real worker kicked; the list kicks the real workers; Revert routes through the real
// IA_REVERT_V2_SUBMIT.
//   node test/test_shipped.js
const H = require("./harness");
const { check, same } = H;

const FORM = H.readJSON(process.env.IA_FORM || H.FILES.formOn);
const LIST = H.readJSON(process.env.IA_LIST || H.FILES.listOn);
const BASE = H.readJSON(H.FILES.formBase);
const LBASE = H.readJSON(H.FILES.listBase);
const ID = H.IDS;
const real = (k) => /^[1-9][0-9]{0,19}$/.test(String(ID[k]));
const IA_SAVE = "2098335576774463489";
const CLASSIC_REVERT = "2099319746652852225";
const named = (trace, n) => trace.filter((t) => t[0] === n);
const wf = (trace, id, op) => trace.filter((t) => t[0] === "runWorkflow" && t[1] === id && (!op || t[2].operation === op));
const boundTo = (doc, model) => H.byKey(doc, H.findModel(doc.list, model).events.onClick);

const pick = (j) => ({ material_id: "M", location_id: "L" + j, balance_id: "B" + j, sm_quantity: 1, category: "Unrestricted" });
const rec = (picks) => {
  const lines = [];
  for (let i = 0, left = picks; left > 0; i++, left -= 10) lines.push({ item_selection: "I" + i, requested_qty: 10, total_quantity: Math.min(10, left), temp_qty_data: JSON.stringify(Array.from({ length: Math.min(10, left) }, (_, j) => pick(j))), temp_hu_data: "" });
  return { page_status: "Edit", id: "77", item_assembly_status: "Draft", stock_movement_no: "IA-77", organization_id: "1001", item_id: "P1", stock_movement: lines };
};
const answers = (id, params) => {
  if (id === ID.IA_V2_SUBMIT && params.operation === "SUBMIT") return { data: { route: "QUEUED", code: "200", job_id: "777", job_status: "QUEUED", terminal: "NO", ia_id: "77", ia_no: "IA-77" } };
  if (id === ID.IA_V2_SUBMIT) return { data: { route: "STATUS", code: "200", job_id: "777", job_status: "COMPLETED", terminal: "YES", ia_id: "77" } };
  if (id === ID.IA_REVERT_V2_SUBMIT) return { data: { route: "QUEUED", code: "200", job_id: "778", job_status: "QUEUED", ia_id: "77" } };
  return { data: { code: "200", message: "ok", id: ["77"], processed: "0" } };
};
const click = async (doc, model, values) => {
  const w = H.world({ db: (n) => (n === "accounting_integration" ? { data: [{ acc_integration_type: "No Accounting Integration" }] } : { data: [] }) });
  const self = H.makeThis(w, doc, { values: values, answer: answers });
  await H.fire(w, boundTo(doc, model), self);
  return w;
};

(async () => {
  const completion = real("IA_V2_SUBMIT") && real("IA_V2_WORKER");
  const revert = real("IA_REVERT_V2_SUBMIT") && real("IA_REVERT_V2_WORKER");
  console.log("ids.json: completion workflows " + (completion ? "set" : "not created yet (\"0\")") + ", revert workflows " + (revert ? "set" : "not created yet (\"0\")"));
  for (const [model, classic] of [["button_completed", "onClick_saveAsCompleted"], ["comp_post_button", "onClick_saveAsCompletedPost"]]) {
    let w = await click(FORM, model, rec(50));
    check("shipped " + model + ", 50 picks -> the classic, no V2 call", same(named(w.trace, "triggerEvent").map((t) => t[1]), [classic]) && wf(w.trace, IA_SAVE).length === 1 &&
      w.trace.filter((t) => t[0] === "runWorkflow" && t[1] !== IA_SAVE).length === 0);
    w = await click(FORM, model, rec(51));
    if (completion) {
      check("shipped " + model + ", 51 picks -> IA_V2_SUBMIT " + ID.IA_V2_SUBMIT + ", worker " + ID.IA_V2_WORKER + " kicked, closed; no classic",
        wf(w.trace, ID.IA_V2_SUBMIT, "SUBMIT").length === 1 && wf(w.trace, ID.IA_V2_WORKER).length >= 1 && named(w.trace, "triggerEvent").length === 0 && named(w.trace, "dialog.hide").length === 1);
    } else {
      const base = await click(BASE, model, rec(51));
      check("shipped ON with the completion ids \"0\", " + model + ", 51 picks: exactly the classic", same(w.trace.slice(1), base.trace) && same(w.trace[0], ["triggerEvent", classic, "(no args)"]));
    }
  }
  // the list kick
  {
    const w = H.world();
    const self = H.makeThis(w, LIST, { answer: answers });
    H.compile(w, H.byName(LIST, "mounted").func, false).call(self, {});
    await H.drain(w);
    const kicked = w.trace.filter((t) => t[0] === "runWorkflow").map((t) => t[1]);
    check("shipped list mounted: kicks exactly the workers whose ids are set", same(kicked, [completion ? ID.IA_V2_WORKER : null, revert ? ID.IA_REVERT_V2_WORKER : null].filter((x) => x)) &&
      (kicked.length > 0 || w.trace.length === 0), kicked);
  }
  // Revert
  {
    const sel = [{ id: "77", stock_movement_no: "IA-77", item_assembly_status: "Completed", organization_id: "1001" }];
    const run = async (doc) => {
      const w = H.world();
      const self = H.makeThis(w, doc, { components: { custom_7rq6zmn4: { $refs: { crud: { tableSelect: sel } } } }, answer: answers });
      H.compile(w, H.byName(doc, "IArevertCompleted").func, false).call(self, {});
      await H.drain(w);
      return w;
    };
    const w = await run(LIST);
    if (revert) {
      check("shipped Revert -> IA_REVERT_V2_SUBMIT " + ID.IA_REVERT_V2_SUBMIT + " (min_picks 50); QUEUED -> worker " + ID.IA_REVERT_V2_WORKER, wf(w.trace, ID.IA_REVERT_V2_SUBMIT, "SUBMIT").length === 1 &&
        wf(w.trace, ID.IA_REVERT_V2_SUBMIT, "SUBMIT")[0][2].min_picks === "50" && wf(w.trace, ID.IA_REVERT_V2_WORKER).length >= 1 && wf(w.trace, CLASSIC_REVERT).length === 0);
    } else {
      const b = await run(LBASE);
      check("shipped ON with the revert ids \"0\": Revert = exactly the base classic", same(w.trace, b.trace) && wf(w.trace, CLASSIC_REVERT).length === 1);
    }
  }
  H.done("shipped ON build");
})().catch((e) => {
  H.check("the test ran to its end", false, String(e && e.stack).slice(0, 600));
  H.done("shipped ON build");
});
