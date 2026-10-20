// plan_live.js <reads.json> <tenant> <gd_id> [--out file]: gxPlan on live dev reads (test/run_reads.py), the GD's lock simulated
// (header Processing under GDC|<gd>|1). Prints the route, timing and every part the COMMIT steps get.
const fs = require("fs"), vm = require("vm");
const GDC = __dirname + "/../../gdc";
const [dump, tenant, gdId] = process.argv.slice(2);
const outAt = process.argv.indexOf("--out");
const S = JSON.parse(fs.readFileSync(dump, "utf8"));
S.hdr = S.hdr.map((r) => ({ j: r.j.replace(/"gd_status": "Created"/, '"gd_status": "Processing"') }));
S.lock = [{ step_name: "LOCK|1", result_ref: "GDC|" + gdId + "|1" }];
const F = JSON.parse(fs.readFileSync(GDC + "/lift/fields.json", "utf8"));
const files = [GDC + "/lift/runtime.js", GDC + "/lift/lifted_prepare.js", GDC + "/code/prepare/adapter.js", GDC + "/code/prepare/chain.js", GDC + "/code/_fc.js",
  __dirname + "/../code/prepare/chain.js", __dirname + "/../code/prepare/plan.js"];
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(files.map((f) => fs.readFileSync(f, "utf8")).join("\n") + `\nconst GC_KINDS = ${JSON.stringify({ header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub })};`, sb);
sb.__E = { jobId: "999000000000000001", nonce: "a1b2c3d4", idempotencyKey: "GDC|" + gdId + "|1", gdId, organizationId: S.organizationId, tenantId: tenant, request: { v: 1, source: "LIST", submitted_by: "1" } };
sb.__S = S;
const t0 = Date.now();
const res = vm.runInContext("gxPlan(__E, __S)", sb);
const ms = Date.now() - t0;
console.log(`route=${res.route} code=${res.code} ${res.message} | ${ms} ms | lines ${res.lineCount} movements ${res.movementCount} | manifest ${(res.payload || "").length} chars | part rows ${res.partRows.length}`);
if (res.payload) {
  const m = JSON.parse(res.payload);
  const part = (k) => JSON.parse(res.partRows.filter((r) => r.step_name.split("|")[2] === k).map((r) => r.result_ref).join(""));
  console.log("counts:", JSON.stringify(m.counts));
  console.log("notes:", JSON.stringify(m.notes));
  console.log("GD:", JSON.stringify(part("GD")).slice(0, 400));
  console.log("RES:", JSON.stringify(part("RES").updates.slice(0, 2)).slice(0, 600));
  console.log("ENGINE:", JSON.stringify(part("ENGINE").movements.slice(0, 2)).slice(0, 500));
  console.log("PICK:", JSON.stringify(part("PICK")).slice(0, 500));
  console.log("PACK:", JSON.stringify(part("PACK")).slice(0, 500));
  console.log("HU:", JSON.stringify(part("HU")).slice(0, 700));
  console.log("NUM:", JSON.stringify(part("NUM")).slice(0, 600));
  console.log("AFTER:", JSON.stringify(part("AFTER")).slice(0, 300));
  if (outAt > 0) fs.writeFileSync(process.argv[outAt + 1], JSON.stringify({ result: res, manifest: m }));
}
