// RES-01 R3: after a successful Draft save the form starts the raw-material reservation (IA_HOLD RECONCILE, source SAVE) for a new IA
// or one that already reserves: up to 50 hold picks it waits and shows the result, above it starts it in the background. IA_SAVE
// never runs it (user 10-21). Switch off (the build) = v36 call for call; a failed save never reserves.
//   node scratchpad/iasc/client/test/test_res_draft.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

const BUILT = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const ON = H.resVariant(BUILT, true);
const IA_SAVE = "2098335576774463489";
const HOLD = H.SC_TEST_IDS.IA_HOLD;

const lines = (n) => Array.from({ length: n }, (_, i) => ({ id: String(5001 + i), item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 1, total_quantity: 1,
  temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", balance_id: "BL2", sm_quantity: 1, category: "Unrestricted" }]), temp_hu_data: "" }));
const held = (status, message) => ({ data: { code: "200", message: message, result_json: JSON.stringify({ status: status, lines: [] }) } });
const run = async (doc, values, hold, o) => {
  o = o || {};
  const w = H.world({ db: H.tableDb(F.tables()) });
  const answer = (id, params) => {
    if (id === IA_SAVE) return o.save || { data: { code: "200", message: "Item Assembly saved.", id: "4001" } };
    if (id === HOLD) return hold || held("FULL", "All materials are reserved.");
    return { data: { code: "200", message: "ok" } };
  };
  const self = H.makeThis(w, doc, { values: H.clone(values), stateful: true, answer: answer });
  const e = H.byName(doc, "onClick_saveAsDraft");
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self, { field: "button_draft", fieldNode: "button_draft", currentRef: {}, $eventArgs: [] });
  await H.drain(w);
  return w.trace;
};
const holdCalls = (trace) => trace.filter((t) => t[0] === "runWorkflow" && t[1] === HOLD);
const after = (trace, a, b) => trace.findIndex((t) => t[0] === a[0] && (a[1] === undefined || t[1] === a[1])) < trace.findIndex((t) => t[0] === b[0] && (b[1] === undefined || t[1] === b[1]));
const msgs = (trace) => trace.filter((t) => /^\$message/.test(t[0])).map((t) => [t[0], t[1]]);

(async () => {
  check("the build ships the RES switch off, in the Draft handler (one switch per script that reserves)", ON.resSwitches >= 1 && !/const RES_ENABLED = true;/.test(H.byName(BUILT, "onClick_saveAsDraft").func) &&
    /const RES_ENABLED = false;/.test(H.byName(BUILT, "onClick_saveAsDraft").func), ON.resSwitches);
  // ---- switch off: the v36 handler call for call
  {
    const V36 = H.readJSON(H.FILES.formBase);
    const values = F.header({ stock_movement: lines(2) });
    const a = await run(V36, values);
    const b = await run(BUILT, values);
    check("switch off: Draft save = v36 call for call", same(b, a), { v36: a.length, built: b.length });
  }
  // ---- a new IA: reserved after the save, waited for, the result shown, then the dialog closes
  {
    const t = await run(ON, F.header({ stock_movement: lines(2) }));
    const c = holdCalls(t);
    check("new Draft: IA_HOLD RECONCILE (source SAVE) for the saved id, after the save answered", c.length === 1 && same(c[0][2], { ia_id: "4001", organization_id: F.ORG,
      operation: "RECONCILE", source: "SAVE" }) && after(t, ["runWorkflow", IA_SAVE], ["runWorkflow", HOLD]), c.map((x) => x[2]));
    check("new Draft: waits (Reserving materials...), shows the result, then closes", t.some((x) => x[0] === "showLoading" && x[1] === "Reserving materials...") &&
      same(msgs(t), [["$message.success", "Item Assembly saved as draft"], ["$message.success", "All materials are reserved."]]) && after(t, ["runWorkflow", HOLD], ["dialog.hide"]), msgs(t));
  }
  // ---- Clone: the clone is new
  {
    const t = await run(ON, F.header({ page_status: "Clone", stock_movement: lines(1) }), undefined, { save: { data: { code: "200", id: "4002" } } });
    check("Clone saved as Draft: reserved for the clone's id", same(holdCalls(t).map((x) => x[2].ia_id), ["4002"]));
  }
  // ---- Edit: only an IA that already reserves
  {
    const t = await run(ON, F.header({ id: "4001", page_status: "Edit", material_hold_status: "", stock_movement: lines(1) }));
    check("Edit of an IA that never reserved: not reserved", holdCalls(t).length === 0 && same(msgs(t), [["$message.success", "Item Assembly saved as draft"]]), msgs(t));
    const u = await run(ON, F.header({ id: "4001", page_status: "Edit", material_hold_status: "PARTIAL", stock_movement: lines(1) }), held("PARTIAL", "Some materials are reserved: the rest is short of stock."));
    check("Edit of an IA that reserves: reserved again, a partial result shown as a warning", holdCalls(u).length === 1 &&
      same(msgs(u).slice(1), [["$message.warning", "Some materials are reserved: the rest is short of stock."]]), msgs(u));
  }
  // ---- above 50 hold picks: started in the background, not waited for
  {
    const t = await run(ON, F.header({ stock_movement: lines(60) }));
    check("60 picks: IA_HOLD started, not waited for (no loading), said so", holdCalls(t).length === 1 && !t.some((x) => x[0] === "showLoading" && x[1] === "Reserving materials...") &&
      same(msgs(t).slice(1), [["$message.info", "The materials are being reserved in the background."]]), msgs(t));
  }
  // ---- answers that are not a result
  {
    const t = await run(ON, F.header({ stock_movement: lines(1) }), { data: { code: "200", message: "Not enrolled: this Item Assembly does not reserve its materials.", result_json: "" } });
    check("an answer without a result (nothing to reserve): nothing more shown", same(msgs(t), [["$message.success", "Item Assembly saved as draft"]]), msgs(t));
    const u = await run(ON, F.header({ stock_movement: lines(1) }), { data: { code: "409", message: "Another reservation of this Item Assembly is running: try again in a moment." } });
    check("409 busy: its message as a warning, the dialog still closes", same(msgs(u).slice(1), [["$message.warning", "Another reservation of this Item Assembly is running: try again in a moment."]]) &&
      u.some((x) => x[0] === "dialog.hide"), msgs(u));
    const v = await run(ON, F.header({ stock_movement: lines(1) }), { reject: new Error("network") });
    check("no answer: a warning that it is reserved on the next open, the dialog still closes", same(msgs(v).slice(1), [["$message.warning",
      "The materials could not be reserved now: they are reserved when this Item Assembly is opened again."]]) && v.some((x) => x[0] === "dialog.hide"), msgs(v));
  }
  // ---- a failed save never reserves
  {
    const t = await run(ON, F.header({ stock_movement: lines(1) }), undefined, { save: { data: { code: "400", message: "Plant is required" } } });
    check("a refused save: no reservation", holdCalls(t).length === 0, msgs(t));
  }
  H.done("test_res_draft");
})();
