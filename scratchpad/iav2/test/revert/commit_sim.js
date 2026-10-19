// node test/revert/commit_sim.js - the BUILT IA_REVERT_V2_PREPARE + IA_REVERT_V2_COMMIT on the interpreter (lib/sim/engine.js)
// against an in-memory world (_world.js) whose Item Assembly was completed by the engine core the way IA V2 completes it (_scen.js:
// op 1 issues, op 2 receipt). INVENTORY_BULK_APPLY = the engine's own core over the world; INVENTORY_LOCK_TOKENS emulated. Nothing
// touches a database. Scenarios: clean (stock and FIFO restored, the IA Draft, every lock given back, the ordering rule kept); a
// crash right after EVERY write, then the resume (the clean run's final state, the stock moved once); V1 400 -> FAILED + Completed;
// 409 x 9 -> FAILED IA_RV_INVENTORY_LOCK_BUSY + Completed; no answer with intents -> retry -> REPLAYED; 500 -> REQUIRES_REVIEW;
// COST lock BUSY -> 5 s waits, then the holder lets go -> COMPLETED; BUSY past 1,800 s -> REQUIRES_REVIEW IA_RV_COST_TIMEOUT; WA /
// batch / Blocked receipts; IM1 changed -> FAILED; the parent's costing moved -> REQUIRES_REVIEW IA_RV_COST_CHANGED; PARK above
// 1,000 movements; a COMPLETED job is not run again; node data at 1,001 movements.
const assert = require("assert");
const S = require("./_scen");
const { runWorkflow, fmt, parse } = require("./_world");
const J = (o) => JSON.stringify(o);
const TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW"];
let checks = 0;
const ok = (cond, what, extra) => {
  checks++;
  assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 900)));
};

function prepared(spec, opts) {
  const z = S.completed(spec);
  const jobId = S.queuedJob(z, opts);
  const r = runWorkflow(z.w, "IA_REVERT_V2_PREPARE", { job_id: jobId });
  return Object.assign(z, { jobId: jobId, prep: r });
}
const job = (z) => z.w.job(z.jobId);
const commit = (z) => runWorkflow(z.w, "IA_REVERT_V2_COMMIT", { job_id: z.jobId });
// the worker's role between COMMIT runs: a crashed run's lease expires (11 min), a backoff is waited out, SPLIT / PARK go on at once
function drive(z, max) {
  const runs = [];
  const w = z.w;
  for (let i = 0; i < (max || 60); i++) {
    const r = commit(z);
    runs.push(r);
    const j = job(z);
    if (TERMINAL.indexOf(j.job_status) >= 0 && !r.err) break;
    if (r.err) {
      w.crashAfter = 0;
      w.now += 11 * 60000;
    } else if (j.next_attempt_at !== null && j.next_attempt_at > w.now) w.now = j.next_attempt_at + 1000;
    else w.now += 1000;
  }
  return runs;
}
const doneSteps = (z) => z.w.steps.filter((r) => !r.is_deleted && r.job_id === z.jobId && /^V[0-9]_/.test(r.step_name)).map((r) => r.step_name).sort();
const costHeld = (z) => z.w.locks.filter((l) => Number(l.free_token) === 0 || l.owner_operation_id);
const applied = (z) => z.w.steps.filter((r) => r.job_id === "IAV|" + z.jobId && r.step_name === "IBA|DONE").length;
const irMoves = (z) => z.w.mv.filter((m) => m.transaction_type === "IA-R" && m.trx_no === z.ia.stock_movement_no);
function finalState(z) {
  const w = z.w;
  const ia = w.ia(z.ia.id);
  return { job: job(z).job_status, ia: ia.item_assembly_status, posted: ia.posted_status, number: ia.stock_movement_no, stock: S.snapshot(w), steps: doneSteps(z),
    fifo: w.fifo.map((f) => [f.material_id, f.fifo_initial_quantity, f.fifo_available_quantity, f.fifo_cost_price, f.is_deleted]).sort(),
    wa: w.wa.map((r) => [r.material_id, r.batch_id, r.wa_quantity, Number(Number(r.wa_cost_price).toFixed(8)), r.is_deleted]).sort(),
    batch: w.batch.map((b) => [b.id, b.is_deleted]).sort(), irMoves: irMoves(z).length, applied: applied(z) };
}
// the revert's promise: every component's stock and FIFO value back as before the completion; the assembled item's own rows gone
function expectReverted(z, label) {
  const w = z.w;
  const after = S.snapshot(w);
  ok(job(z).job_status === "COMPLETED" && job(z).progress_percent === 100 && job(z).lease_owner === null && job(z).finished_at, label + ": job COMPLETED 100, lease released", job(z));
  const ia = w.ia(z.ia.id);
  ok(ia.item_assembly_status === "Draft" && ia.posted_status === "" && ia.stock_movement_no === z.ia.stock_movement_no && ia.ia_v2_job_id === z.jobId, label + ": the IA Draft, posted blank, the number kept", ia);
  for (const c of z.comps) {
    const b = z.before[c.it.id];
    const a = after[c.it.id];
    ok(a.qty === b.qty && a.batch === b.batch && a.fifoQty === b.fifoQty && Math.abs(a.fifoValue - b.fifoValue) < 1e-6 && J(a.wa.map((x) => x[0])) === J(b.wa.map((x) => x[0])),
      label + ": component " + c.it.material_code + " stock / FIFO / WA back (qty " + a.qty + ", FIFO " + a.fifoQty + " worth " + a.fifoValue + ")", { before: b, after: a });
  }
  const p = after[z.parent.id] || { qty: 0, fifoQty: 0, wa: [] };
  const pb = z.before[z.parent.id] || { qty: 0, block: 0, fifoQty: 0, fifoValue: 0, wa: [] };
  ok(p.qty === pb.qty && p.block === (pb.block || 0) && p.fifoQty === pb.fifoQty && Math.abs(p.fifoValue - pb.fifoValue) < 1e-6, label + ": the assembled item's stock and FIFO back to before", { before: pb, after: p });
  ok(costHeld(z).length === 0, label + ": every lock given back (token 1, no owner)", costHeld(z));
  ok(w.violations.length === 0, label + ": the ordering rule held (no COST lock of IAV|<job>|C while the engine operation ran)", w.violations);
  ok(applied(z) === 1 && irMoves(z).length === z.comps.length + 1, label + ": the reverse operation applied once (" + irMoves(z).length + " IA-R rows)", { applied: applied(z), ir: irMoves(z).length });
}

// ---------------------------------------------------------------- 1. clean
const clean = {};
{
  const z = prepared({});
  ok(job(z).job_status === "READY_TO_COMMIT" && job(z).progress_percent === 60 && job(z).lease_owner, "clean: PREPARE -> READY_TO_COMMIT (the worker's lease kept)", job(z));
  const a = commit(z);
  ok(!a.err && a.out.path === "SPLIT" && job(z).job_status === "COMMITTING_REVERT" && /^SPLIT\|/.test(job(z).lease_owner) && job(z).progress_percent === 80 && job(z).attempt_count === 0,
    "clean: phase A ends SPLIT (progress 80)", { out: a.out, err: a.err, job: job(z) });
  ok(z.w.ia(z.ia.id).item_assembly_status === "Processing" && applied(z) === 1, "clean: after phase A the stock moved, the IA still Processing");
  const b = commit(z);
  ok(!b.err && b.out.path === "DONE", "clean: phase B -> DONE", b);
  expectReverted(z, "clean");
  ok(J(doneSteps(z)) === J(["V0_REVALIDATE", "V1_INVENTORY", "V2_COST", "V4_FINISH"]), "clean: V0 V1 V2 V4 DONE (no Batch row for a V2-completed non-batch parent)", doneSteps(z));
  const tk = z.w.tokenCalls;
  ok(tk.length === 2 && tk[0].mode === "TAKE" && tk[0].op === "IAV|" + z.jobId + "|C" && tk[1].mode === "GIVE" && tk[1].op === tk[0].op && J(tk[0].ids) === J(tk[1].ids), "clean: COST TAKE then GIVE as IAV|<job>|C", tk);
  const again = commit(z);
  ok(again.out && again.out.path === "NO_WRITE" && applied(z) === 1, "clean: a re-run of a COMPLETED job writes nothing", again.out);
  clean.state = finalState(z);
  clean.writes = z.w.writes.slice();
  clean.prepWrites = 2;
  console.log("ok   clean: " + z.w.writes.length + " writes (" + z.w.writes.join(" | ").slice(0, 300) + " ...)");
}

// ---------------------------------------------------------------- 2. a crash right after every COMMIT write, then the resume
{
  const total = clean.writes.length;
  let points = 0;
  for (let k = 3; k <= total; k++) {
    const z = prepared({});
    const base = z.w.writes.length;
    z.w.crashAfter = base + (k - 2);
    const runs = drive(z);
    const died = runs.filter((r) => r.err && /crash right after/.test(r.err)).length;
    ok(died === 1, "crash@" + k + ": one run died right after a write (" + z.w.crashed + ")", runs.map((r) => r.err || r.out.path));
    const st = finalState(z);
    for (const key of ["job", "ia", "posted", "number", "stock", "steps", "fifo", "wa", "batch", "irMoves", "applied"]) {
      ok(J(st[key]) === J(clean.state[key]), "crash@" + k + " (" + z.w.crashed + "): " + key + " = the clean run's", { got: st[key], want: clean.state[key] });
    }
    ok(costHeld(z).length === 0 && z.w.violations.length === 0, "crash@" + k + ": every lock given back, the ordering rule held", { held: costHeld(z), v: z.w.violations });
    points++;
  }
  console.log("ok   a crash after each of the " + points + " COMMIT writes, then the resume -> the clean run's final state, the reverse operation applied once, every lock given back");
}

// ---------------------------------------------------------------- 3. V1 refusals and waits
{
  // someone used the assembled item between PREPARE and COMMIT: the engine refuses (all-or-nothing) -> FAILED + Completed
  let z = prepared({});
  const ib = z.w.ib.find((b) => b.material_id === z.parent.id);
  ib.unrestricted_qty = 1;
  ib.balance_quantity = 1;
  commit(z);
  ok(job(z).job_status === "FAILED" && /^IA_RV_INVENTORY_/.test(job(z).error_code) && z.w.ia(z.ia.id).item_assembly_status === "Completed" && applied(z) === 0 && job(z).lease_owner === null,
    "V1 400 -> FAILED " + job(z).error_code + " (" + job(z).error_message + "), the IA Completed again, nothing moved", job(z));
  ok(/FG-1/.test(job(z).error_message), "V1 400: the message names the assembled item (LABELS)", job(z).error_message);
  // 409 x 9
  z = prepared({});
  z.w.engineMode = Array(20).fill("409");
  const waits = [];
  for (let i = 0; i < 12 && TERMINAL.indexOf(job(z).job_status) < 0; i++) {
    const before = z.w.now;
    commit(z);
    if (job(z).error_code === "IA_RV_LOCK_WAIT") {
      waits.push(Math.round((job(z).next_attempt_at - before) / 1000));
      z.w.now = job(z).next_attempt_at + 1000;
    }
  }
  ok(J(waits) === J([15, 30, 60, 120, 240, 300, 300, 300]), "409: 8 lock waits 15 s x 2^n capped at 300 s", waits);
  ok(job(z).job_status === "FAILED" && job(z).error_code === "IA_RV_INVENTORY_LOCK_BUSY" && z.w.ia(z.ia.id).item_assembly_status === "Completed" && applied(z) === 0,
    "409: the 9th -> FAILED IA_RV_INVENTORY_LOCK_BUSY + Completed", job(z));
  // applied but no answer (the child died after writing): intents -> retry -> REPLAYED -> COMPLETED, moved once
  z = prepared({});
  z.w.engineMode = ["applied-none"];
  drive(z);
  expectReverted(z, "applied, no answer");
  ok(z.w.engineCalls.filter((c) => c.mode === "APPLY").length === 2, "applied, no answer: the second APPLY replayed (REPLAYED)", z.w.engineCalls);
  // the platform's 400 envelope (an engine run that died) with no intents -> a lock wait, then 200
  z = prepared({});
  z.w.engineMode = ["env400"];
  commit(z);
  ok(job(z).error_code === "IA_RV_LOCK_WAIT" && job(z).attempt_count === 1, "V1 400 envelope without a result_code, no intents -> a lock wait", job(z));
  drive(z);
  expectReverted(z, "400 envelope then 200");
  // 500 -> REQUIRES_REVIEW at once, the IA stays Processing
  z = prepared({});
  z.w.engineMode = ["500"];
  commit(z);
  ok(job(z).job_status === "REQUIRES_REVIEW" && z.w.ia(z.ia.id).item_assembly_status === "Processing", "V1 500 -> REQUIRES_REVIEW, the IA stays Processing", job(z));
  ok(commit(z).out.path === "NO_WRITE", "a REQUIRES_REVIEW job is not run again");
  console.log("ok   V1: 400 -> FAILED + Completed; 409 x 8 waits -> FAILED IA_RV_INVENTORY_LOCK_BUSY; applied without an answer -> REPLAYED; envelope -> wait; 500 -> REQUIRES_REVIEW");
}

// ---------------------------------------------------------------- 4. the COST lock: BUSY waits, the deadline
{
  const holdCost = (z, owner) => {
    const l = z.w.locks.find((x) => x.lock_key === "COST|" + z.parent.id + "|" + S.PLANT);
    Object.assign(l, { free_token: 0, owner_operation_id: owner });
    return l;
  };
  let z = prepared({});
  commit(z);
  const l = holdCost(z, "IBA|GDC|999");
  const t0 = z.w.now;
  const waits = [];
  for (let i = 0; i < 3; i++) {
    commit(z);
    waits.push([job(z).error_code, job(z).attempt_count, Math.round((job(z).next_attempt_at - z.w.now) / 1000)]);
    z.w.now = job(z).next_attempt_at + 500;
  }
  ok(waits.every((x) => x[0] === "IA_RV_WAIT" && x[1] === 0 && x[2] === 5) && job(z).job_status === "COMMITTING_REVERT", "COST BUSY: 5 s waits, not counted, the job open", waits);
  ok(z.w.locks.filter((x) => x.owner_operation_id === "IAV|" + z.jobId + "|C").length === 0 && z.w.tokenCalls.filter((c) => c.mode === "TAKE").length === 0, "COST BUSY: nothing taken while another holds it");
  Object.assign(l, { free_token: 1, owner_operation_id: "", last_owner_operation_id: "IBA|GDC|999" });
  drive(z);
  expectReverted(z, "COST BUSY then free");
  ok(z.w.now - t0 < 60000, "COST BUSY: done seconds after the holder let go");
  z = prepared({});
  commit(z);
  holdCost(z, "IBA|GDC|999");
  for (let i = 0; i < 400 && TERMINAL.indexOf(job(z).job_status) < 0; i++) {
    commit(z);
    if (job(z).next_attempt_at) z.w.now = job(z).next_attempt_at + 1000;
  }
  ok(job(z).job_status === "REQUIRES_REVIEW" && job(z).error_code === "IA_RV_COST_TIMEOUT" && z.w.ia(z.ia.id).item_assembly_status === "Processing",
    "COST BUSY past 1,800 s after V2's first wait -> REQUIRES_REVIEW IA_RV_COST_TIMEOUT, the IA stays Processing", job(z));
  // fix wave R4: the window opens at V2's first busy wait, however late the job got there
  z = prepared({});
  commit(z);
  z.w.now += 3 * 3600000;
  holdCost(z, "IBA|GDC|999");
  commit(z);
  const w1 = JSON.parse(job(z).error_details);
  ok(job(z).error_code === "IA_RV_WAIT" && w1.waitFrom === fmt(z.w.now), "R4: a first COST wait 3 h after V1 DONE is a wait (window opens now), not a review", job(z));
  let last = null;
  for (let i = 0; i < 400 && TERMINAL.indexOf(job(z).job_status) < 0; i++) {
    last = [z.w.now, job(z).error_code];
    z.w.now = job(z).next_attempt_at + 1000;
    commit(z);
  }
  ok(job(z).error_code === "IA_RV_COST_TIMEOUT" && (z.w.now - parse(w1.waitFrom)) / 1000 > 1800 && (last[0] - parse(w1.waitFrom)) / 1000 <= 1800 && last[1] === "IA_RV_WAIT",
    "R4: the review comes once 1,800 s have passed since that first wait, not before", { job: job(z), waitFrom: w1.waitFrom, last: last });
  ok(z.w.locks.filter((x) => x.owner_operation_id === "IAV|" + z.jobId + "|C").length === 0, "COST timeout: no lock of IAV|<job>|C left held");
  console.log("ok   COST lock: BUSY -> 5 s waits (not counted) -> COMPLETED once free; still busy 1,800 s after V2's first wait -> REQUIRES_REVIEW IA_RV_COST_TIMEOUT (a late first wait still waits)");
}

// ---------------------------------------------------------------- 5. other parents and receipts
{
  for (const [label, spec] of [
    ["WA running average", { parent: { method: S.WA, qty: 2 }, parentStock: [10, 4] }],
    ["WA batch parent", { parent: { method: S.WA, batch: true, qty: 2 } }],
    ["FIFO batch parent", { parent: { method: S.FIFO, batch: true, qty: 3 } }],
    ["FIFO with older stock of the parent", { parent: { method: S.FIFO, qty: 2 }, parentStock: [5, 7] }],
    ["Blocked receipt", { parent: { method: S.FIFO, qty: 2 }, cat: "Blocked" }],
    ["batch components", { comps: [{ qty: 2, layers: [[6, 1.5]], batch: true }, { qty: 1, layers: [[3, 4]] }] }],
  ]) {
    const z = prepared(spec);
    ok(job(z).job_status === "READY_TO_COMMIT", label + ": PREPARE READY", job(z));
    drive(z);
    expectReverted(z, label);
    if (spec.parent && spec.parent.batch) ok(z.w.batch.every((b) => b.is_deleted === 1) && doneSteps(z).indexOf("V3_BATCH") >= 0, label + ": its Batch row removed (V3)", z.w.batch);
    if (label === "WA running average") {
      const wa = z.w.wa.find((r) => r.material_id === z.parent.id);
      ok(wa.wa_quantity === "10.00000000" || Number(wa.wa_quantity) === 10, label + ": the running average restated to the stock before (" + wa.wa_quantity + " at " + wa.wa_cost_price + ")", wa);
      ok(Math.abs(Number(wa.wa_cost_price) - 4) < 1e-6, label + ": at the price before (4)", wa);
    }
  }
  console.log("ok   WA running average restated, WA / FIFO batch parents (Batch row removed), older parent stock kept, Blocked receipt, batch components");
}

// ---------------------------------------------------------------- 6. what changed between PREPARE and COMMIT
{
  let z = prepared({});
  z.w.mv.push(Object.assign({}, z.w.mv.find((m) => m.trx_no === z.ia.stock_movement_no), { id: z.w.id(), transaction_type: "IA-R", movement: "IN" }));
  commit(z);
  ok(job(z).job_status === "FAILED" && job(z).error_code === "IA_RV_ROWS_CHANGED" && z.w.ia(z.ia.id).item_assembly_status === "Completed" && applied(z) === 0,
    "V0: a movement row of the IA appeared after PREPARE -> FAILED IA_RV_ROWS_CHANGED + Completed, nothing moved", job(z));
  z = prepared({});
  commit(z);
  const layer = z.w.fifo.find((f) => f.material_id === z.parent.id && !f.is_deleted);
  layer.fifo_available_quantity = Number(layer.fifo_available_quantity) - 0.5;
  drive(z);
  ok(job(z).job_status === "REQUIRES_REVIEW" && job(z).error_code === "IA_RV_COST_CHANGED" && z.w.ia(z.ia.id).item_assembly_status === "Processing", "V2: the parent's layer drawn down after V1 -> REQUIRES_REVIEW IA_RV_COST_CHANGED", job(z));
  ok(z.w.locks.filter((x) => x.owner_operation_id === "IAV|" + z.jobId + "|C" || (Number(x.free_token) === 0 && x.last_owner_operation_id === "IAV|" + z.jobId + "|C")).length === 0,
    "V2 review: the COST lock was given back on the way out");
  z = prepared({});
  commit(z);
  z.w.ia(z.ia.id).ia_v2_job_id = "999";
  commit(z);
  ok(job(z).job_status === "REQUIRES_REVIEW" && z.w.ia(z.ia.id).item_assembly_status === "Processing", "phase B: the IA no longer this job's -> REQUIRES_REVIEW, never an unlock", job(z));
  z = prepared({});
  z.w.ia(z.ia.id).is_deleted = 1;
  commit(z);
  ok(job(z).job_status === "FAILED" && job(z).error_code === "IA_RV_NOT_LOCKED" && z.w.statusWrites.length === 0, "phase A: the IA soft-deleted -> FAILED IA_RV_NOT_LOCKED, no status written onto it", { job: job(z), w: z.w.statusWrites });
  console.log("ok   IM1 changed -> FAILED + Completed; the parent's costing moved -> REQUIRES_REVIEW IA_RV_COST_CHANGED (lock given back); the IA re-owned / deleted -> review / FAILED without a write");
}

// ---------------------------------------------------------------- 7. PARK above 1,000 movements, node data
{
  const z = prepared({ manyComps: 1000, parent: { qty: 1 } });
  ok(job(z).job_status === "READY_TO_COMMIT", "1,001 movements: PREPARE READY", { job: job(z), err: z.prep.err });
  const a = commit(z);
  ok(a.out && a.out.path === "PARK" && job(z).lease_owner === null && job(z).lease_expires_at === null && job(z).next_attempt_at === z.w.now && job(z).progress_percent === 80 && job(z).attempt_count === 0,
    "> 1,000 movements -> PARK (no lease, due now, progress 80, attempts 0)", { out: a.out, job: job(z) });
  const b = commit(z);
  ok(b.out && b.out.path === "DONE" && job(z).job_status === "COMPLETED", "the next call finishes phase B", b.out);
  const mb = (x) => (x / 1048576).toFixed(2);
  const sizes = [z.prep.sizes.IA_REVERT_V2_PREPARE, a.sizes.IA_REVERT_V2_COMMIT, b.sizes.IA_REVERT_V2_COMMIT];
  ok(sizes.every((x) => x < 20 * 1048576), "node outputs at 1,001 movements: PREPARE " + mb(sizes[0]) + " MB, COMMIT A " + mb(sizes[1]) + " MB, B " + mb(sizes[2]) + " MB (< 20 MB each)", sizes);
  console.log("ok   PARK at 1,001 movements, phase B on the next call; node outputs PREPARE " + mb(sizes[0]) + " MB, COMMIT A " + mb(sizes[1]) + " MB, COMMIT B " + mb(sizes[2]) + " MB");
}
// ---------------------------------------------------------------- 8. the runbook (revert/README_REVERT.md): fix, reset, kick the worker
{
  const reset = (z) => Object.assign(job(z), { job_status: "COMMITTING_REVERT", attempt_count: 0, lease_owner: null, lease_expires_at: null, next_attempt_at: z.w.now,
    error_code: null, error_message: null, error_details: null, finished_at: null });
  const kick = (z) => runWorkflow(z.w, "IA_REVERT_V2_WORKER", { job_id: z.jobId });
  const v1Done = (z) => z.w.steps.find((r) => r.job_id === z.jobId && r.step_name === "V1_INVENTORY");
  let z = prepared({});
  z.w.engineMode = ["500"];
  commit(z);
  ok(job(z).job_status === "REQUIRES_REVIEW" && !v1Done(z), "runbook: V1 500 -> REQUIRES_REVIEW, V1 not DONE", job(z));
  reset(z);
  let k = kick(z);
  ok(!k.err && job(z).job_status === "COMPLETED", "runbook: reset after V1 500 -> the worker resumes at V1 and finishes", { k: k.out || k.err, job: job(z) });
  expectReverted(z, "reset after V1 500");
  z = prepared({});
  commit(z);
  const l = z.w.locks.find((x) => x.lock_key === "COST|" + z.parent.id + "|" + S.PLANT);
  Object.assign(l, { free_token: 0, owner_operation_id: "IBA|GDC|999" });
  for (let i = 0; i < 400 && TERMINAL.indexOf(job(z).job_status) < 0; i++) {
    commit(z);
    if (job(z).next_attempt_at) z.w.now = job(z).next_attempt_at + 1000;
  }
  ok(job(z).error_code === "IA_RV_COST_TIMEOUT", "runbook: COST timeout reached", job(z));
  reset(z);
  kick(z);
  ok(job(z).job_status === "COMMITTING_REVERT" && job(z).error_code === "IA_RV_WAIT" && JSON.parse(job(z).error_details).waitFrom === fmt(z.w.now),
    "runbook: reset while the lock is still held -> V2 waits again with a fresh 30 minutes (R4: the reset cleared the window)", job(z));
  Object.assign(l, { free_token: 1, owner_operation_id: "", last_owner_operation_id: "IBA|GDC|999" });
  z.w.now = job(z).next_attempt_at + 1000;
  k = kick(z);
  ok(!k.err && job(z).job_status === "COMPLETED", "runbook: the holder let go -> the next kick finishes at V2 with the same COST part", { k: k.out || k.err, job: job(z) });
  expectReverted(z, "reset after COST timeout");
  z = prepared({});
  commit(z);
  const layer = z.w.fifo.find((f) => f.material_id === z.parent.id && !f.is_deleted);
  layer.fifo_available_quantity = Number(layer.fifo_available_quantity) - 0.5;
  drive(z);
  ok(job(z).error_code === "IA_RV_COST_CHANGED", "runbook: COST changed -> review", job(z));
  layer.is_deleted = 1;
  reset(z);
  k = kick(z);
  ok(!k.err && job(z).job_status === "COMPLETED" && z.w.ia(z.ia.id).item_assembly_status === "Draft" && costHeld(z).length === 0 && applied(z) === 1,
    "runbook: the named row brought to its after-value, reset -> V2 counts it done, COMPLETED", { k: k.out || k.err, job: job(z) });
  z = prepared({});
  commit(z);
  z.w.ia(z.ia.id).ia_v2_job_id = "999";
  commit(z);
  ok(job(z).job_status === "REQUIRES_REVIEW", "runbook: phase B, the IA not this job's -> review", job(z));
  z.w.ia(z.ia.id).ia_v2_job_id = z.jobId;
  reset(z);
  k = kick(z);
  ok(!k.err && job(z).job_status === "COMPLETED", "runbook: the IA's row fixed, reset -> resumes at V2 and finishes", { k: k.out || k.err, job: job(z) });
  expectReverted(z, "reset after a phase B review");
  console.log("ok   runbook resets: V1 500 -> resumes at V1; COST timeout -> waits again with a fresh window, finishes once free; COST changed -> fixed row, finishes; phase B review -> finishes");
}
// ---------------------------------------------------------------- 9. fix wave R2: the engine wrote, then the IA lost its lock
{
  const at = clean.writes.findIndex((w) => /^engine IAV\|/.test(w)) + 1;
  const z = prepared({});
  z.w.crashAfter = at;
  const r = commit(z);
  ok(r.err && /crash right after/.test(r.err) && applied(z) === 1 && !z.w.steps.find((x) => x.job_id === z.jobId && x.step_name === "V1_INVENTORY"),
    "R2: the run died right after the APPLY (IBA|DONE written), before V1 DONE", { err: r.err, crashed: z.w.crashed });
  z.w.crashAfter = 0;
  z.w.ias.find((h) => h.id === z.ia.id).is_deleted = 1;
  const before = z.w.statusWrites.length;
  z.w.now += 11 * 60000;
  commit(z);
  ok(job(z).job_status === "REQUIRES_REVIEW" && job(z).error_code === "IA_RV_RECONCILIATION_MISMATCH" && JSON.parse(job(z).error_details).step === "V1_INVENTORY"
    && z.w.statusWrites.length === before && z.w.ias.find((h) => h.id === z.ia.id).item_assembly_status === "Processing",
  "R2: the resume finds the IA gone but IAV|<job> written -> REQUIRES_REVIEW (not FAILED), no status written", { job: job(z), statusWrites: z.w.statusWrites.slice(before) });
  console.log("ok   R2: crash after the APPLY, IA soft-deleted, resume -> REQUIRES_REVIEW IA_RV_RECONCILIATION_MISMATCH, nothing unlocked");
}
// --5000: the same at the 5,000-movement limit (about 25 s)
if (process.argv.indexOf("--5000") > 0) {
  const spec = { manyComps: 4999, parent: { qty: 1 } };
  const y = S.completed(spec);
  const s = runWorkflow(y.w, "IA_REVERT_V2_SUBMIT", { operation: "SUBMIT", ia_id: y.ia.id, idempotency_key: y.key, source: "LIST", min_picks: "50", form: Object.assign({}, y.row) });
  const z = prepared(spec);
  const a = commit(z);
  const b = commit(z);
  const mb = (x) => (x / 1048576).toFixed(2);
  const sizes = [s.sizes.IA_REVERT_V2_SUBMIT, z.prep.sizes.IA_REVERT_V2_PREPARE, a.sizes.IA_REVERT_V2_COMMIT, b.sizes.IA_REVERT_V2_COMMIT];
  ok(s.out && s.out.route === "QUEUED" && a.out.path === "PARK" && job(z).job_status === "COMPLETED" && z.w.ia(z.ia.id).item_assembly_status === "Draft"
    && sizes.every((x) => x < 20 * 1048576), "5,000 movements: QUEUED, COMPLETED, each run < 20 MB", sizes);
  console.log("ok   5,000 movements: node outputs SUBMIT " + mb(sizes[0]) + " MB, PREPARE " + mb(sizes[1]) + " MB, COMMIT A " + mb(sizes[2]) + " MB, COMMIT B " + mb(sizes[3]) + " MB");
}
console.log(checks + " checks passed");
