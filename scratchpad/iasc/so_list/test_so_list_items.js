// The SO list's By Item line actions (scratchpad/iasc/so_list/patch_so_list_items.py) on both live bases (dev v541, prod v271):
//   structure  two row actions appended to the By Item table after View / Edit and their two handlers appended to the events; minus
//              those it is the base page exactly (func_handleConvertGD and onConfirm_selectPlant byte-identical)
//   behaviour  each handler on a list row (the SO and the item as records) and a form-shaped row (ids) opens the SO Linked IAs page
//              with the line's ids (Create IA with sc_action "create"); a row it can't name opens nothing; the hidden rules as the form's
//   node scratchpad/iasc/so_list/test_so_list_items.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const HERE = __dirname;

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + String(JSON.stringify(got)).slice(0, 900) + "\n  want " + String(JSON.stringify(want)).slice(0, 900));
};
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);

const PATCHER = process.env.SO_LIST_PATCHER || path.join(HERE, "patch_so_list_items.py");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "so-list-items-"));
const b = spawnSync("python3", [PATCHER, "--write"], { env: Object.assign({}, process.env, { SO_LIST_OUT: dir }), encoding: "utf8" });
if (b.status !== 0) throw new Error(b.stderr.slice(-800) || b.stdout.slice(-800));
const PAGE = "2112449353901772801";
const find = (o, model) => (Array.isArray(o) ? [].concat(...o.map((v) => find(v, model))) : o && typeof o === "object" ?
  (o.model === model ? [o] : [].concat(...Object.values(o).map((v) => find(v, model)))) : []);
const crudOf = (p) => find(p.list, "custom_r7tpmpsj")[0];
const ev = (p, name) => p.config.eventScript.filter((e) => e.name === name);

// a handler on a mock list: the toView and the warnings it gives, and the reads (o.so: the sales_order rows; o.fail: the read fails)
const run = async (func, row, o) => {
  o = o || {};
  const calls = [];
  const reads = [];
  const db = { collection: (name) => {
    const q = { name: name };
    const chain = { field: (f) => ((q.field = f), chain), where: (w) => ((q.where = w), chain), get: () => {
      reads.push(q);
      if (o.fail) return Promise.reject(new Error("down"));
      return Promise.resolve({ data: name === "sales_order" ? (o.so || [SO]).filter((r) => String(r.id) === String(q.where && q.where.id)) : [] });
    } };
    return chain;
  } };
  const self = { toView: (x) => calls.push(["toView", x]), $message: { warning: (m) => calls.push(["warning", m]) } };
  await new Function("db", "console", "return function () {\n" + func.replace("(async () => {", "return (async () => {") + "\n};")(db, { log() {}, error() {} }).call(self, { row: row });
  calls.reads = reads;
  return calls;
};
// a row action's hidden rule, as the platform evaluates it: {{ expression }} over arguments[0] = { row }
const hidden = (rule, row) => !!new Function("return (" + rule.replace(/^\{\{/, "").replace(/\}\}$/, "") + ");").call({}, { row: row });

const SO = { id: "9001", organization_id: "1001", is_processing: 0 };
const listRow = (o) => Object.assign({ id: "8002", line_index: "2", line_status: "Issued",
  item_name: { id: "5005", material_code: "SC-BOX", material_name: "Box" }, sales_order_id: { id: "9001", so_no: "SO-1", so_status: "Issued" } }, o || {});

(async () => {
for (const base of ["dev", "prod"]) {
  const OUT = JSON.parse(fs.readFileSync(path.join(dir, "so_list_items_" + base + ".json"), "utf8"));
  const BASE = JSON.parse(fs.readFileSync(path.join(HERE, "base", base === "dev" ? "so_list_dev_v541.json" : "so_list_prod_v271.json"), "utf8"));
  const L = base + ": ";
  // structure
  const acts = crudOf(OUT).options.customProps.rowActions;
  eq(L + "the By Item row actions: View, Edit, then Linked IAs and Create IA", acts.map((a) => [a.title, a.permission, a.icon, a.styleType, a.type]),
    [["View", "so_view", "eye", "Link", "custom"], ["Edit", "so_edit", "pencil-square", "Link", "custom"],
      ["Linked IAs", "so_item_linked_ias", "diagram-3", "Link", "custom"], ["Create IA", "so_item_create_ia", "plus-square", "Link", "custom"]]);
  const NEW = ["func_lineLinkedIas", "func_lineCreateIa"];
  eq(L + "each action runs its own handler, appended last to the events", [acts.slice(2).map((a) => a.events.map((e) => e.name)), OUT.config.eventScript.slice(-2).map((e) => e.name)],
    [[["func_lineLinkedIas"], ["func_lineCreateIa"]], NEW]);
  eq(L + "the action's event key is its handler's key", acts.slice(2).map((a) => a.events[0].key), OUT.config.eventScript.slice(-2).map((e) => e.key));
  const keys = OUT.config.eventScript.map((e) => e.key);
  eq(L + "every event key once", keys.filter((k, i) => keys.indexOf(k) !== i), []);
  const u = JSON.parse(JSON.stringify(OUT));
  crudOf(u).options.customProps.rowActions.splice(2, 2);
  u.config.eventScript.splice(-2, 2);
  eq(L + "minus the two actions and their handlers: the live base exactly", JSON.stringify(canon(u)) === JSON.stringify(canon(BASE)), true);
  for (const h of ["func_handleConvertGD", "onConfirm_selectPlant", "func_viewLine", "func_editLine"]) {
    eq(L + h + " byte-identical", ev(OUT, h).map((e) => e.func), ev(BASE, h).map((e) => e.func));
  }

  // behaviour
  const LINKED = ev(OUT, "func_lineLinkedIas")[0].func;
  const CREATE = ev(OUT, "func_lineCreateIa")[0].func;
  const view = (calls) => (calls.filter((c) => c[0] === "toView")[0] || [])[1];
  let c = await run(LINKED, listRow());
  eq(L + "Linked IAs on a list row as the platform gives it (no organisation in it): the order read once, the page for this line, nothing to create",
    [view(c), c.reads.map((q) => [q.name, q.where])], [{ target: PAGE, targetType: "Page", mode: "dialog", type: "add", width: "80%",
      title: "Item Assemblies - SO-1 line 2", params: { so_id: "9001", so_line_id: "8002", item_id: "5005", organization_id: "1001", sc_action: "" } }, [["sales_order", { id: "9001", is_deleted: 0 }]]]);
  c = await run(CREATE, listRow());
  eq(L + "Create IA on a list row: the same page, creating", view(c) && view(c).params, { so_id: "9001", so_line_id: "8002", item_id: "5005", organization_id: "1001", sc_action: "create" });
  c = await run(CREATE, listRow({ sales_order_id: "9001", item_name: "5005" }));
  eq(L + "a row holding ids (as the form's): the same ids", view(c) && [view(c).params, view(c).title],
    [{ so_id: "9001", so_line_id: "8002", item_id: "5005", organization_id: "1001", sc_action: "create" }, "Item Assemblies - 9001 line 2"]);
  c = await run(LINKED, listRow({ organization_id: "1003", sales_order_id: { id: "9001", so_no: "SO-1", organization_id: "1003" } }));
  eq(L + "the organisation is the order's own, as stored (never the row's)", view(c) && view(c).params.organization_id, "1001");
  c = await run(LINKED, listRow({ sales_order_id: { id: "9001", so_no: "SO-1" } }), { so: [{ id: "9001", organization_id: { id: "1001", dept_name: "Org" }, is_processing: 0 }] });
  eq(L + "the stored organisation as a record: its id", view(c) && view(c).params.organization_id, "1001");
  for (const [name, f] of [["Linked IAs", LINKED], ["Create IA", CREATE]]) {
    c = await run(f, listRow(), { so: [{ id: "9001", organization_id: "1001", is_processing: 1 }] });
    eq(L + name + ", the order being saved in the background: nothing opened, the reason", [c.filter((x) => x[0] === "toView").length, c.filter((x) => x[0] === "warning" &&
      /being saved in the background/.test(x[1])).length], [0, 1]);
    c = await run(f, listRow(), { fail: true });
    eq(L + name + ", the order unreadable: nothing opened, a warning (never a guessed organisation)", [c.filter((x) => x[0] === "toView").length, c.filter((x) => x[0] === "warning").length], [0, 1]);
    c = await run(f, listRow(), { so: [] });
    eq(L + name + ", the order gone: nothing opened, a warning", [c.filter((x) => x[0] === "toView").length, c.filter((x) => x[0] === "warning").length], [0, 1]);
  }
  for (const [label, row] of [["no line id", listRow({ id: "" })], ["no item", listRow({ item_name: null })], ["no Sales Order", listRow({ sales_order_id: null })], ["no row", undefined]]) {
    for (const [name, f] of [["Linked IAs", LINKED], ["Create IA", CREATE]]) {
      c = await run(f, row);
      eq(L + name + ", " + label + ": nothing opened, nothing read, a warning", [c.filter((x) => x[0] === "toView").length, c.reads.length, c.filter((x) => x[0] === "warning").length], [0, 0, 1]);
    }
  }

  // the hidden rules
  const [hl, hc] = acts.slice(2).map((a) => a.hidden);
  eq(L + "Linked IAs shown for a saved line, a Completed one too", [hidden(hl, listRow()), hidden(hl, listRow({ line_status: "Completed" }))], [false, false]);
  eq(L + "Linked IAs hidden: no line id, no item, the order being saved", [hidden(hl, listRow({ id: "" })), hidden(hl, listRow({ item_name: null })),
    hidden(hl, listRow({ sales_order_id: { id: "9001", is_processing: 1 } }))], [true, true, true]);
  const so = (s) => ({ sales_order_id: { id: "9001", so_status: s, is_processing: 0 } });
  eq(L + "Create IA shown on an open line of an Issued or a Processing order", [hidden(hc, listRow()), hidden(hc, listRow(so("Processing")))], [false, false]);
  eq(L + "Create IA hidden: a Completed / Cancelled line, a Completed / Cancelled / Draft order, the order being saved, an unsaved row",
    [hidden(hc, listRow({ line_status: "Completed" })), hidden(hc, listRow({ line_status: "Cancelled" })), hidden(hc, listRow(so("Completed"))), hidden(hc, listRow(so("Cancelled"))),
      hidden(hc, listRow(so("Draft"))), hidden(hc, listRow({ sales_order_id: { id: "9001", so_status: "Issued", is_processing: 1 } })), hidden(hc, listRow({ id: "" }))],
    [true, true, true, true, true, true, true]);
}
console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
})();
