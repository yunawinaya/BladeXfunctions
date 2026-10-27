// node test/commit/worker_sim.js - the BUILT IA_V2_WORKER on the interpreter (lib/sim/engine.js): its SQL answered from an
// in-memory gd_async_job / gd_publish_step / sm_item_assembly, IA_V2_PREPARE and IA_V2_COMMIT played by their job-row effects
// (the worker never trusts an answer: it reads the job back). Scenarios: idle; QUEUED -> claim -> PREPARE -> COMMIT A (SPLIT)
// -> COMMIT B in one tick; PARK -> the next tick resumes phase B; PREPARE hard code -> FAILED + Draft; prevStatus unknown /
// missing -> REQUIRES_REVIEW without unlock (no default); a silent PREPARE -> counted retry; dead leases exhausted; job_id
// drives one job; live leases, other commands (REVERT_IA) and backoffs are left alone; a lost lock never unlocks.
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
const IA1 = "2112073133161844801", IA2 = "2112073133161844802";
const JOB1 = "2112100000000000011", JOB2 = "2112100000000000012";

function world() {
  const w = { now: Date.UTC(2026, 9, 20, 2, 0, 0), seq: 2114000000000000000n, jobs: {}, steps: [], ia: {}, calls: [], prepare: {}, commit: {}, unlocks: [], phaseB: {}, violations: [] };
  w.id = () => (w.seq += 1n).toString();
  return w;
}
function addJob(w, jobId, iaId, o) {
  const opt = Object.assign({ status: "QUEUED", prevStatus: "Draft", key: "IA:" + ORG + ":" + iaId + ":k:1", command: "COMPLETE_IA" }, o || {});
  const req = { v: 1, action: "DIRECT", saveAs: "Completed", iaId: iaId };
  if (opt.prevStatus !== undefined) req.prevStatus = opt.prevStatus;
  w.jobs[jobId] = { id: jobId, organization_id: ORG, command: opt.command, job_status: opt.status, progress_percent: 0, progress_message: "Queued for processing", attempt_count: opt.attempts || 0,
    next_attempt_at: opt.nextAt === undefined ? null : opt.nextAt, lease_owner: opt.leaseOwner || null, lease_expires_at: opt.leaseUntil || null, row_version: opt.rv || 0, error_code: null,
    error_message: null, error_details: null, finished_at: null, idempotency_key: opt.key, correlation_id: "IA|" + iaId, request_payload: J(req), create_time: w.now - 60000 + Object.keys(w.jobs).length,
    is_deleted: 0 };
  w.ia[iaId] = { id: iaId, item_assembly_status: "Processing", ia_v2_job_id: jobId, is_deleted: 0 };
  w.steps.push({ id: w.id(), job_id: "IAC|" + iaId, step_name: "LOCK|1", step_status: "LOCK", result_ref: opt.key, started_at: fmt(w.now - 60000), is_deleted: 0 });
  return w.jobs[jobId];
}
const iaOf = (j) => j.correlation_id.slice(3);
// IA_LOCK_JOIN as the BUILT SQL says it: the sm_item_assembly join drops a soft-deleted IA only when it carries
// `AND g.is_deleted = 0` (CONTRACT section 8, ruling 5) - without it a deleted IA still joins and would read as owned
const joinDropsDeleted = (text) => /LEFT JOIN sm_item_assembly g[\s\S]*?AND g\.is_deleted = 0[\s\S]*?LEFT JOIN gd_publish_step lk/.test(text);
const iaIdCol = (w, j, text) => {
  const ia = w.ia[iaOf(j)];
  assert.ok(/LEFT JOIN sm_item_assembly g/.test(text), "the job read carries IA_LOCK_JOIN");
  if (ia && ia.is_deleted && joinDropsDeleted(text)) return "0";
  const lk = w.steps.filter((s) => s.job_id === "IAC|" + iaOf(j) && s.step_name.indexOf("LOCK|") === 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
  return ia && ia.item_assembly_status === "Processing" && lk && lk.result_ref === j.idempotency_key ? iaOf(j) : "0";
};
const prevOf = (j) => { try { const p = JSON.parse(j.request_payload).prevStatus; return p === undefined ? null : p; } catch (e) { return null; } };
const claimOf = (w, j) => w.steps.find((s) => !s.is_deleted && s.job_id === j.id && s.step_name === "W0_CLAIM_" + j.row_version) || null;
const live = (t, now) => (t && parse(t) > now ? 1 : 0);
const dead = (j, now) => (j.lease_owner && j.lease_expires_at && parse(j.lease_expires_at) <= now ? 1 : 0);

function sqlMocks(w) {
  let text0 = "";
  const wjob = (j) => ({ db_now: fmt(w.now), id: j.id, job_status: j.job_status, progress_percent: j.progress_percent, progress_message: j.progress_message, attempt_count: j.attempt_count,
    next_attempt_at: j.next_attempt_at, lease_owner: j.lease_owner, lease_expires_at: j.lease_expires_at, lease_live: live(j.lease_expires_at, w.now), row_version: j.row_version,
    error_code: j.error_code, error_message: j.error_message, error_details: j.error_details, ia_id: iaIdCol(w, j, text0), prev_status: prevOf(j), finished_at: j.finished_at });
  const idsIn = (text) => (text.match(/j\.id IN \(([0-9, ]+)\)/) || [, ""])[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "0");
  return new Proxy({}, {
    get: (_, id) => (text) => {
      const name = String(id).replace(/^sql_node_IW/, "");
      text0 = text;
      if (name === "poll") {
        assert.ok(/j\.command = 'COMPLETE_IA'/.test(text) && /'\^IA\\\\\|\[0-9\]\{1,20\}\$'/.test(text) && /CONCAT\('IAC\|', SUBSTRING\(j\.correlation_id, 4\)\)/.test(text), "poll SQL: COMPLETE_IA, IA| / IAC|");
        const only = (text.match(/\(([0-9]+) = 0 OR j\.id = /) || [, "0"])[1];
        const due = Object.values(w.jobs).filter((j) => !j.is_deleted && j.command === "COMPLETE_IA" && (only === "0" || j.id === only)
          && ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA"].indexOf(j.job_status) >= 0 && (!j.lease_expires_at || parse(j.lease_expires_at) <= w.now)
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
      if (name === "final") return idsIn(text).filter((i) => w.jobs[i]).map((i) => { const j = w.jobs[i]; return { id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner, error_code: j.error_code, error_message: j.error_message, ia_id: iaOf(j) }; });
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
        if (w.steps.some((s) => s.job_id === r.job_id && s.step_name === r.step_name)) throw new Error("Duplicate entry for key 'Job Step' " + r.step_name);
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
        else if (table === "Item Assembly") {
          assert.deepStrictEqual(Object.keys(r).sort(), ["id", "item_assembly_status"], "an unlock writes { id, item_assembly_status } only");
          if (w.ia[id].is_deleted) w.violations.push("unlocked the soft-deleted IA " + id + " to " + r.item_assembly_status);
          w.ia[id].item_assembly_status = r.item_assembly_status;
          w.unlocks.push(id + ":" + r.item_assembly_status);
        } else throw new Error("unexpected update of " + table);
      }
      return rows.length;
    },
  };
}
// PREPARE / COMMIT stand-ins: what the real ones do to the job row (CONTRACT section 9), selected per job
function callee(w, name, params) {
  const j = w.jobs[params.job_id];
  w.calls.push(name.replace("IA_V2_", "") + ":" + params.job_id);
  const answer = (o) => ({ returned: Object.assign({ job_id: j.id, job_status: j.job_status, result_code: "", result_message: "" }, o || {}), ctx: {} });
  if (name === "IA_V2_PREPARE") {
    const mode = w.prepare[j.id] || "ok";
    if (mode === "ok") {
      Object.assign(j, { job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready", row_version: j.row_version + 1 });
      return answer({ evidence: "{}" });
    }
    if (mode === "hard") return answer({ result_code: "IA_LINES_CHANGED", result_message: "The Item Assembly's lines changed while it was waiting" });
    return { returned: {}, ctx: {} };
  }
  if (name === "IA_V2_COMMIT") {
    const mode = w.commit[j.id] || "split";
    // COMMIT answered a hard code before writing anything (e.g. its guard refused): the job is still READY_TO_COMMIT
    if (mode === "hard" && j.job_status === "READY_TO_COMMIT") return answer({ result_code: "IA_INVALID_DATA", result_message: "job_id: digits only" });
    if (j.job_status === "READY_TO_COMMIT" || (j.job_status === "COMMITTING_IA" && !w.phaseB[j.id])) {
      w.phaseB[j.id] = true;
      if (mode === "park") Object.assign(j, { job_status: "COMMITTING_IA", progress_percent: 75, attempt_count: 0, lease_owner: null, lease_expires_at: null, next_attempt_at: fmt(w.now), row_version: j.row_version + 3 });
      else Object.assign(j, { job_status: "COMMITTING_IA", progress_percent: 75, attempt_count: 0, lease_owner: "SPLIT|" + w.id(), lease_expires_at: fmt(w.now + 600000), next_attempt_at: null, row_version: j.row_version + 3 });
      return answer({ path: mode === "park" ? "PARK" : "SPLIT" });
    }
    Object.assign(j, { job_status: "COMPLETED", progress_percent: 100, lease_owner: null, lease_expires_at: null, finished_at: fmt(w.now), row_version: j.row_version + 3 });
    w.ia[iaOf(j)].item_assembly_status = "Completed";
    return answer({ path: "DONE" });
  }
  throw new Error("unexpected call " + name);
}
let runNo = 0;
function tick(w, jobId) {
  const e = new Engine({ dir: X.OUT, db: dbOf(w), mocks: { sql: sqlMocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 40;
  const run0 = e.run.bind(e);
  e.run = (name, params) => (name === "IA_V2_WORKER" ? run0(name, params) : callee(w, name, params));
  return e.run("IA_V2_WORKER", { job_id: jobId || "" }).returned;
}

// the built JSON: the callees, the unlock node, no prevStatus default anywhere
{
  const doc = X.built("IA_V2_WORKER");
  const text = J(doc);
  ok(/IA_V2_PREPARE:Workflow:/.test(text) && /IA_V2_COMMIT:Workflow:/.test(text) && !/\|\| \\"Draft\\"/.test(text), "worker: calls IA_V2_PREPARE / IA_V2_COMMIT; no || \"Draft\" anywhere");
  const unl = [];
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "update-node" && /Item Assembly:Table:/.test(J(n.data.table_id))) unl.push(n); Object.values(n).forEach(walk); } };
  walk(doc);
  ok(unl.length === 4 && unl.every((n) => J(n.data.props.list.map((p) => p.prop)) === J(["id", "item_assembly_status"])), "worker: 4 unlock nodes, each { id, item_assembly_status }", unl.map((n) => n.id));
  const joined = [];
  const walkSql = (n) => { if (Array.isArray(n)) n.forEach(walkSql); else if (n && typeof n === "object") { if (n.type === "sql-node" && /LEFT JOIN sm_item_assembly g/.test(n.data.script.code)) joined.push(n); Object.values(n).forEach(walkSql); } };
  walkSql(doc);
  ok(joined.length === 8 && joined.every((n) => joinDropsDeleted(n.data.script.code)), "worker: all 8 lock-joined reads drop a soft-deleted IA (ruling 5)", joined.map((n) => n.id));
  const res = doc.response_json.map((r) => r.name);
  ok(J(res) === J(["worker_route", "processed", "jobs", "job_id", "job_status", "result_code", "result_message", "ia_id", "evidence"]), "worker: the CONTRACT section 8 answer", res);
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
  addJob(w, JOB1, IA1);
  const r = tick(w);
  const j = w.jobs[JOB1];
  ok(r.worker_route === "WORKED" && r.processed === "1" && r.job_id === JOB1 && r.job_status === "COMPLETED" && r.ia_id === IA1 && JSON.parse(r.jobs)[0].ia_id === IA1, "one tick: WORKED, COMPLETED", r);
  ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1, "COMMIT:" + JOB1]), "PREPARE once, COMMIT A then (SPLIT) COMMIT B", w.calls);
  ok(w.steps.some((s) => s.job_id === JOB1 && s.step_name === "W0_CLAIM_0" && /^WRK\|/.test(s.result_ref)), "the claim gate row W0_CLAIM_0 of this run", w.steps);
  ok(j.job_status === "COMPLETED" && w.ia[IA1].item_assembly_status === "Completed" && w.unlocks.length === 0, "job COMPLETED, IA Completed, no unlock");
  ok(tick(w).worker_route === "IDLE" && w.calls.length === 3, "the next tick finds nothing");
  console.log("ok   QUEUED -> VALIDATING -> READY_TO_COMMIT -> COMMITTING_IA (SPLIT) -> COMPLETED in one tick");
}
// 3. PARK (> 1,000 picks): the tick ends after COMMIT A; the next tick resumes phase B, no retry counted
{
  const w = world();
  addJob(w, JOB1, IA1);
  w.commit[JOB1] = "park";
  let r = tick(w);
  ok(w.jobs[JOB1].job_status === "COMMITTING_IA" && w.jobs[JOB1].lease_owner === null && J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]) && r.job_status === "COMMITTING_IA",
    "PARK: no second COMMIT call in this tick (no SPLIT| lease)", { calls: w.calls, job: w.jobs[JOB1] });
  w.now += 3000;
  r = tick(w);
  ok(w.jobs[JOB1].job_status === "COMPLETED" && J(w.calls.slice(2)) === J(["COMMIT:" + JOB1]) && r.job_status === "COMPLETED" && w.jobs[JOB1].attempt_count === 0, "PARK: the next tick resumes COMMIT B, no PREPARE, no retry counted", w.calls);
  console.log("ok   PARK: tick 1 ends after COMMIT A, tick 2 runs COMMIT B");
}
// 4. PREPARE hard code -> FAILED + Draft; prevStatus unknown / missing -> REQUIRES_REVIEW, no unlock
// RES-01 Created (BA, 10-22): a Created IA's job unlocks back to Created
for (const [prev, want] of [["Draft", "Draft"], ["Created", "Created"], ["Completed", null], ["In Progress", null], [undefined, null]]) {
  const w = world();
  addJob(w, JOB1, IA1, { prevStatus: prev });
  w.prepare[JOB1] = "hard";
  tick(w);
  const j = w.jobs[JOB1];
  if (want) {
    ok(j.job_status === "FAILED" && j.error_code === "IA_LINES_CHANGED" && j.lease_owner === null && w.ia[IA1].item_assembly_status === want && J(w.unlocks) === J([IA1 + ":" + want]) && J(w.calls) === J(["PREPARE:" + JOB1]),
      "PREPARE hard code -> FAILED + " + want + ", no COMMIT", { job: j, unlocks: w.unlocks });
  } else {
    ok(j.job_status === "REQUIRES_REVIEW" && j.error_code === "IA_PREV_STATUS_UNKNOWN" && w.unlocks.length === 0 && w.ia[IA1].item_assembly_status === "Processing",
      "prevStatus " + J(prev) + " -> REQUIRES_REVIEW IA_PREV_STATUS_UNKNOWN, no unlock (no default)", { job: j, unlocks: w.unlocks });
  }
}
console.log("ok   PREPARE hard code -> FAILED + Draft; prevStatus Completed / In Progress / missing -> REQUIRES_REVIEW, no unlock");
// 5. a silent PREPARE (no code, the job left VALIDATING) -> counted retry with backoff, lease released
{
  const w = world();
  addJob(w, JOB1, IA1);
  w.prepare[JOB1] = "silent";
  tick(w);
  const j = w.jobs[JOB1];
  ok(j.job_status === "VALIDATING" && j.attempt_count === 1 && j.lease_owner === null && j.next_attempt_at === fmt(w.now + 2000) && w.unlocks.length === 0, "silent PREPARE -> retry 1 after 2 s, lease released", j);
  console.log("ok   a silent PREPARE -> counted retry (2 s), nothing unlocked");
}
// 6. dead leases exhausted: pre-commit -> FAILED + Draft; COMMITTING_IA -> REQUIRES_REVIEW (the IA stays Processing)
{
  const w = world();
  addJob(w, JOB1, IA1, { status: "VALIDATING", attempts: 3, rv: 2, leaseOwner: "WRK|dead", leaseUntil: fmt(w.now - 1000) });
  addJob(w, JOB2, IA2, { status: "COMMITTING_IA", attempts: 3, rv: 7, leaseOwner: "PUB|dead", leaseUntil: fmt(w.now - 1000) });
  const r = tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IA_TRANSIENT_RETRIES_EXHAUSTED" && w.ia[IA1].item_assembly_status === "Draft", "dead lease x3 pre-commit -> FAILED + Draft", w.jobs[JOB1]);
  ok(w.jobs[JOB2].job_status === "REQUIRES_REVIEW" && w.jobs[JOB2].error_code === "IA_RECONCILIATION_MISMATCH" && w.jobs[JOB2].error_message === X.C.IA_TEXT.review && w.ia[IA2].item_assembly_status === "Processing",
    "dead lease x3 in COMMITTING_IA -> REQUIRES_REVIEW, the IA stays Processing", w.jobs[JOB2]);
  ok(w.calls.length === 0 && r.processed === "2", "no callee called for exhausted jobs", { calls: w.calls, r: r });
  // a dead COMMIT run (lease expired, 1 attempt) is resumed, counted once
  const w2 = world();
  addJob(w2, JOB1, IA1, { status: "COMMITTING_IA", attempts: 0, rv: 7, leaseOwner: "PUB|dead", leaseUntil: fmt(w2.now - 1000) });
  w2.phaseB[JOB1] = true;
  tick(w2);
  ok(w2.jobs[JOB1].job_status === "COMPLETED" && J(w2.calls) === J(["COMMIT:" + JOB1]), "a dead COMMIT run's job is resumed (phase B)", { calls: w2.calls, job: w2.jobs[JOB1] });
  console.log("ok   dead leases: exhausted pre-commit FAILED + Draft, COMMITTING_IA REQUIRES_REVIEW; a single dead run resumed");
}
// 7. job_id drives one job; a live lease, a backoff, another command (REVERT_IA of the same IA namespace) are left alone
{
  const w = world();
  addJob(w, JOB1, IA1);
  addJob(w, JOB2, IA2);
  let r = tick(w, JOB2);
  ok(r.processed === "1" && r.job_id === JOB2 && w.jobs[JOB2].job_status === "COMPLETED" && w.jobs[JOB1].job_status === "QUEUED", "job_id: only that job", r);
  const w2 = world();
  addJob(w2, JOB1, IA1, { status: "COMMITTING_IA", leaseOwner: "PUB|alive", leaseUntil: fmt(w2.now + 300000) });
  addJob(w2, JOB2, IA2, { nextAt: fmt(w2.now + 60000) });
  addJob(w2, "2112100000000000013", "2112073133161844803", { command: "REVERT_IA", prevStatus: "Completed" });
  r = tick(w2);
  ok(r.worker_route === "IDLE" && w2.calls.length === 0, "live lease / backoff / a REVERT_IA job -> nothing to do", r);
  console.log("ok   job_id drives one job; live leases, backoffs and REVERT_IA jobs are left alone");
}
// 8. the IA lost its lock (another key on the latest IAC| lock): ia_id 0 -> a hard failure releases nothing
{
  const w = world();
  addJob(w, JOB1, IA1);
  w.steps.push({ id: w.id(), job_id: "IAC|" + IA1, step_name: "LOCK|2", step_status: "LOCK", result_ref: "another-key", started_at: fmt(w.now), is_deleted: 0 });
  w.prepare[JOB1] = "hard";
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.unlocks.length === 0 && w.ia[IA1].item_assembly_status === "Processing", "not the lock owner -> FAILED, nothing unlocked", { job: w.jobs[JOB1], unlocks: w.unlocks });
  console.log("ok   a job that no longer owns the IA never unlocks it");
}
// 9. ruling 5: the IA soft-deleted (an old mobile client's delete) while its job is open reads as NOT owned (ia_id '0'), so
// none of the worker's three unlock paths writes a status onto the deleted row
{
  const deletedIa = (w) => { w.ia[IA1].is_deleted = 1; };
  const quiet = (w, label) => {
    ok(w.unlocks.length === 0 && w.violations.length === 0 && w.ia[IA1].item_assembly_status === "Processing" && w.ia[IA1].is_deleted === 1, label + ": no unlock of the deleted row", { unlocks: w.unlocks, v: w.violations });
  };
  // a) PREPARE answers a hard code and leaves the job VALIDATING (after_prepare's unlock)
  let w = world();
  addJob(w, JOB1, IA1);
  deletedIa(w);
  w.prepare[JOB1] = "hard";
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IA_LINES_CHANGED" && w.jobs[JOB1].lease_owner === null, "deleted IA, PREPARE hard code -> FAILED", w.jobs[JOB1]);
  quiet(w, "after_prepare");
  // b) the runs died 3 times before COMMIT (claim's EXHAUST unlock)
  w = world();
  addJob(w, JOB1, IA1, { status: "VALIDATING", attempts: 3, rv: 2, leaseOwner: "WRK|dead", leaseUntil: fmt(w.now - 1000) });
  deletedIa(w);
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IA_TRANSIENT_RETRIES_EXHAUSTED" && w.calls.length === 0, "deleted IA, dead leases x3 pre-commit -> FAILED", w.jobs[JOB1]);
  quiet(w, "claim EXHAUST");
  // c) COMMIT answers a hard code before writing (after_publish's unlock)
  w = world();
  addJob(w, JOB1, IA1);
  w.commit[JOB1] = "hard";
  deletedIa(w);
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IA_INVALID_DATA" && J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]),
    "deleted IA, COMMIT hard code without a write -> FAILED", { job: w.jobs[JOB1], calls: w.calls });
  quiet(w, "after_publish");
  // control: the same three paths on a live IA DO unlock it (the filter drops only deleted rows)
  for (const [label, setup] of [["after_prepare", (x) => { x.prepare[JOB1] = "hard"; }], ["after_publish", (x) => { x.commit[JOB1] = "hard"; }]]) {
    const v = world();
    addJob(v, JOB1, IA1);
    setup(v);
    tick(v);
    ok(v.jobs[JOB1].job_status === "FAILED" && J(v.unlocks) === J([IA1 + ":Draft"]) && v.ia[IA1].item_assembly_status === "Draft", "control " + label + ": a live IA is unlocked to Draft", v.unlocks);
  }
  const v = world();
  addJob(v, JOB1, IA1, { status: "VALIDATING", attempts: 3, rv: 2, leaseOwner: "WRK|dead", leaseUntil: fmt(v.now - 1000) });
  tick(v);
  ok(J(v.unlocks) === J([IA1 + ":Draft"]), "control claim EXHAUST: a live IA is unlocked to Draft", v.unlocks);
  console.log("ok   ruling 5: a soft-deleted IA reads as not owned - after_prepare / claim EXHAUST / after_publish write no unlock (a live IA still does)");
}
// one stock call per run (prod 10-26: a lock lives until the top-level run ends): after an iteration that called IA_V2_COMMIT the run
// takes no further job; the next one goes to the next run
{
  const w = world();
  addJob(w, JOB1, IA1);
  addJob(w, JOB2, IA2);
  w.commit[JOB1] = "park";
  w.commit[JOB2] = "park";
  let r = tick(w);
  ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]) && w.jobs[JOB2].job_status === "QUEUED", "two due jobs: this run's one COMMIT call, the second job left for the next run",
    { calls: w.calls, job2: w.jobs[JOB2].job_status });
  w.now += 3000;
  r = tick(w);
  ok(J(w.calls.slice(2)) === J(["COMMIT:" + JOB1]) && w.jobs[JOB1].job_status === "COMPLETED" && w.jobs[JOB2].job_status === "QUEUED",
    "the next run: the parked job's phase B (its one COMMIT call), still nothing for the second", w.calls);
  w.now += 3000;
  r = tick(w);
  ok(J(w.calls.slice(3)) === J(["PREPARE:" + JOB2, "COMMIT:" + JOB2]), "then the second job, one COMMIT call", w.calls);
  // a PREPARE-only iteration (refused before any COMMIT) does not end the run: the next job still runs
  const v = world();
  addJob(v, JOB1, IA1);
  addJob(v, JOB2, IA2);
  v.prepare[JOB1] = "hard";
  v.commit[JOB2] = "park";
  tick(v);
  ok(J(v.calls) === J(["PREPARE:" + JOB1, "PREPARE:" + JOB2, "COMMIT:" + JOB2]), "a job refused in PREPARE (no stock call) lets the run take the next job", v.calls);
  console.log("ok   one COMMIT call per run: the second due job and a parked phase B go to later runs");
}
console.log(checks + " checks passed");
