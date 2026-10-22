// RES-01 Cancel (user 10-22, like Goods Delivery): a Created IA is cancelled from the Item Assembly list's bulk Cancel (the form has no
// Cancel button since the list has it, user 10-22 evening); a Cancelled IA is read-only on the form (its badge, no button) and shows no
// reservation row.
//   node scratchpad/iasc/client/test/test_cancel.js
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

const SHIPPED = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const ON = H.resVariant(SHIPPED, true);
const HOLD = H.SC_TEST_IDS.IA_HOLD;

const of = (trace, op) => trace.filter((t) => new RegExp("(^|[.:])" + op + "$").test(t[0])).reduce((a, t) => a.concat(t[1]), []);
const headerLocked = (trace) => trace.some((t) => /disabled$/.test(t[0]) && Array.isArray(t[1]) && t[1].indexOf("issuing_operation_faci") >= 0 && t[2] === true);
const tableLocked = (trace) => trace.some((t) => /disabled$/.test(t[0]) && Array.isArray(t[1]) && t[1].indexOf("stock_movement") >= 0 && t[2] === true);
const ia = (status, o) => F.header(Object.assign({ id: "4001", page_status: "Edit", item_assembly_status: status, material_hold_status: "", stock_movement_no: "IA-7",
  stock_movement: [] }, o || {}));
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
const mount = async (values, flags) => {
  const w = H.world({ db: H.tableDb(F.tables()) });
  w.so = F.so();
  const self = H.makeThis(w, ON, Object.assign({ values: H.clone(values), stateful: true, answer: F.answer(w, H.SC_TEST_IDS, () => ({ data: { code: "200", message: "ok" } })) }, flags));
  const e = H.byName(ON, "mounted");
  H.compile(w, H.sourceOf(e), e.type === "rule").call(self);
  await H.drain(w);
  return w.trace;
};
const holdCalls = (trace) => trace.filter((t) => /runWorkflow$/.test(t[0]) && t[1] === HOLD).map((t) => t[2]);

(async () => {
  // ---- the structure
  {
    check("no Cancel button and no Cancel handler on the form (Cancel is the list's bulk action)", !find(SHIPPED.list, "button_cancel") && !H.byName(SHIPPED, "onClick_cancelIA") &&
      !JSON.stringify(SHIPPED).includes("button_cancel"));
    const badge = find(SHIPPED.list, "cancelled_status");
    check("a Cancelled badge in the list's Cancelled colours, hidden until mounted shows it", !!badge && badge.options.hidden === true && /Cancelled/.test(badge.options.defaultValue) &&
      /#F90A0A/.test(badge.options.defaultValue) && /#FDC4C4/.test(badge.options.defaultValue), badge && badge.options.hidden);
    const keys = JSON.stringify(find(SHIPPED.list, "item_assembly_status").options.datasource).match(/"dict_key","operator":"equal","valueType":"value","value":"([^"]+)"/g) || [];
    check("the status option list has Cancelled", keys.some((k) => /"value":"Cancelled"/.test(k)), keys);
  }
  // ---- mounted
  {
    let t = await mount(ia("Created"), { isEdit: true });
    check("Edit of a Created IA: Created / Complete / Complete & Post shown, no Cancel", ["button_created", "button_completed", "comp_post_button"]
      .every((m) => of(t, "display").indexOf(m) >= 0) && of(t, "display").indexOf("button_cancel") < 0, of(t, "display"));
    t = await mount(ia("Draft"), { isEdit: true });
    check("Edit of a Draft: no Cancel button (a Draft is deleted)", of(t, "display").indexOf("button_cancel") < 0, of(t, "display"));
    t = await mount(ia("Cancelled", { material_hold_status: "NONE" }), { isEdit: true });
    check("Edit of a Cancelled IA: its badge, the header and the lines locked, no button at all, no reservation row and no IA_HOLD call",
      of(t, "display").indexOf("cancelled_status") >= 0 && headerLocked(t) && tableLocked(t) &&
      ["button_draft", "button_created", "button_completed", "comp_post_button", "button_post", "button_cancel"].every((m) => of(t, "display").indexOf(m) < 0) &&
      of(t, "display").indexOf("res_summary") < 0 && holdCalls(t).length === 0, of(t, "display"));
    t = await mount(ia("Cancelled", { material_hold_status: "NONE" }), { isView: true });
    check("View of a Cancelled IA: its badge", of(t, "display").indexOf("cancelled_status") >= 0, of(t, "display"));
  }
  H.done("test_cancel");
})();
