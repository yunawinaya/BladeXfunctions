// node test/commit/worker_sim.js - the BUILT SA_V2_WORKER on the interpreter (lib/sim/engine.js): its SQL answered from an
// in-memory gd_async_job / gd_publish_step / stock_adjustment, SA_V2_PREPARE and SA_V2_COMMIT mocked by their job-row effects
// (the worker never trusts an answer: it reads the job back). Scenarios: idle poll; QUEUED -> claim -> PREPARE -> COMMIT A
// (SPLIT) -> COMMIT B in one tick; PARK -> the next tick resumes phase B; PREPARE hard code -> FAILED + unlock (Draft / Cancelled);
// unknown prevStatus -> REQUIRES_REVIEW without unlock; dead lease exhausted; a silent PREPARE -> counted retry; job_id drives one
// job only; a live claim row / live lease is skipped.
const assert = require("assert");
const path = require("path");
const { Engine } = require(path.join(__dirname, "../../lib/sim/engine.js"));
const X = require("./fixture.js");

const fmt = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString().slice(0, 19).replace("T", " "));
const parse = (t) => (t ? Date.parse(String(t).replace(" ", "T") + "Z") : null);
const J = (o) => JSON.stringify(o);
let checks = 0;
const ok = (cond, what, extra) => { checks++; assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 700))); };
const ORG = X.ORG;
const SA1 = "2111100000000000101", SA2 = "2111100000000000102";
const JOB1 = "2111100000000000011", JOB2 = "2111100000000000012";

function world() {
  const w = { now: Date.UTC(2026, 9, 16, 2, 0, 0), seq: 2114000000000000000n, jobs: {}, steps: [], sa: {}, calls: [], prepare: {}, commit: {}, unlocks: [] };
  w.id = () => (w.seq += 1n).toString();
  return w;
}
function addJob(w, jobId, saId, o) {
  const opt = Object.assign({ status: "QUEUED", prevStatus: "Draft", source: "FORM", action: "COMPLETE", key: "SA:" + ORG + ":" + saId + ":k:1" }, o || {});
  w.jobs[jobId] = { id: jobId, organization_id: ORG, command: "COMPLETE_SA", job_status: opt.status, progress_percent: 0, progress_message: "Queued for processing", attempt_count: opt.attempts || 0,
    next_attempt_at: opt.nextAt === undefined ? null : opt.nextAt, lease_owner: opt.leaseOwner || null, lease_expires_at: opt.leaseUntil || null, row_version: opt.rv || 0, error_code: null,
    error_message: null, error_details: null, finished_at: null, idempotency_key: opt.key, correlation_id: "SA|" + saId,
    request_payload: J({ v: 1, source: opt.source, action: opt.action, prevStatus: opt.prevStatus, saId: saId }), create_time: w.now - 60000 + Object.keys(w.jobs).length, is_deleted: 0 };
  w.sa[saId] = { id: saId, stock_adjustment_status: "Processing", sa_v2_job_id: jobId };
  w.steps.push({ id: w.id(), job_id: "SAC|" + saId, step_name: "LOCK|1", step_status: "LOCK", result_ref: opt.key, started_at: fmt(w.now - 60000), is_deleted: 0 });
  return w.jobs[jobId];
}
const saOf = (j) => j.correlation_id.slice(3);
const saIdCol = (w, j) => {
  const sa = w.sa[saOf(j)];
  const lk = w.steps.filter((s) => s.job_id === "SAC|" + saOf(j) && s.step_name.indexOf("LOCK|") === 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
  return sa && sa.stock_adjustment_status === "Processing" && lk && lk.result_ref === j.idempotency_key ? saOf(j) : "0";
};
const prevOf = (j) => { try { const p = JSON.parse(j.request_payload).prevStatus; return p === undefined ? null : p; } catch (e) { return null; } };
const claimOf = (w, j) => w.steps.find((s) => !s.is_deleted && s.job_id === j.id && s.step_name === "W0_CLAIM_" + j.row_version) || null;
const live = (t, now) => (t && parse(t) > now ? 1 : 0);
const dead = (j, now) => (j.lease_owner && j.lease_expires_at && parse(j.lease_expires_at) <= now ? 1 : 0);

function sqlMocks(w) {
  const wjob = (j) => ({ db_now: fmt(w.now), id: j.id, job_status: j.job_status, progress_percent: j.progress_percent, progress_message: j.progress_message, attempt_count: j.attempt_count,
    next_attempt_at: j.next_attempt_at, lease_owner: j.lease_owner, lease_expires_at: j.lease_expires_at, lease_live: live(j.lease_expires_at, w.now), row_version: j.row_version,
    error_code: j.error_code, error_message: j.error_message, error_details: j.error_details, sa_id: saIdCol(w, j), prev_status: prevOf(j), finished_at: j.finished_at });
  const idsIn = (text) => (text.match(/j\.id IN \(([0-9, ]+)\)/) || [, ""])[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "0");
  return new Proxy({}, {
    get: (_, id) => (text) => {
      const name = String(id).replace(/^sql_node_SW/, "");
      if (name === "poll") {
        const only = (text.match(/\(([0-9]+) = 0 OR j\.id = /) || [, "0"])[1];
        const due = Object.values(w.jobs).filter((j) => !j.is_deleted && j.command === "COMPLETE_SA" && (only === "0" || j.id === only)
          && ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_SA"].indexOf(j.job_status) >= 0 && (!j.lease_expires_at || parse(j.lease_expires_at) <= w.now)
          && (!j.next_attempt_at || parse(j.next_attempt_at) <= w.now) && (!claimOf(w, j) || parse(claimOf(w, j).started_at) <= w.now - 600000))
          .sort((a, b) => a.create_time - b.create_time || (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).slice(0, 5);
        if (!due.length) return [{ db_now: fmt(w.now), id: null }];
        return due.map((j) => {
          const c = claimOf(w, j);
          return Object.assign(wjob(j), { organization_id: j.organization_id, dead_lease: dead(j, w.now), claim_id: c ? c.id : null, claim_started_at: c ? c.started_at : null, claim_owner: c ? c.result_ref : null });
        });
      }
      if (name === "tick") {
        return idsIn(text).filter((i) => w.jobs[i]).map((i) => {
          const j = w.jobs[i];
          const c = claimOf(w, j);
          return Object.assign(wjob(j), { lease_until: fmt(w.now + 600000), organization_id: j.organization_id, dead_lease: dead(j, w.now), due_now: !j.next_attempt_at || parse(j.next_attempt_at) <= w.now ? 1 : 0,
            claim_id: c ? c.id : null, claim_started_at: c ? c.started_at : null, claim_owner: c ? c.result_ref : null, claim_live: c && parse(c.started_at) > w.now - 600000 ? 1 : 0 });
        });
      }
      if (name === "final") return idsIn(text).filter((i) => w.jobs[i]).map((i) => { const j = w.jobs[i]; return { id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner, error_code: j.error_code, error_message: j.error_message, sa_id: saOf(j) }; });
      const one = (text.match(/AND j\.id = ([0-9]+)/) || [])[1];
      if (["own", "prepBack", "mid", "pubBack", "split", "pub2Back"].indexOf(name) >= 0) return one && w.jobs[one] ? [wjob(w.jobs[one])] : [{ db_now: fmt(w.now), id: null }];
      throw new Error("no SQL mock for " + id);
    },
  });
}
function dbOf(w) {
  return {
    tenantId: "000000",
    insert(table, rows) {
      assert.strictEqual(table, "GD Publish Step");
      for (const r of rows) {
        if (w.steps.some((s) => !s.is_deleted && s.job_id === r.job_id && s.step_name === r.step_name)) throw new Error("Duplicate entry for key 'Job Step' " + r.step_name);
        w.steps.push(Object.assign({ id: w.id(), is_deleted: 0 }, r));
      }
      return rows;
    },
    update(table, rows) {
      for (const r0 of rows) {
        const r = Object.assign({}, r0);
        const id = String(r.__id);
        delete r.__id;
        if (table === "GD Async Job") Object.assign(w.jobs[id], r, { id: id });
        else if (table === "Stock Adjustment") {
          assert.deepStrictEqual(Object.keys(r).sort(), ["id", "stock_adjustment_status"], "an unlock writes { id, stock_adjustment_status } only");
          w.sa[id].stock_adjustment_status = r.stock_adjustment_status;
          w.unlocks.push(id + ":" + r.stock_adjustment_status);
        } else throw new Error("unexpected update of " + table);
      }
      return rows.length;
    },
  };
}
// PREPARE / COMMIT stand-ins: what the real ones do to the job row (CONTRACT section 9), selected per job
function callee(w, name, params) {
  const j = w.jobs[params.job_id];
  w.calls.push(name.replace("SA_V2_", "") + ":" + params.job_id);
  const answer = (o) => ({ returned: Object.assign({ job_id: j.id, job_status: j.job_status, result_code: "", result_message: "" }, o || {}), ctx: {} });
  if (name === "SA_V2_PREPARE") {
    const mode = w.prepare[j.id] || "ok";
    if (mode === "ok") {
      Object.assign(j, { job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready", row_version: j.row_version + 1 });
      return answer({ evidence: "{}" });
    }
    if (mode === "hard") return answer({ result_code: "SA_LINES_CHANGED", result_message: "The Stock Adjustment's lines changed while it was waiting" });
    if (mode === "park" || mode === "park-same-rv") {
      // PREPARE above 1,000 entries (controller ruling): READY_TO_COMMIT, lease cleared, due now, no retry counted
      Object.assign(j, { job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Prepared; the stock moves on the next tick", lease_owner: null, lease_expires_at: null,
        next_attempt_at: fmt(w.now), row_version: mode === "park" ? j.row_version + 1 : j.row_version });
      return answer({ evidence: "{}" });
    }
    return { returned: {}, ctx: {} };
  }
  if (name === "SA_V2_COMMIT") {
    const mode = w.commit[j.id] || "split";
    if (j.job_status === "READY_TO_COMMIT" || (j.job_status === "COMMITTING_SA" && !w.phaseB[j.id])) {
      w.phaseB[j.id] = true;
      if (mode === "park") Object.assign(j, { job_status: "COMMITTING_SA", progress_percent: 80, attempt_count: 0, lease_owner: null, lease_expires_at: null, next_attempt_at: fmt(w.now), row_version: j.row_version + 3 });
      else Object.assign(j, { job_status: "COMMITTING_SA", progress_percent: 80, attempt_count: 0, lease_owner: "SPLIT|" + w.id(), lease_expires_at: fmt(w.now + 600000), next_attempt_at: null, row_version: j.row_version + 3 });
      return answer({ path: mode === "park" ? "PARK" : "SPLIT" });
    }
    Object.assign(j, { job_status: "COMPLETED", progress_percent: 100, lease_owner: null, lease_expires_at: null, finished_at: fmt(w.now), row_version: j.row_version + 3 });
    w.sa[saOf(j)].stock_adjustment_status = "Completed";
    return answer({ path: "DONE" });
  }
  throw new Error("unexpected call " + name);
}
let runNo = 0;
function tick(w, jobId) {
  w.phaseB = w.phaseB || {};
  const e = new Engine({ dir: X.OUT, db: dbOf(w), mocks: { sql: sqlMocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 40;
  const run0 = e.run.bind(e);
  e.run = (name, params) => (name === "SA_V2_WORKER" ? run0(name, params) : callee(w, name, params));
  const r = e.run("SA_V2_WORKER", { job_id: jobId || "" });
  return r.returned;
}

// 1. idle
{
  const w = world();
  const r = tick(w);
  ok(r.worker_route === "IDLE" && r.processed === "0" && w.calls.length === 0, "an empty poll answers IDLE", r);
  console.log("ok   idle poll");
}
// 2. QUEUED -> claim -> PREPARE -> COMMIT A (SPLIT) -> COMMIT B, one tick
{
  const w = world();
  addJob(w, JOB1, SA1);
  const r = tick(w);
  const j = w.jobs[JOB1];
  ok(r.worker_route === "WORKED" && r.processed === "1" && r.job_id === JOB1 && r.job_status === "COMPLETED" && r.sa_id === SA1, "one tick: WORKED, COMPLETED", r);
  ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1, "COMMIT:" + JOB1]), "PREPARE once, COMMIT A then (SPLIT) COMMIT B", w.calls);
  ok(w.steps.some((s) => s.job_id === JOB1 && s.step_name === "W0_CLAIM_0" && /^WRK\|/.test(s.result_ref)), "the claim gate row W0_CLAIM_0 of this run", w.steps);
  ok(j.job_status === "COMPLETED" && w.sa[SA1].stock_adjustment_status === "Completed" && w.unlocks.length === 0, "job COMPLETED, SA Completed, no unlock");
  const again = tick(w);
  ok(again.worker_route === "IDLE" && w.calls.length === 3, "the next tick finds nothing", again);
  console.log("ok   QUEUED -> VALIDATING -> READY_TO_COMMIT -> COMMITTING_SA (SPLIT) -> COMPLETED in one tick");
}
// 3. PARK: the tick ends after COMMIT A; the next tick resumes phase B
{
  const w = world();
  addJob(w, JOB1, SA1);
  w.commit[JOB1] = "park";
  let r = tick(w);
  ok(w.jobs[JOB1].job_status === "COMMITTING_SA" && w.jobs[JOB1].lease_owner === null && J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]) && r.job_status === "COMMITTING_SA",
    "PARK: no second COMMIT call in this tick (no SPLIT| lease)", { calls: w.calls, job: w.jobs[JOB1] });
  w.now += 3000;
  r = tick(w);
  ok(w.jobs[JOB1].job_status === "COMPLETED" && J(w.calls.slice(2)) === J(["COMMIT:" + JOB1]) && r.job_status === "COMPLETED", "PARK: the next tick resumes COMMIT B (no PREPARE)", w.calls);
  ok(w.jobs[JOB1].attempt_count === 0, "PARK: no retry counted", w.jobs[JOB1]);
  console.log("ok   PARK above 1,000 entries: tick 1 ends after COMMIT A, tick 2 runs COMMIT B");
}
// 3b. PARK after PREPARE (above 1,000 entries): the tick ends after PREPARE; the next tick claims READY_TO_COMMIT -> COMMIT A
for (const [mode, commitMode] of [["park", "split"], ["park-same-rv", "split"], ["park", "park"]]) {
  const w = world();
  addJob(w, JOB1, SA1);
  w.prepare[JOB1] = mode;
  w.commit[JOB1] = commitMode;
  let r = tick(w);
  const j = w.jobs[JOB1];
  ok(J(w.calls) === J(["PREPARE:" + JOB1]) && j.job_status === "READY_TO_COMMIT" && j.lease_owner === null && r.job_status === "READY_TO_COMMIT" && j.attempt_count === 0,
    mode + ": tick 1 = PREPARE only, the job parked READY_TO_COMMIT without a lease", { calls: w.calls, job: j, r: r });
  w.now += 1000;
  r = tick(w);
  ok(w.steps.filter((s) => s.job_id === JOB1 && /^W0_CLAIM_/.test(s.step_name)).length === 2 && w.calls.indexOf("PREPARE:" + JOB1, 1) < 0, mode + ": tick 2 claims it again (a new claim row), no second PREPARE",
    { calls: w.calls, steps: w.steps.filter((s) => s.job_id === JOB1) });
  if (commitMode === "split") {
    ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1, "COMMIT:" + JOB1]) && j.job_status === "COMPLETED" && r.job_status === "COMPLETED" && j.attempt_count === 0,
      mode + ": tick 2 = COMMIT A (SPLIT) + COMMIT B -> COMPLETED, no retry counted", { calls: w.calls, job: j });
  } else {
    ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]) && j.job_status === "COMMITTING_SA", "PREPARE park + COMMIT park: tick 2 = COMMIT A only", w.calls);
    w.now += 1000;
    tick(w);
    ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1, "COMMIT:" + JOB1]) && j.job_status === "COMPLETED", "PREPARE park + COMMIT park: tick 3 = COMMIT B -> COMPLETED", w.calls);
  }
}
console.log("ok   PARK after PREPARE: tick 1 PREPARE only; tick 2 claims READY_TO_COMMIT -> COMMIT A (-> B, or PARK again -> tick 3), also when PREPARE keeps row_version");

// 4. PREPARE hard code -> FAILED + unlock (FORM: Draft, REVIEW: Cancelled); unknown prevStatus -> REQUIRES_REVIEW, no unlock
for (const [source, prev, want] of [["FORM", "Draft", "Draft"], ["REVIEW", "Cancelled", "Cancelled"], ["FORM", "In Progress", null], ["FORM", undefined, null]]) {
  const w = world();
  addJob(w, JOB1, SA1, { source: source, action: source === "REVIEW" ? "REVIEW" : "COMPLETE", prevStatus: prev });
  w.prepare[JOB1] = "hard";
  tick(w);
  const j = w.jobs[JOB1];
  if (want) {
    ok(j.job_status === "FAILED" && j.error_code === "SA_LINES_CHANGED" && j.lease_owner === null && w.sa[SA1].stock_adjustment_status === want && J(w.unlocks) === J([SA1 + ":" + want]),
      source + " PREPARE hard code -> FAILED + " + want, { job: j, unlocks: w.unlocks });
    ok(J(w.calls) === J(["PREPARE:" + JOB1]), source + ": no COMMIT after a failed PREPARE", w.calls);
  } else {
    ok(j.job_status === "REQUIRES_REVIEW" && j.error_code === "SA_PREV_STATUS_UNKNOWN" && w.unlocks.length === 0 && w.sa[SA1].stock_adjustment_status === "Processing",
      "prevStatus " + J(prev) + " -> REQUIRES_REVIEW SA_PREV_STATUS_UNKNOWN, no unlock (no default)", { job: j, unlocks: w.unlocks });
  }
}
console.log("ok   PREPARE hard code -> FAILED + Draft (FORM) / Cancelled (REVIEW); prevStatus unknown or missing -> REQUIRES_REVIEW, no unlock");
// 5. a silent PREPARE (no code, job left VALIDATING) -> counted retry with backoff, lease released
{
  const w = world();
  addJob(w, JOB1, SA1);
  w.prepare[JOB1] = "silent";
  tick(w);
  const j = w.jobs[JOB1];
  ok(j.job_status === "VALIDATING" && j.attempt_count === 1 && j.lease_owner === null && j.next_attempt_at === fmt(w.now + 2000) && j.error_code === null && w.unlocks.length === 0,
    "silent PREPARE -> retry 1 after 2 s, lease released", j);
  console.log("ok   a silent PREPARE -> counted retry (2 s), nothing unlocked");
}
// 6. a dead WRK lease, retries exhausted before COMMIT -> FAILED + unlock; COMMITTING_SA exhausted -> REQUIRES_REVIEW, no unlock
{
  const w = world();
  addJob(w, JOB1, SA1, { status: "VALIDATING", attempts: 3, rv: 2, leaseOwner: "WRK|dead", leaseUntil: fmt(w.now - 1000) });
  addJob(w, JOB2, SA2, { status: "COMMITTING_SA", attempts: 3, rv: 7, leaseOwner: "PUB|dead", leaseUntil: fmt(w.now - 1000) });
  const r = tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "SA_TRANSIENT_RETRIES_EXHAUSTED" && w.sa[SA1].stock_adjustment_status === "Draft", "dead lease x3 pre-commit -> FAILED + Draft", w.jobs[JOB1]);
  ok(w.jobs[JOB2].job_status === "REQUIRES_REVIEW" && w.jobs[JOB2].error_code === "SA_RECONCILIATION_MISMATCH" && w.sa[SA2].stock_adjustment_status === "Processing", "dead lease x3 in COMMITTING_SA -> REQUIRES_REVIEW, SA stays Processing", w.jobs[JOB2]);
  ok(w.calls.length === 0 && r.processed === "2", "no callee called for exhausted jobs", { calls: w.calls, r: r });
  console.log("ok   dead lease exhausted: pre-commit FAILED + unlock, COMMITTING_SA REQUIRES_REVIEW");
}
// 7. job_id drives that job only; a live lease / backoff / a job not COMPLETE_SA is left alone
{
  const w = world();
  addJob(w, JOB1, SA1);
  addJob(w, JOB2, SA2);
  let r = tick(w, JOB2);
  ok(r.processed === "1" && r.job_id === JOB2 && w.jobs[JOB2].job_status === "COMPLETED" && w.jobs[JOB1].job_status === "QUEUED", "job_id: only that job", r);
  const w2 = world();
  addJob(w2, JOB1, SA1, { status: "COMMITTING_SA", leaseOwner: "PUB|alive", leaseUntil: fmt(w2.now + 300000) });
  addJob(w2, JOB2, SA2, { nextAt: fmt(w2.now + 60000) });
  w2.jobs[JOB2].command = "COMPLETE_GR";
  r = tick(w2);
  ok(r.worker_route === "IDLE" && w2.calls.length === 0, "live lease / other command -> nothing to do", r);
  console.log("ok   job_id drives one job; live leases and other commands are left alone");
}
// 8. the SA lost its lock (another key on the latest SAC lock): sa_id 0 -> a hard failure releases nothing
{
  const w = world();
  addJob(w, JOB1, SA1);
  w.steps.push({ id: w.id(), job_id: "SAC|" + SA1, step_name: "LOCK|2", step_status: "LOCK", result_ref: "another-key", started_at: fmt(w.now), is_deleted: 0 });
  w.prepare[JOB1] = "hard";
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.unlocks.length === 0 && w.sa[SA1].stock_adjustment_status === "Processing", "not the lock owner -> FAILED, nothing unlocked", { job: w.jobs[JOB1], unlocks: w.unlocks });
  console.log("ok   a job that no longer owns the SA never unlocks it");
}
console.log(checks + " checks passed");
