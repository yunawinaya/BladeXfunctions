// test_plan.js <fixture.json>: SO_AUTO_GD v18's code_v2plan, run offline on a real code_build output (fixture from a dev run),
// then GD_ASYNC_SUBMIT's own guard (code_node_EluyWNR5) on every V2 submit it plans - the payload must pass the guard as-is.
const fs = require("fs"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const fx = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const node = (file, id) => {
  const walk = (o) => {
    if (Array.isArray(o)) { for (const v of o) { const r = walk(v); if (r) return r; } return null; }
    if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = walk(v); if (r) return r; } }
    return null;
  };
  return walk(JSON.parse(fs.readFileSync(R + file, "utf8"))).data.script.code;
};
const run = (code, subst) => {
  let src = code;
  for (const [k, v] of Object.entries(subst)) src = src.split(k).join(v);
  const left = src.match(/\{\{[^}]+\}\}/g);
  assert.ok(!left, "unsubstituted: " + left);
  return new Function(src)();
};
const PLAN = node("Goods Delivery/SOconvertGDCreatedWorkflow.json", "code_v2plan");
const GUARD = node("Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json", "code_node_EluyWNR5");
const cb = fx.code_build.data, items = fx.items.data, org = fx.params.organization_id;
const plan = (payloads, v2, itemRows, facts) => run(PLAN, {
  "{{workflowparams:v2}}": JSON.stringify(v2), "{{workflowparams:organization_id}}": JSON.stringify(org),
  "{{node:code_build.data.payloads}}": JSON.stringify(payloads), "{{node:sql_node_Items.data}}": JSON.stringify(itemRows || items),
  "{{node:sql_v2facts.data}}": facts === undefined ? "" : JSON.stringify(facts),
});
const IDS = node("Goods Delivery/SOconvertGDCreatedWorkflow.json", "code_v2ids");
const guard = (p) => {
  const subst = { "{{workflowparams:organization_id}}": JSON.stringify(org), "{{workflowparams:plant_id}}": JSON.stringify(p.v2Plant),
    "{{workflowparams:idempotency_key}}": JSON.stringify(p.v2Key), "{{workflowparams:payload}}": JSON.stringify(p.v2Payload),
    "{{workflowparams:confirmation_hash}}": '""', "{{workflowparams:correlation_id}}": '""', "{{workflowparams:payload_hash}}": '""' };
  for (const m of GUARD.match(/\{\{[^}]+\}\}/g) || []) if (!(m in subst)) subst[m] = m.indexOf("tenant") >= 0 ? '"496474"' : '""';
  return run(GUARD, subst);
};
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };
const lines = (p) => p.allData.table_gd.length;

console.log("fixture:", cb.payloads.length, "payload(s),", cb.payloads.map(lines).join("/"), "lines;", items.length, "items");
let out = plan(cb.payloads, "1");
assert.strictEqual(out.payloads.length, cb.payloads.length);
const p = out.payloads[0];
assert.strictEqual(p.route, "V2", "the 500-line SO goes to V2: " + p.reason);
assert.strictEqual(p.allData, null, "a V2 item no longer carries allData");
assert.ok(/^[A-Za-z0-9:_-]{16,128}$/.test(p.v2Key), "key format (GD_ASYNC_SUBMIT's rule): " + p.v2Key);
assert.ok(/^[0-9]+$/.test(p.v2Plant));
const pl = JSON.parse(p.v2Payload);
assert.strictEqual(pl.command, "CREATE_GD_FROM_FORM");
assert.strictEqual(pl.lines.length, lines(cb.payloads[0]));
assert.ok(pl.lines.every((l) => l.temp_qty_data === undefined || (Array.isArray(l.temp_qty_data) && !l.temp_qty_data.length)), "no allocations: PREPARE allocates");
assert.strictEqual(pl.header.allocation_mode, "RESERVE");
console.log("  header:", JSON.stringify({ delivery_no: pl.header.delivery_no, delivery_no_type: pl.header.delivery_no_type, so_id: pl.header.so_id, plant: pl.header.plant_id, org: pl.header.organization_id }));
ok("real 500-line SO -> V2, key + payload shape, no allocations");

const g = guard(p);
console.log("  SUBMIT guard:", JSON.stringify(g).slice(0, 300));
assert.notStrictEqual(g.route, "REJECT", "GD_ASYNC_SUBMIT's guard rejects the payload");
ok("GD_ASYNC_SUBMIT's guard accepts the planned submit");

out = plan(cb.payloads, "");
assert.ok(out.payloads.every((x) => x.route === "CLASSIC" && x.allData && x.reason === "V2 switched off"));
ok("v2 off -> every delivery classic, allData kept");

const mat = String(cb.payloads[0].allData.table_gd[0].material_id);
out = plan(cb.payloads, "1", items.map((it) => (String(it.id) === mat ? Object.assign({}, it, { stock_control: "0" }) : it)));
assert.strictEqual(out.payloads[0].route, "CLASSIC");
assert.ok(/not a stock-controlled item/.test(out.payloads[0].reason), out.payloads[0].reason);
ok("a non-stock line -> classic, the form's reason kept");

const big = JSON.parse(JSON.stringify(cb.payloads[0]));
while (big.allData.table_gd.length <= 2000) big.allData.table_gd = big.allData.table_gd.concat(big.allData.table_gd.slice(0, 500));
out = plan([big], "1");
assert.deepStrictEqual([out.payloads.length, out.blocked.length], [0, 1]);
assert.ok(/More than 2000 lines/.test(out.blocked[0].reason));
ok("more than 2,000 lines -> not converted, never classic");

const twice = [plan(cb.payloads, "1").payloads[0].v2Key, plan(cb.payloads, "1").payloads[0].v2Key];
assert.notStrictEqual(twice[0], twice[1]);
ok("each convert click gets its own key");
const l0 = cb.payloads[0].allData.table_gd[0];
out = plan(cb.payloads, "1", items, [{ kind: "HU", id: String(l0.material_id) }]);
assert.strictEqual(out.payloads[0].route, "CLASSIC");
assert.ok(/handling units in this plant/.test(out.payloads[0].reason), out.payloads[0].reason);
out = plan(cb.payloads, "1", items, [{ kind: "PEND", id: String(l0.so_line_item_id) }]);
assert.strictEqual(out.payloads[0].route, "CLASSIC");
assert.ok(/pending reservation/.test(out.payloads[0].reason), out.payloads[0].reason);
out = plan(cb.payloads, "1", items, [{ kind: "HU", id: "999" }, { kind: "PEND", id: "999" }]);
assert.strictEqual(out.payloads[0].route, "V2");
ok("handling-unit item / pending SO line -> classic (V2 would refuse them); unrelated facts change nothing");
const item = (over) => Object.assign({ kind: "ITEM", id: String(l0.material_id), f1: "1", f2: "First In First Out", f3: "0", f4: "0", f5: "1.0000" }, over);
out = plan(cb.payloads, "1", items, [item({ f4: "" })]);
assert.strictEqual(out.payloads[0].route, "CLASSIC");
assert.ok(/serial number management ''/.test(out.payloads[0].reason), out.payloads[0].reason);
assert.strictEqual(plan(cb.payloads, "1", items, [item({ f2: "FIFO" })]).payloads[0].route, "CLASSIC");
assert.strictEqual(plan(cb.payloads, "1", items, [item({})]).payloads[0].route, "V2");
assert.strictEqual(plan(cb.payloads, "1", items, [{ kind: "SETUP", id: "1", f1: "Manual" }, { kind: "HU", id: String(l0.material_id) }]).payloads[0].route, "V2", "Manual: PREPARE allocates nothing");
ok("item master flags PREPARE refuses (NULL serial, costing 'FIFO') -> classic; clean flags -> V2; Manual mode ignores handling units");

const ids = (v2, o, p) => run(IDS, { "{{workflowparams:v2}}": JSON.stringify(v2), "{{workflowparams:organization_id}}": JSON.stringify(o),
  "{{workflowparams:plant_id}}": JSON.stringify(p), "{{node:code_build.data.payloads}}": JSON.stringify(cb.payloads) });
let x = ids("1", org, fx.params.plant_id);
assert.strictEqual(x.run, 1);
assert.strictEqual(x.soLineIdsSql.split(",").length, new Set(cb.payloads[0].allData.table_gd.map((l) => String(l.so_line_item_id))).size);
assert.ok(/^'[0-9]+'(,'[0-9]+')*$/.test(x.soLineIdsSql));
x = ids("", org, fx.params.plant_id);
assert.deepStrictEqual([x.run, x.orgSql, x.plantSql], [0, "0", "0"]);
x = ids("1", "1 OR 1=1", "2");
assert.deepStrictEqual([x.run, x.orgSql, x.plantSql], [0, "0", "0"]);
ok("facts input: quoted SO line ids, digits-only org / plant, nothing when V2 is off or an id is not digits");
console.log(n + " passed");
