// RES-01 Created (BA, 10-22): the IA form's Created status. A Created button next to Draft (Add and Draft, the switch on) saves and
// reserves; a Created IA is edited like a Draft but shows Created and has no Draft button (it never goes back to Draft); its badge; the
// status option; the IA V2 Complete handler takes a stored Created IA like a Draft.
//   node scratchpad/iasc/client/test/test_created.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

const SHIPPED = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const ON = H.resVariant(SHIPPED, true);
const OFF = H.resVariant(SHIPPED, false);
const IA_SAVE = "2098335576774463489";

const mount = async (doc, values, flags) => {
  const w = H.world({ db: H.tableDb(F.tables()) });
  w.so = F.so();
  const self = H.makeThis(w, doc, Object.assign({ values: H.clone(values), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, () => ({ data: { code: "200", message: "ok" } })) }, flags));
  const e = H.byName(doc, "mounted");
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self);
  await H.drain(w);
  return w.trace;
};
// the form's own calls and sc_main's (tagged sc:)
const of = (trace, op) => trace.filter((t) => new RegExp("(^|[.:])" + op + "$").test(t[0])).reduce((a, t) => a.concat(t[1]), []);
const headerLocked = (trace) => trace.some((t) => /disabled$/.test(t[0]) && Array.isArray(t[1]) && t[1].indexOf("issuing_operation_faci") >= 0 && t[2] === true);
const ia = (status, o) => F.header(Object.assign({ id: "4001", page_status: "Edit", item_assembly_status: status, material_hold_status: "", stock_movement: [] }, o || {}));
const find = (list, model) => {
  let hit = null;
  const walk = (n) => {
    if (hit || !n || typeof n !== "object") return;
    if (n.model === model) hit = n;
    Object.keys(n).forEach((k) => walk(n[k]));
  };
  walk(list);
  return hit;
};

(async () => {
  // ---- the structure
  {
    const b = find(SHIPPED.list, "button_created");
    const d = find(SHIPPED.list, "button_draft");
    const handler = H.byName(SHIPPED, "onClick_saveAsCreated");
    check("a Created button: a hidden button labelled Created, like the Draft button, its click bound to onClick_saveAsCreated", !!b && b.type === d.type &&
      b.options.hidden === true && b.options.buttonName === "Created" && !!handler && b.events.onClick === handler.key, b && [b.type, b.options.hidden, b.options.buttonName, b.events]);
    const badge = find(SHIPPED.list, "created_status");
    check("a Created badge next to the Draft one, hidden until mounted shows it", !!badge && badge.type === find(SHIPPED.list, "draft_status").type && badge.options.hidden === true &&
      /Created/.test(JSON.stringify(badge.options)), badge && badge.options);
    const keys = JSON.stringify(find(SHIPPED.list, "item_assembly_status").options.datasource).match(/"dict_key","operator":"equal","valueType":"value","value":"([^"]+)"/g) || [];
    check("the status option list has Created (the shared dictionary's key)", keys.some((k) => /"value":"Created"/.test(k)) && keys.some((k) => /"value":"Draft"/.test(k)), keys);
  }
  // ---- Add
  {
    let t = await mount(ON, F.header({ page_status: "Add" }), { isAdd: true });
    check("Add, switch on: Draft and Created next to Complete / Complete & Post", ["button_draft", "button_created", "button_completed", "comp_post_button"]
      .every((m) => of(t, "display").indexOf(m) >= 0), of(t, "display"));
    t = await mount(OFF, F.header({ page_status: "Add" }), { isAdd: true });
    check("Add, switch off: no Created button (nothing to reserve)", of(t, "display").indexOf("button_created") < 0 && of(t, "display").indexOf("button_draft") >= 0, of(t, "display"));
  }
  // ---- Edit
  {
    let t = await mount(ON, ia("Draft"), { isEdit: true });
    check("Edit of a Draft: Draft and Created buttons, the header editable, the Draft badge", ["button_draft", "button_created", "button_completed", "comp_post_button", "draft_status"]
      .every((m) => of(t, "display").indexOf(m) >= 0) && !headerLocked(t), [of(t, "display"), headerLocked(t)]);
    t = await mount(ON, ia("Created"), { isEdit: true });
    check("Edit of a Created IA: Created, Complete and Complete & Post, no Draft button, the header editable, the Created badge",
      ["button_created", "button_completed", "comp_post_button", "created_status"].every((m) => of(t, "display").indexOf(m) >= 0) && of(t, "display").indexOf("button_draft") < 0 &&
      of(t, "display").indexOf("draft_status") < 0 && !headerLocked(t), [of(t, "display"), headerLocked(t)]);
    check("Edit of a Created IA: its Small Cycle actions editable like a Draft's (Select SO Line shown)", of(t, "display").indexOf("sc_btn_line") >= 0, of(t, "display"));
    t = await mount(OFF, ia("Created"), { isEdit: true });
    check("Edit of a Created IA, switch off: still saved as Created (no Draft button)", of(t, "display").indexOf("button_created") >= 0 && of(t, "display").indexOf("button_draft") < 0,
      of(t, "display"));
    t = await mount(ON, ia("Completed"), { isEdit: true });
    check("Edit of a Completed IA: no Created button, the header locked, Select SO Line hidden", of(t, "display").indexOf("button_created") < 0 && headerLocked(t) &&
      of(t, "display").indexOf("sc_btn_line") < 0, of(t, "display"));
    t = await mount(ON, ia("Processing"), { isEdit: true });
    check("Processing: the Created button never shown (hidden by default; v36's hide list unchanged)", of(t, "display").indexOf("button_created") < 0, of(t, "display"));
    t = await mount(ON, ia("Created"), { isView: true });
    check("View of a Created IA: the Created badge, the header locked, no save button", of(t, "display").indexOf("created_status") >= 0 && headerLocked(t) &&
      of(t, "display").indexOf("button_created") < 0, of(t, "display"));
  }
  // ---- the IA V2 Complete handler: a stored Created IA above 50 picks completes in the background, like a Draft
  {
    const picks = Array.from({ length: 60 }, (_, i) => ({ id: String(5001 + i), item_selection: "C2", item_name: "SC-SCREW", quantity_uom: F.EA, requested_qty: 1, total_quantity: 1,
      temp_qty_data: JSON.stringify([{ material_id: "C2", location_id: "L0", balance_id: "BL2", sm_quantity: 1, category: "Unrestricted" }]), temp_hu_data: "" }));
    const click = async (status) => {
      const w = H.world({ db: H.tableDb(F.tables({ extra: { sm_item_assembly: [{ id: "4001", item_assembly_status: status, posted_status: "Unposted", is_deleted: 0 }] } })) });
      const self = H.makeThis(w, ON, { values: H.clone(ia(status, { stock_movement: picks })), stateful: true, isEdit: true,
        answer: F.answer(w, H.SC_TEST_IDS, () => ({ data: { code: "200", message: "ok" } })), confirm: () => "confirm" });
      const e = H.byName(ON, "iaV2_onClick_completed");
      H.compile(w, H.sourceOf(e), e.type === "rule").call(self, { field: "button_completed", fieldNode: "button_completed", currentRef: {}, $eventArgs: [] });
      await H.drain(w);
      const runs = w.trace.filter((t) => /runWorkflow$/.test(t[0])).map((t) => t[1]);
      return { v2: runs.some((id) => id !== IA_SAVE && id !== H.SC_TEST_IDS.IA_HOLD), classic: runs.indexOf(IA_SAVE) >= 0 };
    };
    const d = await click("Draft");
    check("V2 Complete of a stored Draft, 60 picks: the background save (the baseline)", d.v2 && !d.classic, d);
    const c = await click("Created");
    check("V2 Complete of a stored Created IA, 60 picks: the background save, never the classic one", c.v2 && !c.classic, c);
    // review 1: a new IA's background save that did not answer keeps the form on the same key; neither Draft nor Created may then save a
    // second IA (SUBMIT may have written the first)
    const w = H.world({ db: H.tableDb(F.tables()) });
    const self = H.makeThis(w, ON, { values: H.clone(F.header({ page_status: "Add", stock_movement: picks })), stateful: true, isAdd: true,
      answer: F.answer(w, H.SC_TEST_IDS, () => ({ data: { code: "200", message: "ok" } })), confirm: () => "confirm" });
    const e = H.byName(ON, "iaV2_onClick_completed");
    H.compile(w, H.sourceOf(e), e.type === "rule").call(self, { field: "button_completed", fieldNode: "button_completed", currentRef: {}, $eventArgs: [] });
    await H.drain(w);
    check("a new IA's background save without an answer: the Draft and Created buttons both hidden (the same key stays)", of(w.trace, "hide").indexOf("button_draft") >= 0 &&
      of(w.trace, "hide").indexOf("button_created") >= 0, of(w.trace, "hide"));
  }
  H.done("test_created");
})();
