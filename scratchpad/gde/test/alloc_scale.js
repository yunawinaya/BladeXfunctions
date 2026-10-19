// alloc_scale.js <reads.json> <tenant> [--out=<table.json>]: a Draft's Save as Created planned on live dev reads (test/run_sql.py),
// header-only, so every line goes through the save-time auto-allocation (alloc_edit.js). Times gePlan and the allocation loop
// inside it, prints the route and how many rows were allocated; --out writes the allocated table (for an exact before/after
// comparison of a change to the loop). Read-only: nothing is written anywhere.
const fs = require("fs"), vm = require("vm");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outArg = (process.argv.find((a) => a.startsWith("--out=")) || "").slice(6);
const [dump, tenant] = pos;
const S = JSON.parse(fs.readFileSync(dump, "utf8"));
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", R + "scratchpad/gdc/code/prepare/adapter.js",
  D + "/code/prepare/alloc_edit.js", D + "/code/prepare/alloc_ids.js", D + "/code/prepare/chain_edit.js", D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js",
  D + "/code/prepare/plan_edit.js", D + "/code/commit/so_edit.js", D + "/code/prepare/adapter_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
const sb = { console, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
// time the allocation loop inside the plan, and keep its table (the loop is a const: wrapped in the source)
const DECL = "const geAllocLoop = function geAllocLoop(A) {";
if (SRC.indexOf(DECL) < 0) throw new Error("alloc_edit.js: geAllocLoop declaration not found");
vm.runInContext(SRC.replace(DECL, "const __loop0 = function geAllocLoop(A) {") + "\nconst GE_KINDS = " + JSON.stringify(KINDS) + ";" +
  "\nvar __loopMs = 0, __loopTable = null; const geAllocLoop = function (A) { const t = Date.now(); const r = __loop0(A); __loopMs += Date.now() - t; __loopTable = r.tableGD || null; return r; };", sb);
sb.__S = S;
const stored = vm.runInContext("geAdapt(__S)", sb).stored;
if (!stored || stored.gd_status !== "Draft") { console.log("not a Draft: " + (stored && stored.gd_status)); process.exit(1); }
const form = JSON.parse(JSON.stringify(stored));
form.order_remark = (form.order_remark || "") + " (edited)";
sb.__F = form; sb.__ST = JSON.parse(JSON.stringify(stored));
const delta = vm.runInContext("geDelta(__F, __ST, GE_KINDS)", sb);
const key = "GDE|" + stored.id + "|1";
const S2 = Object.assign({}, S, { hdr: S.hdr.map((r) => ({ j: r.j.replace(/"gd_status": "[^"]*"/, '"gd_status": "Processing"') })), lock: [{ step_name: "LOCK|1", result_ref: key }] });
sb.__S2 = S2;
sb.__E = Object.assign({ jobId: "2110999999999999999", tenantId: tenant, nonce: "a1b2c3d4", idempotencyKey: key, gdId: String(stored.id), organizationId: String(stored.organization_id),
  request: { v: 1, source: "FORM", stored_status: "Draft", submitted_by: "1", picking_version: "", answers: { needCL: "required", continueZero: "", confirmPickReversal: "" }, delta } },
  vm.runInContext("geAllocIds(__F.table_gd, [])", sb));
const t0 = Date.now();
const res = vm.runInContext("gePlan(__E, geAdapt(__S2), GE_KINDS)", sb);
const ms = Date.now() - t0;
const table = sb.__loopTable ? (typeof sb.__loopTable === "string" ? JSON.parse(sb.__loopTable) : sb.__loopTable) : [];
const allocated = table.filter((l) => { try { return JSON.parse(l.temp_qty_data || "[]").length > 0; } catch (e) { return false; } }).length;
console.log(`lines ${stored.table_gd.length}; route ${res.route} ${res.code} ${String(res.message || "").slice(0, 80)}; plan ${ms} ms, allocation loop ${sb.__loopMs} ms; rows allocated ${allocated}`
  + (res.route === "ENGINE" ? `; movements ${res.movementCount}; res creates ${res.parts.RES.creates.length}` : ""));
if (outArg) fs.writeFileSync(outArg, JSON.stringify(table));
