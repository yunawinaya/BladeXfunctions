// test_convert_switch.js <convert.out.json>: routing of the GD form's gdV2_func_processGDLineItem (repo GDfullJSON.json) on
// a mocked page - which builder runs for the form Convert to GD opens (page_status Add) versus a reopened Multiple-convert
// Draft (Edit), with the stock check answering, failing, refusing or unreachable. The data-level equivalence of the V2
// path is v2_loader_trace.js + compare_runs.py; this checks only who builds the lines and what the fallback hands over.
const fs = require("fs"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const STOCK_CHECK = "2105663605526925314";
const findEv = (o) => { if (Array.isArray(o)) { for (const x of o) { const r = findEv(x); if (r) return r; } } else if (o && typeof o === "object") { if (o.eventScript) return o.eventScript; for (const v of Object.values(o)) { const r = findEv(v); if (r) return r; } } return null; };
const source = findEv(JSON.parse(fs.readFileSync(R + "Goods Delivery/GDfullJSON.json", "utf8"))).find((e) => e.name === "gdV2_func_processGDLineItem").func;
assert.strictEqual(source, fs.readFileSync(R + "Goods Delivery/AsyncV2/gdV2_funcProcessGDLineItem.js", "utf8"), "form handler == repo mirror");
// MUTANT=[from, to] (mutation checks of this test): the handler with one edit
const MUT = process.env.MUTANT ? JSON.parse(process.env.MUTANT) : null;
const source2 = MUT ? source.replace(MUT[0], MUT[1]) : source;
if (MUT) assert.notStrictEqual(source2, source, "mutant applies");
const conv = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).data.data[0];
const EMPTY_FACTS = JSON.stringify({ items: [], balances: { regular: [], batch: [], serial: [] }, batches: [], reserved: [], hu: [], bins: [] });

async function run({ pageStatus, answer, globalOn = false, convertOn = true, plant }) {
  let code = source2;
  if (globalOn) code = code.replace("const STOCK_CHECK_ENABLED = false;", "const STOCK_CHECK_ENABLED = true;");
  if (!convertOn) code = code.replace("const CONVERT_STOCK_CHECK_ENABLED = true;", "const CONVERT_STOCK_CHECK_ENABLED = false;");
  const log = { order: [], triggers: [], stockCalls: 0, errors: [], tableSet: false };
  const values = Object.assign({ table_gd: [] }, conv, { page_status: pageStatus }, plant === undefined ? {} : { plant_id: plant });
  const page = {
    getValue: (k) => k.split(".").reduce((o, p) => (o == null ? undefined : o[p]), values),
    getValues: () => values,
    setData: async (x) => { if ("table_gd" in x) log.tableSet = true; Object.assign(values, x); },
    showLoading: () => log.order.push("show"), hideLoading: () => log.order.push("hide"),
    $message: { error: (m) => log.errors.push(String(m)), warning: () => {}, success: () => {}, info: () => {} },
    $alert: async (m) => log.errors.push("alert: " + String(m).slice(0, 120)),
    display: () => {}, hide: () => {}, disabled: () => {}, openDialog: () => {},
    getComponent: () => ({ hideChildRecord: () => {}, options: {} }),
    getVarGlobal: (k) => (k === "deptParentId" ? conv.organization_id : "admin"), getVarSystem: () => conv.organization_id,
    triggerEvent: async (name, args) => { log.order.push("trigger:" + name); log.triggers.push({ name, args }); },
    runWorkflow: (id, params, ok, err) => {
      assert.strictEqual(id, STOCK_CHECK);
      log.stockCalls++;
      setTimeout(() => {
        if (answer === "ok") ok({ data: { facts: EMPTY_FACTS } });
        else if (answer === "err") err("gateway down");
        else if (answer === "refused") ok({ data: { result_code: "GD_STOCK_GUARD", result_message: "plant is not in this organization" } });
        else ok({});
      }, 5);
    },
  };
  const db = { collection: () => { const api = { where: () => api, filter: () => api, field: () => api, orderBy: () => api, limit: () => api, get: async () => ({ data: [] }) }; return api; } };
  const args = { allItems: JSON.parse(conv.all_item || "[]").map((item) => Object.assign({}, item, { altUOM: item.altUOM == null ? "" : item.altUOM.toString() })) };
  const snapshot = JSON.stringify(args);
  const quiet = { log: () => {}, warn: () => {}, error: () => {} };
  Function("db", "console", "window", "return async function () {\n" + code + "\n}")(db, quiet, {}).call(page, args);
  for (let i = 0; i < 300 && !(log.triggers.length || (log.tableSet && log.order.includes("hide"))); i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  return { log, args, snapshot };
}

const classicOnly = (r, why) => {
  assert.deepStrictEqual(r.log.triggers.map((t) => t.name), ["func_processGDLineItem"], why + ": the classic builder runs once");
  assert.strictEqual(r.log.triggers[0].args, r.args, why + ": it gets the handler's own input object");
  assert.strictEqual(JSON.stringify(r.args), r.snapshot, why + ": that input is untouched");
  assert.strictEqual(r.log.tableSet, false, why + ": V2 wrote no lines");
};

(async () => {
  const lines = JSON.parse(conv.all_item || "[]").length;
  let r = await run({ pageStatus: "Add", answer: "ok" });
  assert.ok(r.log.stockCalls >= 1 && r.log.triggers.length === 0 && r.log.tableSet, JSON.stringify(r.log));
  assert.ok(r.log.order[0] === "show" && r.log.order.includes("hide"));
  console.log("ok Convert (Add): V2 builds the " + lines + " lines through " + r.log.stockCalls + " stock-check call(s), classic not run");

  r = await run({ pageStatus: "Edit", answer: "ok" });
  assert.strictEqual(r.log.stockCalls, 0);
  classicOnly(r, "Edit");
  assert.deepStrictEqual(r.log.order, ["trigger:func_processGDLineItem"], "Edit: no overlay, nothing before the hand-over");
  console.log("ok reopened Multiple-convert Draft (Edit): classic, untouched hand-over, no stock check");

  r = await run({ pageStatus: undefined, answer: "ok" });
  assert.strictEqual(r.log.stockCalls, 0);
  classicOnly(r, "page_status unset");
  console.log("ok page_status not set: classic (only a known Add takes the convert switch)");

  r = await run({ pageStatus: "Add", answer: "ok", convertOn: false });
  assert.strictEqual(r.log.stockCalls, 0);
  classicOnly(r, "convert switch off");
  console.log("ok CONVERT_STOCK_CHECK_ENABLED = false: Convert is classic again");

  for (const answer of ["err", "refused", "nodata"]) {
    r = await run({ pageStatus: "Add", answer });
    assert.ok(r.log.stockCalls >= 1);
    classicOnly(r, "stock check " + answer);
    assert.deepStrictEqual(r.log.errors, [], "no 'quantities are not suggested' message: the classic builds them");
    const hide = r.log.order.lastIndexOf("hide"), trig = r.log.order.indexOf("trigger:func_processGDLineItem");
    assert.ok(hide >= 0 && hide < trig, "the V2 overlay is closed before the hand-over: " + r.log.order.join(","));
    console.log("ok stock check " + answer + ": falls back to the classic builder with the original input");
  }

  r = await run({ pageStatus: "Add", answer: "ok", plant: "" });
  assert.strictEqual(r.log.stockCalls, 0);
  classicOnly(r, "no plant");
  console.log("ok no plant on the form: classic, no stock call");

  r = await run({ pageStatus: "Edit", answer: "ok", globalOn: true });
  assert.ok(r.log.stockCalls >= 1 && r.log.triggers.length === 0 && r.log.tableSet);
  console.log("ok STOCK_CHECK_ENABLED = true still means V2 everywhere (Edit too)");
  console.log("9 passed");
})().catch((e) => { console.error(e); process.exit(1); });
