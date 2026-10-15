// plan_live.js <sql dump.json> <tenant> <gd_id> [out.json]: gcPlan on live dev reads (test/run_prepare_sql.py), the GD's
// lock simulated (header gd_status Processing). Prints the route, sizes, timing; writes the prepared payload when asked.
const fs = require("fs"), vm = require("vm");
const D = __dirname + "/..";
const [dump, tenant, gdId, outFile] = process.argv.slice(2);
const S = JSON.parse(fs.readFileSync(dump, "utf8"));
S.hdr = S.hdr.map((r) => ({ j: r.j.replace(/"gd_status": "Created"/, '"gd_status": "Processing"') }));
const F = JSON.parse(fs.readFileSync(D + "/lift/fields.json", "utf8"));
const src = ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js"].map((f) => fs.readFileSync(D + "/" + f, "utf8")).join("\n");
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(src + `\nconst GC_KINDS = ${JSON.stringify({ header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub })};`, sb);
S.lock = [{ step_name: "LOCK|1", result_ref: "GDC|" + gdId + "|1" }];
sb.__E = { jobId: "999000000000000001", nonce: "a1b2c3d4", idempotencyKey: "GDC|" + gdId + "|1", gdId, organizationId: S.organizationId, tenantId: tenant, request: { v: 1, source: process.env.SOURCE || "FORM", submitted_by: "2105190590557097986", answers: JSON.parse(process.env.ANSWERS || "{}"), header: {} } };
sb.__S = S;
const t0 = Date.now();
const res = vm.runInContext("gcPlan(__E, __S)", sb);
const ms = Date.now() - t0;
const m = res.payload ? JSON.parse(res.payload) : null;
console.log(`route=${res.route} code=${res.code} ${res.message} | ${ms} ms | lines ${res.lineCount} movements ${res.movementCount} | manifest ${(res.payload || "").length} chars | part rows ${res.partRows.length}`);
if (m) {
  const byPart = {};
  for (const r of res.partRows) { const k = r.step_name.split("|")[2]; byPart[k] = (byPart[k] || 0) + r.result_ref.length; }
  console.log("part sizes:", JSON.stringify(byPart), "| total", Object.values(byPart).reduce((a, b) => a + b, 0));
  console.log("counts:", JSON.stringify(m.counts));
  const part = (k) => JSON.parse(res.partRows.filter((r) => r.step_name.split("|")[2] === k).map((r) => r.result_ref).join(""));
  console.log("gd header write:", JSON.stringify(part("GD").header));
  console.log("after:", JSON.stringify(part("AFTER")).slice(0, 200));
  console.log("types:", JSON.stringify(part("ENGINE").movements.reduce((a, x) => ((a[x.direction + "/" + x.inventory_category + "/" + x.isMovingInv] = (a[x.direction + "/" + x.inventory_category + "/" + x.isMovingInv] || 0) + 1), a), {})));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ manifest: m, rows: res.partRows }));
}
