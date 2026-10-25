// submit_sim.js <tenant> <gd_id> <source> [answers.json] [form: stored | stored+edit | stored+emptyref | stored+undelivered]: GD_COMPLETE_SUBMIT
// as built (Goods Delivery/CompleteV2/) on the workflow interpreter, its SQL run READ-ONLY on live dev (.dbtools/db),
// CREDIT_LIMIT_CHECK mocked as passed, the writes captured (nothing is written), the read-back answered from the capture
const fs = require("fs"), path = require("path"), cp = require("child_process");
const { Engine } = require("../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [tenant, gdId, source, answersFile, formMode] = process.argv.slice(2);
const writes = [];
const db = {
  tenantId: tenant,
  insert(table, rows) { writes.push(["add", table, rows]); return rows.map((r, i) => Object.assign({ id: "990000000000000" + i }, r)); },
  update(table, rows) { writes.push(["update", table, rows]); return rows.length; },
};
const live = (sql) => {
  const t = cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "100000", sql], { maxBuffer: 1 << 30, encoding: "utf8" });
  return JSON.parse(t);
};
const timing = {};
const sql = new Proxy({}, {
  get: (_, id) => (text) => {
    if (id === "sql_node_GSback") {
      const job = writes.find((w) => w[1] === "GD Async Job");
      const lock = writes.find((w) => w[1] === "GD Publish Step");
      const gd = writes.find((w) => w[1] === "Goods Delivery");
      return [{ job_id: job ? "990000000000000999" : null, job_status: job ? job[2][0].job_status : null, gd_status: gd ? gd[2][0].gd_status : null, lock_ref: lock ? lock[2][0].result_ref : null }];
    }
    const t0 = Date.now();
    const rows = live(text);
    timing[id] = Date.now() - t0;
    return rows;
  },
});
const e = new Engine({ dir: R + "Goods Delivery/CompleteV2", db, mocks: { sql, read: {} } });
const run0 = e.run.bind(e);
e.run = (name, params) => (name === "CREDIT_LIMIT_CHECK" ? { returned: { result: "passed", message: "" }, ctx: {} } : run0(name, params));
const params = { operation: "SUBMIT", gd_id: gdId, source: source, answers: answersFile ? JSON.parse(fs.readFileSync(answersFile, "utf8")) : {} };
if (formMode) {
  // the form as the stored GD (PREPARE's hdr + lines reads through the adapter), optionally edited
  const vm = require("vm");
  const D = R + "scratchpad/gdc/";
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, RegExp, parseFloat };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(D + "code/prepare/adapter.js", "utf8") + "\nthis.gcAdapt = gcAdapt;", sb);
  const wf = JSON.parse(fs.readFileSync(R + "Goods Delivery/CompleteV2/GD_COMPLETE_SUBMIT.json", "utf8"));
  const find = (nodes, id) => { for (const n of nodes || []) { if (n.id === id) return n; const x = find(n.blocks, id); if (x) return x; } return null; };
  const org = live("SELECT organization_id FROM goods_delivery WHERE id = " + gdId)[0].organization_id;
  const fill = (id) => find(wf.nodes, id).data.script.code.replace(/\{\{node:code_node_GSentry\.data\.tenantId\}\}/g, tenant)
    .replace(/\{\{node:code_node_GSentry\.data\.gdId\}\}/g, gdId).replace(/\{\{node:code_node_GSentry\.data\.organizationId\}\}/g, org);
  const S = { organizationId: org, hdr: live(fill("sql_node_GShdr")), lines: live(fill("sql_node_GSlines")) };
  const gd = sb.gcAdapt(S).gd.data;
  const flat = (rows) => rows.flatMap((r) => [r].concat(r.children || []));
  if (formMode === "stored+edit") gd.order_remark = "typed but not saved";
  if (formMode === "stored+qty") flat(gd.table_gd)[0].gd_qty = Number(flat(gd.table_gd)[0].gd_qty) + 1;
  // LSH 10-23..25: the form sends [] for an attachment column the stored GD holds as null
  if (formMode === "stored+emptyref") gd.gd_ref_doc = [];
  if (formMode === "stored+undelivered") flat(gd.table_gd).forEach((r) => { if (r.material_id) r.gd_undelivered_qty = Number(r.gd_undelivered_qty || 0) + 7; });
  params.form = gd;
}
// DUMP=<file>: also write the request, e.g. to replay it live through runas.mjs
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(params));
const t0 = Date.now();
const out = e.run("GD_COMPLETE_SUBMIT", params);
const ms = Date.now() - t0;
const o = out.ctx.out || {};
console.log(`${gdId} ${source}${formMode ? "/" + formMode : ""}: ${JSON.stringify(out.returned).slice(0, 600)}`);
console.log(`  ${ms} ms total | sql ${JSON.stringify(timing)} | node data ${(out.ctx.bytes / 1e6).toFixed(1)} MB`);
if (o.code_node_GSgate) console.log("  gate:", JSON.stringify(Object.assign({}, o.code_node_GSgate, { overrides: Object.keys(o.code_node_GSgate.overrides || {}).length })).slice(0, 700));
for (const w of writes) console.log("  WRITE", w[0], w[1], JSON.stringify(w[2]).slice(0, 900));
