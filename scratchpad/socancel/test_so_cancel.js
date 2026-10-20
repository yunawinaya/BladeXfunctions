// test_so_cancel.js [workflow.json] [--mutate name]: SO_CANCEL on the workflow simulator (scratchpad/gdc/pkv2tools/sim/engine.js) with
// mocked reads. GD V2 work in flight (a Processing delivery, an unfinished background save naming the SO) -> 400 before any write;
// classic rules unchanged (Created GD / PP blocks, Draft GD / PP / SI deleted, invoiced blocks, delete exits first). Run on the v7
// file to see the bug: it cancels the SO under a running V2 job.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../gdc/pkv2tools/sim/engine.js");
const args = process.argv.slice(2);
const mutate = args.indexOf("--mutate") >= 0 ? args[args.indexOf("--mutate") + 1] : "";
const FILE = args.find((a) => a.endsWith(".json")) || __dirname + "/../../Bulk Actions/Sales & Distribution/Sales Order/SOcancelWorkflow.json";
const MUT = { no_busy: ["if (busyGd.length > 0 || busyJobs.length > 0) {", "if (false) {"],
  no_jobs: ["busyGd.length > 0 || busyJobs.length > 0", "busyGd.length > 0"] };
const SO = "2110923367180840962";

function run(o) {
  let text = fs.readFileSync(FILE, "utf8");
  if (mutate) { if (text.indexOf(MUT[mutate][0]) < 0) throw new Error("mutant does not apply"); text = text.split(MUT[mutate][0]).join(MUT[mutate][1]); }
  const wf = JSON.parse(text);
  const writes = [], sqls = [];
  const e = new Engine({ dir: __dirname, db: { tenantId: "711077", update: (tb, rows) => { writes.push(tb + ":" + rows.map((r) => r.__id).join(",")); return rows.length; },
    insert: () => { throw new Error("SO_CANCEL inserts nothing"); } },
  mocks: { sql: { sql_node_SXjobs: (sql) => { sqls.push(sql); return o.jobs || []; } },
    read: { search_gd: () => ({ data: o.gds || [] }), search_pp: () => ({ data: o.pps || [] }), search_si: () => ({ data: o.sis || [] }),
      get_node_SoCancelReorder: () => ({ data: { id: SO, table_so: [] } }) } } });
  e.load = (name) => (name === "SO_CANCEL" ? wf : { nodes: [] });
  const r = e.run("SO_CANCEL", Object.assign({ action: "cancel", so_id: SO, so_no: "SO/1" }, o.params || {}));
  return { out: r.returned || {}, writes, sqls };
}
let n = 0, bad = 0;
const t = (name, f) => { try { f(); n++; console.log("ok", name); } catch (e) { bad++; console.log("FAIL", name, "-", String(e.message).split("\n")[0]); } };
const gd = (status, no) => ({ id: "9" + n + status.length, delivery_no: no || "GD/1", gd_status: status });
t("nothing open -> cancelled: the SO and its lines written; the background-save read is digits-only, tenant-scoped", () => {
  const r = run({});
  assert.strictEqual(r.out.code, "200");
  assert.ok(r.writes.some((w) => /^Sales Order:/.test(w)), r.writes.join(" "));
  assert.strictEqual(r.sqls.length, 1);
  assert.ok(r.sqls[0].indexOf("LIKE '%\"" + SO + "\"%'") >= 0 && r.sqls[0].indexOf("tenant_id = '711077'") >= 0, r.sqls[0]);
});
t("a delivery in Processing (V2 edit / completion / cancel) -> 400, nothing written", () => {
  const r = run({ gds: [gd("Processing", "GD/20261020/091")] });
  assert.strictEqual(r.out.code, "400");
  assert.ok(/GD\/20261020\/091 is being processed in the background/.test(r.out.message), r.out.message);
  assert.deepStrictEqual(r.writes, []);
});
t("an unfinished background save of a new delivery for the SO -> 400, nothing written", () => {
  const r = run({ jobs: [{ job_id: "2112426566646599682", job_status: "COMMITTING_GD" }] });
  assert.strictEqual(r.out.code, "400");
  assert.ok(/still being saved in the background/.test(r.out.message), r.out.message);
  assert.deepStrictEqual(r.writes, []);
});
t("one job row comes back as an object, not a list -> still busy", () => {
  const r = run({ jobs: { job_id: "2112426566646599682", job_status: "QUEUED" } });
  assert.strictEqual(r.out.code, "400");
});
t("Processing beside a Draft GD -> busy wins: the Draft GD is not deleted", () => {
  const r = run({ gds: [gd("Processing"), gd("Draft", "GD/2")] });
  assert.strictEqual(r.out.code, "400");
  assert.deepStrictEqual(r.writes, []);
});
t("unchanged: a Created GD blocks", () => {
  const r = run({ gds: [gd("Created")] });
  assert.strictEqual(r.out.code, "400");
  assert.ok(/Has a created goods delivery/.test(r.out.message), r.out.message);
  assert.deepStrictEqual(r.writes, []);
});
t("unchanged: a Draft GD is deleted and the SO cancelled; Completed / Cancelled GDs do not block", () => {
  const r = run({ gds: [gd("Draft"), gd("Completed", "GD/3"), gd("Cancelled", "GD/4")] });
  assert.strictEqual(r.out.code, "200");
  assert.ok(r.writes.some((w) => /^Goods Delivery:/.test(w)) && r.writes.some((w) => /^Sales Order:/.test(w)), r.writes.join(" "));
});
t("unchanged: an invoiced SO blocks", () => {
  const r = run({ sis: [{ id: "5", si_status: "Issued" }] });
  assert.strictEqual(r.out.code, "400");
  assert.deepStrictEqual(r.writes, []);
});
t("unchanged: delete exits first (no reads, no job read)", () => {
  const r = run({ params: { action: "delete" }, gds: [gd("Processing")] });
  assert.strictEqual(r.out.code, "200");
  assert.strictEqual(r.sqls.length, 0);
});
t("an so_id that is not digits never reaches the SQL", () => {
  const r = run({ params: { so_id: "1' OR '1'='1" } });
  assert.ok(r.sqls[0].indexOf("LIKE '%\"0\"%'") >= 0, r.sqls[0]);
});
console.log(n + " passed, " + bad + " failed" + (mutate ? " (mutant " + mutate + ")" : ""));
if (bad) process.exit(1);
