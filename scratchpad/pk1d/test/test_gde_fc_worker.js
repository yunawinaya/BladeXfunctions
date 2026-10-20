// test_gde_fc_worker.js: GD Edit V2's orphan-hold rule for Picking Force Complete (Picking 1d, Task 8). A PICKING_FC hold whose
// force complete (its CONFIRM_PICKING job) has ended is due at once: the worker poll and SUBMIT's held check treat it as
// expired, the claim cancels it with the force complete's wording, and never touches a Picking it did not lock.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const W = R + "scratchpad/gde/code/worker/";
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0].slice(0, 240)); } };
const walk = (l, out = []) => { for (const x of l || []) { out.push(x); walk(x.blocks, out); } return out; };
const code = (file, id) => { const x = walk(JSON.parse(fs.readFileSync(R + file, "utf8")).nodes).filter((y) => y.id === id)[0]; assert.ok(x, id); return x.data.script.code; };

// the worker's own modules as test_worker.js loads them: _common.js included, the source cut at its first {{template}} line
const mod = (file) => {
  const t = fs.readFileSync(W + file, "utf8").replace("//@include _common.js\n", fs.readFileSync(W + "_common.js", "utf8") + "\n");
  const cut = t.search(/^.*\{\{.*$/m);
  const ctx = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Date, parseInt, parseFloat, isNaN };
  vm.createContext(ctx);
  vm.runInContext(cut >= 0 ? t.slice(0, cut) : t, ctx);
  return ctx;
};
const PL = mod("plan.js"), CL = mod("claim.js");
const call = (ctx, fn, ...args) => { ctx.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", ctx))); };
const heldItem = (heldBy) => ({ jobId: "5", jobStatus: "HELD", attempts: 0, deadLease: "NO", deadClaim: "NO", progressPercent: 60, progressMessage: "held", nextAttemptAt: "2026-10-20 10:30:00",
  leaseOwner: "", leaseExpiresAt: "", storedStatus: "Created", pickId: "", heldBy: heldBy });
const pickOf = (item) => ({ route: "CLAIM", item, dbNow: "2026-10-20 10:05:00", jobId: "5", organizationId: "9", gdId: "2100000000000000001", rvBase: 3, leaseUntil: "2026-10-20 10:15:00" });

it("claim: an orphaned force-complete hold is cancelled with the force complete's wording", () => {
  const r = call(CL, "workerClaim", { leaseOwner: "WRK|abc" }, pickOf(heldItem("PICKING_FC")));
  assert.strictEqual(r.route, "EXPIRE"); assert.strictEqual(r.failRows[0].job_status, "CANCELLED");
  assert.ok(/force complete/i.test(r.failRows[0].progress_message) && /force complete/i.test(r.result_message), r.failRows[0].progress_message + " | " + r.result_message);
  assert.deepStrictEqual(r.pickUnlockRows, []);
});
it("claim: a sales order save's expired hold keeps its wording", () => {
  const r = call(CL, "workerClaim", { leaseOwner: "WRK|abc" }, pickOf(heldItem("CASCADE")));
  assert.ok(/sales order save/.test(r.failRows[0].progress_message), r.failRows[0].progress_message);
});
it("plan: a polled row's causation_id reaches the item as heldBy", () => {
  const item = call(PL, "workerItem", { id: "5", organization_id: "9", gd_id: "1", job_status: "HELD", causation_id: "PICKING_FC", attempt_count: 0, row_version: 1 });
  assert.strictEqual(item.heldBy, "PICKING_FC");
});

// the built SQL: due / expired also when the force complete that held the job has ended
const ORPHAN = /causation_id = 'PICKING_FC'[\s\S]{0,400}f\.command = 'CONFIRM_PICKING'[\s\S]{0,300}f\.job_status IN \('COMPLETED', 'FAILED', 'CANCELLED'\)/;
it("worker poll: an orphaned PICKING_FC hold is due", () => { assert.ok(ORPHAN.test(code("Goods Delivery/EditV2/GD_EDIT_WORKER.json", "sql_node_GWpoll"))); });
it("worker tick: an orphaned PICKING_FC hold reads due, as in the poll (the pick skips a job its fresh read finds not due)", () => {
  const tick = code("Goods Delivery/EditV2/GD_EDIT_WORKER.json", "sql_node_GWtick");
  const due = tick.slice(0, tick.indexOf(" AS due_now"));
  assert.ok(ORPHAN.test(due.slice(due.lastIndexOf("(j.next_attempt_at IS NULL"))), "due_now lacks the orphan clause");
});
it("worker poll: still selects causation_id", () => { assert.ok(/j\.causation_id/.test(code("Goods Delivery/EditV2/GD_EDIT_WORKER.json", "sql_node_GWpoll"))); });
it("SUBMIT held check: an orphaned PICKING_FC hold reads expired", () => { assert.ok(ORPHAN.test(code("Goods Delivery/EditV2/GD_EDIT_SUBMIT.json", "sql_node_GSheld"))); });
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
