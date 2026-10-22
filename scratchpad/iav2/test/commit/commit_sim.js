// node test/commit/commit_sim.js - the BUILT IA_V2_COMMIT on the interpreter (lib/sim/engine.js) against the in-memory world
// (world.js: INVENTORY_BULK_APPLY = the deployed planner). Nothing touches a database.
// Happy paths (non-batch, system-generated batch, Blocked receipt, alt-UOM receipt, the same balance picked on two lines);
// a crash right after EVERY write, then the resume (same end state, op 2's request byte-identical, op 1 replayed once);
// I1 duplicate number / re-PLAN refusal; I2 400 / 409 x 8 / the platform's 400 envelope / no answer / 500; op 1 under review;
// a "401" skip inside op 1; I3 409 waits (not counted) up to the 30-minute deadline; R1 "401"; the IA soft-deleted before I0
// and after I2; PARK above 1,000 picks; an empty ENGINE_I; a Manual parent's manifest; node data at 830 and 2,000 picks.
const W = require("./world.js");
const { assert, X, J, fmt, parse, TERMINAL, world, runCommit, drive, liveBatches, stepNames, opCalls } = W;
const { JOB, IAID, ORG, PARENT, IANO } = X;
let checks = 0;
const ok = (cond, what, extra) => { checks++; assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 900))); };
const outRows = (w) => w.mv.filter((m) => m.movement === "OUT" && String(m.operation_effect_key).indexOf("IAC|" + JOB + "|I|") === 0);
const inRows = (w) => w.mv.filter((m) => m.movement === "IN" && String(m.operation_effect_key).indexOf("IAC|" + JOB + "|R|") === 0);
const priceOf = (w, c) => X.P.receiptUnitPrice({ outTotals: [W.decSum(outRows(w).map((m) => m.total_price))], receiptBaseQty: c.receiptBaseQty, assemblyCost: c.o.assemblyCost });
const balance = (w, mat, bin) => w.bal.find((b) => b.material_id === mat && b.location_id === bin);
const parentLayer = (w) => w.fifo.filter((l) => l.material_id === PARENT).slice(-1)[0];
const DONE = ["I0_REVALIDATE:DONE", "I2_ISSUE:DONE", "I3_RECEIPT:DONE", "I4_FINISH:DONE"];
const doneSteps = (c) => DONE.concat(c.o.batch ? ["I1_BATCH:DONE", "I1|I|001:INTENT"] : []).sort();

function expectCompleted(w, c, label) {
  ok(w.job.job_status === "COMPLETED" && w.job.progress_percent === 100 && w.job.lease_owner === null && w.job.finished_at, label + ": job COMPLETED 100, lease released", w.job);
  ok(w.ia.item_assembly_status === "Completed" && w.ia.posted_status === "Unposted", label + ": the IA Completed / Unposted", w.ia);
  ok(w.engine.applied["IAC|" + JOB + "|I"] === (c.movements.length ? 1 : undefined) && w.engine.applied["IAC|" + JOB + "|R"] === 1, label + ": op 1 and op 2 each applied exactly once", w.engine.applied);
  ok(outRows(w).length === c.movements.filter((m) => Number(w.items[m.material_id].stock_control) !== 0).length && inRows(w).length === 1, label + ": one OUT row per stock pick, one IN row", { out: outRows(w).length, in: inRows(w).length });
  const r = inRows(w)[0];
  ok(Math.abs(Number(r.unit_price) - Number(X.C.iaQ8(priceOf(w, c)).toFixed(4))) < 1e-9, label + ": R1 stored at the price of the stored OUT rows (" + priceOf(w, c) + ")", r);
  ok(r.inventory_category === c.o.category && r.bin_location_id === X.BIN0 && Number(r.base_qty) === Number(c.receiptBaseQty), label + ": R1 into the header bin / category, the base qty", r);
  if (c.o.batch) {
    const live = liveBatches(w, PARENT);
    ok(live.length === 1 && live[0].batch_number === X.BATCH_NO && live[0].transaction_no === IANO && r.batch_number_id === live[0].id, label + ": ONE live Batch row, the receipt on it", { live, r });
  } else ok(liveBatches(w).length === 0 && r.batch_number_id === null, label + ": no Batch row for a non-batch parent (deliberate V2 difference)", liveBatches(w));
  ok(J(Object.keys(w.itemDates).sort()) === J(c.itemIds.slice().sort()), label + ": Item dates for the parent and every component (non-stock included)", Object.keys(w.itemDates));
  ok(J(stepNames(w)) === J(doneSteps(c)), label + ": step rows", stepNames(w));
  ok(w.violations.length === 0, label + ": no forbidden write", w.violations);
}
const state = (w) => ({ ia: [w.ia.item_assembly_status, w.ia.posted_status], bal: w.bal.map((b) => [b.material_id, b.location_id, b.unrestricted_qty, b.block_qty, b.balance_quantity]),
  fifo: w.fifo.map((l) => [l.material_id, l.fifo_sequence, l.fifo_cost_price, l.fifo_available_quantity]), mv: w.mv.map((m) => [m.operation_effect_key, m.quantity, m.unit_price, m.total_price]),
  batches: liveBatches(w).map((b) => [b.batch_number, b.material_id, b.plant_id, b.transaction_no, b.initial_quantity]), steps: stepNames(w), items: Object.keys(w.itemDates).sort() });

// ------------------------------------------------------------------ 1. happy paths
const CASES = { plain: {}, batch: { batch: true }, blocked: { category: "Blocked", batch: true }, altuom: { altUom: true, itemQty: 2.5 }, twice: { sameBalance: true, picks: 3 } };
const clean = {};
for (const [name, o] of Object.entries(CASES)) {
  const c = X.makeCase(o);
  const w = world(c);
  const a = runCommit(w);
  ok(!a.err && a.out.path === "SPLIT" && w.job.job_status === "COMMITTING_IA" && /^SPLIT\|/.test(w.job.lease_owner) && w.job.progress_percent === 75 && w.job.attempt_count === 0,
    name + ": phase A ends SPLIT at 75", { a, job: w.job });
  ok(w.ia.item_assembly_status === "Processing" && outRows(w).length === c.movements.length && inRows(w).length === 0, name + ": after phase A op 1 moved, op 2 not yet, the IA Processing");
  const b = runCommit(w);
  ok(!b.err && b.out.path === "DONE" && b.out.job_status === "COMPLETED", name + ": phase B -> DONE", b);
  expectCompleted(w, c, name);
  ok(J(w.iaWrites) === J(["Completed"]), name + ": the IA written once (Completed)", w.iaWrites);
  const again = runCommit(w);
  ok(!again.err && again.out.path === "NO_WRITE" && w.job.job_status === "COMPLETED" && opCalls(w, "R").length === 1, name + ": a re-run of a COMPLETED job writes nothing", again.out);
  clean[name] = { c, state: state(w), writes: w.writes.slice(), opR: opCalls(w, "R").map((x) => x.text), sizes: w.sizes.slice() };
  console.log("ok   " + name + ": " + w.writes.length + " writes, receipt at " + inRows(w)[0].unit_price + (o.batch ? ", Batch row " + liveBatches(w)[0].id : ""));
}
{
  // the price comes from the STORED rows (4 dp), not the APPLY answer's unrounded totals (controller 4)
  const c = clean.plain.c;
  const w = world(c);
  drive(w);
  const answered = J(JSON.parse(w.steps.find((r) => r.job_id === "IAC|" + JOB + "|I" && r.step_name === "IBA|DONE").result_ref).results.map((r) => r.total_price));
  const fromAnswer = X.P.receiptUnitPrice({ outTotals: JSON.parse(answered), receiptBaseQty: c.receiptBaseQty, assemblyCost: c.o.assemblyCost });
  ok(fromAnswer !== priceOf(w, c) && Number(inRows(w)[0].unit_price) === Number(priceOf(w, c).toFixed(4)), "the receipt price is the stored rows' (" + priceOf(w, c) + "), not the answer's (" + fromAnswer + ")");
  // Review Focus 1: a Blocked receipt lands in block_qty
  const bw = world(clean.blocked.c);
  drive(bw);
  const pb = balance(bw, PARENT, X.BIN0);
  ok(pb && Number(pb.block_qty) === Number(clean.blocked.c.receiptBaseQty) && Number(pb.unrestricted_qty) === 0, "Blocked receipt: block_qty += the receipt, unrestricted untouched", pb);
  // Review Focus 2: the same balance picked on two lines -> consumed once per pick, in order (line 1's picks, then line 3's)
  const tc = clean.twice.c;
  const tw = world(tc);
  drive(tw);
  const keys = tc.movements.filter((m) => m.material_id === X.comp(1)).map((m) => m.movement_key);
  const rows = outRows(tw).filter((m) => m.item_id === X.comp(1));
  const used = rows.reduce((t, m) => t + Number(m.base_qty), 0);
  ok(keys.length === 6 && rows.length === 6 && J(rows.map((m) => m.operation_effect_key.split("|").pop())) === J(keys) && Number(balance(tw, X.comp(1), X.binOf(1)).unrestricted_qty) === 500 - used,
    "same balance on lines 1 and 3: six SUBTRACTs on one balance row, in line then pick order, the row down by " + used, rows.map((m) => [m.operation_effect_key, m.base_qty, m.unit_price]));
  const prices = rows.map((m) => Number(m.unit_price));
  ok(prices[0] !== prices[prices.length - 1], "... later picks are priced from the next FIFO layer (the first one ran out)", prices);
  console.log("ok   price from stored rows; Blocked receipt in block_qty; same balance on two lines consumed once per pick in order");
}

// ------------------------------------------------------------------ 2. a crash right after every write, then the resume
for (const name of ["plain", "batch"]) {
  const total = clean[name].writes.length;
  for (let k = 1; k <= total; k++) {
    const c = X.makeCase(CASES[name]);
    const w = world(c, { crashAfter: k });
    const runs = drive(w);
    const what = w.crashed;
    ok(runs.filter((r) => r.err).length === 1, name + " crash@" + k + ": one run died right after write " + k + " (" + what + ")", runs.map((r) => r.err || r.out.path));
    ok(w.job.job_status === "COMPLETED", name + " crash@" + k + " (" + what + "): resumed to COMPLETED", { job: w.job, runs: runs.map((r) => r.err || r.out.path) });
    expectCompleted(w, c, name + " crash@" + k);
    const st = state(w);
    for (const key of Object.keys(st)) ok(J(st[key]) === J(clean[name].state[key]), name + " crash@" + k + ": " + key + " = the clean run's", { got: st[key], want: clean[name].state[key] });
    const reqs = opCalls(w, "R").map((x) => x.text);
    ok(reqs.length >= 1 && reqs.every((t) => t === clean[name].opR[0]), name + " crash@" + k + ": op 2's request byte-identical to the clean run's", reqs);
    if (/engine APPLY IAC\|[0-9]+\|I$/.test(String(what))) ok(opCalls(w, "I").length === 2, name + " crash@" + k + ": op 1 called again and answered REPLAYED", opCalls(w, "I").length);
  }
  console.log("ok   " + name + ": a crash after each of the " + total + " writes, then the resume -> the clean run's end state, op 1 / op 2 applied once, op 2's request identical");
}

// ------------------------------------------------------------------ 3. phase A failures: FAILED, back to Draft, our Batch row soft-deleted, nothing moved
const failed = (w, code, label) => {
  ok(w.job.job_status === "FAILED" && w.job.error_code === code && w.job.lease_owner === null, label + ": FAILED " + code, w.job);
  ok(w.ia.item_assembly_status === "Draft" && w.mv.length === 0, label + ": back to Draft, nothing moved", { ia: w.ia.item_assembly_status, mv: w.mv.length });
  ok(liveBatches(w).filter((b) => b.transaction_no === IANO).length === 0 && w.violations.length === 0, label + ": no live Batch row of ours left", { batches: w.batches, v: w.violations });
};
{
  // Review Focus 5: the system-generated number already taken by another document
  const c = X.makeCase({ batch: true });
  const w = world(c, { batches: [{ id: "2111900000000000001", batch_number: X.BATCH_NO + "  ", material_id: PARENT, plant_id: X.PLANT, organization_id: ORG, transaction_no: "GR-2610-0007", is_deleted: 0,
    initial_quantity: "5.00000000" }] });
  drive(w);
  failed(w, "IA_BATCH_DUPLICATE", "duplicate batch number");
  ok(w.job.error_message === "Duplicate Batch Format found." && w.batches.length === 1 && w.batches[0].is_deleted === 0 && w.engine.calls.length === 0, "... the other document's row untouched, no engine call", w.job);
  // I2 400 -> FAILED + mapped message + our Batch row soft-deleted
  const c2 = X.makeCase({ batch: true });
  const w2 = world(c2, { faults: { ["IAC|" + JOB + "|I|APPLY"]: ["400"] } });
  drive(w2);
  failed(w2, "IA_INVENTORY_INSUFFICIENT", "I2 400");
  const l = c2.labels.M3;
  ok(w2.job.error_message === "Insufficient quantity - line " + l.line_index + " (" + l.item_code + "), bin " + l.bin + " (Unrestricted)" && w2.batchDeletes.length === 1, "... LABELS-worded, the inserted Batch row soft-deleted", w2.job);
  // I1's re-PLAN refuses: the parent no longer stock-controlled ("401") -> FAILED IA_PLAN_SKIPPED
  const c3 = X.makeCase({ batch: true });
  const w3 = world(c3);
  w3.items[PARENT].stock_control = 0;
  drive(w3);
  failed(w3, "IA_PLAN_SKIPPED", "I1 re-PLAN 401");
  ok(/into bin FG-01/.test(w3.job.error_message) && /nothing was moved\.$/.test(w3.job.error_message) && opCalls(w3, "R", "PLAN").length === 1 && opCalls(w3, "I").length === 0, "... worded, op 1 never called", w3.job.error_message);
  // the IA soft-deleted before I0 (mobile delete): FAILED, nothing moved, no write to the deleted row
  const w4 = world(X.makeCase({ batch: true }));
  w4.ia.is_deleted = 1;
  drive(w4);
  ok(w4.job.job_status === "FAILED" && w4.job.error_code === "IA_NOT_LOCKED" && w4.iaWrites.length === 0 && w4.mv.length === 0 && w4.violations.length === 0 && w4.batches.length === 0,
    "IA soft-deleted before I0 -> FAILED IA_NOT_LOCKED, nothing moved, no unlock of the deleted row", w4.job);
  // manifest with a Manual Input parent (batchMode reuse_or_insert: NOT_ELIGIBLE at SUBMIT this cut) -> refused at the entry
  const c5 = X.makeCase({ batch: true, batchMode: "reuse_or_insert" });
  const w5 = world(c5);
  drive(w5);
  failed(w5, "IA_INVALID_DATA", "Manual parent manifest");
  ok(/batchMode reuse_or_insert/.test(JSON.parse(w5.job.error_details).why) && w5.engine.calls.length === 0 && w5.batches.length === 0, "... no Batch row, no engine call", w5.job.error_details);
  // an I1 that inserted its row and died before DONE, then the IA lost its lock: the entry finds the row by the intent and removes it
  const c6 = X.makeCase({ batch: true });
  const w6 = world(c6, { crashAfter: clean.batch.writes.indexOf("batch insert x1") + 1 });
  runCommit(w6);
  ok(w6.crashed === "batch insert x1" && liveBatches(w6).length === 1, "crash right after the Batch insert", w6.crashed);
  w6.ia.is_deleted = 1;
  w6.now += 11 * 60000;
  w6.crashAfter = 0;
  runCommit(w6);
  ok(w6.job.job_status === "FAILED" && w6.job.error_code === "IA_NOT_LOCKED" && liveBatches(w6).length === 0 && w6.batchDeletes.length === 1 && w6.violations.length === 0,
    "... the next pass: FAILED, the intent-identified Batch row soft-deleted, the deleted IA not written", { job: w6.job, batches: w6.batches });
  console.log("ok   phase A failures: duplicate number, I2 400 (mapped), re-PLAN 401, IA deleted before I0, Manual manifest, orphan Batch row after a crash -> FAILED, nothing moved");
}
{
  // I2 409 x 8 -> lock waits 15 s x 2^n (cap 300 s), then FAILED IA_INVENTORY_LOCK_BUSY + Draft + Batch row removed
  const c = X.makeCase({ batch: true });
  const w = world(c, { faults: { ["IAC|" + JOB + "|I|APPLY"]: Array(20).fill("409") } });
  const waits = [];
  for (let i = 0; i < 12 && TERMINAL.indexOf(w.job.job_status) < 0; i++) {
    const before = w.now;
    runCommit(w);
    if (w.job.error_code === "IA_LOCK_WAIT") {
      waits.push(Math.round((parse(w.job.next_attempt_at) - before) / 1000));
      w.now = parse(w.job.next_attempt_at) + 1000;
    }
  }
  ok(J(waits) === J([15, 30, 60, 120, 240, 300, 300, 300]), "I2 409: 8 lock waits 15 s x 2^n capped at 300 s", waits);
  failed(w, "IA_INVENTORY_LOCK_BUSY", "I2 409 x 9");
  ok(opCalls(w, "I").length === 9 && w.batchDeletes.length === 1, "... 9 calls, the Batch row soft-deleted", opCalls(w, "I").length);
  // the platform's 400 envelope (a dead engine run) once, then 200; no answer once, then 200; applied but no answer -> REPLAYED
  for (const f of ["400env", "null"]) {
    const w2 = world(X.makeCase({}), { faults: { ["IAC|" + JOB + "|I|APPLY"]: [f] } });
    runCommit(w2);
    ok(w2.job.job_status === "COMMITTING_IA" && w2.job.error_code === "IA_LOCK_WAIT" && w2.job.attempt_count === 1 && w2.mv.length === 0, f + " -> a lock wait (no intent row)", w2.job);
    drive(w2);
    ok(w2.job.job_status === "COMPLETED" && w2.engine.applied["IAC|" + JOB + "|I"] === 1, f + " -> ... then 200 -> COMPLETED, op 1 applied once", w2.engine);
  }
  const w3 = world(X.makeCase({}), { faults: { ["IAC|" + JOB + "|I|APPLY"]: ["applied-none"] } });
  runCommit(w3);
  ok(w3.job.error_code === "IA_STEP_RETRY" && w3.job.job_status === "COMMITTING_IA" && w3.ia.item_assembly_status === "Processing", "applied but no answer (intent rows) -> retry, never a lock wait / unlock", w3.job);
  drive(w3);
  ok(w3.job.job_status === "COMPLETED" && w3.engine.applied["IAC|" + JOB + "|I"] === 1 && opCalls(w3, "I").length === 2, "... the next APPLY replays (REPLAYED) -> COMPLETED, moved once", w3.engine);
  // op 1 answers 500 (its own REQUIRES_REVIEW) -> REQUIRES_REVIEW at once; op 2 is never called; a re-run writes nothing
  const w4 = world(X.makeCase({ batch: true }), { faults: { ["IAC|" + JOB + "|I|APPLY"]: ["500"] } });
  drive(w4);
  ok(w4.job.job_status === "REQUIRES_REVIEW" && w4.job.error_code === "IA_RECONCILIATION_MISMATCH" && w4.ia.item_assembly_status === "Processing" && opCalls(w4, "R").length === 0
    && liveBatches(w4).length === 1, "op 1 500 -> REQUIRES_REVIEW, the IA stays Processing, op 2 never applied, the Batch row kept", w4.job);
  console.log("ok   I2: 409 x 8 waits then FAILED; 400 envelope / no answer -> wait then DONE; applied-no-answer -> retry -> REPLAYED; 500 -> review, op 2 never called");
}

// ------------------------------------------------------------------ 4. phase B (never unlocks)
{
  // Review Focus 4: one op-1 movement answered "401" (its item's stock_control flipped to 0 after PREPARE): op 1 200 with a
  // skip; I3's count uses op 1's code-200 results, the price excludes it, no review
  const c = X.makeCase({});
  const w = world(c);
  w.items[X.comp(2)].stock_control = 0;
  drive(w);
  const skipped = c.movements.filter((m) => m.material_id === X.comp(2)).length;
  ok(w.job.job_status === "COMPLETED" && outRows(w).length === c.movements.length - skipped && outRows(w).every((m) => m.item_id !== X.comp(2)),
    "a 401 skip inside op 1: COMPLETED, " + skipped + " picks without a row", { job: w.job.job_status, rows: outRows(w).length });
  ok(Number(inRows(w)[0].unit_price) === Number(priceOf(w, c).toFixed(4)) && JSON.parse(w.steps.find((r) => r.step_name === "I2_ISSUE").result_ref).summary.skipped === skipped,
    "... the price from the stored rows only (the skip adds nothing), I2's note counts the skip");
  // I3: op 2 answered 409 every time -> 10 s waits, attempt_count unchanged, then REQUIRES_REVIEW IA_RECEIPT_TIMEOUT 30 min after I2
  const w2 = world(X.makeCase({ batch: true }), { faults: { ["IAC|" + JOB + "|R|APPLY"]: Array(400).fill("409") } });
  runCommit(w2);
  const i2at = parse(w2.steps.find((r) => r.step_name === "I2_ISSUE").finished_at);
  let waits = 0;
  for (let i = 0; i < 400 && TERMINAL.indexOf(w2.job.job_status) < 0; i++) {
    runCommit(w2);
    if (w2.job.error_code === "IA_WAIT") {
      waits++;
      ok(w2.job.attempt_count === 0 && parse(w2.job.next_attempt_at) - w2.now === 10000, "I3 409: a 10 s wait, not counted", w2.job);
      w2.now = parse(w2.job.next_attempt_at);
    }
  }
  ok(w2.job.job_status === "REQUIRES_REVIEW" && w2.job.error_code === "IA_RECEIPT_TIMEOUT" && w2.ia.item_assembly_status === "Processing" && w2.iaWrites.length === 0 && w2.now - i2at > 1800000
    && waits >= 170 && liveBatches(w2).length === 1, "... " + waits + " waits, then REQUIRES_REVIEW IA_RECEIPT_TIMEOUT, no unlock, the Batch row kept", { job: w2.job, waits });
  // ruling 10 R4: the window starts at I3's FIRST transient answer - a first kick 6 hours after I2 still waits up to 30 min
  const w2b = world(X.makeCase({ batch: true }), { faults: { ["IAC|" + JOB + "|R|APPLY"]: Array(400).fill("409") } });
  runCommit(w2b);
  w2b.now += 6 * 3600 * 1000;
  let first = null;
  let lateWaits = 0;
  for (let i = 0; i < 400 && TERMINAL.indexOf(w2b.job.job_status) < 0; i++) {
    runCommit(w2b);
    if (w2b.job.error_code === "IA_WAIT") {
      lateWaits++;
      const d = JSON.parse(w2b.job.error_details);
      if (first === null) first = d.waitFrom;
      ok(d.waitFrom === first && d.step === "I3_RECEIPT", "late kick: every wait keeps the first wait's time", d);
      w2b.now = parse(w2b.job.next_attempt_at);
    }
  }
  const late = JSON.parse(w2b.job.error_details);
  ok(lateWaits >= 170 && w2b.job.error_code === "IA_RECEIPT_TIMEOUT" && late.waitFrom === first && parse(first) - parse(w2b.steps.find((r) => r.step_name === "I2_ISSUE").finished_at) >= 6 * 3600 * 1000
    && late.waited > 1800 && late.waited < 1830, "late kick (6 h after I2): " + lateWaits + " waits over 30 min from the FIRST transient answer, then IA_RECEIPT_TIMEOUT", { late, lateWaits });
  // the runbook's reset (error_details NULL) after the timeout opens a fresh window: the next 409s wait again, then 200 -> COMPLETED
  Object.assign(w2b.job, { job_status: "COMMITTING_IA", attempt_count: 0, lease_owner: null, lease_expires_at: null, next_attempt_at: fmt(w2b.now), error_code: null, error_message: null,
    error_details: null, finished_at: null });
  w2b.engine.faults["IAC|" + JOB + "|R|APPLY"] = ["409", "409"];
  runCommit(w2b);
  ok(w2b.job.job_status === "COMMITTING_IA" && w2b.job.error_code === "IA_WAIT" && JSON.parse(w2b.job.error_details).waitFrom === fmt(w2b.now), "after the reset: the first 409 waits (a fresh window)", w2b.job);
  drive(w2b);
  ok(w2b.job.job_status === "COMPLETED" && w2b.ia.item_assembly_status === "Completed" && w2b.engine.applied["IAC|" + JOB + "|R"] === 1, "after the reset: ... then 200 -> COMPLETED", w2b.job);
  // a 409 once, then 200 -> DONE (the wait is not a failure)
  const w3 = world(X.makeCase({}), { faults: { ["IAC|" + JOB + "|R|APPLY"]: ["409", "null", "400env"] } });
  drive(w3);
  ok(w3.job.job_status === "COMPLETED" && w3.engine.applied["IAC|" + JOB + "|R"] === 1 && opCalls(w3, "R").length === 4, "I3 409 / no answer / envelope -> waits, then 200 -> COMPLETED", opCalls(w3, "R").length);
  // R1 answered "401" (the parent's stock_control flipped after phase A) -> REQUIRES_REVIEW IA_RECEIPT_REFUSED, never Completed
  const w4 = world(X.makeCase({ batch: true }));
  runCommit(w4);
  w4.items[PARENT].stock_control = 0;
  drive(w4);
  ok(w4.job.job_status === "REQUIRES_REVIEW" && w4.job.error_code === "IA_RECEIPT_REFUSED" && w4.ia.item_assembly_status === "Processing" && inRows(w4).length === 0,
    "R1 401 -> REQUIRES_REVIEW IA_RECEIPT_REFUSED, the IA stays Processing", w4.job);
  // op 2 400 with a result_code / 500 -> REQUIRES_REVIEW at once
  for (const f of ["400", "500"]) {
    const w5 = world(X.makeCase({}), { faults: { ["IAC|" + JOB + "|R|APPLY"]: [f] } });
    drive(w5);
    ok(w5.job.job_status === "REQUIRES_REVIEW" && w5.job.error_code === "IA_RECEIPT_REFUSED" && w5.ia.item_assembly_status === "Processing", "op 2 " + f + " -> REQUIRES_REVIEW IA_RECEIPT_REFUSED", w5.job);
  }
  // op 1 under review (an IBA|REVIEW on IAC|<job>|I although I2 is DONE): op 2 is never started
  const w6 = world(X.makeCase({}));
  runCommit(w6);
  w6.steps.push({ id: w6.id(), job_id: "IAC|" + JOB + "|I", step_name: "IBA|REVIEW", step_status: "REVIEW", result_ref: "", is_deleted: 0 });
  drive(w6);
  ok(w6.job.job_status === "REQUIRES_REVIEW" && w6.job.error_code === "IA_RECEIPT_COUNT_MISMATCH" && opCalls(w6, "R").length === 0, "op 1 under review -> op 2 never called, REQUIRES_REVIEW", w6.job);
  // a stored OUT row missing (count mismatch) -> REQUIRES_REVIEW before op 2
  const w7 = world(X.makeCase({}));
  runCommit(w7);
  w7.mv[0].is_deleted = 1;
  drive(w7);
  ok(w7.job.job_status === "REQUIRES_REVIEW" && w7.job.error_code === "IA_RECEIPT_COUNT_MISMATCH" && opCalls(w7, "R").length === 0 && /stored/.test(w7.job.error_details),
    "stored OUT rows != op 1's code-200 results -> REQUIRES_REVIEW, op 2 never called", w7.job);
  // Review Focus 3: the IA soft-deleted after I2 -> REQUIRES_REVIEW, no write to the deleted row
  const w8 = world(X.makeCase({}));
  runCommit(w8);
  w8.ia.is_deleted = 1;
  drive(w8);
  ok(w8.job.job_status === "REQUIRES_REVIEW" && w8.iaWrites.length === 0 && w8.violations.length === 0 && opCalls(w8, "R").length === 0, "IA soft-deleted after I2 -> REQUIRES_REVIEW, no unlock, op 2 never called", w8.job);
  // ruling 10 R2: the run dies right after op 1's APPLY (before the I2 DONE row), then the IA is soft-deleted: the resumed entry
  // sees op 1's engine rows -> REQUIRES_REVIEW, never "FAILED, nothing moved"; no unlock, the Batch row kept, op 2 never called
  for (const name of ["batch", "plain"]) {
    const c9 = X.makeCase(CASES[name]);
    const k = clean[name].writes.findIndex((x) => /^engine APPLY IAC\|[0-9]+\|I$/.test(x)) + 1;
    const w9 = world(c9, { crashAfter: k });
    const died = runCommit(w9);
    ok(died.err && /engine APPLY IAC\|[0-9]+\|I$/.test(w9.crashed) && outRows(w9).length === c9.movements.length && !w9.steps.some((r) => r.step_name === "I2_ISSUE"),
      name + " R2: the run died right after op 1's APPLY, before I2 DONE", { crashed: w9.crashed, err: died.err });
    w9.ia.is_deleted = 1;
    Object.assign(w9, { crashAfter: 0, now: w9.now + 11 * 60000 });
    Object.assign(w9.job, { attempt_count: w9.job.attempt_count + 1, row_version: w9.job.row_version + 1 });
    const back = runCommit(w9);
    const d9 = JSON.parse(w9.job.error_details);
    ok(!back.err && w9.job.job_status === "REQUIRES_REVIEW" && w9.job.error_code === "IA_RECONCILIATION_MISMATCH" && d9.step === "I2_ISSUE" && d9.wouldFail === "IA_NOT_LOCKED"
      && w9.iaWrites.length === 0 && w9.violations.length === 0 && w9.batchDeletes.length === 0 && liveBatches(w9).length === (name === "batch" ? 1 : 0) && opCalls(w9, "R").length === 0
      && outRows(w9).length === c9.movements.length, name + " R2: resumed with the IA deleted -> REQUIRES_REVIEW (wouldFail IA_NOT_LOCKED), no unlock, Batch row kept, op 2 never called", { job: w9.job });
  }
  console.log("ok   phase B: 401 skip priced out; I3 409 waits " + waits + " x 10 s then IA_RECEIPT_TIMEOUT; a first kick 6 h after I2 still waits 30 min (R4), a reset opens a fresh window; R1 401 / 400 / 500 -> review; op 1 under review / count mismatch / IA deleted -> review, op 2 never called; op 1 applied + IA deleted before I2 DONE -> review (R2)");
}

// ------------------------------------------------------------------ 5. sizes: PARK above 1,000 picks, an empty ENGINE_I, prevStatus unknown
{
  const c = X.makeCase({ lines: 501, picks: 2, nonStock: 3 });
  ok(c.movements.length === 1002, "PARK case: 1,002 picks");
  const w = world(c);
  const a = runCommit(w);
  ok(a.out.path === "PARK" && w.job.job_status === "COMMITTING_IA" && w.job.lease_owner === null && w.job.next_attempt_at === fmt(w.now) && w.job.progress_percent === 75 && w.job.attempt_count === 0,
    "> 1,000 picks -> PARK (no lease, due now, 75, attempts 0)", w.job);
  w.now += 5000;
  const b = runCommit(w);
  ok(b.out.path === "DONE" && w.job.job_status === "COMPLETED", "the next tick finishes phase B", b.out);
  // all lines non-stock (SUBMIT / PREPARE refuse it: defensive) -> no op 1 call, the receipt at assembly_cost only
  const e = X.makeCase({ lines: 0, nonStock: 3 });
  e.manifest.counts.movementsI = 0;
  const we = world(e);
  drive(we);
  ok(we.job.job_status === "COMPLETED" && opCalls(we, "I").length === 0 && Number(inRows(we)[0].unit_price) === 1.25, "empty ENGINE_I: no op 1 call, the receipt at the assembly cost", inRows(we)[0]);
  // prevStatus unknown + a phase-A refusal -> REQUIRES_REVIEW IA_PREV_STATUS_UNKNOWN, no unlock (no default)
  for (const prev of ["In Progress", null]) {
    const wp = world(X.makeCase({ batch: true }), { request: { prevStatus: prev }, faults: { ["IAC|" + JOB + "|I|APPLY"]: ["400"] } });
    drive(wp);
    ok(wp.job.job_status === "REQUIRES_REVIEW" && wp.job.error_code === "IA_PREV_STATUS_UNKNOWN" && wp.ia.item_assembly_status === "Processing" && wp.batchDeletes.length === 0,
      "prevStatus " + J(prev) + " + I2 400 -> REQUIRES_REVIEW, no unlock, nothing else written", wp.job);
  }
  // RES-01 Created (BA, 10-22): a Created IA's job (prevStatus Created) + an I2 refusal -> FAILED, the IA back to Created
  {
    const wcr = world(X.makeCase({ batch: true }), { request: { prevStatus: "Created" }, faults: { ["IAC|" + JOB + "|I|APPLY"]: ["400"] } });
    drive(wcr);
    ok(wcr.job.job_status === "FAILED" && wcr.ia.item_assembly_status === "Created" && wcr.mv.length === 0, "prevStatus Created + I2 400 -> FAILED, back to Created, nothing moved",
      { job: wcr.job.job_status, ia: wcr.ia.item_assembly_status });
  }
  // I0: the lines changed after PREPARE -> FAILED IA_LINES_CHANGED + Draft before any write
  const wl = world(X.makeCase({}));
  wl.lines[0].temp_qty_data = JSON.stringify([{ balance_id: X.balId(1), location_id: X.binOf(1), batch_id: "", category: "Unrestricted", sm_quantity: 9 }]);
  drive(wl);
  failed(wl, "IA_LINES_CHANGED", "I0 lines changed");
  console.log("ok   PARK at 1,002 picks; empty ENGINE_I; prevStatus unknown -> review; I0 lines changed -> FAILED");
}

// ------------------------------------------------------------------ 6. node data at 830 and 2,000 picks (outputs; + recorded inputs)
{
  const rows = [];
  for (const [label, o] of [["830", { lines: 415, picks: 2, nonStock: 3, batch: true }], ["2000", { lines: 1000, picks: 2, nonStock: 3 }]]) {
    const c = X.makeCase(o);
    const w = world(c);
    drive(w);
    ok(w.job.job_status === "COMPLETED", label + " picks: COMPLETED", w.job);
    const mb = (b) => (b / 1048576).toFixed(1);
    const [A, B] = w.sizes;
    ok(A.out <= 20 * 1048576 && B.out <= 10 * 1048576 && A.out + A.in <= 30 * 1048576, label + " picks: COMMIT A " + mb(A.out) + " MB outputs (" + mb(A.out + A.in) + " with inputs), B " + mb(B.out) + " MB", w.sizes);
    rows.push(label + " picks: A " + mb(A.out) + " / " + mb(A.out + A.in) + " MB, B " + mb(B.out) + " / " + mb(B.out + B.in) + " MB");
  }
  console.log("ok   node data (outputs / with recorded inputs): " + rows.join("; "));
}

console.log(checks + " checks passed");
