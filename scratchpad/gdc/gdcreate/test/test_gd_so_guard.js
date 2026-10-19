// test_gd_so_guard.js <scratch dir>: GOODS_DELIVERY's same-sales-order guard (patch_gd_so_guard.py). The head of the repo
// GDheadWorkflow.json - start, the Processing guard, the new SO guard - runs on the interpreter with its two SQL reads
// mocked: a new delivery (Add / Clone, or a stored Draft) saved as Created / Completed is refused 400 while a GD Created
// V2 save of one of its sales orders is unfinished; Drafts, Edits of stored Created GDs and free sales orders pass; only
// digit ids reach the SQL. A run that ends without a return passed both guards. Nothing touches a database.
const fs = require("fs"), path = require("path"), assert = require("assert");
const { Engine } = require("../../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const dir = process.argv[2];
const wf = JSON.parse(fs.readFileSync(R + "Goods Delivery/GDheadWorkflow.json", "utf8"));
const head = wf.nodes.slice(0, 5);
assert.deepStrictEqual(head.map((n) => n.id), ["start", "code_node_GdProcGuard", "if_GdProcGuard", "code_node_GdSoGuard", "if_GdSoGuard"]);
fs.writeFileSync(path.join(dir, "GD_HEAD_GUARDS.json"), JSON.stringify(Object.assign({}, wf, { nodes: head })));

const SO = "2110957064359641090", ORG = "2105190589240086530";
const job = (status) => status + "|2111300000000000001|SO/20261016-035";
let n = 0;
const run = ({ pageStatus = "Add", saveAs = "Created", stored = null, busy = null, procOpen = null, allData = {} }) => {
  const seen = { soSql: null, procSql: null };
  const e = new Engine({
    dir,
    db: { tenantId: "711077" },
    mocks: {
      sql: {
        sql_node_GdProcGuard: (text) => { seen.procSql = text; return [{ gd_status: stored, open_job: procOpen }]; },
        sql_node_GdSoGuard: (text) => { seen.soSql = text; return [{ stored_status: stored, busy_job: busy }]; },
      },
      read: {},
    },
  });
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  const data = Object.assign({ id: pageStatus === "Edit" ? "2111076387613216769" : "", organization_id: ORG, so_id: [SO], table_gd: [{ material_id: "1", line_so_id: SO }] }, allData);
  const r = e.run("GD_HEAD_GUARDS", { allData: data, saveAs, pageStatus });
  return Object.assign({ out: r.returned }, seen);
};
const t = (name, f) => { f(); n++; console.log("ok", name); };
const refused = (r) => r.out && String(r.out.code) === "400";

t("Add saved as Created while a V2 save of the SO is QUEUED -> 400, the SO and job named", () => {
  const r = run({ busy: job("QUEUED") });
  assert.ok(refused(r), JSON.stringify(r.out));
  assert.strictEqual(r.out.message, "A delivery for SO/20261016-035 is still being saved in the background (job 2111300000000000001, QUEUED). Wait for it to finish - it then appears in the Goods Delivery list - before saving another delivery for it.");
  assert.ok(r.soSql.includes("j.organization_id = '" + ORG + "'") && r.soSql.includes("j.source_so_ids LIKE '%\"" + SO + "\"%'") && r.soSql.includes("g.id = 0"), r.soSql);
  assert.strictEqual(r.procSql, null, "an Add never reads the Processing guard");
});
t("Add saved as Completed while the save is COMMITTING_GD -> 400", () => assert.ok(refused(run({ saveAs: "Completed", busy: job("COMMITTING_GD") }))));
t("Clone saved as Created while busy -> 400", () => assert.ok(refused(run({ pageStatus: "Clone", busy: job("VALIDATING") }))));
t("a save under review -> 400 with the contact-support text", () => {
  const r = run({ busy: job("REQUIRES_REVIEW") });
  assert.ok(refused(r) && /stopped half-way and is under review \(job 2111300000000000001\): please contact support/.test(r.out.message), r.out.message);
});
t("free sales order -> passes", () => { const r = run({ busy: null }); assert.strictEqual(r.out, null); assert.ok(r.soSql); });
t("saved as Draft -> passes without reading", () => { const r = run({ saveAs: "Draft", busy: job("QUEUED") }); assert.strictEqual(r.out, null); assert.strictEqual(r.soSql, null); });
t("Edit of a stored Draft saved as Created while busy -> 400", () => {
  const r = run({ pageStatus: "Edit", stored: "Draft", busy: job("READY_TO_COMMIT") });
  assert.ok(refused(r)); assert.ok(r.soSql.includes("g.id = 2111076387613216769"));
});
t("Edit of a stored Created GD saved as Completed (Picking / Packing completion) while busy -> passes", () => {
  assert.strictEqual(run({ pageStatus: "Edit", saveAs: "Completed", stored: "Created", busy: job("QUEUED") }).out, null);
});
t("Edit of a Processing GD -> the Processing guard answers first", () => {
  const r = run({ pageStatus: "Edit", stored: "Processing", busy: job("QUEUED") });
  assert.ok(refused(r) && /being processed in the background/.test(r.out.message), JSON.stringify(r.out));
  assert.strictEqual(r.soSql, null);
});
t("Edit whose stored GD is gone (no row) counts as new -> 400 when busy", () => assert.ok(refused(run({ pageStatus: "Edit", stored: null, busy: job("QUEUED") }))));
t("no sales order on the delivery -> passes without reading", () => {
  const r = run({ busy: job("QUEUED"), allData: { so_id: [], table_gd: [{ material_id: "1" }] } });
  assert.strictEqual(r.out, null); assert.strictEqual(r.soSql, null);
});
t("only digit ids reach the SQL; comma text, line and bundle-child SOs are all collected", () => {
  const r = run({ busy: null, allData: { so_id: "111, 1' OR '1'='1", table_gd: [{ line_so_id: "222", children: [{ line_so_id: "333" }, { line_so_id: "x" }] }, null] } });
  assert.strictEqual(r.out, null);
  const likes = r.soSql.match(/LIKE '%"(\d+)"%'/g).map((x) => x.match(/\d+/)[0]);
  assert.deepStrictEqual(likes, ["111", "222", "333"]);
  assert.ok(!/OR '1'='1/.test(r.soSql));
});
t("no organization on the delivery -> scoped by the sales orders alone (ids are unique)", () => {
  const r = run({ busy: null, allData: { organization_id: "" } });
  assert.ok(r.soSql.includes("WHERE 1 = 1"), r.soSql);
});
console.log(n + " passed");
