// plan_live.js <reads.json>: code/prepare/plan.js (grPlan) on one GD's live dev reads (test/run_reads.py output), as PREPARE runs it
// under this job's lock: the stored GD shown Processing and its latest LOCK row this job's key. Prints the route, the movements and
// each step's planned rows (before -> after); exit 1 if it throws. --out <file> writes the plan for test/commit_sim.js.
const fs = require("fs"), vm = require("vm");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const X = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
vm.createContext(sb);
for (const f of [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_revert.js", R + "scratchpad/gdc/code/prepare/adapter.js", D + "/code/prepare/chain.js", D + "/code/prepare/plan.js"])
  vm.runInContext(fs.readFileSync(f, "utf8"), sb);
vm.runInContext("this.grPlan = grPlan;", sb);
const reads = JSON.parse(JSON.stringify(X.reads));
reads.hdr = reads.hdr.map((r) => ({ j: r.j.replace(/"gd_status": ?"Completed"/, '"gd_status": "Processing"') }));
const S = Object.assign({ organizationId: X.org }, reads, { lock: [{ result_ref: "KEY1" }] });
const entry = { route: "GO", jobId: "9001", gdId: X.gd, organizationId: X.org, tenantId: X.tenant, idempotencyKey: "KEY1", nonce: "abc12345", request: { source: "LIST" } };
const out = sb.grPlan(entry, S);
const m = out.payload ? JSON.parse(out.payload) : {};
const parts = {};
for (const r of out.partRows) { const k = r.step_name.split("|")[2]; parts[k] = (parts[k] || "") + r.result_ref; }
const P = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, JSON.parse(v)]));
console.log("route", out.route, out.code, "|", out.message, "| unlockOk", out.unlockOk);
console.log("counts", JSON.stringify(m.counts));
for (const mv of out.movements) console.log("  move", mv.movement_key, mv.direction, mv.inventory_category, mv.material_id, mv.quantity, mv.material_uom, "bin", mv.location_id, "batch", mv.batch_id, "@", mv.unit_price, mv.transaction_type, mv.trx_no, mv.parent_trx_no);
for (const [part, groups] of Object.entries(P)) if (part !== "ENGINE") for (const [g, rows] of Object.entries(groups)) if (Array.isArray(rows)) for (const r of rows) if (r && r.before) console.log("  " + part + "." + g, r.id, JSON.stringify(r.before), "->", JSON.stringify(r.after));
// --out <file>: the plan (partRows, manifest) for test/commit_sim.js (tenant data: session scratchpad only)
const oi = process.argv.indexOf("--out");
if (oi > 0) fs.writeFileSync(process.argv[oi + 1], JSON.stringify({ result: out, manifest: m }));
