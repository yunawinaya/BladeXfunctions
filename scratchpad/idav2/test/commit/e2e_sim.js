// node test/commit/e2e_sim.js - the BUILT IDA_V2_WORKER driving the BUILT IDA_V2_COMMIT (nested on one interpreter, as the platform nests
// them) against world.js (INVENTORY_BULK_APPLY = the deployed planner); IDA_V2_PREPARE is the only stand-in (VALIDATING -> READY_TO_COMMIT,
// lease kept, the manifest already stored). One tick: claim -> PREPARE -> COMMIT A (SPLIT) -> COMMIT B -> COMPLETED; PARK above 1,000
// receipts (tick 2 runs phase B); a D2 refusal -> FAILED + Draft + our Batch rows removed, the worker writes nothing more; a COMMIT run that
// dies inside the tick kills the tick, the next tick (lease expired) resumes it.
const path = require("path");
const W = require("./world.js");
const { assert, X, J, fmt, parse, world, liveBatches, stepNames, opCalls } = W;
X.utc8(__filename);
const { Engine } = require(path.join(__dirname, "../../lib/sim/engine.js"));
const { JOB, IDAID, ORG } = X;
let checks = 0;
const ok = (cond, what, extra) => { checks++; assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 900))); };
const MIX = [{ kind: "none" }, { kind: "typed", number: "LOT-7", item: 50 }, { kind: "typed", number: "LOT-7", item: 50 }, { kind: "auto" }, { kind: "ns" }, { kind: "nsauto" }, { kind: "auto", alt: true }];

// the worker's SQL over the world's one job (the CONTRACT section 8 reads: poll, tick, the job read-backs, final)
function workerSql(w) {
  const j = w.job;
  const lk = () => W.latestLock(w);
  const idaCol = () => (!w.ida.is_deleted && w.ida.item_disassembly_status === "Processing" && lk() && lk().result_ref === j.idempotency_key ? IDAID : "0");
  const prev = () => { try { const p = JSON.parse(j.request_payload).prevStatus; return p === undefined ? null : p; } catch (e) { return null; } };
  const claim = () => w.steps.find((s) => s.job_id === JOB && s.step_name === "W0_CLAIM_" + j.row_version) || null;
  const liveT = (t) => (t && parse(t) > w.now ? 1 : 0);
  const row = () => ({ db_now: fmt(w.now), id: j.id, job_status: j.job_status, progress_percent: j.progress_percent, progress_message: j.progress_message, attempt_count: j.attempt_count,
    next_attempt_at: j.next_attempt_at, lease_owner: j.lease_owner, lease_expires_at: j.lease_expires_at, lease_live: liveT(j.lease_expires_at), row_version: j.row_version, error_code: j.error_code,
    error_message: j.error_message, error_details: j.error_details, line_count: j.line_count, ida_id: idaCol(), prev_status: prev(), finished_at: j.finished_at });
  const withClaim = (r) => {
    const c = claim();
    return Object.assign(r, { organization_id: ORG, dead_lease: j.lease_owner && j.lease_expires_at && parse(j.lease_expires_at) <= w.now ? 1 : 0, claim_id: c ? c.id : null,
      claim_started_at: c ? c.started_at : null, claim_owner: c ? c.result_ref : null, claim_live: c && parse(c.started_at) > w.now - 600000 ? 1 : 0, lease_until: fmt(w.now + 600000),
      due_now: !j.next_attempt_at || parse(j.next_attempt_at) <= w.now ? 1 : 0 });
  };
  return (name) => {
    if (name === "poll") {
      const c = claim();
      const due = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"].indexOf(j.job_status) >= 0 && (!j.lease_expires_at || parse(j.lease_expires_at) <= w.now)
        && (!j.next_attempt_at || parse(j.next_attempt_at) <= w.now) && (!c || parse(c.started_at) <= w.now - 600000);
      return due ? [withClaim(row())] : [{ db_now: fmt(w.now), id: null }];
    }
    if (name === "tick") return [withClaim(row())];
    if (name === "final" || name === "stopFinal") return [{ id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner, error_code: j.error_code, error_message: j.error_message, ida_id: IDAID }];
    if (["own", "prepBack", "mid", "pubBack", "split", "pub2Back"].indexOf(name) >= 0) return [row()];
    return undefined;
  };
}

// one tick = one request chain: every run in it (the worker + the nested COMMITs) counted - node outputs + injected code / SQL texts
class TickEngine extends Engine {
  record(n, ctx, data) {
    this.outBytes = (this.outBytes || 0) + JSON.stringify(data === undefined ? null : data).length;
    return super.record(n, ctx, data);
  }
  node(n, ctx) {
    const d = n.data || {};
    try {
      if (n.type === "code-node") this.inBytes = (this.inBytes || 0) + this.injectJs(d.script.code, ctx).length;
      else if (n.type === "sql-node") this.inBytes = (this.inBytes || 0) + this.injectRaw(d.script.code, ctx).length;
    } catch (x) {
      /* a reference not resolvable yet: the node itself reports it */
    }
    return super.node(n, ctx);
  }
}
function tick(w) {
  const ws = workerSql(w);
  // one Engine: the worker's sql nodes (DW) answered here, the COMMIT's (DC) by world.js
  const e = new TickEngine({ dir: X.OUT, db: null, mocks: { sql: null, read: {} } });
  w.lastTick = e;
  const inner = W.__internals(w);
  e.db = inner.db;
  e.mocks.sql = new Proxy({}, { get: (_, id) => (text) => {
    if (/^sql_node_DW/.test(String(id))) {
      const r = ws(String(id).replace(/^sql_node_DW/, ""));
      if (r === undefined) throw new Error("no worker SQL mock for " + id);
      return r;
    }
    return inner.sql[id](text);
  } });
  e.uuidN = (w.runNo = (w.runNo || 0) + 1) * 2 ** 40;
  const run0 = e.run.bind(e);
  e.run = (name, params) => {
    if (name === "IDA_V2_WORKER" || name === "IDA_V2_COMMIT") {
      if (name === "IDA_V2_COMMIT") w.commitRuns = (w.commitRuns || 0) + 1;
      return run0(name, params);
    }
    if (name === "IDA_V2_PREPARE") {
      assert.strictEqual(w.job.job_status, "VALIDATING");
      Object.assign(w.job, { job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready to commit", row_version: w.job.row_version + 1 });
      w.prepares = (w.prepares || 0) + 1;
      return { returned: { job_id: JOB, job_status: "READY_TO_COMMIT", result_code: "", result_message: "prepared", evidence: "{}" }, ctx: {} };
    }
    if (name === "INVENTORY_BULK_APPLY") return { returned: W.engineCall(w, params), ctx: {} };
    throw new Error("unexpected call " + name);
  };
  try {
    return { out: e.run("IDA_V2_WORKER", { job_id: "" }).returned, err: null };
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
  const c = X.makeCase({ lines: MIX });
  const w = queued(c);
  const r = tick(w);
  ok(!r.err && r.out.worker_route === "WORKED" && r.out.job_status === "COMPLETED" && r.out.ida_id === IDAID && w.prepares === 1 && w.commitRuns === 2, "one tick: PREPARE, COMMIT A (SPLIT), COMMIT B -> COMPLETED",
    { r, prepares: w.prepares, commits: w.commitRuns });
  ok(w.ida.item_disassembly_status === "Completed" && w.engine.applied["IDC|" + JOB + "|I"] === 1 && w.engine.applied["IDC|" + JOB + "|R"] === 1 && liveBatches(w).length === 3
    && w.job.progress_percent === 100 && w.job.lease_owner === null && J(w.lines.map((l) => l.batch_number)) === J(["-", "LOT-7", "LOT-7", "Batch-00631", "-", "Batch-00632", "Batch-00633"]),
    "the IDA Completed, both operations once, three Batch rows, the AUTO numbers in the lines", w.job);
  ok(w.steps.some((s) => s.job_id === JOB && s.step_name === "W0_CLAIM_0"), "the worker's claim row");
  ok(tick(w).out.worker_route === "IDLE", "the next tick is idle");
  console.log("ok   e2e: one worker tick completes a mixed 7-line IDA (2 COMMIT runs)");
}
{
  const c = X.makeCase({ n: 1001 });
  const w = queued(c);
  let r = tick(w);
  ok(!r.err && w.commitRuns === 1 && w.job.job_status === "COMMITTING_IDA" && w.job.lease_owner === null && w.job.progress_percent === 75 && w.engine.applied["IDC|" + JOB + "|R"] === undefined,
    "PARK: tick 1 = PREPARE + COMMIT A (1,001 receipts planned), op 2 not yet", { job: w.job, commits: w.commitRuns });
  w.now += 2000;
  r = tick(w);
  ok(!r.err && w.commitRuns === 2 && w.prepares === 1 && w.job.job_status === "COMPLETED" && w.engine.applied["IDC|" + JOB + "|R"] === 1, "PARK: tick 2 = COMMIT B -> COMPLETED", { job: w.job });
  console.log("ok   e2e: PARK at 1,001 receipts, phase B on the next tick");
}
{
  const c = X.makeCase({ lines: MIX });
  const w = queued(c, { faults: { ["IDC|" + JOB + "|I|APPLY"]: ["400"] } });
  const r = tick(w);
  ok(!r.err && r.out.job_status === "FAILED" && w.job.error_code === "IDA_INVENTORY_INSUFFICIENT" && w.ida.item_disassembly_status === "Draft" && liveBatches(w).length === 0 && w.commitRuns === 1
    && w.batchDeletes.length === 3 && w.violations.length === 0, "D2 400 inside the tick: COMMIT wrote FAILED + Draft + our Batch rows removed; the worker wrote nothing more", { out: r.out, job: w.job });
  console.log("ok   e2e: a refused issue -> FAILED + Draft + Batch rows removed in one tick");
}
// the chain budget (controller ruling 10-21): above 2,000 moves the tick ends right after PREPARE; COMMIT A and B take the next two ticks
const mb = (b) => (b / 1048576).toFixed(1);
for (const n of [2000, 4999]) {
  const c = X.makeCase({ n: n, pattern: (i) => (i % 3 === 0 ? { kind: "auto", item: i } : i % 3 === 1 ? { kind: "typed", number: "T-" + Math.ceil(i / 6), item: 10000 + Math.ceil(i / 6) } : { kind: "none" }) });
  const w = queued(c);
  const moves = c.lines.length + c.picks.length;
  ok(w.job.line_count === moves, "the job's line_count = its moves (" + moves + ")");
  const ticks = [];
  let r = tick(w);
  ticks.push(w.lastTick);
  ok(!r.err && w.prepares === 1 && !w.commitRuns && w.job.job_status === "READY_TO_COMMIT" && w.job.lease_owner === null && w.job.next_attempt_at === fmt(w.now) && JSON.parse(r.out.evidence).path === "PREPARED",
    moves + " moves, tick 1: PREPARE alone (READY_TO_COMMIT, no lease, due now)", { out: r.out, job: w.job });
  w.now += 15000;
  r = tick(w);
  ticks.push(w.lastTick);
  ok(!r.err && w.commitRuns === 1 && w.job.job_status === "COMMITTING_IDA" && w.job.lease_owner === null && w.engine.applied["IDC|" + JOB + "|I"] === 1 && !w.engine.applied["IDC|" + JOB + "|R"],
    moves + " moves, tick 2: COMMIT A alone (PARK)", { job: w.job, commits: w.commitRuns });
  w.now += 15000;
  r = tick(w);
  ticks.push(w.lastTick);
  ok(!r.err && w.commitRuns === 2 && w.prepares === 1 && w.job.job_status === "COMPLETED" && w.ida.item_disassembly_status === "Completed" && w.engine.applied["IDC|" + JOB + "|R"] === 1,
    moves + " moves, tick 3: COMMIT B -> COMPLETED", { job: w.job });
  ok(ticks.every((x) => (x.outBytes || 0) + (x.inBytes || 0) <= 35 * 1048576), moves + " moves: every tick's chain (worker + COMMIT, without PREPARE) <= 35 MB", ticks.map((x) => mb((x.outBytes || 0) + (x.inBytes || 0))));
  console.log("ok   e2e chain budget, " + moves + " moves: PREPARE / COMMIT A / COMMIT B in three ticks; per tick (worker + nested COMMIT, outputs + inputs): "
    + ticks.map((x, i) => "tick " + (i + 1) + " " + mb((x.outBytes || 0) + (x.inBytes || 0)) + " MB").join(", ") + " (+ PREPARE's own data in tick 1)");
}
{
  // 2,000 moves: unchanged - PREPARE and COMMIT A in one tick (A PARKs: op 2 holds 1,999 > 1,000), B on the next
  const c = X.makeCase({ n: 1999 });
  const w = queued(c);
  let r = tick(w);
  ok(!r.err && w.prepares === 1 && w.commitRuns === 1 && w.job.job_status === "COMMITTING_IDA" && w.job.line_count === 2000, "2,000 moves, tick 1: PREPARE + COMMIT A (unchanged)", { job: w.job, commits: w.commitRuns });
  w.now += 2000;
  r = tick(w);
  ok(!r.err && w.commitRuns === 2 && w.job.job_status === "COMPLETED", "2,000 moves, tick 2: COMMIT B -> COMPLETED", { job: w.job });
  console.log("ok   e2e: 2,000 moves unchanged (PREPARE + COMMIT A, then B)");
}
{
  // the COMMIT run dies right after op 1 (inside the tick): the whole tick dies; when the job-sized lease is over the next tick resumes it
  const c = X.makeCase({ lines: MIX });
  const w = queued(c);
  // the writes of the tick: the claim row, the worker's lease, COMMIT's lease claim, D0 DONE, the intent, the config, the Batch insert, D1 DONE, op 1
  w.crashAfter = 9;
  let r = tick(w);
  ok(r.err && /crash right after/.test(r.err) && /engine APPLY IDC\|[0-9]+\|I$/.test(String(w.crashed)), "the tick died with its COMMIT run right after op 1", { err: r.err, what: w.crashed });
  w.crashAfter = 0;
  w.now += 5 * 60000;
  r = tick(w);
  ok(!r.err && r.out.worker_route === "IDLE", "the lease is still live 5 minutes later: nothing to do", r.out);
  w.now = parse(w.job.lease_expires_at) + 1000;
  r = tick(w);
  ok(!r.err && w.job.job_status === "COMPLETED" && w.engine.applied["IDC|" + JOB + "|I"] === 1 && w.engine.applied["IDC|" + JOB + "|R"] === 1 && w.ida.item_disassembly_status === "Completed"
    && opCalls(w, "I").length === 2 && liveBatches(w).length === 3, "after the job-sized lease the next tick resumes to COMPLETED, op 1 replayed (REPLAYED), each operation applied once", { job: w.job, applied: w.engine.applied });
  console.log("ok   e2e: a COMMIT crash inside the tick -> the next tick after the lease resumes (" + w.crashed + ")");
}
console.log(checks + " checks passed");
