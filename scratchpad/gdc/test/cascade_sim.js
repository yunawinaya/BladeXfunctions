// cascade_sim.js <tenant> <so_id> <gd_id>: SO_CASCADE (repo Sales Order/) on the interpreter, called WITHOUT a cascade_ref
// (the classic route: the Processing refusal + the 500-line cap); the cascade_ref / GD Edit V2 routes are tested by
// scratchpad/gde/test/cascade_v2_sim.js. The SO lines, the GD and its
// lines are read live from dev (read-only); GOODS_DELIVERY, PICKING_PLAN and GLOBAL_ALLOCATION are mocked and recorded,
// so nothing is written. Scenarios: the Processing block, the 500-line cap (edit and append), and the normal small cascade.
const cp = require("child_process"), assert = require("assert");
const { Engine } = require("../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [tenant, soId, gdId] = process.argv.slice(2);
const live = (sql) => JSON.parse(cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "100000", sql], { maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const T = `tenant_id = '${tenant}'`;
const str = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" && Math.abs(v) > 2 ** 53 ? String(v) : v])));
const soLines = str(live(`SELECT CAST(id AS CHAR) id, CAST(item_name AS CHAR) item_name, so_quantity, CAST(so_item_uom AS CHAR) so_item_uom, delivered_qty, planned_qty,
  so_item_price, so_amount, so_desc, line_index, item_id FROM sales_order_axszx8cj_sub WHERE ${T} AND sales_order_id = ${soId} AND is_deleted = 0 ORDER BY id`));
const gd = str(live(`SELECT CAST(id AS CHAR) id, delivery_no, gd_status, CAST(plant_id AS CHAR) plant_id, organization_id, so_no FROM goods_delivery WHERE ${T} AND id = ${gdId}`))[0];
const gdl = str(live(`SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(so_line_item_id AS CHAR) so_line_item_id, gd_qty, gd_order_quantity,
  base_qty, gd_initial_delivered_qty, temp_qty_data, picked_temp_qty_data, picked_qty, CAST(gd_order_uom_id AS CHAR) gd_order_uom_id, unit_price, total_price
  FROM goods_delivery_fwii8mvb_sub WHERE ${T} AND goods_delivery_id = ${gdId} AND is_deleted = 0 ORDER BY id`));
const items = live(`SELECT CAST(i.id AS CHAR) id, i.material_code, i.material_name, CAST(i.based_uom AS CHAR) based_uom, '[]' uom_conversion_json, i.material_costing_method
  FROM item i WHERE i.id IN (SELECT material_id FROM goods_delivery_fwii8mvb_sub WHERE ${T} AND goods_delivery_id = ${gdId})`);

function run(label, { status, lines, change, passNo = 1, addLine = false }) {
  const keep = gdl.slice(0, lines);
  const keepSo = soLines.filter((s) => keep.some((l) => l.so_line_item_id === s.id));
  const doc = Object.assign({}, gd, { gd_status: status, so_id: [soId], table_gd: keep });
  const prev = keepSo.map((s) => Object.assign({}, s));
  let next = keepSo.map((s) => Object.assign({}, s));
  if (change === "reduce") next[0].so_quantity = Number(next[0].so_quantity) / 2;
  if (change === "price") next[0].so_item_price = Number(next[0].so_item_price) + 1;
  if (addLine) next = next.concat([Object.assign({}, keepSo.find((s) => s.item_name), { id: "9990000000000000001", so_quantity: 2, delivered_qty: 0, planned_qty: 0 })]);
  const calls = [];
  const e = new Engine({ dir: R + "Sales Order", db: { tenantId: tenant, insert: (t, r) => r, update: (t, r) => r.length },
    mocks: {
      sql: new Proxy({}, { get: () => () => items }),
      read: {
        search_cd_gds: () => ({ total: 1, count: 1, data: [doc] }), search_cd_pps: () => ({ total: 0, count: 0, data: [] }),
        get_cd_setup: () => ({ count: 1, data: {} }), search_cd_bins: () => ({ data: [] }), search_cd_uoms: () => ({ data: [] }), search_cd_batches: () => ({ data: [] }),
        search_cd_solines: () => ({ data: keepSo }),
      },
    } });
  // a missing value reaches a code node as null on the platform (the interpreter would inject nothing)
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  // the platform's ConditionRule if-nodes (filter leaves on node.X.data.y); the shared interpreter knows expressions only
  const node0 = e.node.bind(e);
  e.node = (nd, ctx) => {
    if (nd.type !== "if" || (nd.data.expression || {}).code) return node0(nd, ctx);
    const test = (leaf) => {
      if (leaf.type === "branch") return (leaf.operator === "any" ? "some" : "every") && leaf.children[leaf.operator === "any" ? "some" : "every"](test);
      const v = e.resolve(leaf.prop.replace(/^node\./, "node:").replace(/^workflowparams\./, "workflowparams:"), ctx);
      const op = leaf.operator;
      if (op === "numberEqual") return Number(v) === Number(leaf.value);
      if (op === "numberNotEqual") return Number(v) !== Number(leaf.value);
      if (op === "equal") return String(v) === String(leaf.value);
      if (op === "notEqual") return String(v) !== String(leaf.value);
      if (op === "greaterThan") return Number(v) > Number(leaf.value);
      throw new Error("if " + nd.id + ": operator " + op);
    };
    e.trace.push(ctx.name + " " + nd.id);
    e.block(nd.blocks[nd.data.filter.list.every(test) ? 0 : 1].blocks, ctx);
  };
  e.run = ((run0) => (n, p) => {
    if (n === "SOcascadeDownstreamWorkflow") return run0(n, p);
    calls.push(n === "GOODS_DELIVERY" ? n + "(" + ((p.allData && p.allData.table_gd) || []).length + " lines)" : n);
    if (n === "GLOBAL_ALLOCATION") return { returned: { code: "200", allocationData: [{ location_id: "1", batch_id: null, gd_quantity: 2, unrestricted_qty: 2 }] }, ctx: {} };
    return { returned: { code: "200", message: "", pickingReversalNote: "", creditLimitNote: "" }, ctx: {} };
  })(e.run.bind(e));
  const res = e.run("SOcascadeDownstreamWorkflow", { passNo, so_id: [soId], prev_table_so: prev, next_table_so: next, confirmPickReversal: "", raiseGdQty: "", organization_id: gd.organization_id });
  const out = res.returned || {};
  if (process.env.TRACE) console.log("    diff:", JSON.stringify((res.ctx.out || {}).code_cd_diff).slice(0, 600));
  if (process.env.TRACE) console.log("    trace:", e.trace.map((x) => x.split(" ")[1]).join(" ").slice(0, 1500), JSON.stringify(out).slice(0, 300));
  console.log(`${label}\n    -> ${out.code} ${String(out.message || "").slice(0, 200)}\n    calls: ${calls.join(", ") || "none"}`);
  return { out, calls };
}

const n = gdl.length;
console.log(`GD ${gd.delivery_no} ${n} lines, SO ${soLines.length} lines`);
let r = run("small GD (3 lines), qty reduced", { status: "Created", lines: 3, change: "reduce" });
assert.ok(r.calls.includes("GOODS_DELIVERY(3 lines)"), "small cascade still re-saves the GD");
r = run("same GD Processing, qty reduced", { status: "Processing", lines: 3, change: "reduce" });
assert.strictEqual(r.out.code, "406"); assert.ok(/processed in the background/.test(r.out.message)); assert.ok(!r.calls.some((c) => c.startsWith("GOODS_DELIVERY")));
r = run("same GD Processing, price only", { status: "Processing", lines: 3, change: "price" });
assert.notStrictEqual(r.out.code, "406");
r = run(`whole GD (${n} lines), qty reduced`, { status: "Created", lines: n, change: "reduce" });
assert.strictEqual(r.out.code, "406"); assert.ok(/up to (500|1,000) lines/.test(r.out.message)); assert.ok(!r.calls.some((c) => c.startsWith("GOODS_DELIVERY")));
r = run(`whole GD (${n} lines), new SO line (pass B)`, { status: "Created", lines: n, passNo: 2, addLine: true });
assert.strictEqual(r.out.code, "406"); assert.ok(/more than a Sales Order change can update \((500|1,000)\)/.test(r.out.message)); assert.ok(!r.calls.some((c) => c.startsWith("GOODS_DELIVERY")));
r = run("small GD (3 lines), new SO line (pass B)", { status: "Created", lines: 3, passNo: 2, addLine: true });
assert.ok(r.calls.includes("GOODS_DELIVERY(4 lines)"), "a small append still re-saves the GD");
console.log("all cascade scenarios passed");
