// cascade_v2_sim.js <tenant> <so_id> <gd_id> [scenario...]: SO_CASCADE (repo Sales Order/) on gdc's interpreter with GD Edit V2:
// each delivery goes to GD_EDIT_SUBMIT (CASCADE, its payload, cascade_ref) -> QUEUED: GD_EDIT_WORKER prepares it (HELD = held
// for SO_SAVE's RELEASE); NOT_ELIGIBLE / no cascade_ref: GOODS_DELIVERY as before; a pass A not saved cancels what it held.
// The SO lines and the GD are read live from dev (read-only); GD_EDIT_SUBMIT, GD_EDIT_WORKER, GOODS_DELIVERY, PICKING_PLAN and
// GLOBAL_ALLOCATION are mocked and recorded: nothing is written.
const cp = require("child_process"), assert = require("assert");
const { Engine } = require("../../gdc/pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const argv = process.argv.slice(2);
const mutate = argv.indexOf("--mutate") >= 0 ? argv.splice(argv.indexOf("--mutate"), 2)[1] : "";
const [tenant, soId, gdId, ...want] = argv;
// a mutant runs a mutated copy of the repo's SO_CASCADE (code nodes hold their code JSON-encoded)
const MUT = {
  cancel_off: ["{ heldJobs: [], cancelJobs: held }", "{ heldJobs: [], cancelJobs: [] }"],
  route_classic: ["if (!ref || s([{{node:code_cd_gde_args.data.enabled}}][0]) !== \"YES\" || s(a.route) === \"NOT_ELIGIBLE\") route = \"CLASSIC\";", "if (true) route = \"CLASSIC\";"],
  held_any: ["const held = String(w.job_status || \"\") === \"HELD\";", "const held = true;"],
  cap_off: ["big: on && lines > 500 ? \"Y\" : \"N\", ask: on && lines <= 500 ? \"Y\" : \"N\"", "big: \"N\", ask: on ? \"Y\" : \"N\""],
  fallback_off: ["FALLBACK.indexOf(s(w.result_code)) >= 0", "false"],
  collect_ignores_fallback: ["if (rt.route === \"V2\" && fb.fallback !== \"YES\") {", "if (rt.route === \"V2\") {"],
  switch_ignored: ["s([{{node:code_cd_gde_args.data.enabled}}][0]) !== \"YES\" || ", ""],
};
let DIR = R + "Sales Order";
if (mutate) {
  const fs = require("fs"), os = require("os"), path = require("path");
  const enc = (x) => JSON.stringify(x).slice(1, -1);
  let t = fs.readFileSync(DIR + "/SOcascadeDownstreamWorkflow.json", "utf8");
  if (t.indexOf(enc(MUT[mutate][0])) < 0) throw new Error("mutant " + mutate + " does not apply");
  t = t.split(enc(MUT[mutate][0])).join(enc(MUT[mutate][1]));
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cascade-mut-"));
  fs.writeFileSync(DIR + "/SOcascadeDownstreamWorkflow.json", t);
}
// the cascade switch flipped off (GDE_CASCADE_ENABLED = false): a copy of the repo's SO_CASCADE, made once
let offDir = "";
const OFF_DIR = () => {
  if (offDir) return offDir;
  const fs = require("fs"), os = require("os"), path = require("path");
  const enc = (x) => JSON.stringify(x).slice(1, -1);
  const t = fs.readFileSync(DIR + "/SOcascadeDownstreamWorkflow.json", "utf8");
  if (t.indexOf(enc("const GDE_CASCADE_ENABLED = true;")) < 0) throw new Error("no GDE_CASCADE_ENABLED switch in SO_CASCADE");
  offDir = fs.mkdtempSync(path.join(os.tmpdir(), "cascade-off-"));
  fs.writeFileSync(offDir + "/SOcascadeDownstreamWorkflow.json", t.split(enc("const GDE_CASCADE_ENABLED = true;")).join(enc("const GDE_CASCADE_ENABLED = false;")));
  return offDir;
};
const live = (sql) => JSON.parse(cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "100000", sql], { maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/^[^\[]*/, ""));
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
const REF = "SO|" + soId + "|sim";
// a job id as the platform makes them (digits), one per delivery
const JOB = (gdIdOf) => String(2111000000000000000n + BigInt(String(gdIdOf).slice(-6)));

// o: { passNo, ref, gds: [doc], reduce: [so line ids], addLine, submit: (params, i) => answer, worker: (job) => answer }
function run(label, o) {
  const passNo = o.passNo || 1;
  const docs = o.gds;
  const linked = new Set(docs.flatMap((d) => d.table_gd.map((l) => l.so_line_item_id)));
  const keepSo = soLines.filter((s) => linked.has(s.id));
  const prev = keepSo.map((s) => Object.assign({}, s));
  let next = keepSo.map((s) => Object.assign({}, s));
  for (const id of o.reduce || []) { const l = next.find((s) => s.id === id); l.so_quantity = Number(l.so_quantity) - 1; }
  if (o.addLine) next = next.concat([Object.assign({}, keepSo.find((s) => s.item_name), { id: "9990000000000000001", so_quantity: 2, delivered_qty: 0, planned_qty: 0 })]);
  const calls = [];
  let submits = 0;
  const e = new Engine({ dir: o.off ? OFF_DIR() : DIR, db: { tenantId: tenant, insert: (t, r) => r, update: (t, r) => r.length },
    mocks: {
      sql: new Proxy({}, { get: () => () => items }),
      read: {
        search_cd_gds: () => ({ total: docs.length, count: docs.length, data: docs }), search_cd_pps: () => ({ total: 0, count: 0, data: [] }),
        get_cd_setup: () => ({ count: 1, data: {} }), search_cd_bins: () => ({ data: [] }), search_cd_uoms: () => ({ data: [] }), search_cd_batches: () => ({ data: [] }),
        search_cd_solines: () => ({ data: keepSo }),
      },
    } });
  // a missing value reaches a code node as null on the platform (the interpreter would inject nothing)
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  // the platform's ConditionRule if-nodes (as gdc's cascade_sim.js)
  const node0 = e.node.bind(e);
  e.node = (nd, ctx) => {
    if (nd.type !== "if" || (nd.data.expression || {}).code) return node0(nd, ctx);
    const test = (leaf) => {
      if (leaf.type === "branch") return leaf.children[leaf.operator === "any" ? "some" : "every"](test);
      const v = e.resolve(leaf.prop.replace(/^node\./, "node:").replace(/^workflowparams\./, "workflowparams:"), ctx);
      if (leaf.operator === "numberEqual") return Number(v) === Number(leaf.value);
      if (leaf.operator === "equal") return String(v) === String(leaf.value);
      if (leaf.operator === "notEqual") return String(v) !== String(leaf.value);
      throw new Error("if " + nd.id + ": operator " + leaf.operator);
    };
    e.block(nd.blocks[nd.data.filter.list.every(test) ? 0 : 1].blocks, ctx);
  };
  e.run = ((run0) => (n, p) => {
    if (n === "SOcascadeDownstreamWorkflow") return run0(n, p);
    if (n === "GD_EDIT_SUBMIT") {
      if (p.operation === "CANCEL_HELD") { calls.push("CANCEL_HELD(" + p.gd_id + "," + p.cascade_ref + ")"); return { returned: { route: "CANCELLING", code: "200", job_id: JOB(p.gd_id) }, ctx: {} }; }
      calls.push("SUBMIT(" + p.operation + "," + p.source + "," + p.gd_id + "," + ((p.form && p.form.table_gd) || []).length + " lines," + (p.cascade_ref || "no ref") + "," + JSON.stringify(p.answers) + ")");
      if (!p.cascade_ref) return { returned: { route: "REJECT", code: "400", message: "cascade_ref is required for a cascade submit" }, ctx: {} };
      return { returned: o.submit ? o.submit(p, submits++) : { route: "QUEUED", code: "200", job_id: JOB(p.gd_id), picking_reversal_note: "" }, ctx: {} };
    }
    if (n === "GD_EDIT_WORKER") { calls.push("WORKER(" + p.job_id + ")"); return { returned: o.worker ? o.worker(p.job_id) : { job_status: "HELD", job_id: p.job_id, result_message: "held" }, ctx: {} }; }
    calls.push(n === "GOODS_DELIVERY" ? n + "(" + ((p.allData && p.allData.table_gd) || []).length + " lines)" : n);
    if (n === "GLOBAL_ALLOCATION") return { returned: { code: "200", allocationData: [{ location_id: "1", batch_id: null, gd_quantity: 2, unrestricted_qty: 2 }] }, ctx: {} };
    return { returned: { code: "200", message: "", pickingReversalNote: "", creditLimitNote: "" }, ctx: {} };
  })(e.run.bind(e));
  const params = { passNo, so_id: [soId], prev_table_so: prev, next_table_so: next, confirmPickReversal: "Yes", raiseGdQty: "", organization_id: gd.organization_id };
  if (o.ref !== null) params.cascade_ref = o.ref || REF;
  const res = e.run("SOcascadeDownstreamWorkflow", params);
  const out = res.returned || {};
  console.log(`${label}\n    -> ${out.code} ${String(out.message || "").slice(0, 160)} | held ${JSON.stringify(out.heldJobs || null)}\n    calls: ${calls.join(", ") || "none"}`);
  return { out, calls };
}

const one = (lines, extra) => Object.assign({}, gd, { gd_status: "Created", so_id: [soId], table_gd: lines }, extra || {});
const L = gdl.slice(0, 3);
const scenarios = {
  V2HELD: () => {
    const r = run("V2: queued, prepared, held", { gds: [one(L)], reduce: [L[0].so_line_item_id] });
    assert.strictEqual(r.out.code, "200"); assert.deepStrictEqual(r.out.heldJobs, [{ job_id: JOB(gd.id), gd_id: gd.id, gd_no: gd.delivery_no }]);
    assert.ok(r.calls.some((c) => c.startsWith("SUBMIT(SUBMIT,CASCADE," + gd.id + ",3 lines," + REF + ",{\"needCL\":\"auto\",\"continueZero\":\"Yes\",\"confirmPickReversal\":\"Yes\"}")), r.calls.join(" | "));
    assert.ok(r.calls.includes("WORKER(" + JOB(gd.id) + ")")); assert.ok(!r.calls.some((c) => /^GOODS_DELIVERY|^CANCEL/.test(c)));
  },
  V2FAILED: () => {
    const r = run("V2: the worker's PREPARE failed", { gds: [one(L)], reduce: [L[0].so_line_item_id], worker: (j) => ({ job_status: "FAILED", job_id: j, result_message: "Not enough stock for line 1" }) });
    assert.strictEqual(r.out.code, "406"); assert.ok(/Not enough stock for line 1/.test(r.out.message)); assert.deepStrictEqual(r.out.heldJobs, []);
    assert.ok(!r.calls.some((c) => /^CANCEL/.test(c)), "nothing held: nothing to cancel");
  },
  CLASSIC: () => {
    const r = run("not taken by the background save: GOODS_DELIVERY as before", { gds: [one(L)], reduce: [L[0].so_line_item_id], submit: () => ({ route: "NOT_ELIGIBLE", code: "300", reason: "it has serial-numbered items" }) });
    assert.strictEqual(r.out.code, "200"); assert.ok(r.calls.includes("GOODS_DELIVERY(3 lines)")); assert.ok(!r.calls.some((c) => /^WORKER/.test(c))); assert.deepStrictEqual(r.out.heldJobs, []);
  },
  CONFIRM: () => {
    const r = run("the background save asks the pick-reversal question (413)", { gds: [one(L)], reduce: [L[0].so_line_item_id], submit: () => ({ route: "STOP", code: "413", message: "Reverse 1 picked unit?" }) });
    assert.strictEqual(r.out.code, "413"); assert.strictEqual(r.out.blockKind, "confirmReversal"); assert.ok(!r.calls.some((c) => /^WORKER|^GOODS/.test(c)));
  },
  NOREF: () => {
    const r = run("a caller without cascade_ref (cannot release): the classic save", { gds: [one(L)], reduce: [L[0].so_line_item_id], ref: null });
    assert.strictEqual(r.out.code, "200"); assert.ok(r.calls.includes("GOODS_DELIVERY(3 lines)")); assert.deepStrictEqual(r.out.heldJobs, []);
  },
  MULTI: () => {
    const g2 = one([L[1]], { id: "2110000000000000777", delivery_no: "GD/SIM/2" });
    const r = run("two deliveries: the first held, the second refused -> the first's hold cancelled", { gds: [one([L[0]]), g2], reduce: [L[0].so_line_item_id, L[1].so_line_item_id],
      submit: (p, i) => (p.gd_id === g2.id ? { route: "STOP", code: "400", message: "Line 1 is short" } : { route: "QUEUED", code: "200", job_id: JOB(p.gd_id) }) });
    assert.strictEqual(r.out.code, "406"); assert.deepStrictEqual(r.out.heldJobs, []);
    assert.ok(r.calls.includes("CANCEL_HELD(" + gd.id + "," + REF + ")"), r.calls.join(" | ")); assert.ok(r.calls.indexOf("WORKER(" + JOB(gd.id) + ")") < r.calls.lastIndexOf("WORKER(" + JOB(gd.id) + ")"), "the worker runs the cancel");
  },
  BIG: () => {
    const pad = Array.from({ length: 520 }, (_, i) => Object.assign({}, L[2], { id: String(2110000000000100000 + i), so_line_item_id: L[2].so_line_item_id }));
    const r = run("a delivery above 500 lines: refused before the background save (SO_SAVE commits it in the same request)", { gds: [one([L[0]].concat(pad))], reduce: [L[0].so_line_item_id] });
    assert.strictEqual(r.out.code, "406"); assert.ok(/521 lines: a Sales Order change can update a delivery of up to 500 lines/.test(r.out.message), r.out.message);
    assert.ok(!r.calls.some((c) => /^SUBMIT|^WORKER|^GOODS_DELIVERY/.test(c)), r.calls.join(" | "));
  },
  NOREFBIG: () => {
    const pad = Array.from({ length: 520 }, (_, i) => Object.assign({}, L[2], { id: String(2110000000000100000 + i), so_line_item_id: L[2].so_line_item_id }));
    const r = run("no cascade_ref and above 500 lines: the classic route keeps its 500-line refusal (d3's review)", { gds: [one([L[0]].concat(pad))], reduce: [L[0].so_line_item_id], ref: null });
    assert.strictEqual(r.out.code, "406"); assert.ok(/up to 500 lines/.test(r.out.message), r.out.message); assert.ok(!r.calls.some((c) => /^GOODS_DELIVERY/.test(c)), r.calls.join(" | "));
    const b = run("pass B, no cascade_ref, above 500 lines: the new line is not appended classically", { passNo: 2, gds: [one(pad.slice(0, 501))], addLine: true, ref: null });
    assert.strictEqual(b.out.code, "406"); assert.ok(/more than a Sales Order change can update \(500\)/.test(b.out.message), b.out.message); assert.ok(!b.calls.some((c) => /^GOODS_DELIVERY/.test(c)));
  },
  // a delivery past 500 lines is refused before GD_EDIT_SUBMIT: SO_SAVE commits the edit in the same request (55 s gateway);
  // SO_SAVE + SO_CASCADE + SUBMIT + PREPARE at 2,000 lines in one request took dev down on 2026-10-16
  CAP: () => {
    const pad = Array.from({ length: 500 }, (_, i) => Object.assign({}, L[2], { id: String(2110000000000100000 + i), so_line_item_id: L[2].so_line_item_id }));
    const r = run("a delivery above 500 lines: refused with the reason, nothing submitted", { gds: [one([L[0]].concat(pad))], reduce: [L[0].so_line_item_id] });
    assert.strictEqual(r.out.code, "406"); assert.ok(/501 lines: a Sales Order change can update a delivery of up to 500 lines/.test(r.out.message), r.out.message);
    assert.ok(!r.calls.some((c) => /^SUBMIT|^WORKER|^GOODS_DELIVERY/.test(c)), r.calls.join(" | ")); assert.deepStrictEqual(r.out.heldJobs, []);
  },
  // the inventory engine refuses data the classic save handles (PREPARE FAILED, the delivery put back): that delivery goes to the
  // classic save instead; a stock shortage stays the cascade's refusal; above 500 lines the classic cap refuses it
  FALLBACK: () => {
    const fb = (code) => (j) => ({ job_status: "FAILED", job_id: j, result_code: code, result_message: "FAILED: Item 1 has costing rows that need migration" });
    for (const code of ["GDE_INVENTORY_UNSUPPORTED_COSTING", "GDE_INVENTORY_DUPLICATE_BALANCE", "GDE_INVENTORY_UNSUPPORTED_PRICE"]) {
      const r = run("engine refusal " + code + ": the classic save takes the delivery", { gds: [one(L)], reduce: [L[0].so_line_item_id], worker: fb(code) });
      assert.strictEqual(r.out.code, "200", r.out.message); assert.ok(r.calls.includes("GOODS_DELIVERY(3 lines)"), r.calls.join(" | "));
      assert.deepStrictEqual(r.out.heldJobs, []); assert.ok(!r.calls.some((c) => /^CANCEL/.test(c)), r.calls.join(" | "));
    }
    const n = run("a stock shortage: no fallback", { gds: [one(L)], reduce: [L[0].so_line_item_id], worker: (j) => ({ job_status: "FAILED", job_id: j, result_code: "GDE_INVENTORY_INSUFFICIENT", result_message: "short" }) });
    assert.strictEqual(n.out.code, "406"); assert.ok(!n.calls.some((c) => /^GOODS_DELIVERY/.test(c)), n.calls.join(" | "));
    const pad = Array.from({ length: 520 }, (_, i) => Object.assign({}, L[2], { id: String(2110000000000100000 + i), so_line_item_id: L[2].so_line_item_id }));
    const big = run("engine refusal above 500 lines: the classic cap refuses it", { gds: [one([L[0]].concat(pad))], reduce: [L[0].so_line_item_id], worker: fb("GDE_INVENTORY_UNSUPPORTED_COSTING") });
    assert.strictEqual(big.out.code, "406"); assert.ok(/up to 500 lines/.test(big.out.message), big.out.message); assert.ok(!big.calls.some((c) => /^GOODS_DELIVERY/.test(c)), big.calls.join(" | "));
  },
  // the cascade switch off: every delivery goes to the classic save as before GD Edit V2 (its 500-line cap), nothing submitted
  OFF: () => {
    const r = run("switch off: the classic save, nothing submitted", { gds: [one(L)], reduce: [L[0].so_line_item_id], off: true });
    assert.strictEqual(r.out.code, "200", r.out.message); assert.ok(r.calls.includes("GOODS_DELIVERY(3 lines)"), r.calls.join(" | "));
    assert.ok(!r.calls.some((c) => /^SUBMIT|^WORKER|^CANCEL/.test(c)), r.calls.join(" | ")); assert.deepStrictEqual(r.out.heldJobs, []);
  },
  OFFBIG: () => {
    for (const n of [520, 1000]) {
      const pad = Array.from({ length: n }, (_, i) => Object.assign({}, L[2], { id: String(2110000000000100000 + i), so_line_item_id: L[2].so_line_item_id }));
      const r = run("switch off, " + (n + 1) + " lines: the classic 500-line refusal", { gds: [one([L[0]].concat(pad))], reduce: [L[0].so_line_item_id], off: true });
      assert.strictEqual(r.out.code, "406"); assert.ok(/up to 500 lines/.test(r.out.message), r.out.message);
      assert.ok(!r.calls.some((c) => /^SUBMIT|^WORKER|^GOODS_DELIVERY/.test(c)), r.calls.join(" | "));
    }
  },
  CAPB: () => {
    const pad = Array.from({ length: 500 }, (_, i) => Object.assign({}, L[2], { id: String(2110000000000100000 + i), so_line_item_id: L[2].so_line_item_id }));
    const r = run("pass B onto a delivery above 500 lines: the new line is not appended, nothing submitted", { passNo: 2, gds: [one([L[0]].concat(pad))], addLine: true });
    assert.strictEqual(r.out.code, "406"); assert.ok(/more than a Sales Order change can update \(500\)/.test(r.out.message), r.out.message);
    assert.ok(!r.calls.some((c) => /^SUBMIT|^WORKER|^GOODS_DELIVERY/.test(c)), r.calls.join(" | "));
  },
  CAPEDGE: () => {
    const pad = Array.from({ length: 499 }, (_, i) => Object.assign({}, L[2], { id: String(2110000000000100000 + i), so_line_item_id: L[2].so_line_item_id }));
    const r = run("exactly 500 lines: the background save takes it", { gds: [one([L[0]].concat(pad))], reduce: [L[0].so_line_item_id] });
    assert.strictEqual(r.out.code, "200", r.out.message); assert.ok(r.calls.some((c) => /^SUBMIT\(SUBMIT,CASCADE,\d+,500 lines/.test(c)), r.calls.join(" | "));
  },
  PASSB: () => {
    const r = run("pass B: a new SO line appended, held for the release", { passNo: 2, gds: [one(L)], addLine: true });
    assert.strictEqual(r.out.code, "200", r.out.message); assert.strictEqual(r.out.heldJobs.length, 1); assert.ok(r.calls.some((c) => /^SUBMIT\(SUBMIT,CASCADE,\d+,4 lines/.test(c)), r.calls.join(" | "));
  },
  PASSBFAIL: () => {
    const r = run("pass B: the append fails -> reported, nothing cancelled (the sales order is saved)", { passNo: 2, gds: [one(L)], addLine: true,
      worker: (j) => ({ job_status: "FAILED", job_id: j, result_message: "Line 4 is short" }) });
    assert.strictEqual(r.out.code, "406"); assert.ok(/new line could not be added/.test(r.out.message)); assert.ok(!r.calls.some((c) => /^CANCEL/.test(c)));
  },
};
let failed = 0;
console.log(`GD ${gd.delivery_no} ${gdl.length} lines, SO ${soLines.length} lines`);
for (const sc of want.length ? want : Object.keys(scenarios)) {
  try { scenarios[sc](); } catch (x) { failed++; console.log("  FAIL " + sc + ": " + (x.message || x).toString().split("\n")[0].slice(0, 300)); }
}
console.log((mutate ? "[mutant " + mutate + "] " : "") + (failed ? failed + " scenario(s) failed" : "all scenarios passed"));
process.exit(failed ? 1 : 0);
