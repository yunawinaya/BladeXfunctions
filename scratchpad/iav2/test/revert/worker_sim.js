// node test/revert/worker_sim.js - the BUILT IA_REVERT_V2_SUBMIT and IA_REVERT_V2_WORKER on the interpreter (the worker calls the
// built PREPARE / COMMIT on the same interpreter) against an engine-completed IA (_scen.js). SUBMIT: QUEUED (lock, job, IA
// Processing, due), NOT_ELIGIBLE (min_picks, serial), STOP (refusals, too big, split), BUSY, STATUS, STALE, INVALID, the read-back
// failing -> STOP 500. WORKER: SUBMIT -> one tick (claim, PREPARE, COMMIT A SPLIT, COMMIT B) -> COMPLETED and reverted; a poll
// takes REVERT_IA jobs only; PREPARE's run dying 4 times -> FAILED + the IA back to Completed; a SOFT-DELETED IA (CONTRACT.md
// ruling 5) -> no worker / PREPARE path writes a status onto it.
const assert = require("assert");
const S = require("./_scen");
const { runWorkflow } = require("./_world");
const J = (o) => JSON.stringify(o);
let checks = 0;
const ok = (cond, what, extra) => {
  checks++;
  assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 900)));
};
const submit = (z, o) => runWorkflow(z.w, "IA_REVERT_V2_SUBMIT", Object.assign({ operation: "SUBMIT", ia_id: z.ia.id, idempotency_key: z.key, source: "LIST", min_picks: "0",
  form: Object.assign({}, z.row) }, o || {}));
const worker = (z, jobId) => runWorkflow(z.w, "IA_REVERT_V2_WORKER", { job_id: jobId || "" });
const revertJob = (z) => z.w.jobs.filter((j) => j.command === "REVERT_IA").sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0] || null;

// ---------------------------------------------------------------- SUBMIT
{
  let z = S.completed({});
  let r = submit(z);
  const j = revertJob(z);
  const lk = z.w.latestLock(z.ia.id);
  ok(!r.err && r.out.route === "QUEUED" && r.out.code === "200" && r.out.job_id === j.id && r.out.ia_id === z.ia.id && r.out.ia_no === z.ia.stock_movement_no && r.out.line_count === "3"
    && r.out.terminal === "NO" && r.out.action === "REVERT", "SUBMIT QUEUED (3 live rows)", r);
  ok(j.job_status === "QUEUED" && j.next_attempt_at === z.w.now && j.correlation_id === "IA|" + z.ia.id && j.causation_id === z.ia.id && j.line_count === 3 && j.plant_id === S.PLANT,
    "SUBMIT: the REVERT_IA job, made due after the read-back", j);
  const req = JSON.parse(j.request_payload);
  ok(req.action === "REVERT" && req.prevStatus === "Completed" && req.liveRows === 3 && req.liveOut === 2 && req.liveIn === 1 && /^IM1:4:/.test(req.movesFingerprint) === false && /^IM1:3:/.test(req.movesFingerprint)
    && req.source === "LIST", "SUBMIT: the request payload (prevStatus Completed, live rows, IM1)", req);
  ok(lk.step_name === "LOCK|2" && lk.result_ref === z.key && z.w.ia(z.ia.id).item_assembly_status === "Processing" && z.w.ia(z.ia.id).ia_v2_job_id === j.id,
    "SUBMIT: LOCK|2 (after the completion's LOCK|1) with the key, the IA Processing under the job", { lk: lk, ia: z.w.ia(z.ia.id) });
  r = submit(z);
  ok(r.out.route === "STATUS" && r.out.job_id === j.id && r.out.job_status === "QUEUED", "SUBMIT again with the same key -> its STATUS", r.out);
  r = submit(z, { idempotency_key: "IAV:" + S.ORG + ":" + z.ia.id + ":click02", form: Object.assign({}, z.row, { item_assembly_status: "Processing" }) });
  ok(r.out.route === "BUSY" && r.out.code === "409" && r.out.error_code === "IA_RV_BUSY" && r.out.job_id === j.id, "SUBMIT with another key while the job is open -> BUSY (the open job's fields)", r.out);
  r = submit(z, { operation: "STATUS", idempotency_key: "", form: {} });
  ok(r.out.route === "STATUS" && r.out.job_id === j.id && r.out.action === "REVERT", "STATUS: the IA's latest job", r.out);
  z = S.completed({});
  r = submit(z, { min_picks: "50" });
  ok(r.out.route === "NOT_ELIGIBLE" && r.out.code === "300" && r.out.reason === "classic" && !revertJob(z) && z.w.ia(z.ia.id).item_assembly_status === "Completed" && z.w.writes.length === 0,
    "SUBMIT: 3 live rows <= min_picks 50 -> NOT_ELIGIBLE classic, nothing written", r.out);
  z = S.completed({});
  r = submit(z, { operation: "STATUS", idempotency_key: "", form: {} });
  ok(r.out.route === "STATUS" && r.out.action === "DIRECT" && r.out.job_status === "COMPLETED", "STATUS before any revert: the completion's job (either command)", r.out);
  z = S.completed({});
  z.w.ia(z.ia.id).item_assembly_status = "Draft";
  r = submit(z);
  ok(r.out.route === "STALE" && r.out.code === "409" && r.out.error_code === "IA_RV_STALE" && z.w.writes.length === 0, "SUBMIT: the row says Completed, the IA is Draft -> STALE", r.out);
  r = submit(z, { form: Object.assign({}, z.row, { item_assembly_status: "Draft" }) });
  ok(r.out.route === "STOP" && r.out.code === "400" && r.out.error_code === "IA_RV_REFUSED" && r.out.message === "Only Completed Item Assembly can be reverted (this one is Draft)." && z.w.writes.length === 0,
    "SUBMIT: a Draft IA -> STOP 400 with the classic's text", r.out);
  z = S.completed({});
  z.w.ia(z.ia.id).posted_status = "Posted";
  r = submit(z);
  ok(r.out.route === "STOP" && r.out.message === "This Item Assembly has been posted to accounting and cannot be reverted.", "SUBMIT: posted -> STOP with the classic's text", r.out);
  z = S.completed({ comps: [{ qty: 1, layers: [[5, 1]], serial: true }] });
  r = submit(z);
  ok(r.out.route === "NOT_ELIGIBLE" && r.out.reason === "serial numbers", "SUBMIT: a serial-numbered component -> NOT_ELIGIBLE (the classic takes it)", r.out);
  // fix wave R1: the classic's cap counts picks; a serial IA completed with exactly 250 picks (251 rows) stays the classic's and reverts
  z = S.completed({ manyComps: 250 });
  z.w.items[z.comps[0].it.id].serial = true;
  r = submit(z, { min_picks: "50" });
  ok(r.out.route === "NOT_ELIGIBLE" && r.out.reason === "serial numbers" && !revertJob(z) && z.w.writes.length === 0, "R1 SUBMIT: serial, 250 picks (251 live rows) -> NOT_ELIGIBLE (classic)", r.out);
  const cl = runWorkflow(z.w, "IA_REVERT", { ia_id: z.ia.id, ia_no: z.ia.stock_movement_no, organization_id: S.ORG });
  ok(!cl.err && cl.out.code === "200" && z.w.ia(z.ia.id).item_assembly_status === "Draft", "R1: ... and the classic IA_REVERT v5 reverts it (Draft)", cl.out || cl.err);
  z = S.completed({ manyComps: 251 });
  z.w.items[z.comps[0].it.id].serial = true;
  r = submit(z);
  ok(r.out.route === "STOP" && r.out.error_code === "IA_RV_TOO_BIG" && /252 stock movements/.test(r.out.message) && /at most 250/.test(r.out.message), "SUBMIT: serial, 251 picks (252 rows) -> STOP IA_RV_TOO_BIG", r.out);
  z = S.completed({ manyComps: 5000 });
  r = submit(z);
  ok(r.out.route === "STOP" && r.out.error_code === "IA_RV_SPLIT_REQUIRED" && /5001 stock movements/.test(r.out.message), "SUBMIT: 5,001 live rows -> STOP IA_RV_SPLIT_REQUIRED", r.out);
  z = S.completed({});
  z.w.dropIaWrites = true;
  r = submit(z);
  ok(r.out.route === "STOP" && r.out.code === "500" && r.out.error_code === "IA_RV_QUEUE_FAILED" && revertJob(z).next_attempt_at > z.w.now, "SUBMIT: the IA write did not land -> STOP 500, the job not made due", r.out);
  z = S.completed({});
  r = submit(z, { ia_id: "x" });
  ok(r.out.route === "INVALID" && r.out.code === "400", "SUBMIT: a bad ia_id -> INVALID", r.out);
  console.log("ok   SUBMIT: QUEUED (LOCK|n+1, job, Processing, due) / STATUS / BUSY / NOT_ELIGIBLE (min_picks, serial) / STALE / STOP (refused, too big, split) / STOP 500 / INVALID");
}

// ---------------------------------------------------------------- WORKER: one stock call per run (prod 10-26: a lock lives until the top-level run ends)
{
  const doc = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2", "IA_REVERT_V2_WORKER.json"), "utf8"));
  const all = [];
  const walk = (ns) => (ns || []).forEach((n) => {
    all.push(n);
    walk(n.blocks);
  });
  walk(doc.nodes);
  // the revert worker's ids: RW -> IVW (build_revert WRENAMES)
  const next = all.filter((n) => n.id === "code_node_IVWnext")[0];
  const idx = all.filter((n) => n.id === "set_cache_IVWidxN")[0];
  ok(!!next && /\{\{node:code_node_IVWmid\.data\.route\}\}/.test(next.data.script.code) && /called \? 9999 : next/.test(next.data.script.code) && !!idx &&
    /code_node_IVWnext\.data\.nextIndex/.test(J(idx.data)), "WORKER: after an iteration that called IA_REVERT_V2_COMMIT the loop index goes past the plan (one stock call per run)",
  next ? next.data.script.code : "no code_node_IVWnext");
}
// ---------------------------------------------------------------- WORKER: one tick end to end
{
  const z = S.completed({});
  const s = submit(z);
  const j = revertJob(z);
  // one lock call per worker run: tick 1 = claim, PREPARE, COMMIT A (V1, PARK); tick 2 = COMMIT B (V2 .. V4)
  const t1 = worker(z, j.id);
  ok(!t1.err && t1.out.worker_route === "WORKED" && t1.out.job_status === "COMMITTING_REVERT", "WORKER: tick 1 -> V1 done, PARKed", { s: s.out, t: t1.out, err: t1.err });
  const t = worker(z, j.id);
  ok(!t.err && t.out.worker_route === "WORKED" && t.out.processed === "1" && t.out.job_status === "COMPLETED" && t.out.ia_id === z.ia.id, "WORKER: tick 2 -> COMPLETED", { t: t.out, err: t.err });
  const ia = z.w.ia(z.ia.id);
  ok(ia.item_assembly_status === "Draft" && ia.posted_status === "", "WORKER: the IA Draft", ia);
  const after = S.snapshot(z.w);
  for (const c of z.comps) ok(J(after[c.it.id]) === J(z.before[c.it.id]), "WORKER: component " + c.it.material_code + " back", { b: z.before[c.it.id], a: after[c.it.id] });
  ok(after[z.parent.id].qty === 0 && after[z.parent.id].fifoQty === 0, "WORKER: the assembled item taken back, its layer removed", after[z.parent.id]);
  ok(z.w.violations.length === 0 && z.w.locks.every((l) => Number(l.free_token) === 1 && !l.owner_operation_id), "WORKER: the ordering rule held, every lock given back", z.w.locks);
  const jobs = JSON.parse(t.out.jobs);
  ok(jobs.length === 1 && jobs[0].before === "COMMITTING_REVERT" && jobs[0].job_status === "COMPLETED", "WORKER: its jobs answer", jobs);
  console.log("ok   WORKER: SUBMIT -> tick 1 (claim, PREPARE, COMMIT A, PARK), tick 2 (COMMIT B) -> COMPLETED; stock and FIFO back, the IA Draft");
}
{
  // a poll takes only REVERT_IA jobs (the completion's COMPLETED job of the IA is never touched)
  const z = S.completed({});
  submit(z);
  worker(z, "");
  const t = worker(z, "");
  ok(!t.err && t.out.processed === "1" && revertJob(z).job_status === "COMPLETED" && z.w.jobs.find((x) => x.command === "COMPLETE_IA").job_status === "COMPLETED",
    "WORKER poll (two ticks: V1, then V2 .. V4): the REVERT_IA job only", t.out);
  const idle = worker(z, "");
  ok(idle.out.worker_route === "IDLE" && idle.out.processed === "0", "WORKER poll: nothing due -> IDLE", idle.out);
}
// ---------------------------------------------------------------- PREPARE dying: retries, then FAILED + Completed / a soft-deleted IA: no write
for (const deleted of [false, true]) {
  const z = S.completed({});
  submit(z);
  const j = revertJob(z);
  if (deleted) z.w.ia(z.ia.id).is_deleted = 1;
  z.w.planThrows = deleted ? 0 : 99;
  const out = [];
  for (let i = 0; i < 8 && ["COMPLETED", "FAILED", "REQUIRES_REVIEW"].indexOf(j.job_status) < 0; i++) {
    const t = worker(z, j.id);
    out.push(t.err ? "died" : t.out.job_status);
    z.w.now += 11 * 60000;
  }
  if (!deleted) {
    ok(j.job_status === "FAILED" && j.error_code === "IA_RV_TRANSIENT_RETRIES_EXHAUSTED" && z.w.ia(z.ia.id).item_assembly_status === "Completed" && out.filter((x) => x === "died").length === 4,
      "WORKER: PREPARE's run died 4 times -> FAILED IA_RV_TRANSIENT_RETRIES_EXHAUSTED, the IA back to Completed", { job: j, out: out });
  } else {
    ok(j.job_status === "FAILED" && j.error_code === "IA_RV_NOT_FOUND" && z.w.statusWrites.every((x) => !(x.id === z.ia.id && x.deleted === 1)),
      "WORKER on a soft-deleted IA: PREPARE -> FAILED IA_RV_NOT_FOUND and no status written onto the deleted IA (ruling 5)", { job: j, writes: z.w.statusWrites, out: out });
  }
}
for (const deleted of [false, true]) {
  // the worker's own unlock path: PREPARE's run dies before it reads anything, until the retries are spent; on a soft-deleted IA
  // the lock join (g.is_deleted = 0) reads ia_id '0', so the exhausted job gets no unlock row
  const z = S.completed({});
  submit(z);
  const j = revertJob(z);
  z.w.sqlThrows.sql_node_IVPjob = 99;
  if (deleted) z.w.ia(z.ia.id).is_deleted = 1;
  for (let i = 0; i < 8 && j.job_status !== "FAILED"; i++) {
    worker(z, j.id);
    z.w.now += 11 * 60000;
  }
  const iaWrites = z.w.statusWrites.filter((x) => x.id === z.ia.id);
  if (!deleted) {
    ok(j.job_status === "FAILED" && j.error_code === "IA_RV_TRANSIENT_RETRIES_EXHAUSTED" && J(iaWrites.map((x) => x.status)) === J(["Processing", "Completed"]),
      "WORKER exhausted: FAILED, the worker's own unlock writes Completed", { job: j, writes: iaWrites });
  } else {
    ok(j.job_status === "FAILED" && j.error_code === "IA_RV_TRANSIENT_RETRIES_EXHAUSTED" && J(iaWrites.map((x) => x.status)) === J(["Processing"]),
      "WORKER exhausted on a soft-deleted IA: FAILED with NO unlock write (ruling 5: the join reads ia_id '0')", { job: j, writes: iaWrites });
  }
}
console.log("ok   WORKER: PREPARE dying 4 times -> FAILED + Completed; a soft-deleted IA gets no status write (PREPARE IA_RV_NOT_FOUND; the worker's exhausted unlock skipped)");
console.log(checks + " checks passed");
