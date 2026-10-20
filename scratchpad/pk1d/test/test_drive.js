// test_drive.js: PICKING_FC_DRIVE (Picking 1d, Task 11) run on the 1c sim interpreter with GD Edit V2 stood in
// (scratchpad/pk1d/sim/drive_sim.js). DRIVE calls only GD_EDIT_SUBMIT; the test plays the screen: it runs GD_EDIT_WORKER for
// every job id DRIVE's answer names in kick, then calls DRIVE again.
const fs = require("fs"), path = require("path"), assert = require("assert");
const { seedFc, gdeStub, driveEngine, DB } = require(path.join(__dirname, "../sim/drive_sim.js"));
const WF = path.join(__dirname, "../../../Picking/AsyncV2/PICKING_FC_DRIVE.json");
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.stack || e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };

const setup = (opt, stubOpt) => {
  const db = new DB();
  const fx = seedFc(db, opt);
  const gde = gdeStub(db, stubOpt);
  const e = driveEngine(db, gde);
  const drive = (params) => e.run("PICKING_FC_DRIVE", Object.assign({ job_id: fx.J, lease_owner: "" }, params || {})).returned;
  // the screen: DRIVE, then every kicked edit job's worker, until DRIVE answers a final route
  const follow = (max) => {
    const seen = [];
    for (let i = 0; i < (max || 60); i++) {
      const r = drive();
      seen.push(r);
      if (["DONE", "ABORTED", "REVIEW", "REJECT", "NONE"].includes(r.route)) break;
      for (const k of r.kick || []) gde.worker(k);
      db.advance(3);
    }
    return seen;
  };
  const job = () => db.t.job.find((j) => j.id === fx.J);
  const edits = (gi) => db.t.job.filter((j) => j.command === "EDIT_GD" && (gi === undefined || JSON.parse(j.request_payload).gd_id === fx.gdIds[gi]));
  const steps = () => db.t.step.filter((s) => s.job_id === fx.J && /^FC_/.test(s.step_name)).map((s) => s.step_name).sort();
  const picking = () => db.t.picking.find((p) => p.id === fx.P);
  return { db, fx, gde, e, drive, follow, job, edits, steps, picking };
};
const ops = (t) => t.gde.log.submit.map((p) => (p.operation || "SUBMIT") + ":" + t.fx.gdIds.indexOf(String(p.gd_id)));

it("the workflow exists and holds no GD_EDIT_WORKER call (the screen kicks every edit job's PREPARE / COMMIT)", () => {
  const text = fs.readFileSync(WF, "utf8");
  assert.ok(!/GD_EDIT_WORKER:Workflow:/.test(text), "DRIVE must not call GD_EDIT_WORKER");
  assert.ok(/GD_EDIT_SUBMIT:Workflow:/.test(text), "DRIVE calls GD_EDIT_SUBMIT");
});

it("1 hold phase: F0, then one SUBMIT per delivery in the same call, answered WAIT + kick of every queued edit", () => {
  const t = setup({ gds: [{ lines: 2 }, { lines: 1 }, { lines: 3 }] });
  const r = t.drive();
  assert.strictEqual(r.route, "WAIT", JSON.stringify(r));
  assert.deepStrictEqual(ops(t), ["SUBMIT:0", "SUBMIT:1", "SUBMIT:2"]);
  assert.deepStrictEqual(r.kick.slice().sort(), t.edits().map((x) => x.id).sort());
  assert.deepStrictEqual(t.steps(), ["FC_F0"]);
  assert.ok(!t.e.calls.includes("GD_EDIT_WORKER"));
  const p = t.gde.log.submit[0];
  assert.deepStrictEqual([p.source, p.fcd_ref, p.cascade_ref, String(p.causation_job_id), String(p.picking_id)], ["PICKING_FC", "FCD|a1b2c3d4|0", "PKFC|" + t.fx.J, t.fx.J, t.fx.P]);
  const j = t.job();
  assert.deepStrictEqual([j.job_status, j.lease_owner, j.lease_expires_at], ["READY_TO_COMMIT", null, null]);
  assert.ok(j.next_attempt_at <= t.db.now, "due again at once");
  assert.ok(t.db.t.gd.filter((g) => t.fx.gdIds.includes(g.id)).every((g) => g.gd_status === "Processing"));
});

it("1b all held -> FC_HOLD + COMMITTING_PICKING, then RELEASE of the first delivery only", () => {
  const t = setup({ gds: [{ lines: 2 }, { lines: 1 }, { lines: 3 }] });
  for (const k of t.drive().kick) t.gde.worker(k);
  t.db.advance(3);
  const r = t.drive();
  assert.strictEqual(r.route, "WAIT", JSON.stringify(r));
  assert.deepStrictEqual(t.steps(), ["FC_F0", "FC_HOLD"]);
  assert.strictEqual(t.job().job_status, "COMMITTING_PICKING");
  assert.deepStrictEqual(ops(t).slice(3), ["RELEASE:0"]);
  assert.deepStrictEqual(r.kick, [t.edits(0)[0].id]);
  assert.ok(/delivery 1 of 3/.test(t.job().progress_message), t.job().progress_message);
});

it("2 commit phase: deliveries committed strictly in order, then FC_GDS and DONE (due now, lease released)", () => {
  const t = setup({ gds: [{ lines: 2 }, { lines: 1 }, { lines: 3 }] });
  const seen = t.follow();
  const last = seen[seen.length - 1];
  assert.strictEqual(last.route, "DONE", JSON.stringify(seen.map((x) => x.route)));
  assert.deepStrictEqual(t.gde.log.commits, t.fx.gdIds);
  assert.deepStrictEqual(ops(t).filter((x) => x.startsWith("RELEASE")), ["RELEASE:0", "RELEASE:1", "RELEASE:2"]);
  assert.deepStrictEqual(t.steps(), ["FC_F0", "FC_GDS", "FC_HOLD"]);
  const j = t.job();
  assert.deepStrictEqual([j.job_status, j.lease_owner], ["COMMITTING_PICKING", null]);
  assert.ok(j.next_attempt_at <= t.db.now);
  assert.ok(!t.e.calls.includes("GD_EDIT_WORKER"));
  // DONE again (nothing to do) on a repeated call, without a claim
  const rv = j.row_version;
  assert.strictEqual(t.drive().route, "DONE");
  assert.strictEqual(t.job().row_version, rv);
});

it("2b a RELEASE waits until the previous delivery is COMPLETED", () => {
  const t = setup({ gds: [{ lines: 1 }, { lines: 1 }] });
  for (const k of t.drive().kick) t.gde.worker(k);
  t.db.advance(3);
  t.drive(); // FC_HOLD + RELEASE 0, no kick run
  t.db.advance(3);
  const r = t.drive();
  assert.strictEqual(r.route, "WAIT");
  assert.deepStrictEqual(ops(t).filter((x) => x.startsWith("RELEASE")), ["RELEASE:0"]);
  assert.deepStrictEqual(r.kick, [t.edits(0)[0].id]);
});

it("3 budget: at most 12 actions per call, the rest on the next call", () => {
  const t = setup({ gds: Array.from({ length: 14 }, () => ({ lines: 1 })) });
  const r = t.drive();
  assert.strictEqual(r.route, "WAIT");
  assert.strictEqual(t.edits().length, 11, "F0 + 11 SUBMITs = 12 actions");
  assert.strictEqual(r.kick.length, 11);
  t.db.advance(3);
  const r2 = t.drive();
  assert.strictEqual(t.edits().length, 14);
  assert.strictEqual(r2.kick.length, 14);
});

it("3b budget: about 600 line-weight units of SUBMIT per call, but always one action", () => {
  const t = setup({ gds: [{ lines: 1, weight: 400 }, { lines: 1, weight: 400 }, { lines: 1, weight: 900 }] });
  t.drive();
  assert.strictEqual(t.edits().length, 1);
  t.db.advance(3);
  t.drive();
  assert.strictEqual(t.edits().length, 2);
  t.db.advance(3);
  t.drive();
  assert.strictEqual(t.edits().length, 3, "a 900-weight delivery alone is still submitted");
});

it("3c budget: 20 s per call (the DB clock), but always one action", () => {
  const t = setup({ gds: [{ lines: 1 }, { lines: 1 }, { lines: 1 }] });
  const submit = t.gde.submit;
  t.gde.submit = (p) => { t.db.advance(25); return submit(p); };
  t.drive();
  assert.strictEqual(t.edits().length, 1);
});

it("4 a refusal in the hold phase: FC_ABORT, every hold cancelled, then FAILED and the Picking unlocked", () => {
  const t = setup({ gds: [{ lines: 1 }, { lines: 1 }, { lines: 1 }] });
  const stub = gdeStub(t.db, { refuse: { [t.fx.gdIds[1]]: { route: "STOP", code: "409", message: "GDE_FC_STALE: line 7 changed since the force complete was planned" } } });
  t.gde.submit = stub.submit; t.gde.worker = stub.worker; t.gde.log = stub.log;
  const seen = t.follow();
  const last = seen[seen.length - 1];
  assert.strictEqual(last.route, "ABORTED", JSON.stringify(seen.map((x) => x.route)));
  assert.deepStrictEqual(t.steps(), ["FC_ABORT", "FC_F0"]);
  assert.deepStrictEqual(ops(t), ["SUBMIT:0", "SUBMIT:1", "CANCEL_HELD:0"]);
  assert.deepStrictEqual(t.edits(0).map((x) => x.job_status), ["CANCELLED"]);
  const j = t.job();
  assert.deepStrictEqual([j.job_status, j.error_code, j.lease_owner], ["FAILED", "PK_FC_GD_CHANGED", null]);
  assert.ok(/GD\/2/.test(j.error_message) && /Not force completed/.test(j.progress_message), j.error_message + " / " + j.progress_message);
  assert.ok(j.finished_at);
  assert.strictEqual(t.picking().is_processing, 0);
  assert.ok(t.db.t.gd.filter((g) => t.fx.gdIds.includes(g.id)).every((g) => g.gd_status === "Created"));
});

it("4b an edit refused at its PREPARE (FAILED, not stale) aborts the same way", () => {
  const t = setup({ gds: [{ lines: 1 }, { lines: 1 }] });
  const g1 = t.fx.gdIds[1];
  const stub = gdeStub(t.db, { prepareFail: { [g1]: "GDE_NOT_ELIGIBLE" } });
  t.gde.submit = stub.submit; t.gde.worker = stub.worker; t.gde.log = stub.log;
  const seen = t.follow();
  assert.strictEqual(seen[seen.length - 1].route, "ABORTED", JSON.stringify(seen.map((x) => x.route)));
  assert.strictEqual(t.job().error_code, "GDE_NOT_ELIGIBLE");
  assert.deepStrictEqual(t.edits(0).map((x) => x.job_status), ["CANCELLED"]);
  assert.strictEqual(t.picking().is_processing, 0);
});

it("5 a commit failing GDE_STALE is re-planned (at most 2), then REVIEW: holds cancelled, the Picking stays locked", () => {
  const t = setup({ gds: [{ lines: 1 }, { lines: 1 }] });
  const g0 = t.fx.gdIds[0];
  const stub = gdeStub(t.db, { commitFail: { [g0]: ["GDE_STALE", "GDE_STALE", "GDE_STALE"] } });
  t.gde.submit = stub.submit; t.gde.worker = stub.worker; t.gde.log = stub.log;
  const seen = t.follow();
  assert.strictEqual(seen[seen.length - 1].route, "REVIEW", JSON.stringify(seen.map((x) => x.route)));
  assert.deepStrictEqual(t.edits(0).map((x) => x.job_status), ["FAILED", "FAILED", "FAILED"]);
  assert.deepStrictEqual(t.edits(1).map((x) => x.job_status), ["CANCELLED"]);
  assert.deepStrictEqual(t.steps(), ["FC_F0", "FC_HOLD", "FC_REVIEW"]);
  const j = t.job();
  assert.deepStrictEqual([j.job_status, j.error_code, j.lease_owner], ["REQUIRES_REVIEW", "GDE_STALE", null]);
  assert.strictEqual(t.picking().is_processing, 1);
});

it("5b a delivery sharing an SO line with one committed after its hold is re-planned before its RELEASE", () => {
  const t = setup({ gds: [{ lines: 1, so: ["S1"] }, { lines: 1, so: ["S1"] }, { lines: 1, so: ["S9"] }] });
  const seen = t.follow();
  assert.strictEqual(seen[seen.length - 1].route, "DONE", JSON.stringify(seen.map((x) => x.route)));
  assert.deepStrictEqual(ops(t), ["SUBMIT:0", "SUBMIT:1", "SUBMIT:2", "RELEASE:0", "CANCEL_HELD:1", "SUBMIT:1", "RELEASE:1", "RELEASE:2"]);
  assert.deepStrictEqual(t.edits(1).map((x) => x.job_status), ["CANCELLED", "COMPLETED"]);
});

it("6 a live lease of another run -> WAIT, nothing written; the caller's own lease is taken over", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  Object.assign(t.job(), { lease_owner: "DRV|ffffffffffffffffffffffff", lease_expires_at: t.db.now + 300000 });
  const rv = t.job().row_version;
  const r = t.drive();
  assert.strictEqual(r.route, "WAIT");
  assert.deepStrictEqual([t.job().row_version, t.steps(), t.gde.log.submit.length], [rv, [], 0]);
  Object.assign(t.job(), { lease_owner: "WRK|abc", lease_expires_at: t.db.now + 300000 });
  const r2 = t.drive({ lease_owner: "WRK|abc" });
  assert.strictEqual(r2.route, "WAIT");
  assert.strictEqual(t.gde.log.submit.length, 1);
  assert.strictEqual(t.job().lease_owner, null);
});

it("7 every key DRIVE writes or sends is 24 characters or fewer (a 19-digit job id)", () => {
  const t = setup({ gds: [{ lines: 1 }, { lines: 1 }] });
  t.follow();
  const keys = t.db.t.step.filter((s) => s.job_id === t.fx.J).map((s) => s.step_name)
    .concat(t.gde.log.submit.map((p) => p.cascade_ref), t.gde.log.submit.map((p) => p.fcd_ref || ""));
  assert.strictEqual(t.fx.J.length, 19);
  assert.ok(keys.every((k) => k.length <= 24), keys.filter((k) => k.length > 24).join(", "));
});

it("8 F0: the Picking's rows changed since PREPARE -> FAILED + unlocked, no delivery touched", () => {
  const t = setup({ gds: [{ lines: 2 }] });
  t.db.t.lines.find((r) => r.transfer_order_id === t.fx.P).line_status = "Completed";
  const r = t.drive();
  assert.strictEqual(r.route, "ABORTED", JSON.stringify(r));
  assert.strictEqual(t.gde.log.submit.length, 0);
  assert.deepStrictEqual([t.job().job_status, t.job().error_code], ["FAILED", "PK_FC_STALE"]);
  assert.strictEqual(t.picking().is_processing, 0);
});

it("8b F0: a record added, or a delivery's status changed -> FAILED", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  t.db.t.records.push({ id: t.db.id(), transfer_order_id: t.fx.P, gd_line_id: "x", store_out_qty: "1.00000000", is_deleted: 0 });
  assert.strictEqual(t.drive().route, "ABORTED");
  const u = setup({ gds: [{ lines: 1 }, { lines: 1 }] });
  u.db.t.gd.find((g) => g.id === u.fx.gdIds[1]).gd_status = "Completed";
  assert.strictEqual(u.drive().route, "ABORTED");
  assert.strictEqual(u.job().error_code, "PK_FC_STALE");
});

it("8c F0: a record's picked quantity changed -> FAILED", () => {
  const t = setup({ gds: [{ lines: 2 }] });
  t.db.t.records.find((r) => r.transfer_order_id === t.fx.P).store_out_qty = "2.00000000";
  assert.strictEqual(t.drive().route, "ABORTED");
  assert.strictEqual(t.job().error_code, "PK_FC_STALE");
});

it("9 a foreign edit on a delivery (BUSY) -> WAIT, retried on the next call", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  const stub = gdeStub(t.db, { busyFor: { [t.fx.gdIds[0]]: 1 } });
  t.gde.submit = stub.submit; t.gde.worker = stub.worker; t.gde.log = stub.log;
  const r = t.drive();
  assert.deepStrictEqual([r.route, r.kick, t.edits().length], ["WAIT", [], 0]);
  t.db.advance(3);
  const r2 = t.drive();
  assert.deepStrictEqual([r2.route, t.edits().length], ["WAIT", 1]);
});

it("10 not a force complete -> REJECT; a finished job -> NONE; both write nothing", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  t.job().request_payload = JSON.stringify({ v: 1, operation: "CONFIRM" });
  const rv = t.job().row_version, touched = t.picking().update_time;
  t.db.advance(60);
  assert.strictEqual(t.drive().route, "REJECT");
  t.job().request_payload = JSON.stringify({ v: 1, operation: "FORCE_COMPLETE" });
  t.job().job_status = "COMPLETED";
  assert.strictEqual(t.drive().route, "NONE");
  assert.deepStrictEqual([t.job().row_version, t.steps(), t.picking().update_time, t.gde.log.submit.length], [rv, [], touched, 0]);
});

it("11 every working call touches the Picking lock (is_processing 1, its update time refreshed)", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  t.db.advance(600);
  t.drive();
  assert.deepStrictEqual([t.picking().is_processing, t.picking().update_time], [1, t.db.now + 8 * 3600 * 1000]);
});

it("12 a re-plan SUBMIT refused while committing -> FC_REVIEW: REQUIRES_REVIEW, the Picking stays locked", () => {
  const t = setup({ gds: [{ lines: 1, so: ["S1"] }, { lines: 1, so: ["S1"] }] });
  const stub = gdeStub(t.db, { refuse: { [t.fx.gdIds[1]]: { route: "STOP", code: "400", message: "Goods Delivery is Completed", skip: 1 } } });
  t.gde.submit = stub.submit; t.gde.worker = stub.worker; t.gde.log = stub.log;
  const seen = t.follow();
  assert.strictEqual(seen[seen.length - 1].route, "REVIEW", JSON.stringify(seen.map((x) => x.route)));
  assert.deepStrictEqual(ops(t), ["SUBMIT:0", "SUBMIT:1", "RELEASE:0", "CANCEL_HELD:1", "SUBMIT:1"]);
  assert.deepStrictEqual(t.steps(), ["FC_F0", "FC_HOLD", "FC_REVIEW"]);
  assert.deepStrictEqual([t.job().job_status, t.job().error_code, t.picking().is_processing], ["REQUIRES_REVIEW", "PK_FC_GD_REFUSED", 1]);
  assert.ok(/1 of 2 deliveries/.test(t.job().progress_message), t.job().progress_message);
});

console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
