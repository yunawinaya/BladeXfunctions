// test_submit_credit.js <request.json>: GD_ASYNC_SUBMIT's credit check at the click (patch_submit_credit.py) on the interpreter -
// repo Goods Delivery/AsyncV2/, every read mocked, CREDIT_LIMIT_CHECK mocked and recorded, writes recorded. Nothing touches a database.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const REQ = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const PAY = JSON.parse(REQ.payload);
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };
const ITEM = (id) => ({ kind: "ITEM", id: id, f1: "1", f2: "First In First Out", f3: "0", f4: "0", f5: "10.0000" });
const MAT = String(PAY.lines[0].material_id);

const run = (o) => {
  const writes = [], calls = [], sqls = [];
  const payload = o.payload || PAY;
  const e = new Engine({
    dir: R + "Goods Delivery/AsyncV2",
    db: { tenantId: "711077", insert: (tb, rows) => { writes.push("insert " + tb); return rows.map((r, i) => Object.assign({ id: String(7000 + i) }, r)); }, update: (tb, rows) => { writes.push("update " + tb); return rows.length; } },
    mocks: {
      sql: {
        sql_node_GZBo7WZi: () => [Object.assign({ db_now: "2026-10-23 10:00:00" }, o.existing || {})],
        sql_node_GSsoBusy: () => [],
        sql_node_GSfit: () => o.facts || [ITEM(MAT)],
        sql_node_GSclSetup: (text) => { sqls.push(text); return [{ full_cl_check: o.fullCl === undefined ? "1" : o.fullCl }]; },
        sql_node_mhbRT14u: () => [{ id: o.existing ? o.existing.id : "7000", job_status: o.existing ? o.existing.job_status : "QUEUED", idempotency_key: REQ.idempotency_key, payload_hash: o.existing ? o.existing.payload_hash : "", gd_id: "", gd_no: "", is_deleted: 0, row_version: 0, progress_message: "" }],
      },
      read: {},
    },
  });
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  const run0 = e.run.bind(e);
  e.run = (name, p) => {
    if (name === "GD_ASYNC_SUBMIT") return run0(name, p);
    calls.push([name, p]);
    assert.strictEqual(name, "CREDIT_LIMIT_CHECK", "unexpected child " + name);
    return { returned: o.cl || { result: "success", message: "" }, ctx: {} };
  };
  const req = Object.assign({}, REQ, { payload: JSON.stringify(payload) }, o.needCL === undefined ? {} : { needCL: o.needCL });
  const r = e.run("GD_ASYNC_SUBMIT", req);
  return { out: r.returned || {}, writes, calls, sqls };
};
const BLOCK = { result: "failed", message: "Block - Credit limit exceeded. Limit 1,000.00, outstanding 1,250.00" };
const OVERRIDE = { result: "failed", message: "Override - Credit limit exceeded. Do you want to proceed?" };
const expTotal = (p) => {
  let t = 0;
  for (const l of p.lines) {
    if (String(l.stable_line_key).indexOf(".") !== -1) continue;
    const oq = parseFloat(l.gd_order_quantity) || 0, gq = parseFloat(l.gd_qty) || 0;
    if (oq > 0 && gq > 0) t += ((parseFloat(l.total_price) || 0) / oq) * gq;
  }
  return Number(t.toFixed(8));
};

t("not asked (no needCL: SO_AUTO_GD, mobile, older forms): no setup read, no check, the job is made", () => {
  const r = run({});
  assert.deepStrictEqual(r.calls, []);
  assert.deepStrictEqual(r.sqls, []);
  assert.deepStrictEqual(r.writes, ["insert GD Async Job"]);
  assert.strictEqual(r.out.result_code || "", "");
});

t("asked, full_cl_check = 0 (every dev org; all but one prod org): the setup is read, no check, the job is made", () => {
  const r = run({ needCL: "required", fullCl: "0" });
  assert.deepStrictEqual(r.calls, []);
  assert.strictEqual(r.sqls.length, 1);
  assert.ok(r.sqls[0].includes("p.tenant_id = '711077'") && r.sqls[0].includes("p.organization_id = '" + REQ.organization_id + "'") && /ORDER BY p\.id LIMIT 1/.test(r.sqls[0]));
  assert.deepStrictEqual(r.writes, ["insert GD Async Job"]);
});

t("asked, full_cl_check = 1, within the limit: CREDIT_LIMIT_CHECK(customer, total, Goods Delivery) once, the job is made", () => {
  const r = run({ needCL: "required" });
  assert.strictEqual(r.calls.length, 1);
  const p = r.calls[0][1];
  assert.strictEqual(String(p.customer_id), String(PAY.header.customer_name));
  assert.strictEqual(Number(p.total), expTotal(PAY));
  assert.strictEqual(p.document_type, "Goods Delivery");
  assert.deepStrictEqual(r.writes, ["insert GD Async Job"]);
});

t("Block: GD_CREDIT_LIMIT_BLOCKED, the message without its prefix, no job, nothing written", () => {
  const r = run({ needCL: "required", cl: BLOCK });
  assert.strictEqual(r.out.result_code, "GD_CREDIT_LIMIT_BLOCKED");
  assert.strictEqual(r.out.result_message, "Credit limit exceeded. Limit 1,000.00, outstanding 1,250.00");
  assert.strictEqual(r.out.job_id, "");
  assert.strictEqual(r.out.created, "NO");
  assert.deepStrictEqual(r.writes, []);
});

t("Override: GD_CREDIT_LIMIT_OVERRIDE for the form to ask, no job, nothing written", () => {
  const r = run({ needCL: "required", cl: OVERRIDE });
  assert.strictEqual(r.out.result_code, "GD_CREDIT_LIMIT_OVERRIDE");
  assert.strictEqual(r.out.result_message, "Credit limit exceeded. Do you want to proceed?");
  assert.deepStrictEqual(r.writes, []);
});

t("the resubmit after Proceed (needCL not required): no check, the job is made with the same key", () => {
  const r = run({ needCL: "not required", cl: OVERRIDE });
  assert.deepStrictEqual(r.calls, []);
  assert.deepStrictEqual(r.writes, ["insert GD Async Job"]);
  assert.strictEqual(r.out.idempotency_key, REQ.idempotency_key);
});

t("asked on a key whose job exists (a re-click): no check, the existing job is answered", () => {
  const first = run({});
  const r = run({ needCL: "required", cl: BLOCK, existing: { id: "7001", idempotency_key: REQ.idempotency_key, job_status: "QUEUED", payload_hash: first.out.payload_hash, confirmation_hash: "", is_deleted: 0, row_version: 0 } });
  assert.deepStrictEqual(r.calls, []);
  assert.deepStrictEqual(r.writes, []);
  assert.strictEqual(r.out.job_id, "7001");
});

t("No Accounting, or no customer: no check (PREPARE's rule)", () => {
  const noAcc = JSON.parse(JSON.stringify(PAY));
  noAcc.header.acc_integration_type = "No Accounting";
  assert.deepStrictEqual(run({ needCL: "required", cl: BLOCK, payload: noAcc }).calls, []);
  const noCust = JSON.parse(JSON.stringify(PAY));
  noCust.header.customer_name = "";
  const r = run({ needCL: "required", cl: BLOCK, payload: noCust });
  assert.deepStrictEqual(r.calls, []);
});

t("the total: top-level lines only, price / ordered x delivered (a bundle's items are inside its row)", () => {
  const p = JSON.parse(JSON.stringify(PAY));
  const base = p.lines[0];
  p.lines = [
    Object.assign({}, base, { stable_line_key: "L1", total_price: 300, gd_order_quantity: "3", gd_qty: "2" }),
    Object.assign({}, base, { stable_line_key: "L2", total_price: 50, gd_order_quantity: "0", gd_qty: "2" }),
    Object.assign({}, base, { stable_line_key: "L3", total_price: 90, gd_order_quantity: "3", gd_qty: "0" }),
    Object.assign({}, base, { stable_line_key: "L4", material_id: "", item_bundle_id: "300", total_price: 120, gd_order_quantity: "4", gd_qty: "1", children: [Object.assign({}, base, { stable_line_key: "L4.1", item_bundle_id: "300", total_price: 999, gd_order_quantity: "1", gd_qty: "1" })] }),
  ];
  const r = run({ needCL: "required", payload: p, facts: [ITEM(MAT)] });
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(Number(r.calls[0][1].total), 230);
});

t("a delivery that goes to the classic save is not checked here (the classic save checks it)", () => {
  const r = run({ needCL: "required", cl: BLOCK, facts: [Object.assign(ITEM(MAT), { f4: "1" })] });
  assert.strictEqual(r.out.result_code, "GD_V2_USE_CLASSIC");
  assert.deepStrictEqual(r.calls, []);
  assert.deepStrictEqual(r.writes, []);
});

t("a check that answers without failing (any other result) passes", () => {
  const r = run({ needCL: "required", cl: { result: "success", message: "Override - ignored without failed" } });
  assert.deepStrictEqual(r.writes, ["insert GD Async Job"]);
});

console.log(n + " passed");
