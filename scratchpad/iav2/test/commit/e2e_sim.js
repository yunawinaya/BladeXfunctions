// node test/commit/e2e_sim.js - the BUILT IA_V2_WORKER driving the BUILT IA_V2_COMMIT (nested on one interpreter, as the
// platform nests them) against world.js (INVENTORY_BULK_APPLY = the deployed planner); IA_V2_PREPARE is the only stand-in
// (VALIDATING -> READY_TO_COMMIT, lease kept, the manifest already stored). One tick: claim -> PREPARE -> COMMIT A (SPLIT) ->
// COMMIT B -> COMPLETED; PARK above 1,000 picks (tick 2 runs phase B); an I2 refusal -> FAILED + Draft, the worker writes
// nothing more; a COMMIT run that dies inside the tick kills the tick, the next tick (lease expired) resumes it.
const path = require("path");
const W = require("./world.js");
const { assert, X, J, fmt, parse, world, liveBatches, stepNames, opCalls } = W;
const { Engine } = require(path.join(__dirname, "../../lib/sim/engine.js"));
const { JOB, IAID, ORG, KEY } = X;
let checks = 0;
const ok = (cond, what, extra) => { checks++; assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 900))); };

// the worker's SQL over the world's one job (the CONTRACT section 8 reads: poll, tick, the job read-backs, final)
function workerSql(w) {
  const j = w.job;
  const lk = () => W.latestLock(w);
  const iaCol = () => (!w.ia.is_deleted && w.ia.item_assembly_status === "Processing" && lk() && lk().result_ref === j.idempotency_key ? IAID : "0");
  const prev = () => { try { const p = JSON.parse(j.request_payload).prevStatus; return p === undefined ? null : p; } catch (e) { return null; } };
  const claim = () => w.steps.find((s) => s.job_id === JOB && s.step_name === "W0_CLAIM_" + j.row_version) || null;
  const liveT = (t) => (t && parse(t) > w.now ? 1 : 0);
  const row = () => ({ db_now: fmt(w.now), id: j.id, job_status: j.job_status, progress_percent: j.progress_percent, progress_message: j.progress_message, attempt_count: j.attempt_count,
    next_attempt_at: j.next_attempt_at, lease_owner: j.lease_owner, lease_expires_at: j.lease_expires_at, lease_live: liveT(j.lease_expires_at), row_version: j.row_version, error_code: j.error_code,
    error_message: j.error_message, error_details: j.error_details, ia_id: iaCol(), prev_status: prev(), finished_at: j.finished_at });
  const withClaim = (r) => {
    const c = claim();
    return Object.assign(r, { organization_id: ORG, dead_lease: j.lease_owner && j.lease_expires_at && parse(j.lease_expires_at) <= w.now ? 1 : 0, claim_id: c ? c.id : null,
      claim_started_at: c ? c.started_at : null, claim_owner: c ? c.result_ref : null, claim_live: c && parse(c.started_at) > w.now - 600000 ? 1 : 0, lease_until: fmt(w.now + 600000),
      due_now: !j.next_attempt_at || parse(j.next_attempt_at) <= w.now ? 1 : 0 });
  };
  return (name) => {
    if (name === "poll") {
      const c = claim();
      const due = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA"].indexOf(j.job_status) >= 0 && (!j.lease_expires_at || parse(j.lease_expires_at) <= w.now)
        && (!j.next_attempt_at || parse(j.next_attempt_at) <= w.now) && (!c || parse(c.started_at) <= w.now - 600000);
      return due ? [withClaim(row())] : [{ db_now: fmt(w.now), id: null }];
    }
    if (name === "tick") return [withClaim(row())];
    if (name === "final") return [{ id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner, error_code: j.error_code, error_message: j.error_message, ia_id: IAID }];
    if (["own", "prepBack", "mid", "pubBack", "split", "pub2Back"].indexOf(name) >= 0) return [row()];
    return undefined;
  };
}

function tick(w) {
  const ws = workerSql(w);
  // one Engine: the worker's sql nodes (IW) answered here, the COMMIT's (IAC) by world.js
  const e = new Engine({ dir: X.OUT, db: null, mocks: { sql: null, read: {} } });
  const inner = W.__internals(w);
  e.db = inner.db;
  e.mocks.sql = new Proxy({}, { get: (_, id) => (text) => {
    if (/^sql_node_IW/.test(String(id))) {
      const r = ws(String(id).replace(/^sql_node_IW/, ""));
      if (r === undefined) throw new Error("no worker SQL mock for " + id);
      return r;
    }
    return inner.sql[id](text);
  } });
  e.uuidN = (w.runNo = (w.runNo || 0) + 1) * 2 ** 40;
  const run0 = e.run.bind(e);
  e.run = (name, params) => {
    if (name === "IA_V2_WORKER" || name === "IA_V2_COMMIT") {
      if (name === "IA_V2_COMMIT") w.commitRuns = (w.commitRuns || 0) + 1;
      return run0(name, params);
    }
    if (name === "IA_V2_PREPARE") {
      assert.strictEqual(w.job.job_status, "VALIDATING");
      Object.assign(w.job, { job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready to commit", row_version: w.job.row_version + 1 });
      w.prepares = (w.prepares || 0) + 1;
      return { returned: { job_id: JOB, job_status: "READY_TO_COMMIT", result_code: "", result_message: "prepared", evidence: "{}" }, ctx: {} };
    }
    if (name === "INVENTORY_BULK_APPLY") return { returned: W.engineCall(w, params), ctx: {} };
    throw new Error("unexpected call " + name);
  };
  try {
    return { out: e.run("IA_V2_WORKER", { job_id: "" }).returned, err: null };
  } catch (x) {
    return { out: null, err: x.message };
  }
}
const queued = (c, o) => {
  const w = world(c, o);
  Object.assign(w.job, { job_status: "QUEUED", progress_percent: 0, progress_message: "Queued for processing", lease_owner: null, lease_expires_at: null, row_version: 0 });
  return w;
};

{
  const c = X.makeCase({ batch: true });
  const w = queued(c);
  // one stock call per worker run (prod 10-26): tick 1 = PREPARE + COMMIT A (op 1), PARK; tick 2 = COMMIT B (op 2)
  let r = tick(w);
  ok(!r.err && r.out.worker_route === "WORKED" && w.prepares === 1 && w.commitRuns === 1 && w.job.job_status === "COMMITTING_IA" && w.job.lease_owner === null &&
    w.job.progress_percent === 75 && w.engine.applied["IAC|" + JOB + "|I"] === 1 && w.engine.applied["IAC|" + JOB + "|R"] === undefined,
  "tick 1: PREPARE + COMMIT A (op 1 only), PARKed at 75 for the next run", { r, prepares: w.prepares, commits: w.commitRuns, job: w.job });
  w.now += 2000;
  r = tick(w);
  ok(!r.err && r.out.worker_route === "WORKED" && r.out.job_status === "COMPLETED" && r.out.ia_id === IAID && w.prepares === 1 && w.commitRuns === 2, "tick 2: COMMIT B (op 2) -> COMPLETED",
    { r, prepares: w.prepares, commits: w.commitRuns });
  ok(w.ia.item_assembly_status === "Completed" && w.engine.applied["IAC|" + JOB + "|I"] === 1 && w.engine.applied["IAC|" + JOB + "|R"] === 1 && liveBatches(w).length === 1
    && w.job.progress_percent === 100 && w.job.lease_owner === null, "the IA Completed, both operations once, one Batch row", w.job);
  ok(w.steps.some((s) => s.job_id === JOB && s.step_name === "W0_CLAIM_0"), "the worker's claim row");
  ok(tick(w).out.worker_route === "IDLE", "the next tick is idle");
  console.log("ok   e2e: two worker ticks complete a 12-pick batch IA (one stock call each)");
}
{
  const c = X.makeCase({ lines: 501, picks: 2, nonStock: 1 });
  const w = queued(c);
  let r = tick(w);
  ok(!r.err && w.commitRuns === 1 && w.job.job_status === "COMMITTING_IA" && w.job.lease_owner === null && w.job.progress_percent === 75 && w.engine.applied["IAC|" + JOB + "|R"] === undefined,
    "PARK: tick 1 = PREPARE + COMMIT A (1,002 picks issued), op 2 not yet", { job: w.job, commits: w.commitRuns });
  w.now += 2000;
  r = tick(w);
  ok(!r.err && w.commitRuns === 2 && w.prepares === 1 && w.job.job_status === "COMPLETED" && w.engine.applied["IAC|" + JOB + "|R"] === 1, "PARK: tick 2 = COMMIT B -> COMPLETED", { job: w.job });
  console.log("ok   e2e: PARK at 1,002 picks, phase B on the next tick");
}
{
  const c = X.makeCase({ batch: true });
  const w = queued(c, { faults: { ["IAC|" + JOB + "|I|APPLY"]: ["400"] } });
  const r = tick(w);
  ok(!r.err && r.out.job_status === "FAILED" && w.job.error_code === "IA_INVENTORY_INSUFFICIENT" && w.ia.item_assembly_status === "Draft" && liveBatches(w).length === 0 && w.commitRuns === 1,
    "I2 400 inside the tick: COMMIT wrote FAILED + Draft + the Batch row removed; the worker wrote nothing more", { out: r.out, job: w.job });
  console.log("ok   e2e: a refused issue -> FAILED + Draft in one tick");
}
{
  // the COMMIT run dies right after op 1 (inside the tick): the whole tick dies; 11 minutes later the dead lease is resumed
  const c = X.makeCase({});
  const w = queued(c);
  // the writes of the tick: the claim row, the worker's lease, COMMIT's lease claim, I0 DONE, op 1 -> die right after op 1
  w.crashAfter = 5;
  let r = tick(w);
  ok(r.err && /crash right after/.test(r.err), "the tick died with its COMMIT run", r.err);
  const what = w.crashed;
  w.crashAfter = 0;
  w.now += 11 * 60000;
  r = tick(w);
  ok(!r.err && w.job.job_status === "COMMITTING_IA" && w.job.progress_percent === 75 && w.job.lease_owner === null && w.engine.applied["IAC|" + JOB + "|I"] === 1 &&
    w.engine.applied["IAC|" + JOB + "|R"] === undefined, "after a crash at '" + what + "' the next tick resumes op 1 (replayed once) and PARKs", { job: w.job, applied: w.engine.applied });
  w.now += 2000;
  r = tick(w);
  ok(!r.err && w.job.job_status === "COMPLETED" && w.engine.applied["IAC|" + JOB + "|I"] === 1 && w.engine.applied["IAC|" + JOB + "|R"] === 1 && w.ia.item_assembly_status === "Completed",
    "... and the tick after it receives -> COMPLETED, each operation once", { job: w.job, applied: w.engine.applied });
  ok(/engine APPLY IAC\|[0-9]+\|I$/.test(String(what)) && opCalls(w, "I").length === 2, "the crash came right after op 1; the resume replayed it (REPLAYED)", { what, calls: opCalls(w, "I").length });
  console.log("ok   e2e: a COMMIT crash inside the tick -> the next tick resumes (" + what + ")");
}
console.log(checks + " checks passed");
