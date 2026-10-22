// The classic save handlers (Complete and Complete & Post at 50 picks or fewer, Draft): a second click while the first one
// validates, checks the BOM or saves is refused (the IA V2 handler's own form flag, ia_submitting); the next click once it finished
// is free. A double click used to save twice: two completions issue the stock twice; two new Drafts reserve it twice.
//   node scratchpad/iasc/client/test/test_classic_double.js
const H = require("./harness");
const F = require("./fixture");
const { check } = H;

const ON = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const IA_SAVE = "2098335576774463489";
const lines = [{ id: "5001", item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 1, total_quantity: 1,
  temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", balance_id: "BL2", sm_quantity: 1, category: "Unrestricted" }]), temp_hu_data: "" }];
const draft = F.header({ id: "4001", page_status: "Edit", stock_movement: lines });
const answer = (id) => (id === IA_SAVE ? { data: { code: "200", message: "Item Assembly saved.", id: "4001" } } : { data: { code: "200", message: "ok" } });
const tables = () => F.tables({ extra: { accounting_integration: [{ id: "AI1", organization_id: "1001", acc_integration_type: "SQL Accounting V2", agent_id: "A1" }],
  sm_item_assembly: [{ id: "4001", item_assembly_status: "Draft", posted_status: "Unposted", is_deleted: 0 }] } });
const tab = (w) => H.makeThis(w, ON, { values: H.clone(draft), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, answer), confirm: () => "confirm" });
const click = (w, self, name) => {
  const e = H.byName(ON, name);
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self, { field: "button_x", fieldNode: "button_x", currentRef: {}, $eventArgs: [] });
};
const saves = (w, saveAs) => w.trace.filter((t) => /runWorkflow$/.test(t[0]) && t[1] === IA_SAVE && t[2] && t[2].saveAs === saveAs).length;
const busy = (w) => w.trace.filter((t) => t[0] === "$message.warning" && /already in progress/.test(t[1])).length;

(async () => {
  for (const [name, saveAs] of [["onClick_saveAsCompleted", "Completed"], ["onClick_saveAsCompletedPost", "Completed"], ["onClick_saveAsDraft", "Draft"]]) {
    const w = H.world({ db: H.tableDb(tables()) });
    const self = tab(w);
    click(w, self, name);
    click(w, self, name);
    await H.drain(w);
    check(name + ": a double click saves once, the second click is told to wait", saves(w, saveAs) === 1 && busy(w) === 1, [saves(w, saveAs), busy(w)]);
    click(w, self, name);
    await H.drain(w);
    check(name + ": the next click once it finished is free", saves(w, saveAs) === 2, saves(w, saveAs));
  }
  // the Complete button's IA V2 handler hands a small IA (50 picks or fewer) over to the classic handler
  {
    const w = H.world({ db: H.tableDb(tables()) });
    const self = tab(w);
    click(w, self, "iaV2_onClick_completed");
    click(w, self, "iaV2_onClick_completed");
    await H.drain(w);
    check("Complete through the IA V2 button, 50 picks or fewer: a double click completes once", saves(w, "Completed") === 1 && busy(w) === 1, [saves(w, "Completed"), busy(w)]);
  }
  H.done("test_classic_double");
})();
