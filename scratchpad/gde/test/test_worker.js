// test_worker.js: GD_EDIT_WORKER's code (code/worker/*.js), each module in its own context with _common.js included, as
// build_gde.py assembles the code nodes. What differs from GD Completed V2's worker:
//  - every unlock puts the GD back to its STORED status (Created or Draft) and releases our Picking lock (pick_id: the
//    Picking still at the version this job locked; '0' otherwise), read fresh where the worker decides
//  - a cascade's HELD job is never published; an expired hold (next_attempt_at reached) is CANCELLED with both unlocks
//  - the hard codes are GD_EDIT_PREPARE / GD_EDIT_COMMIT's (GDE_*; an inventory refusal GDE_INVENTORY_* is hard)
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const W = __dirname + "/../code/worker/";
const MUT = {
  stored: ["claim.js", "gd_status: item.storedStatus", "gd_status: \"Created\""],
  held_skip: ["pick.js", "item.jobStatus === \"HELD\" ||", ""],
  expire_pick: ["claim.js", "pickUnlockRows: pickUnlock, ", "pickUnlockRows: [], "],
  prep_held: ["after_prepare.js", "if (status === \"HELD\") return", "if (false) return"],
  fresh: ["after_prepare.js", "const unlock = unlockOf(job);", "const unlock = unlockOf({ gd_id: own.gdId, stored_status: \"Created\" });"],
  inv_hard: ["_common.js", "/^GDE_(INVENTORY_[A-Z0-9_]+|[0-9]{3})$/.test(c)", "false"],
};
const mutate = process.argv.indexOf("--mutate") >= 0 ? process.argv[process.argv.indexOf("--mutate") + 1] : "";
const read = (f) => {
  let t = fs.readFileSync(W + f, "utf8");
  if (mutate && MUT[mutate][0] === f) { if (t.indexOf(MUT[mutate][1]) < 0) throw new Error("mutant " + mutate + " does not apply"); t = t.replace(MUT[mutate][1], MUT[mutate][2]); }
  return t;
};
const mod = (file, subs) => {
  let t = read(file).replace("//@include _common.js\n", read("_common.js") + "\n");
  for (const [a, b] of Object.entries(subs || {})) t = t.split(a).join(b);
  const cut = t.search(/^.*\{\{.*$/m);
  const ctx = { console: { log() {} }, JSON, Math, Number, String, Array, Object, Set, Date, parseInt, parseFloat, isNaN };
  vm.createContext(ctx);
  vm.runInContext(cut >= 0 ? t.slice(0, cut) : t, ctx);
  return ctx;
};
const M = { guard: mod("guard.js"), plan: mod("plan.js"), pick: mod("pick.js"), claim: mod("claim.js"), own: mod("own.js"), prep: mod("after_prepare.js"),
  mid: mod("mid.js"), pub: mod("after_publish.js"), split: mod("split.js"), result: mod("result.js", { __PATH__: "DONE" }) };
const call = (ctx, fn, ...args) => { ctx.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", ctx))); };
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + (e.message || e).toString().split("\n")[0]); } };

const GD = "2100000000000000001", PK = "2100000000000000077";
const guard = { route: "CONTINUE", jobId: "0", tenantId: "1", nonce: "abc", leaseOwner: "WRK|abc" };
const row = (o) => Object.assign({ db_now: "2026-10-15 10:00:00", lease_until: "2026-10-15 10:10:00", id: "501", organization_id: "9", gd_id: GD, stored_status: "Draft", pick_id: PK,
  job_status: "QUEUED", progress_percent: 0, progress_message: "Queued", attempt_count: 0, next_attempt_at: null, lease_owner: null, lease_expires_at: null, lease_live: 0,
  dead_lease: 0, due_now: 1, row_version: 4, error_code: null, error_message: null, error_details: null, claim_id: null, claim_started_at: null, claim_owner: null, claim_live: 0 }, o || {});
const pickOf = (r) => {
  const plan = call(M.plan, "workerPlan", guard, [r]);
  return call(M.pick, "workerPick", guard, plan, [r], 0);
};
const claimOf = (r) => call(M.claim, "workerClaim", guard, pickOf(r));

it("guard: an invalid job id is refused with Edit V2's code", () => {
  const r = call(M.guard, "workerGuard", { jobId: "x1", systemTenantId: "1", uuid: "ab" });
  assert.strictEqual(r.route, "REJECT"); assert.strictEqual(r.result_code, "GDE_INVALID_DATA");
});
it("plan/pick: the item carries the stored status and our Picking", () => {
  const p = pickOf(row());
  assert.strictEqual(p.item.storedStatus, "Draft"); assert.strictEqual(p.item.pickId, PK);
});
it("pick: a HELD job whose hold expired is claimed", () => {
  const p = pickOf(row({ job_status: "HELD", next_attempt_at: "2026-10-15 09:59:00" }));
  assert.strictEqual(p.route, "CLAIM", p.result_message);
});
it("pick: a HELD job still on hold is left alone", () => {
  const p = pickOf(row({ job_status: "HELD", next_attempt_at: "2026-10-15 10:05:00", due_now: 0 }));
  assert.strictEqual(p.route, "SKIP"); assert.ok(/not due/.test(p.result_message), p.result_message);
});
it("claim: an expired hold is CANCELLED: the GD back to its stored status (Draft), our Picking lock released", () => {
  const c = claimOf(row({ job_status: "HELD", next_attempt_at: "2026-10-15 09:59:00" }));
  assert.strictEqual(c.route, "EXPIRE");
  assert.strictEqual(c.claimRows[0].job_status, "HELD"); assert.strictEqual(c.claimRows[0].lease_owner, "WRK|abc"); assert.strictEqual(c.claimRows[0].row_version, 5);
  const f = c.failRows[0];
  assert.strictEqual(f.job_status, "CANCELLED"); assert.strictEqual(f.error_code, "GDE_HOLD_EXPIRED"); assert.strictEqual(f.row_version, 6); assert.strictEqual(f.lease_owner, null);
  assert.deepStrictEqual(c.unlockRows, [{ id: GD, gd_status: "Draft" }]);
  assert.deepStrictEqual(c.pickUnlockRows, [{ id: PK, is_processing: 0 }]);
});
it("claim: retries exhausted before the commit -> FAILED, the GD back to its stored status, our Picking released", () => {
  const c = claimOf(row({ job_status: "VALIDATING", dead_lease: 1, lease_owner: "WRK|dead", lease_expires_at: "2026-10-15 09:00:00", attempt_count: 3 }));
  assert.strictEqual(c.route, "EXHAUST");
  assert.strictEqual(c.failRows[0].error_code, "GDE_TRANSIENT_RETRIES_EXHAUSTED");
  assert.deepStrictEqual(c.unlockRows, [{ id: GD, gd_status: "Draft" }]);
  assert.deepStrictEqual(c.pickUnlockRows, [{ id: PK, is_processing: 0 }]);
});
it("claim: a stored Created GD goes back to Created", () => {
  const c = claimOf(row({ job_status: "HELD", stored_status: "Created", next_attempt_at: "2026-10-15 09:59:00" }));
  assert.deepStrictEqual(c.unlockRows, [{ id: GD, gd_status: "Created" }]);
});
it("claim: nothing to unlock when the lock and the Picking are not ours (gd_id / pick_id 0)", () => {
  const c = claimOf(row({ job_status: "HELD", gd_id: "0", pick_id: "0", next_attempt_at: "2026-10-15 09:59:00" }));
  assert.strictEqual(c.route, "EXPIRE"); assert.deepStrictEqual(c.unlockRows, []); assert.deepStrictEqual(c.pickUnlockRows, []);
});
it("own: EXPIRE after the lease write -> the CANCELLED row and both unlocks", () => {
  const c = claimOf(row({ job_status: "HELD", next_attempt_at: "2026-10-15 09:59:00" }));
  const o = call(M.own, "workerOwn", guard, c, [row({ job_status: "HELD", lease_owner: "WRK|abc", lease_live: 1, row_version: 5 })]);
  assert.strictEqual(o.route, "EXPIRE"); assert.strictEqual(o.needFail, "YES"); assert.strictEqual(o.needUnlock, "YES"); assert.strictEqual(o.needPickUnlock, "YES");
  assert.deepStrictEqual(o.pickUnlockRows, [{ id: PK, is_processing: 0 }]);
});
it("own: EXPIRE but the job left HELD meanwhile (a RELEASE won) -> LOST, nothing written", () => {
  const c = claimOf(row({ job_status: "HELD", next_attempt_at: "2026-10-15 09:59:00" }));
  const o = call(M.own, "workerOwn", guard, c, [row({ job_status: "READY_TO_COMMIT", lease_owner: "WRK|abc", lease_live: 1, row_version: 5 })]);
  assert.strictEqual(o.route, "LOST"); assert.strictEqual(o.needFail, "NO"); assert.strictEqual(o.needUnlock, "NO"); assert.strictEqual(o.needPickUnlock, "NO");
});
const ownPrep = { route: "PREPARE", dbNow: "2026-10-15 10:00:00", jobId: "501", gdId: GD };
it("after prepare: a cascade job PREPARE parked as HELD -> nothing to write", () => {
  const a = call(M.prep, "workerAfterPrepare", guard, ownPrep, { result_code: "", result_message: "held" }, [row({ job_status: "HELD", lease_owner: null })]);
  assert.strictEqual(a.route, "END"); assert.strictEqual(a.needJobUpd, "NO"); assert.strictEqual(a.needUnlock, "NO"); assert.strictEqual(a.needPickUnlock, "NO");
});
it("after prepare: HELD while this run's lease is still on it -> nothing written (the hold's end is kept)", () => {
  const a = call(M.prep, "workerAfterPrepare", guard, ownPrep, { result_code: "", result_message: "held" },
    [row({ job_status: "HELD", lease_owner: "WRK|abc", lease_live: 1, next_attempt_at: "2026-10-15 10:15:00" })]);
  assert.strictEqual(a.needJobUpd, "NO"); assert.strictEqual(a.needUnlock, "NO"); assert.strictEqual(a.needPickUnlock, "NO");
});
it("after prepare: a hard code with the job left VALIDATING -> FAILED, unlocks from the fresh read", () => {
  const a = call(M.prep, "workerAfterPrepare", guard, Object.assign({}, ownPrep, { gdId: "0" }), { result_code: "GDE_PICKING_CHANGED", result_message: "moved" },
    [row({ job_status: "VALIDATING", lease_owner: "WRK|abc", lease_live: 1 })]);
  assert.strictEqual(a.jobRows[0].job_status, "FAILED"); assert.strictEqual(a.result_code, "GDE_PICKING_CHANGED");
  assert.deepStrictEqual(a.unlockRows, [{ id: GD, gd_status: "Draft" }]); assert.strictEqual(a.needUnlock, "YES");
  assert.deepStrictEqual(a.pickUnlockRows, [{ id: PK, is_processing: 0 }]); assert.strictEqual(a.needPickUnlock, "YES");
});
it("after prepare: an inventory refusal (GDE_INVENTORY_*) is hard", () => {
  const a = call(M.prep, "workerAfterPrepare", guard, ownPrep, { result_code: "GDE_INVENTORY_INSUFFICIENT", result_message: "short" },
    [row({ job_status: "VALIDATING", lease_owner: "WRK|abc", lease_live: 1 })]);
  assert.strictEqual(a.jobRows[0].job_status, "FAILED"); assert.strictEqual(a.result_code, "GDE_INVENTORY_INSUFFICIENT");
});
it("after prepare: an unknown code is a counted retry", () => {
  const a = call(M.prep, "workerAfterPrepare", guard, ownPrep, { result_code: "", result_message: "" }, [row({ job_status: "VALIDATING", lease_owner: "WRK|abc", lease_live: 1, attempt_count: 1 })]);
  assert.strictEqual(a.jobRows[0].job_status, "VALIDATING"); assert.strictEqual(a.jobRows[0].attempt_count, 2); assert.strictEqual(a.result_code, "GDE_TRANSIENT");
  assert.strictEqual(a.needUnlock, "NO"); assert.strictEqual(a.needPickUnlock, "NO");
});
it("mid: a HELD job is never published", () => {
  const m = call(M.mid, "workerMid", guard, ownPrep, [row({ job_status: "HELD", lease_owner: null })]);
  assert.strictEqual(m.route, "END");
});
it("after publish: a hard code, the job still READY_TO_COMMIT under this run's lease -> FAILED, both unlocks", () => {
  const a = call(M.pub, "workerAfterPublish", guard, ownPrep, { route: "PUBLISH", dbNow: "2026-10-15 10:00:00", jobId: "501" }, { result_code: "GDE_STALE", result_message: "stale", path: "FAIL" },
    [row({ job_status: "READY_TO_COMMIT", lease_owner: "WRK|abc", lease_live: 1, stored_status: "Created" })]);
  assert.strictEqual(a.jobRows[0].job_status, "FAILED"); assert.strictEqual(a.result_code, "GDE_STALE");
  assert.deepStrictEqual(a.unlockRows, [{ id: GD, gd_status: "Created" }]); assert.deepStrictEqual(a.pickUnlockRows, [{ id: PK, is_processing: 0 }]);
});
it("result: names GD_EDIT_WORKER", () => {
  const r = call(M.result, "workerResult", guard, { route: "WORK", items: [{ jobId: "501", jobStatus: "QUEUED" }] }, [{ id: "501", job_status: "COMPLETED", gd_id: GD }]);
  assert.strictEqual(JSON.parse(r.evidence).workflow, "GD_EDIT_WORKER");
});
// a poll (no job_id: the GD list, the form's mounted) leaves an edit SO_SAVE released in the last 10 s to SO_SAVE's own call
it("poll: without a job_id, a job released in the last 10 s is skipped (SO_SAVE commits it); a job_id call takes it", () => {
  const W2 = JSON.parse(fs.readFileSync(__dirname + "/../../../Goods Delivery/EditV2/GD_EDIT_WORKER.json", "utf8"));
  const flat = []; const walk = (l) => { for (const x of l || []) { flat.push(x); walk(x.blocks); } }; walk(W2.nodes);
  const q = flat.filter((x) => x.id === "sql_node_GWpoll")[0].data.script.code.replace(/\s+/g, " ");
  assert.ok(/\(\{\{node:code_node_GWguard\.data\.jobId\}\} <> 0 OR NOT EXISTS \(SELECT 1 FROM gd_publish_step r WHERE r\.tenant_id = j\.tenant_id AND r\.job_id = \(CAST\(j\.id AS CHAR\) COLLATE utf8mb4_general_ci\) AND r\.step_name = 'RELEASE' AND r\.is_deleted = 0 AND r\.started_at > NOW\(3\) - INTERVAL 10 SECOND\)\)/.test(q), q.slice(q.indexOf("WHERE j.tenant_id"), q.indexOf("ORDER BY j.create_time")));
});
console.log((mutate ? "[mutant " + mutate + "] " : "") + (n - failed) + "/" + n + " passed");
process.exit(failed ? 1 : 0);
