// test_worker_fc.js: PICKING_ASYNC_WORKER routes a force complete (Picking 1d, Task 12) through PICKING_FC_DRIVE until its
// deliveries are updated (FC_GDS), then publishes in the same tick; a confirm keeps its route. Runs the repo's JSONs (or PK_OUT)
// on the 1c sim with GD Edit V2 stood in (scratchpad/pk1d/sim/drive_sim.js) and PICKING_BULK_COMMIT recorded, not run.
const fs = require("fs"), path = require("path"), assert = require("assert");
const { seedFc, gdeStub, DB } = require(path.join(__dirname, "../sim/drive_sim.js"));
const { mocks1d } = require(path.join(__dirname, "../sim/mocks_1d.js"));
const { Engine } = require(path.join(__dirname, "../../pk1c/sim/engine.js"));
const DIR = process.env.PK_OUT || path.join(__dirname, "../../../Picking/AsyncV2");
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.stack || e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400)); } };
const FC_CODES = ["PK_FC_NOT_IN_PROGRESS", "PK_FC_NO_RECORDS", "PK_FC_SHARED_LINE", "PK_FC_UOM", "PK_FC_OVERPICK", "PK_FC_GD_UNPICKED", "PK_FC_SETUP_CHANGED", "PK_FC_STALE",
  "PK_FC_GD_CHANGED", "PK_FC_GD_NOT_ELIGIBLE", "PK_FC_GD_REFUSED"];

const setup = (opt) => {
  const db = new DB();
  const fx = seedFc(db, opt);
  const gde = gdeStub(db);
  const e = new Engine({ dir: DIR, db: db, mocks: mocks1d() });
  const run = e.run.bind(e);
  e.calls = [];
  e.commits = [];
  e.driveStub = null;
  e.run = (name, params) => {
    e.calls.push(name);
    if (name === "GD_EDIT_SUBMIT") return { returned: gde.submit(params || {}), ctx: {} };
    if (name === "PICKING_BULK_COMMIT") { e.commits.push(String(params.job_id)); return { returned: { publish_route: "RECORDED", job_id: String(params.job_id) }, ctx: {} }; }
    if (name === "PICKING_FC_DRIVE" && e.driveStub) return { returned: e.driveStub(params), ctx: {} };
    if (name === "GD_EDIT_WORKER" || name === "PICKING_BULK_PREPARE") throw new Error(name + " is not expected here");
    return run(name, params);
  };
  const worker = () => e.run("PICKING_ASYNC_WORKER", { job_id: fx.J }).returned;
  const drive = () => run("PICKING_FC_DRIVE", { job_id: fx.J, lease_owner: "" }).returned;
  const job = () => db.t.job.find((j) => j.id === fx.J);
  const edits = () => db.t.job.filter((j) => j.command === "EDIT_GD");
  // every delivery committed, FC_GDS not yet written: the next drive call answers DONE
  const toLastCommit = () => {
    for (let i = 0; i < 40; i++) {
      const r = drive();
      for (const k of r.kick || []) gde.worker(k);
      db.advance(3);
      if (edits().length && edits().every((x) => x.job_status === "COMPLETED")) return;
    }
    throw new Error("the deliveries did not all commit");
  };
  return { db, fx, gde, e, worker, drive, job, edits, toLastCommit };
};
const WORKER_JSON = () => fs.readFileSync(path.join(DIR, "PICKING_ASYNC_WORKER.json"), "utf8");

it("1 an FC job READY_TO_COMMIT: the tick calls PICKING_FC_DRIVE, not PICKING_BULK_COMMIT; its answer names the edits to kick", () => {
  const t = setup({ gds: [{ lines: 2 }, { lines: 1 }] });
  const r = t.worker();
  assert.deepStrictEqual(t.e.calls.filter((c) => c === "PICKING_FC_DRIVE").length, 1, t.e.calls.join(","));
  assert.deepStrictEqual(t.e.commits, []);
  assert.strictEqual(t.edits().length, 2);
  assert.deepStrictEqual((r.kick || []).slice().sort(), t.edits().map((x) => x.id).sort());
  assert.deepStrictEqual([t.job().job_status, t.job().lease_owner], ["READY_TO_COMMIT", null]);
});

it("2 the drive answers DONE in this tick -> PICKING_BULK_COMMIT in the same tick", () => {
  const t = setup({ gds: [{ lines: 1 }, { lines: 1 }] });
  t.toLastCommit();
  assert.strictEqual(t.job().job_status, "COMMITTING_PICKING");
  t.e.calls = [];
  t.worker();
  const order = t.e.calls.filter((c) => c === "PICKING_FC_DRIVE" || c === "PICKING_BULK_COMMIT");
  assert.deepStrictEqual(order, ["PICKING_FC_DRIVE", "PICKING_BULK_COMMIT"], t.e.calls.join(","));
  assert.deepStrictEqual(t.e.commits, [t.fx.J]);
});

it("3 a confirm (not a force complete): unchanged route - PICKING_BULK_COMMIT, no drive", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  t.job().request_payload = JSON.stringify({ v: 1, operation: "CONFIRM", picking_id: t.fx.P });
  t.worker();
  assert.ok(!t.e.calls.includes("PICKING_FC_DRIVE"), t.e.calls.join(","));
  assert.deepStrictEqual(t.e.commits, [t.fx.J]);
});

it("4 a force complete with FC_GDS (its deliveries updated): published without a drive", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  t.toLastCommit();
  t.drive(); // MARK_GDS -> DONE, the job due
  t.e.calls = [];
  t.worker();
  assert.ok(!t.e.calls.includes("PICKING_FC_DRIVE"), t.e.calls.join(","));
  assert.deepStrictEqual(t.e.commits, [t.fx.J]);
});

it("5 PKC.hard carries the force-complete codes in every copy", () => {
  const w = JSON.parse(WORKER_JSON());
  const codes = [];
  const walk = (ns) => { for (const x of ns || []) { const c = x.data && x.data.script && x.data.script.code; if (c && c.indexOf("hard: [") >= 0) codes.push([x.id, c]); walk(x.blocks); } };
  walk(w.nodes);
  assert.strictEqual(codes.length, 6, codes.map((c) => c[0]).join(","));
  for (const [id, c] of codes) for (const k of FC_CODES) assert.ok(c.indexOf('"' + k + '"') >= 0, id + " lacks " + k);
});

it("5b the drive answers a hard code without writing -> the worker fails the job (no retry) and unlocks the Picking", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  t.e.driveStub = () => ({ route: "ABORTED", result_code: "PK_FC_STALE", result_message: "changed", kick: [] });
  t.worker();
  assert.deepStrictEqual([t.job().job_status, t.job().error_code, t.job().lease_owner], ["FAILED", "PK_FC_STALE", null]);
  assert.strictEqual(t.db.t.picking.find((p) => p.id === t.fx.P).is_processing, 0);
});

it("6 the drive answers without writing (no hard code) -> a counted retry, lease released", () => {
  const t = setup({ gds: [{ lines: 1 }] });
  t.e.driveStub = () => ({ route: "WAIT", result_code: "", result_message: "", kick: [] });
  t.worker();
  const j = t.job();
  assert.deepStrictEqual([j.job_status, j.attempt_count, j.lease_owner], ["READY_TO_COMMIT", 1, null]);
  assert.ok(j.next_attempt_at > t.db.now, "backoff");
  assert.strictEqual(t.db.t.picking.find((p) => p.id === t.fx.P).is_processing, 1);
});

it("7 the tick's final read names the edits to kick only for an open force complete, through the open-job states", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../code/worker_final.sql"), "utf8");
  assert.ok(/CASE WHEN JSON_UNQUOTE\(JSON_EXTRACT\(j\.request_payload, '\$\.operation'\)\) = 'FORCE_COMPLETE'/.test(sql), "no FORCE_COMPLETE gate");
  assert.ok(/e\.job_status IN \('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'HELD'\)/.test(sql), "the edits are not read through their open states");
});
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);
