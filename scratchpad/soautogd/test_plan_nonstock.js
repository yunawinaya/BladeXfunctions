// test_plan_nonstock.js <fixture.json>: SO_AUTO_GD's code_v2plan (patch_nonstock_fit.py) on a real convert run's inputs (prod
// LSH 2026-10-23 13:59, 4 sales orders, two with a non-stock charge line; the fixture stays in the session scratchpad). Before:
// those two go CLASSIC; after: V2, unless GD_V2_NONSTOCK_ENABLED is false; GD_ASYNC_SUBMIT's guard accepts every V2 payload.
const fs = require("fs"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const fx = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const node = (file, id) => {
  const walk = (o) => {
    if (Array.isArray(o)) { for (const v of o) { const r = walk(v); if (r) return r; } return null; }
    if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = walk(v); if (r) return r; } }
    return null;
  };
  return walk(JSON.parse(fs.readFileSync(file.startsWith("/") ? file : R + file, "utf8"))).data.script.code;
};
const run = (code, subst) => {
  let src = code;
  for (const [k, v] of Object.entries(subst)) src = src.split(k).join(v);
  const left = src.match(/\{\{[^}]+\}\}/g);
  assert.ok(!left, "unsubstituted: " + left);
  const log = console.log;
  console.log = () => {};
  try { return new Function(src)(); } finally { console.log = log; }
};
const NEW = node("Goods Delivery/SOconvertGDCreatedWorkflow.json", "code_v2plan");
const OLD = node(R + "scratchpad/gdc/gdcreate/nonstock/SO_AUTO_GD.v21_base.json", "code_v2plan");
const GUARD = node("Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json", "code_node_EluyWNR5");
const payloads = fx.code_build.data.payloads, items = fx.sql_node_Items.data, org = fx.params.organization_id;
const flat = (x) => (Array.isArray(x) ? x : x ? [x] : []);
// the fit read as the patched sql_v2facts answers it: a non-stock item (stock_control 0, show_delivery 0) is f1 NS
const byId = {};
for (const it of flat(items)) byId[String(it.id)] = it;
const factsOld = flat(fx.sql_v2facts.data);
const factsNew = factsOld.map((f) => {
  const it = byId[String(f.id)];
  return f.kind === "ITEM" && it && String(it.stock_control) === "0" && String(it.show_delivery) === "0" ? Object.assign({}, f, { f1: "NS" }) : f;
});
const plan = (code, facts) => run(code, {
  "{{workflowparams:v2}}": '"1"', "{{workflowparams:organization_id}}": JSON.stringify(org),
  "{{node:code_build.data.payloads}}": JSON.stringify(payloads), "{{node:sql_node_Items.data}}": JSON.stringify(items),
  "{{node:sql_v2facts.data}}": JSON.stringify(facts),
}).payloads;
const routes = (out) => out.map((p) => p.so_no + ":" + p.route).join(" ");
const guard = (p) => {
  const subst = { "{{workflowparams:organization_id}}": JSON.stringify(org), "{{workflowparams:plant_id}}": JSON.stringify(p.v2Plant),
    "{{workflowparams:idempotency_key}}": JSON.stringify(p.v2Key), "{{workflowparams:payload}}": JSON.stringify(p.v2Payload),
    "{{workflowparams:confirmation_hash}}": '""', "{{workflowparams:correlation_id}}": '""', "{{workflowparams:payload_hash}}": '""' };
  for (const m of GUARD.match(/\{\{[^}]+\}\}/g) || []) if (!(m in subst)) subst[m] = m.indexOf("tenant") >= 0 ? '"128671"' : '""';
  return run(GUARD, subst);
};
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

const nonStockMaterials = Object.keys(byId).filter((id) => String(byId[id].stock_control) === "0" && String(byId[id].show_delivery) === "0");
console.log("fixture:", payloads.length, "sales orders;", nonStockMaterials.length, "non-stock material(s) among", Object.keys(byId).length);
let out = plan(OLD, factsOld);
assert.strictEqual(routes(out), "SO2610-1541:V2 SO-Lee-029829:CLASSIC SO-Tom-035908:CLASSIC SO2610-1584:V2", routes(out));
assert.ok(out.filter((p) => p.route === "CLASSIC").every((p) => /not a stock-controlled item \(stock_control 0, show_delivery 0\)/.test(p.reason)));
ok("before (v21): the two orders with a charge line go CLASSIC, as prod did at 13:59");

out = plan(NEW, factsNew);
assert.strictEqual(routes(out), "SO2610-1541:V2 SO-Lee-029829:V2 SO-Tom-035908:V2 SO2610-1584:V2", routes(out));
ok("after: all four go V2");
for (const p of out) {
  const pl = JSON.parse(p.v2Payload);
  const ns = pl.lines.filter((l) => nonStockMaterials.indexOf(String(l.material_id)) >= 0);
  assert.ok(ns.every((l) => l.temp_qty_data === undefined || (Array.isArray(l.temp_qty_data) && !l.temp_qty_data.length)), p.so_no + ": a non-stock line carries no allocation");
  const g = guard(p);
  assert.notStrictEqual(g.route, "REJECT", p.so_no + ": GD_ASYNC_SUBMIT's guard rejects it: " + JSON.stringify(g).slice(0, 200));
}
ok("after: every V2 payload passes GD_ASYNC_SUBMIT's guard; the non-stock lines carry no allocation");

out = plan(NEW.replace("const GD_V2_NONSTOCK_ENABLED = true;", "const GD_V2_NONSTOCK_ENABLED = false;"), factsNew);
assert.strictEqual(routes(out), "SO2610-1541:V2 SO-Lee-029829:CLASSIC SO-Tom-035908:CLASSIC SO2610-1584:V2", routes(out));
ok("switch off: back to CLASSIC for the two");
console.log(n + " passed");
