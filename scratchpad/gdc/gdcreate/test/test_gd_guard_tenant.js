// test_gd_guard_tenant.js: GOODS_DELIVERY's SO Guard and Unit Guard read only the session tenant's rows (10-27). The guard
// code nodes, the two SQL reads and the refusal nodes run from the workflow itself; the reads run read-only on dev on
// GD/20261023/615 (tenant 000000) and its job 2113520714659831810, once as 000000 and once as another tenant.
// dev has no unfinished job, so the busy cases run a test-only copy of the job scan that also counts COMPLETED.
// usage: node test_gd_guard_tenant.js [GDheadWorkflow.json]   (the repo file by default; dev v251 fails the other-tenant cases)
const fs = require("fs"), cp = require("child_process");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const W = JSON.parse(fs.readFileSync(process.argv[2] || R + "Goods Delivery/GDheadWorkflow.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const code = (id) => find(W, id).data.script.code;
const db = (sql) => {
  const out = cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", sql], { encoding: "utf8", cwd: R, stdio: ["ignore", "pipe", "ignore"] });
  const i = out.startsWith("[") && !out.startsWith("[DEV]") ? 0 : out.indexOf("\n[") + 1;
  return JSON.parse(out.slice(i));
};
const run = (src, subs) => new Function(Object.entries(subs).reduce((s, [k, v]) => s.split("{{" + k + "}}").join(JSON.stringify(v)), src))();
const fill = (sql, node, out, tenant) => Object.entries(out).reduce((s, [k, v]) => s.split("{{node:" + node + ".data." + k + "}}").join(v), sql.split("{{system:tenantId}}").join(tenant));
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 300))); if (!ok) fails += 1; };

const OWN = "000000", OTHER = "496474", GD = "2113520721798537217", JOB = "2113520714659831810";
const hdr = db("SELECT CAST(id AS CHAR) id, CAST(organization_id AS CHAR) organization_id, so_id FROM goods_delivery WHERE id = " + GD)[0];
const lines = db("SELECT CAST(material_id AS CHAR) material_id, material_name, CAST(gd_order_uom_id AS CHAR) gd_order_uom_id, CAST(good_delivery_uom_id AS CHAR) good_delivery_uom_id, gd_qty, CAST(line_so_id AS CHAR) line_so_id FROM goods_delivery_fwii8mvb_sub WHERE goods_delivery_id = " + GD + " AND is_deleted = 0");
const allData = Object.assign({}, hdr, { table_gd: lines });
const wide = (sql) => sql.replace("'RECONCILING_GD', 'REQUIRES_REVIEW')", "'RECONCILING_GD', 'REQUIRES_REVIEW', 'COMPLETED')");

// SO Guard
const so = (data, tenant, page, sqlOf) => {
  const g = run(code("code_node_GdSoGuard"), { "workflowparams:saveAs": "Created", "workflowparams:allData": data });
  const rows = db(fill(sqlOf(code("sql_node_GdSoGuard")), "code_node_GdSoGuard", g, tenant));
  return Object.assign({ row: rows[0] }, run(code("code_node_GdSoBusy"), { "node:sql_node_GdSoGuard.data": rows, "workflowparams:pageStatus": page }));
};
const soJobs = db("SELECT CAST(id AS CHAR) id FROM gd_async_job WHERE tenant_id = '" + OWN + "' AND command = 'CREATE_GD_FROM_FORM' AND is_deleted = 0 AND source_so_ids LIKE '%\"" +
  String(hdr.so_id).replace(/[^0-9]/g, "") + "\"%'").map((x) => x.id);
let r = so(allData, OWN, "Add", wide);
t("SO guard, own tenant: a job on its sales order (" + soJobs.length + " incl. " + JOB + ") is found and refuses",
  soJobs.indexOf(JOB) >= 0 && r.busy === "YES" && soJobs.indexOf(String(r.row.busy_job).split("|")[1]) >= 0 && r.row.stored_status === "Created", r);
r = so(allData, OTHER, "Add", wide);
t("SO guard, another tenant: no job, no GD status read back, no refusal", r.busy === "NO" && r.row.busy_job == null && r.row.stored_status == null, r);
r = so(Object.assign({}, allData, { organization_id: "" }), OWN, "Add", wide);
t("SO guard, no organization_id (1 = 1), own tenant: still found", r.busy === "YES", r);
r = so(Object.assign({}, allData, { organization_id: "" }), OTHER, "Add", wide);
t("SO guard, no organization_id (1 = 1), another tenant: the scan stays in the session tenant", r.busy === "NO" && r.row.busy_job == null, r);
r = so(allData, OWN, "Edit", (s) => s);
t("SO guard, the real scan on dev (no unfinished job): runs, nothing busy, stored status read", r.busy === "NO" && r.row.stored_status === "Created", r);

// Unit Guard
const uom = (data, tenant) => {
  const g = run(code("code_node_GdUomGuard"), { "workflowparams:saveAs": "Created", "workflowparams:allData": data });
  const rows = db(fill(code("sql_node_GdUomGuard"), "code_node_GdUomGuard", g, tenant));
  return Object.assign({ rows }, run(code("code_node_GdUomCheck"), { "node:sql_node_GdUomGuard.data": rows, "workflowparams:allData": data, "workflowparams:pageStatus": "Add" }));
};
const stock = lines.filter((l) => l.material_id && parseFloat(l.gd_qty) > 0);
const bogusUnit = db("SELECT CAST(u.id AS CHAR) id, u.uom_name FROM unit_of_measurement u WHERE u.tenant_id = '" + OWN + "' AND u.is_deleted = 0 AND u.id NOT IN (" +
  stock.map((l) => l.gd_order_uom_id || l.good_delivery_uom_id).join(",") + ") AND u.id NOT IN (SELECT c.alt_uom_id FROM item_mji552rc_sub c WHERE c.Item_id = " + stock[0].material_id + " AND c.alt_uom_id IS NOT NULL) ORDER BY u.id LIMIT 1")[0];
const badData = Object.assign({}, allData, { table_gd: [Object.assign({}, stock[0], { gd_order_uom_id: bogusUnit.id, good_delivery_uom_id: bogusUnit.id })] });
r = uom(allData, OWN);
const kinds = (rows) => rows.map((x) => x.kind + ":" + x.k);
t("unit guard, own tenant: GD status, the items and their units are read; the stored lines pass", r.refuse === "NO" && r.rows.some((x) => x.kind === "GD" && x.k === "Created") && r.rows.some((x) => x.kind === "ITEM") && r.rows.some((x) => x.kind === "UNIT"), kinds(r.rows));
r = uom(badData, OWN);
t("unit guard, own tenant: a line in a unit its item lacks is refused, named by the unit's name", r.refuse === "YES" && r.message.indexOf(bogusUnit.uom_name) >= 0, r.message);
r = uom(badData, OTHER);
t("unit guard, another tenant: no GD status, item or unit read back; left to the save's own checks", r.refuse === "NO" && r.rows.length === 1 && r.rows[0].kind === "GD" && r.rows[0].k === "", kinds(r.rows));
console.log(fails ? fails + " FAILED" : "all passed");
process.exitCode = fails ? 1 : 0;
