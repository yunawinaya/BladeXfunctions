// RES-01 R4: after a completion the form closes the IA's holds (IA_HOLD CLOSE, source COMPLETE: what the completion issued from
// Reserved delivered, the rest released) in the background: classic Completed and Complete & Post once IA_SAVE answered, IA V2 once
// its job is COMPLETED. Only an IA that reserves (an Edit with a hold status), whatever the switch (review I4); a failed save: never.
//   node scratchpad/iasc/client/test/test_res_close.js
const H = require("./harness");
const F = require("./fixture");
const { check } = H;

// the shipped build (RES-01 ON on DEV since 10-22) and its two switch variants
const SHIPPED = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const BUILT = H.resVariant(SHIPPED, false);
const ON = H.resVariant(SHIPPED, true);
const IA_SAVE = "2098335576774463489";
const SUBMIT = "2112141238600376321";
const ACC = "2013511169625042946";
const HOLD = H.SC_TEST_IDS.IA_HOLD;

const lines = (n) => Array.from({ length: n }, (_, i) => ({ id: String(5001 + i), item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 1, total_quantity: 1,
  temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", balance_id: "BL2", sm_quantity: 1, category: "Unrestricted" }]), temp_hu_data: "" }));
const ia = (o) => F.header(Object.assign({ id: "4001", page_status: "Edit", material_hold_status: "FULL", stock_movement: lines(2) }, o || {}));
const tables = () => F.tables({ extra: { accounting_integration: [{ id: "AI1", organization_id: "1001", acc_integration_type: "SQL Accounting V2", agent_id: "A1" }],
  sm_item_assembly: [{ id: "4001", item_assembly_status: "Completed", posted_status: "Unposted", is_deleted: 0 }] } });
const run = async (doc, name, values, o) => {
  o = o || {};
  const w = H.world({ db: H.tableDb(tables()) });
  const answer = (id, params) => {
    if (id === IA_SAVE) return o.save || { data: { code: "200", message: "Item Assembly saved.", id: "4001" } };
    if (id === SUBMIT && params.operation === "SUBMIT") return { data: { route: "QUEUED", code: "200", job_id: "7001", ia_id: "4001", job_status: "QUEUED" } };
    if (id === SUBMIT) return { data: { route: "STATUS", code: "200", job_id: "7001", ia_id: "4001", job_status: "COMPLETED", terminal: "YES", progress_percent: 100 } };
    if (id === HOLD) return { data: { code: "200", message: "Closed: what the completion used is delivered and the rest is released.", result_json: "{}" } };
    return { data: { code: "200", message: "ok" } };
  };
  const self = H.makeThis(w, doc, { values: H.clone(values), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, answer), confirm: () => "confirm" });
  const e = H.byName(doc, name);
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self, { field: "button_x", fieldNode: "button_x", currentRef: {}, $eventArgs: [] });
  await H.drain(w);
  return w.trace;
};
const closes = (t) => t.filter((x) => /runWorkflow$/.test(x[0]) && x[1] === HOLD).map((x) => x[2]);
const CLOSE = { ia_id: "4001", organization_id: F.ORG, operation: "CLOSE", source: "COMPLETE" };

(async () => {
  for (const name of ["onClick_saveAsCompleted", "onClick_saveAsCompletedPost"]) {
    const t = await run(ON, name, ia());
    check(name + ": an IA that reserves: IA_HOLD CLOSE (source COMPLETE) once IA_SAVE answered", JSON.stringify(closes(t)) === JSON.stringify([CLOSE]), closes(t));
    if (name === "onClick_saveAsCompletedPost") check(name + ": still posted", t.some((x) => x[0] === "runWorkflow" && x[1] === ACC));
    const n = await run(ON, name, ia({ material_hold_status: "" }));
    check(name + ": an IA that never reserved: no CLOSE", closes(n).length === 0, closes(n));
    const a = await run(ON, name, ia({ id: "", page_status: "Add", material_hold_status: "" }));
    check(name + ": a new IA completed at once: no CLOSE", closes(a).length === 0, closes(a));
    const c = await run(ON, name, ia({ page_status: "Clone", material_hold_status: "FULL" }));
    check(name + ": a clone completed at once (its source's hold status still on the form): no CLOSE", closes(c).length === 0, closes(c));
    const f = await run(ON, name, ia(), { save: { data: { code: "402", message: "Insufficient stock" } } });
    check(name + ": a refused completion: no CLOSE", closes(f).length === 0, closes(f));
    const off = await run(BUILT, name, ia());
    check(name + ": switch off, an IA that holds stock: still CLOSE (review I4)", JSON.stringify(closes(off)) === JSON.stringify([CLOSE]), closes(off));
  }
  // IA V2 (more than 50 picks): once the job is COMPLETED
  for (const name of ["iaV2_onClick_completed", "iaV2_onClick_completed_post"]) {
    const t = await run(ON, name, ia({ stock_movement: lines(60) }));
    check(name + ": the job COMPLETED: IA_HOLD CLOSE (source COMPLETE)", JSON.stringify(closes(t)) === JSON.stringify([CLOSE]), closes(t));
    const off = await run(BUILT, name, ia({ stock_movement: lines(60) }));
    check(name + ": switch off, an IA that holds stock: still CLOSE (review I4)", JSON.stringify(closes(off)) === JSON.stringify([CLOSE]), closes(off));
  }
  H.done("test_res_close");
})();
