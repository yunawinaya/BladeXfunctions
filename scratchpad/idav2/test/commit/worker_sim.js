// node test/commit/worker_sim.js - the BUILT IDA_V2_WORKER on the interpreter (lib/sim/engine.js): its SQL answered from an in-memory
// gd_async_job / gd_publish_step / sm_item_disassembly, IDA_V2_PREPARE and IDA_V2_COMMIT played by their job-row effects (the worker never
// trusts an answer: it reads the job back). Scenarios: idle; QUEUED -> claim -> PREPARE -> COMMIT A (SPLIT) -> COMMIT B in one tick; PARK
// -> the next tick resumes phase B; PREPARE hard codes (incl. IDA_BATCH_CONFIG / IDA_BATCH_DUPLICATE) -> FAILED + Draft; prevStatus unknown
// / missing -> REQUIRES_REVIEW without unlock (no default); a silent PREPARE -> counted retry; dead leases exhausted; job_id drives one job;
// live leases, other commands and backoffs are left alone; a lost lock or a soft-deleted IDA never unlocks.
const assert = require("assert");
const path = require("path");
const { Engine } = require(path.join(__dirname, "../../lib/sim/engine.js"));
const X = require("./fixture.js");

const fmt = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString().slice(0, 19).replace("T", " "));
const parse = (t) => (t ? Date.parse(String(t).replace(" ", "T") + "Z") : null);
const J = (o) => JSON.stringify(o);
let checks = 0;
const ok = (cond, what, extra) => { checks++; assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 900))); };
const ORG = X.ORG;
const IDA1 = "2112073133161844801", IDA2 = "2112073133161844802";
const JOB1 = "2112100000000000011", JOB2 = "2112100000000000012";

function world() {
  const w = { now: Date.UTC(2026, 9, 21, 2, 0, 0), seq: 2114000000000000000n, jobs: {}, steps: [], ida: {}, calls: [], prepare: {}, commit: {}, unlocks: [], phaseB: {}, violations: [] };
  w.id = () => (w.seq += 1n).toString();
  return w;
}
function addJob(w, jobId, idaId, o) {
  const opt = Object.assign({ status: "QUEUED", prevStatus: "Draft", key: "IDA:" + ORG + ":" + idaId + ":k:1", command: "COMPLETE_IDA" }, o || {});
  const req = { v: 1, action: "DIRECT", saveAs: "Completed", idaId: idaId };
  if (opt.prevStatus !== undefined) req.prevStatus = opt.prevStatus;
  w.jobs[jobId] = { id: jobId, organization_id: ORG, command: opt.command, job_status: opt.status, progress_percent: 0, progress_message: "Queued for processing", attempt_count: opt.attempts || 0,
    next_attempt_at: opt.nextAt === undefined ? null : opt.nextAt, lease_owner: opt.leaseOwner || null, lease_expires_at: opt.leaseUntil || null, row_version: opt.rv || 0, error_code: null,
    error_message: null, error_details: null, finished_at: null, idempotency_key: opt.key, correlation_id: (opt.corrPrefix || "IDA|") + idaId, request_payload: J(req),
    create_time: w.now - 60000 + Object.keys(w.jobs).length, is_deleted: 0, line_count: opt.moves === undefined ? 7 : opt.moves };
  w.ida[idaId] = { id: idaId, item_disassembly_status: "Processing", ida_v2_job_id: jobId, is_deleted: 0 };
  w.steps.push({ id: w.id(), job_id: "IDC|" + idaId, step_name: "LOCK|1", step_status: "LOCK", result_ref: opt.key, started_at: fmt(w.now - 60000), is_deleted: 0 });
  return w.jobs[jobId];
}
const idaOf = (j) => j.correlation_id.slice(4);
// IDA_LOCK_JOIN as the BUILT SQL says it: the sm_item_disassembly join drops a soft-deleted IDA only when it carries `AND g.is_deleted = 0`
// (CONTRACT section 8, IA ruling 5) - without it a deleted IDA still joins and would read as owned
const joinDropsDeleted = (text) => /LEFT JOIN sm_item_disassembly g[\s\S]*?AND g\.is_deleted = 0[\s\S]*?LEFT JOIN gd_publish_step lk/.test(text);
const idaIdCol = (w, j, text) => {
  if (!/^IDA\|[0-9]{1,20}$/.test(j.correlation_id)) return "0";
  const ida = w.ida[idaOf(j)];
  assert.ok(/LEFT JOIN sm_item_disassembly g/.test(text), "the job read carries IDA_LOCK_JOIN");
  if (ida && ida.is_deleted && joinDropsDeleted(text)) return "0";
  const lk = w.steps.filter((s) => s.job_id === "IDC|" + idaOf(j) && s.step_name.indexOf("LOCK|") === 0).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0];
  return ida && ida.item_disassembly_status === "Processing" && lk && lk.result_ref === j.idempotency_key ? idaOf(j) : "0";
};
const prevOf = (j) => { try { const p = JSON.parse(j.request_payload).prevStatus; return p === undefined ? null : p; } catch (e) { return null; } };
const claimOf = (w, j) => w.steps.find((s) => !s.is_deleted && s.job_id === j.id && s.step_name === "W0_CLAIM_" + j.row_version) || null;
const live = (t, now) => (t && parse(t) > now ? 1 : 0);
const dead = (j, now) => (j.lease_owner && j.lease_expires_at && parse(j.lease_expires_at) <= now ? 1 : 0);

function sqlMocks(w) {
  let text0 = "";
  const wjob = (j) => ({ db_now: fmt(w.now), id: j.id, job_status: j.job_status, progress_percent: j.progress_percent, progress_message: j.progress_message, attempt_count: j.attempt_count,
    next_attempt_at: j.next_attempt_at, lease_owner: j.lease_owner, lease_expires_at: j.lease_expires_at, lease_live: live(j.lease_expires_at, w.now), row_version: j.row_version,
    error_code: j.error_code, error_message: j.error_message, error_details: j.error_details, line_count: j.line_count, ida_id: idaIdCol(w, j, text0), prev_status: prevOf(j), finished_at: j.finished_at });
  const idsIn = (text) => (text.match(/j\.id IN \(([0-9, ]+)\)/) || [, ""])[1].split(",").map((x) => x.trim()).filter((x) => x && x !== "0");
  return new Proxy({}, {
    get: (_, id) => (text) => {
      const name = String(id).replace(/^sql_node_DW/, "");
      text0 = text;
      if (name === "poll") {
        assert.ok(/j\.command = 'COMPLETE_IDA'/.test(text) && /'\^IDA\\\\\|\[0-9\]\{1,20\}\$'/.test(text) && /CONCAT\('IDC\|', SUBSTRING\(j\.correlation_id, 5\)\)/.test(text), "poll SQL: COMPLETE_IDA, IDA| / IDC|, offset 5");
        const only = (text.match(/\(([0-9]+) = 0 OR j\.id = /) || [, "0"])[1];
        const due = Object.values(w.jobs).filter((j) => !j.is_deleted && j.command === "COMPLETE_IDA" && (only === "0" || j.id === only)
          && ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"].indexOf(j.job_status) >= 0 && (!j.lease_expires_at || parse(j.lease_expires_at) <= w.now)
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
      if (name === "final") {
        assert.ok(/SUBSTRING\(j\.correlation_id, 5\) AS ida_id/.test(text), "final read: the IDA id after 'IDA|'");
        return idsIn(text).filter((i) => w.jobs[i]).map((i) => { const j = w.jobs[i]; return { id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner, error_code: j.error_code, error_message: j.error_message, ida_id: idaOf(j) }; });
      }
      const one = (text.match(/AND j\.id = ([0-9]+)/) || [])[1];
      if (name === "prepBack") assert.ok(/j\.line_count,/.test(text), "the read-back after PREPARE carries the job's line_count (moves)");
      if (name === "stopFinal") return idsIn(text).filter((i) => w.jobs[i]).map((i) => { const j = w.jobs[i]; return { id: j.id, job_status: j.job_status, attempt_count: j.attempt_count, lease_owner: j.lease_owner, error_code: j.error_code, error_message: j.error_message, ida_id: idaOf(j) }; });
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
        else if (table === "Item Disassembly") {
          assert.deepStrictEqual(Object.keys(r).sort(), ["id", "item_disassembly_status"], "an unlock writes { id, item_disassembly_status } only");
          if (w.ida[id].is_deleted) w.violations.push("unlocked the soft-deleted IDA " + id + " to " + r.item_disassembly_status);
          if (r.item_disassembly_status !== "Draft") w.violations.push("unlocked to " + r.item_disassembly_status);
          w.ida[id].item_disassembly_status = r.item_disassembly_status;
          w.unlocks.push(id + ":" + r.item_disassembly_status);
        } else throw new Error("unexpected update of " + table);
      }
      return rows.length;
    },
  };
}
// PREPARE / COMMIT stand-ins: what the real ones do to the job row (CONTRACT section 9), selected per job
function callee(w, name, params) {
  const j = w.jobs[params.job_id];
  w.calls.push(name.replace("IDA_V2_", "") + ":" + params.job_id);
  const answer = (o) => ({ returned: Object.assign({ job_id: j.id, job_status: j.job_status, result_code: "", result_message: "" }, o || {}), ctx: {} });
  if (name === "IDA_V2_PREPARE") {
    const mode = w.prepare[j.id] || "ok";
    if (mode === "ok") {
      Object.assign(j, { job_status: "READY_TO_COMMIT", progress_percent: 60, progress_message: "Ready", row_version: j.row_version + 1 });
      return answer({ evidence: "{}" });
    }
    if (mode === "steal") {
      Object.assign(j, { job_status: "READY_TO_COMMIT", progress_percent: 60, lease_owner: "WRK|other", lease_expires_at: fmt(w.now + 600000), row_version: j.row_version + 1 });
      return answer({ evidence: "{}" });
    }
    if (/^IDA_/.test(mode)) return answer({ result_code: mode, result_message: "PREPARE refused: " + mode });
    return { returned: {}, ctx: {} };
  }
  if (name === "IDA_V2_COMMIT") {
    const mode = w.commit[j.id] || "split";
    // COMMIT answered a hard code before writing anything (e.g. its guard refused): the job is still READY_TO_COMMIT
    if (mode === "hard" && j.job_status === "READY_TO_COMMIT") return answer({ result_code: "IDA_INVALID_DATA", result_message: "job_id: digits only" });
    if (j.job_status === "READY_TO_COMMIT" || (j.job_status === "COMMITTING_IDA" && !w.phaseB[j.id])) {
      w.phaseB[j.id] = true;
      if (mode === "park") Object.assign(j, { job_status: "COMMITTING_IDA", progress_percent: 75, attempt_count: 0, lease_owner: null, lease_expires_at: null, next_attempt_at: fmt(w.now), row_version: j.row_version + 3 });
      else Object.assign(j, { job_status: "COMMITTING_IDA", progress_percent: 75, attempt_count: 0, lease_owner: "SPLIT|" + w.id(), lease_expires_at: fmt(w.now + 600000), next_attempt_at: null, row_version: j.row_version + 3 });
      return answer({ path: mode === "park" ? "PARK" : "SPLIT" });
    }
    Object.assign(j, { job_status: "COMPLETED", progress_percent: 100, lease_owner: null, lease_expires_at: null, finished_at: fmt(w.now), row_version: j.row_version + 3 });
    w.ida[idaOf(j)].item_disassembly_status = "Completed";
    return answer({ path: "DONE" });
  }
  throw new Error("unexpected call " + name);
}
let runNo = 0;
function tick(w, jobId) {
  const e = new Engine({ dir: X.OUT, db: dbOf(w), mocks: { sql: sqlMocks(w), read: {} } });
  e.uuidN = ++runNo * 2 ** 40;
  const run0 = e.run.bind(e);
  e.run = (name, params) => (name === "IDA_V2_WORKER" ? run0(name, params) : callee(w, name, params));
  return e.run("IDA_V2_WORKER", { job_id: jobId || "" }).returned;
}

// the built JSON: the callees, the unlock node, no prevStatus default anywhere, the hard codes
{
  const doc = X.built("IDA_V2_WORKER");
  const text = J(doc);
  ok(/IDA_V2_PREPARE:Workflow:2112749086439505922/.test(text) && /IDA_V2_COMMIT:Workflow:2112749139006717954/.test(text) && !/\|\| \\"Draft\\"/.test(text),
    "worker: calls IDA_V2_PREPARE / IDA_V2_COMMIT by their shell ids; no || \"Draft\" anywhere");
  const unl = [];
  const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.type === "update-node" && /Item Disassembly:Table:2106937624568991746/.test(J(n.data.table_id))) unl.push(n); Object.values(n).forEach(walk); } };
  walk(doc);
  ok(unl.length === 4 && unl.every((n) => J(n.data.props.list.map((p) => p.prop)) === J(["id", "item_disassembly_status"])), "worker: 4 unlock nodes, each { id, item_disassembly_status }", unl.map((n) => n.id));
  const joined = [];
  const walkSql = (n) => { if (Array.isArray(n)) n.forEach(walkSql); else if (n && typeof n === "object") { if (n.type === "sql-node" && /LEFT JOIN sm_item_disassembly g/.test(n.data.script.code)) joined.push(n); Object.values(n).forEach(walkSql); } };
  walkSql(doc);
  ok(joined.length === 8 && joined.every((n) => joinDropsDeleted(n.data.script.code)), "worker: all 8 lock-joined reads drop a soft-deleted IDA (ruling 5)", joined.map((n) => n.id));
  const res = doc.response_json.map((r) => r.name);
  ok(J(res) === J(["worker_route", "processed", "jobs", "job_id", "job_status", "result_code", "result_message", "ida_id", "evidence"]), "worker: the CONTRACT section 8 answer", res);
  ok(/"IDA_BATCH_CONFIG", \\"IDA_BATCH_DUPLICATE\\"|IDA_BATCH_CONFIG\\", \\"IDA_BATCH_DUPLICATE/.test(text) && text.indexOf("ida_wrk_") >= 0, "worker: the section 8 hard codes (+ the two batch codes), cache prefix ida_wrk_");
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
  addJob(w, JOB1, IDA1);
  const r = tick(w);
  const j = w.jobs[JOB1];
  ok(r.worker_route === "WORKED" && r.processed === "1" && r.job_id === JOB1 && r.job_status === "COMPLETED" && r.ida_id === IDA1 && JSON.parse(r.jobs)[0].ida_id === IDA1, "one tick: WORKED, COMPLETED", r);
  ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1, "COMMIT:" + JOB1]), "PREPARE once, COMMIT A then (SPLIT) COMMIT B", w.calls);
  ok(w.steps.some((s) => s.job_id === JOB1 && s.step_name === "W0_CLAIM_0" && /^WRK\|/.test(s.result_ref)), "the claim gate row W0_CLAIM_0 of this run", w.steps);
  ok(j.job_status === "COMPLETED" && w.ida[IDA1].item_disassembly_status === "Completed" && w.unlocks.length === 0, "job COMPLETED, IDA Completed, no unlock");
  ok(tick(w).worker_route === "IDLE" && w.calls.length === 3, "the next tick finds nothing");
  console.log("ok   QUEUED -> VALIDATING -> READY_TO_COMMIT -> COMMITTING_IDA (SPLIT) -> COMPLETED in one tick");
}
// 2b. the chain budget (controller ruling 10-21): above 2,000 moves (the job's line_count) the tick ends right after a successful PREPARE
// (READY_TO_COMMIT, lease released, due now); the next kick runs COMMIT A (PARK above 1,000 per leg), the one after it COMMIT B
for (const moves of [2001, 5000]) {
  const w = world();
  addJob(w, JOB1, IDA1, { moves: moves });
  addJob(w, JOB2, IDA2);
  w.commit[JOB1] = "park";
  let r = tick(w);
  const j = w.jobs[JOB1];
  ok(J(w.calls) === J(["PREPARE:" + JOB1]) && j.job_status === "READY_TO_COMMIT" && j.lease_owner === null && j.lease_expires_at === null && j.next_attempt_at === fmt(w.now) && r.worker_route === "WORKED"
    && r.job_status === "READY_TO_COMMIT" && JSON.parse(r.evidence).path === "PREPARED" && w.unlocks.length === 0, moves + " moves, tick 1: PREPARE alone (READY_TO_COMMIT, no lease, due now)", { calls: w.calls, job: j, r });
  ok(w.jobs[JOB2].job_status === "QUEUED" && JSON.parse(r.jobs).length === 2, moves + " moves, tick 1: the tick ended there - the next due job waits for the next tick", w.jobs[JOB2]);
  w.commit[JOB2] = "split";
  r = tick(w, JOB1);
  ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]) && w.jobs[JOB1].job_status === "COMMITTING_IDA" && w.jobs[JOB1].progress_percent === 75, moves + " moves, tick 2: COMMIT A alone (PARK)", w.calls);
  w.now += 3000;
  r = tick(w, JOB1);
  ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1, "COMMIT:" + JOB1]) && w.jobs[JOB1].job_status === "COMPLETED" && r.job_status === "COMPLETED" && w.jobs[JOB1].attempt_count === 0,
    moves + " moves, tick 3: COMMIT B -> COMPLETED (three ticks, no retry counted)", { calls: w.calls, job: w.jobs[JOB1] });
}
{
  // 2,000 moves: unchanged - PREPARE and COMMIT A in the same tick (A PARKs above 1,000 per leg), B on the next
  const w = world();
  addJob(w, JOB1, IDA1, { moves: 2000 });
  w.commit[JOB1] = "park";
  tick(w);
  ok(J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]) && w.jobs[JOB1].job_status === "COMMITTING_IDA", "2,000 moves: PREPARE + COMMIT A in one tick (unchanged)", w.calls);
  w.now += 3000;
  tick(w);
  ok(w.jobs[JOB1].job_status === "COMPLETED" && w.calls.length === 3, "2,000 moves: COMMIT B on the next tick", w.calls);
  // a PREPARE that left a big job READY under ANOTHER run's lease: no write, no stop (the publish check refuses it as before)
  const w2 = world();
  addJob(w2, JOB1, IDA1, { moves: 3000 });
  w2.prepare[JOB1] = "steal";
  tick(w2);
  ok(J(w2.calls) === J(["PREPARE:" + JOB1]) && w2.jobs[JOB1].lease_owner === "WRK|other" && w2.jobs[JOB1].job_status === "READY_TO_COMMIT", "a READY job under another lease: no release written, no COMMIT", w2.jobs[JOB1]);
  console.log("ok   chain budget: above 2,000 moves PREPARE / COMMIT A / COMMIT B in three ticks (the tick ends after PREPARE); 2,000 unchanged");
}
// 3. PARK (a leg above 1,000 movements): the tick ends after COMMIT A; the next tick resumes phase B, no retry counted
{
  const w = world();
  addJob(w, JOB1, IDA1);
  w.commit[JOB1] = "park";
  let r = tick(w);
  ok(w.jobs[JOB1].job_status === "COMMITTING_IDA" && w.jobs[JOB1].lease_owner === null && J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]) && r.job_status === "COMMITTING_IDA",
    "PARK: no second COMMIT call in this tick (no SPLIT| lease)", { calls: w.calls, job: w.jobs[JOB1] });
  w.now += 3000;
  r = tick(w);
  ok(w.jobs[JOB1].job_status === "COMPLETED" && J(w.calls.slice(2)) === J(["COMMIT:" + JOB1]) && r.job_status === "COMPLETED" && w.jobs[JOB1].attempt_count === 0, "PARK: the next tick resumes COMMIT B, no PREPARE, no retry counted", w.calls);
  console.log("ok   PARK: tick 1 ends after COMMIT A, tick 2 runs COMMIT B");
}
// 4. PREPARE hard codes -> FAILED + Draft; prevStatus unknown / missing -> REQUIRES_REVIEW, no unlock
for (const code of ["IDA_LINES_CHANGED", "IDA_BATCH_CONFIG", "IDA_BATCH_DUPLICATE", "IDA_PLAN_SKIPPED", "IDA_NOT_ELIGIBLE"]) {
  const w = world();
  addJob(w, JOB1, IDA1);
  w.prepare[JOB1] = code;
  tick(w);
  const j = w.jobs[JOB1];
  ok(j.job_status === "FAILED" && j.error_code === code && j.lease_owner === null && w.ida[IDA1].item_disassembly_status === "Draft" && J(w.unlocks) === J([IDA1 + ":Draft"]) && J(w.calls) === J(["PREPARE:" + JOB1]),
    "PREPARE hard code " + code + " -> FAILED + Draft at once, no retry, no COMMIT", { job: j, unlocks: w.unlocks });
}
for (const prev of ["Completed", "In Progress", undefined]) {
  const w = world();
  addJob(w, JOB1, IDA1, { prevStatus: prev });
  w.prepare[JOB1] = "IDA_LINES_CHANGED";
  tick(w);
  const j = w.jobs[JOB1];
  ok(j.job_status === "REQUIRES_REVIEW" && j.error_code === "IDA_PREV_STATUS_UNKNOWN" && w.unlocks.length === 0 && w.ida[IDA1].item_disassembly_status === "Processing",
    "prevStatus " + J(prev) + " -> REQUIRES_REVIEW IDA_PREV_STATUS_UNKNOWN, no unlock (no default)", { job: j, unlocks: w.unlocks });
}
// a transient PREPARE code (not hard) -> a counted retry, not a failure
{
  const w = world();
  addJob(w, JOB1, IDA1);
  w.prepare[JOB1] = "IDA_PLAN_FAILED";
  tick(w);
  ok(w.jobs[JOB1].job_status === "VALIDATING" && w.jobs[JOB1].attempt_count === 1 && w.unlocks.length === 0, "PREPARE IDA_PLAN_FAILED left VALIDATING (no write) -> a counted retry", w.jobs[JOB1]);
}
console.log("ok   PREPARE hard codes (incl. the two batch codes) -> FAILED + Draft; prevStatus Completed / In Progress / missing -> REQUIRES_REVIEW, no unlock");
// 5. a silent PREPARE (no code, the job left VALIDATING) -> counted retry with backoff, lease released; exhausted -> FAILED + Draft
{
  const w = world();
  addJob(w, JOB1, IDA1);
  w.prepare[JOB1] = "silent";
  tick(w);
  const j = w.jobs[JOB1];
  ok(j.job_status === "VALIDATING" && j.attempt_count === 1 && j.lease_owner === null && j.next_attempt_at === fmt(w.now + 2000) && w.unlocks.length === 0, "silent PREPARE -> retry 1 after 2 s, lease released", j);
  for (let i = 0; i < 6 && w.jobs[JOB1].job_status === "VALIDATING"; i++) {
    w.now = parse(w.jobs[JOB1].next_attempt_at) + 1000;
    tick(w);
  }
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IDA_TRANSIENT_RETRIES_EXHAUSTED" && w.jobs[JOB1].error_message === X.C.IDA_TEXT.notCompleted && J(w.unlocks) === J([IDA1 + ":Draft"]),
    "silent PREPARE x4 -> FAILED IDA_TRANSIENT_RETRIES_EXHAUSTED + Draft", w.jobs[JOB1]);
  console.log("ok   a silent PREPARE -> counted retries (2 s x 2^n), then FAILED + Draft");
}
// 6. dead leases exhausted: pre-commit -> FAILED + Draft; COMMITTING_IDA -> REQUIRES_REVIEW (the IDA stays Processing)
{
  const w = world();
  addJob(w, JOB1, IDA1, { status: "VALIDATING", attempts: 3, rv: 2, leaseOwner: "WRK|dead", leaseUntil: fmt(w.now - 1000) });
  addJob(w, JOB2, IDA2, { status: "COMMITTING_IDA", attempts: 3, rv: 7, leaseOwner: "PUB|dead", leaseUntil: fmt(w.now - 1000) });
  const r = tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IDA_TRANSIENT_RETRIES_EXHAUSTED" && w.ida[IDA1].item_disassembly_status === "Draft", "dead lease x3 pre-commit -> FAILED + Draft", w.jobs[JOB1]);
  ok(w.jobs[JOB2].job_status === "REQUIRES_REVIEW" && w.jobs[JOB2].error_code === "IDA_RECONCILIATION_MISMATCH" && w.jobs[JOB2].error_message === X.C.IDA_TEXT.review && w.ida[IDA2].item_disassembly_status === "Processing",
    "dead lease x3 in COMMITTING_IDA -> REQUIRES_REVIEW, the IDA stays Processing", w.jobs[JOB2]);
  ok(w.calls.length === 0 && r.processed === "2", "no callee called for exhausted jobs", { calls: w.calls, r: r });
  const w2 = world();
  addJob(w2, JOB1, IDA1, { status: "COMMITTING_IDA", attempts: 0, rv: 7, leaseOwner: "PUB|dead", leaseUntil: fmt(w2.now - 1000) });
  w2.phaseB[JOB1] = true;
  tick(w2);
  ok(w2.jobs[JOB1].job_status === "COMPLETED" && J(w2.calls) === J(["COMMIT:" + JOB1]), "a dead COMMIT run's job is resumed (phase B)", { calls: w2.calls, job: w2.jobs[JOB1] });
  console.log("ok   dead leases: exhausted pre-commit FAILED + Draft, COMMITTING_IDA REQUIRES_REVIEW; a single dead run resumed");
}
// 7. job_id drives one job; a live lease, a backoff, another command and another correlation namespace are left alone
{
  const w = world();
  addJob(w, JOB1, IDA1);
  addJob(w, JOB2, IDA2);
  let r = tick(w, JOB2);
  ok(r.processed === "1" && r.job_id === JOB2 && w.jobs[JOB2].job_status === "COMPLETED" && w.jobs[JOB1].job_status === "QUEUED", "job_id: only that job", r);
  const w2 = world();
  addJob(w2, JOB1, IDA1, { status: "COMMITTING_IDA", leaseOwner: "PUB|alive", leaseUntil: fmt(w2.now + 300000) });
  addJob(w2, JOB2, IDA2, { nextAt: fmt(w2.now + 60000) });
  addJob(w2, "2112100000000000013", "2112073133161844803", { command: "COMPLETE_IA" });
  r = tick(w2);
  ok(r.worker_route === "IDLE" && w2.calls.length === 0, "live lease / backoff / a COMPLETE_IA job -> nothing to do", r);
  console.log("ok   job_id drives one job; live leases, backoffs and other commands are left alone");
}
// 8. the IDA lost its lock (another key on the latest IDC| lock): ida_id 0 -> a hard failure releases nothing
{
  const w = world();
  addJob(w, JOB1, IDA1);
  w.steps.push({ id: w.id(), job_id: "IDC|" + IDA1, step_name: "LOCK|2", step_status: "LOCK", result_ref: "another-key", started_at: fmt(w.now), is_deleted: 0 });
  w.prepare[JOB1] = "IDA_LINES_CHANGED";
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.unlocks.length === 0 && w.ida[IDA1].item_disassembly_status === "Processing", "not the lock owner -> FAILED, nothing unlocked", { job: w.jobs[JOB1], unlocks: w.unlocks });
  console.log("ok   a job that no longer owns the IDA never unlocks it");
}
// 9. ruling 5: the IDA soft-deleted while its job is open reads as NOT owned (ida_id '0'): none of the three unlock paths writes the deleted row
{
  const deletedIda = (w) => { w.ida[IDA1].is_deleted = 1; };
  const quiet = (w, label) => {
    ok(w.unlocks.length === 0 && w.violations.length === 0 && w.ida[IDA1].item_disassembly_status === "Processing" && w.ida[IDA1].is_deleted === 1, label + ": no unlock of the deleted row", { unlocks: w.unlocks, v: w.violations });
  };
  let w = world();
  addJob(w, JOB1, IDA1);
  deletedIda(w);
  w.prepare[JOB1] = "IDA_LINES_CHANGED";
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IDA_LINES_CHANGED" && w.jobs[JOB1].lease_owner === null, "deleted IDA, PREPARE hard code -> FAILED", w.jobs[JOB1]);
  quiet(w, "after_prepare");
  w = world();
  addJob(w, JOB1, IDA1, { status: "VALIDATING", attempts: 3, rv: 2, leaseOwner: "WRK|dead", leaseUntil: fmt(w.now - 1000) });
  deletedIda(w);
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IDA_TRANSIENT_RETRIES_EXHAUSTED" && w.calls.length === 0, "deleted IDA, dead leases x3 pre-commit -> FAILED", w.jobs[JOB1]);
  quiet(w, "claim EXHAUST");
  w = world();
  addJob(w, JOB1, IDA1);
  w.commit[JOB1] = "hard";
  deletedIda(w);
  tick(w);
  ok(w.jobs[JOB1].job_status === "FAILED" && w.jobs[JOB1].error_code === "IDA_INVALID_DATA" && J(w.calls) === J(["PREPARE:" + JOB1, "COMMIT:" + JOB1]), "deleted IDA, COMMIT hard code without a write -> FAILED",
    { job: w.jobs[JOB1], calls: w.calls });
  quiet(w, "after_publish");
  for (const [label, setup] of [["after_prepare", (x) => { x.prepare[JOB1] = "IDA_LINES_CHANGED"; }], ["after_publish", (x) => { x.commit[JOB1] = "hard"; }]]) {
    const v = world();
    addJob(v, JOB1, IDA1);
    setup(v);
    tick(v);
    ok(v.jobs[JOB1].job_status === "FAILED" && J(v.unlocks) === J([IDA1 + ":Draft"]) && v.ida[IDA1].item_disassembly_status === "Draft", "control " + label + ": a live IDA is unlocked to Draft", v.unlocks);
  }
  console.log("ok   ruling 5: a soft-deleted IDA reads as not owned - after_prepare / claim EXHAUST / after_publish write no unlock (a live IDA still does)");
}
console.log(checks + " checks passed");
