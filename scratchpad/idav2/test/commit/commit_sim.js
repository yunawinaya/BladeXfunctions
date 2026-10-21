// node test/commit/commit_sim.js - the BUILT IDA_V2_COMMIT on the interpreter (lib/sim/engine.js) against the in-memory world (world.js:
// INVENTORY_BULK_APPLY = the deployed planner of base/INVENTORY_BULK_APPLY.v10.json). Nothing touches a database.
// Happy paths (non-batch; TYPED incl. a number shared by two lines of one item; AUTO = what N GENERATE_BATCH calls give; mixed; an alt-UOM
// line; non-stock lines incl. a non-stock LAST line; Fixed Cost; WA); a crash right after EVERY write, then the resume (same end state, the
// engine answers REPLAYED, op 2's request byte-identical); every D1 row 1-14; D2 400 / 409 x 8 / envelope / no answer / 500; D3 409 up
// to the deadline, op 1 under review, a count mismatch, R "401", 400 / 500; the IDA soft-deleted before D0 and after D2; PARK above
// 1,000 movements on either leg; node data at 2,000 and 5,000 lines.
const W = require("./world.js");
const { assert, X, J, fmt, parse, TERMINAL, world, runCommit, drive, liveBatches, stepNames, opCalls } = W;
X.utc8(__filename);
const { JOB, IDAID, ORG, IDANO } = X;
let checks = 0;
const ok = (cond, what, extra) => { checks++; assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 1500))); };
const outRows = (w) => w.mv.filter((m) => !m.is_deleted && m.movement === "OUT" && String(m.operation_effect_key).indexOf("IDC|" + JOB + "|I|") === 0);
const inRows = (w) => w.mv.filter((m) => !m.is_deleted && m.movement === "IN" && String(m.operation_effect_key).indexOf("IDC|" + JOB + "|R|") === 0);
const keyOf = (m) => String(m.operation_effect_key).split("|").pop();
const batchOf = (w, id) => w.batches.find((b) => b.id === id) || null;
const MIX = [{ kind: "none" }, { kind: "typed", number: "LOT-7", item: 50 }, { kind: "typed", number: "LOT-7", item: 50 }, { kind: "auto" }, { kind: "ns" }, { kind: "nsauto" }, { kind: "auto", alt: true }];

// the expected receipt per R key: idaAllocate over the STORED OUT rows' total (classic code_cost_alloc, per base unit); Fixed Cost = the
// item's purchase_unit_price whatever is sent
function expectedPrices(w, c) {
  const issued = W.decSum(outRows(w).map((m) => m.total_price));
  const al = X.P.idaAllocate(issued, c.alloc);
  const out = {};
  c.alloc.forEach((a, i) => { if (a.movement_key) out[a.movement_key] = { value: al[i].value, unit: al[i].unit_price, base: a.base_qty, item: a.item_id, batchKey: a.batch_key, lineId: a.line_id }; });
  return { issued: issued, lines: out, values: al };
}
function expectCompleted(w, c, label, skipped) {
  const skip = skipped || [];
  ok(w.job.job_status === "COMPLETED" && w.job.progress_percent === 100 && w.job.lease_owner === null && w.job.finished_at && w.job.error_code === null, label + ": job COMPLETED 100, lease released", w.job);
  ok(w.ida.item_disassembly_status === "Completed" && w.ida.posted_status === "Unposted", label + ": the IDA Completed / Unposted", [w.ida.item_disassembly_status, w.ida.posted_status]);
  ok(w.engine.applied["IDC|" + JOB + "|I"] === 1 && w.engine.applied["IDC|" + JOB + "|R"] === 1, label + ": op 1 and op 2 each applied exactly once", w.engine.applied);
  ok(outRows(w).length === c.movementsI.length && inRows(w).length === c.movementsR.length - skip.length && !inRows(w).some((m) => skip.indexOf(keyOf(m)) >= 0),
    label + ": one OUT row per pick, one IN row per stock-controlled line" + (skip.length ? " (" + skip.join(", ") + " skipped)" : ""), { out: outRows(w).length, in: inRows(w).length });
  const d3ref = JSON.parse((w.steps.find((r) => r.job_id === JOB && r.step_name === "D3_RECEIPT") || {}).result_ref || "{}");
  ok(J(d3ref.skipped) === J(skip) && d3ref.skipped_count === skip.length && (skip.length ? skip.every((k) => w.job.progress_message.indexOf(k) >= 0) : !/skipped/.test(w.job.progress_message)),
    label + ": the D3 DONE ref and the job's message name the skipped receipts (" + (skip.join(", ") || "none") + ")", { d3ref, msg: w.job.progress_message });
  const exp = expectedPrices(w, c);
  const byNumber = {};
  for (const b of liveBatches(w)) byNumber[b.id] = b;
  let received = 0;
  let expectedReceived = 0;
  let bound = 1e-9;
  for (const r of inRows(w)) {
    const e = exp.lines[keyOf(r)];
    const item = w.items[e.item];
    const fixed = item.material_costing_method === X.FIXED;
    const unit = fixed ? X.C.idaQ8(item.purchase_unit_price) : e.unit;
    ok(Number(r.unit_price) === unit && Number(r.base_qty) === Number(e.base), label + ": " + keyOf(r) + " received at " + unit + " per base unit (" + (fixed ? "Fixed Cost" : "its allocated value / base qty") + ")", { r, e });
    if (!fixed) {
      ok(Math.abs(Number(r.total_price) - e.value) <= Number(e.base) * 1e-8 + 1e-9, label + ": " + keyOf(r) + " stored IN total = its line value up to q8", { total: r.total_price, value: e.value });
      received += Number(r.total_price);
      expectedReceived += e.value;
      bound += Number(e.base) * 1e-8 + 1e-9;
    }
    const want = e.batchKey ? c.batchRows.find((b) => b.key === e.batchKey) : null;
    if (want) {
      const b = batchOf(w, r.batch_number_id);
      const n = want.kind === "AUTO" ? (w.numbers || {})[want.key] : want.batch_number;
      ok(b && !b.is_deleted && b.batch_number === n && b.material_id === e.item && b.transaction_no === IDANO, label + ": " + keyOf(r) + " received on its own live Batch row " + n, { r, b });
    } else ok(r.batch_number_id === null, label + ": " + keyOf(r) + " (no batch) received without a batch", r);
  }
  ok(Math.abs(received - expectedReceived) <= bound, label + ": the received value = the allocated value of the stock lines (up to each line's q8 residue)", { received, expectedReceived, bound });
  const live = liveBatches(w).filter((b) => b.transaction_no === IDANO);
  ok(live.length === c.batchRows.filter((r) => r.insert !== false).length && live.every((b) => /^[0-9]+\.[0-9]{8}$/.test(b.initial_quantity)), label + ": one live Batch row per planned row with insert true", live);
  const autos = c.batchRows.filter((r) => r.kind === "AUTO");
  const lineNo = (id) => (w.lines.find((l) => l.id === id) || {}).batch_number;
  ok(autos.every((r) => lineNo(r.line_ids[0]) === (w.numbers || {})[r.key]), label + ": every AUTO line holds its generated number (the non-stock ones too)", autos.map((r) => [r.key, lineNo(r.line_ids[0])]));
  ok(Number(w.bnc[0].running_number) === 631 + autos.length, label + ": the config advanced by the AUTO rows (" + autos.length + ")", w.bnc[0]);
  ok(J(Object.keys(w.itemDates).sort()) === J(c.itemIds.slice().sort()), label + ": Item dates for the source and every recovery item (non-stock included)", Object.keys(w.itemDates).length);
  const want = ["D0_REVALIDATE:DONE", "D2_ISSUE:DONE", "D3_RECEIPT:DONE", "D4_FINISH:DONE"].concat(c.batchMode === "insert" ? ["D1_BATCH:DONE", "D1|I|001:INTENT"] : []).sort();
  ok(J(stepNames(w)) === J(want), label + ": step rows", stepNames(w));
  ok(w.violations.length === 0, label + ": no forbidden write", w.violations);
}
// the AUTO numbers N sequential GENERATE_BATCH calls give on 000000's config (Batch-%5d, next 631), in AUTO row (= line) order
const numbersOf = (c, running) => {
  const n = {};
  c.batchRows.filter((r) => r.kind === "AUTO").forEach((r, i) => { n[r.key] = X.autoNumber(i, running); });
  return n;
};
const state = (w) => ({ ida: [w.ida.item_disassembly_status, w.ida.posted_status], bal: w.bal.map((b) => [b.material_id, b.location_id, b.unrestricted_qty, b.balance_quantity]).sort(),
  bbal: w.bbal.map((b) => [b.material_id, b.location_id, (batchOf(w, b.batch_id) || {}).batch_number, b.unrestricted_qty]).sort(), fifo: w.fifo.map((l) => [l.material_id, (batchOf(w, l.batch_id) || {}).batch_number || "",
    l.fifo_sequence, l.fifo_cost_price, l.fifo_available_quantity]).sort(), wa: w.wa.map((r) => [r.material_id, r.wa_quantity, r.wa_cost_price]).sort(),
  mv: w.mv.map((m) => [m.operation_effect_key, m.quantity, m.unit_price, m.total_price, (batchOf(w, m.batch_number_id) || {}).batch_number || ""]).sort(),
  batches: liveBatches(w).map((b) => [b.batch_number, b.material_id, b.plant_id, b.transaction_no, b.initial_quantity]).sort(), lines: w.lines.map((l) => l.batch_number), bnc: w.bnc.map((b) => b.running_number),
  steps: stepNames(w), items: Object.keys(w.itemDates).sort() });
const failed = (w, code, label) => {
  ok(w.job.job_status === "FAILED" && w.job.error_code === code && w.job.lease_owner === null, label + ": FAILED " + code, w.job);
  ok(w.ida.item_disassembly_status === "Draft" && w.mv.length === 0, label + ": back to Draft, nothing moved", { ida: w.ida.item_disassembly_status, mv: w.mv.length });
  ok(liveBatches(w).filter((b) => b.ours).length === 0 && w.violations.length === 0, label + ": no live Batch row of ours left", { batches: liveBatches(w), v: w.violations });
};
const review = (w, code, label) => {
  ok(w.job.job_status === "REQUIRES_REVIEW" && w.job.error_code === code && w.ida.item_disassembly_status === "Processing" && w.idaWrites.indexOf("Draft") < 0 && w.batchDeletes.length === 0 && w.violations.length === 0,
    label + ": REQUIRES_REVIEW " + code + ", the IDA stays Processing, nothing unlocked or removed", { job: w.job, ida: w.ida.item_disassembly_status, del: w.batchDeletes, v: w.violations });
};

// ------------------------------------------------------------------ 1. happy paths
const CASES = {
  plain: { n: 5 },
  typed: { lines: [{ kind: "typed", number: "LOT-7", item: 50 }, { kind: "none" }, { kind: "typed", number: "lot-7 ", item: 50 }, { kind: "typed", number: "LOT-9", item: 51 }] },
  auto: { lines: [{ kind: "auto" }, { kind: "auto" }, { kind: "auto", item: 1 }, { kind: "none" }] },
  mixed: { lines: MIX },
  altuom: { lines: [{ kind: "none" }, { kind: "none", alt: true, qty: 2.5 }, { kind: "auto", alt: true }] },
  nslast: { lines: [{ kind: "none" }, { kind: "auto" }, { kind: "ns" }, { kind: "nsauto" }] },
  fixed: { lines: [{ kind: "none", cost: X.FIXED }, { kind: "none" }, { kind: "typed", number: "FX-1", cost: X.FIXED }] },
  wa: { lines: [{ kind: "none", cost: X.WA }, { kind: "none", cost: X.WA }, { kind: "none" }] },
  // 260 AUTO rows + shared TYPED rows: two Batch insert slices, two line-number slices, two Item-stamp slices
  slices: { n: 520, pattern: (i) => (i % 2 ? { kind: "auto" } : i % 10 === 0 ? { kind: "typed", number: "S-" + (i % 30), item: 900 + (i % 30) } : { kind: "none" }) },
};
const clean = {};
for (const [name, o] of Object.entries(CASES)) {
  const c = X.makeCase(o);
  const w = world(c);
  w.numbers = numbersOf(c);
  const a = runCommit(w);
  ok(!a.err && a.out.path === "SPLIT" && w.job.job_status === "COMMITTING_IDA" && /^SPLIT\|/.test(w.job.lease_owner) && w.job.progress_percent === 75 && w.job.attempt_count === 0, name + ": phase A ends SPLIT at 75", { a, job: w.job });
  ok(w.ida.item_disassembly_status === "Processing" && outRows(w).length === c.movementsI.length && inRows(w).length === 0, name + ": after phase A op 1 moved, op 2 not yet, the IDA Processing");
  const b = runCommit(w);
  ok(!b.err && b.out.path === "DONE" && b.out.job_status === "COMPLETED", name + ": phase B -> DONE", b);
  expectCompleted(w, c, name);
  ok(J(w.idaWrites) === J(["Completed"]), name + ": the IDA written once (Completed)", w.idaWrites);
  const calls = w.engine.calls.map((x) => x.op.slice(-1) + " " + x.mode);
  ok(J(calls) === J((c.batchRows.some((r) => r.insert !== false) ? ["R PLAN"] : []).concat(["I APPLY", "R APPLY"])) && w.engine.calls.every((x) => x.keys === "mode,movements,operation_key,organization_id"),
    name + ": engine calls (re-PLAN only when a Batch row inserts), each with the 4 params only (alloc never sent)", calls);
  const again = runCommit(w);
  ok(!again.err && again.out.path === "NO_WRITE" && w.job.job_status === "COMPLETED" && opCalls(w, "R").length === 1, name + ": a re-run of a COMPLETED job writes nothing", again.out);
  clean[name] = { c, state: state(w), writes: w.writes.slice(), opR: opCalls(w, "R").map((x) => x.text), sizes: w.sizes.slice() };
  console.log("ok   " + name + ": " + w.writes.length + " writes, " + inRows(w).length + " receipts, " + liveBatches(w).length + " Batch row(s)");
}
{
  // TYPED: one Batch row per (item, number) shared by two lines of one item (case / trailing spaces as one, the first line's text)
  const c = clean.typed.c;
  const rows = c.batchRows;
  ok(rows.length === 2 && J(rows[0].line_ids) === J([X.lineId(1), X.lineId(3)]) && rows[0].batch_number === "LOT-7" && rows[0].initial_quantity === X.C.idaQtyStr(X.C.idaQ8(c.lines[0].total_quantity) + X.C.idaQ8(c.lines[2].total_quantity)),
    "TYPED: lines 1 and 3 (LOT-7 / 'lot-7 ') share ONE Batch row, initial_quantity = their base-qty sum", rows);
  // AUTO: the numbers N GENERATE_BATCH calls give, in line order
  const ca = clean.auto.c;
  ok(J(clean.auto.state.lines) === J(["Batch-00631", "Batch-00632", "Batch-00633", "-"]), "AUTO: Batch-00631 / 632 / 633 in line order (as the classic's GENERATE_BATCH loop), the config 631 -> 634", clean.auto.state.lines);
  ok(ca.batchRows.length === 3 && clean.auto.state.batches.length === 3, "AUTO: one Batch row per AUTO line (two lines of one item -> two rows)");
  // non-stock lines incl. the LAST: their value is not received (classic parity: ADD answers 401)
  const cn = clean.nslast.c;
  const wn = world(cn);
  wn.numbers = numbersOf(cn);
  drive(wn);
  const exp = expectedPrices(wn, cn);
  const inTotal = inRows(wn).reduce((t, m) => t + Number(m.total_price), 0);
  const nsValue = exp.values[2].value + exp.values[3].value;
  ok(Math.abs(inTotal - (Number(exp.issued) - nsValue)) < 1e-6 && exp.values[3].value > 0 && inRows(wn).length === 2, "non-stock LAST line: the issued value minus the non-stock lines' shares is received (" + inTotal.toFixed(8) + ")",
    { inTotal, issued: exp.issued, nsValue });
  ok(wn.lines[3].batch_number === "Batch-00632" && liveBatches(wn).length === 1, "non-stock AUTO line: consumes Batch-00632 (written into the line), no Batch row", wn.lines.map((l) => l.batch_number));
  // the alt-UOM line: received per BASE unit (2.5 x 12 = 30 base units), stored total = the line value up to q8
  const cu = clean.altuom.c;
  const wu = world(cu);
  wu.numbers = numbersOf(cu);
  drive(wu);
  const r2 = inRows(wu).find((m) => keyOf(m) === "R2");
  ok(Number(r2.base_qty) === 30 && Number(r2.quantity) === 2.5, "alt UOM: 2.5 x 12 = 30 base units", r2);
  // Fixed Cost: received at purchase_unit_price whatever is sent; WA: the allocated price, the WA row updated
  const wf = world(clean.fixed.c);
  wf.numbers = numbersOf(clean.fixed.c);
  drive(wf);
  ok(inRows(wf).filter((m) => m.item_id === X.itemId(1) || m.item_id === X.itemId(3)).every((m) => Number(m.unit_price) === 7.25), "Fixed Cost: received at purchase_unit_price 7.25", inRows(wf));
  const ww = world(clean.wa.c);
  drive(ww);
  const waRow = ww.wa.find((r) => r.material_id === X.itemId(1));
  const r1 = inRows(ww).find((m) => keyOf(m) === "R1");
  ok(Number(waRow.wa_quantity) === 4 + Number(r1.base_qty) && Math.abs(Number(waRow.wa_cost_price) - X.C.idaQ8((3.5 * 4 + Number(r1.unit_price) * Number(r1.base_qty)) / (4 + Number(r1.base_qty)))) < 1e-8,
    "WA: the WA row moved to the weighted price of the receipt", { waRow, r1 });
  // the price comes from the STORED OUT rows (prod's 4 dp rule), not the APPLY answer's unrounded totals
  const cp = X.makeCase({ lines: MIX, pickQty: 2.3 });
  const wp = world(cp, { precision: X.PRECISION });
  wp.numbers = numbersOf(cp);
  drive(wp);
  const answered = JSON.parse(wp.steps.find((r) => r.job_id === "IDC|" + JOB + "|I" && r.step_name === "IBA|DONE").result_ref).results.map((r) => r.total_price);
  const stored = W.decSum(outRows(wp).map((m) => m.total_price));
  const r1p = inRows(wp).find((m) => keyOf(m) === "R1");
  ok(Number(answered[0]) !== Number(stored) && Number(r1p.unit_price) === Number(X.C.idaQ8(X.P.idaAllocate(stored, cp.alloc)[0].unit_price).toFixed(4)), "the receipt is priced from the stored rows (" + stored + "), not the answer's (" + answered[0] + ")",
    { answered, stored, r1p });
  console.log("ok   TYPED shared row; AUTO numbers in line order; non-stock last line not received; alt UOM per base unit; Fixed Cost; WA; price from the stored rows");
}

// ------------------------------------------------------------------ 2. a crash right after every write, then the resume
ok(clean.slices.writes.filter((x) => /^batch insert x/.test(x)).length === 2 && clean.slices.writes.filter((x) => /^update Stock movement/.test(x)).length === 2
  && clean.slices.writes.filter((x) => /^update Item x/.test(x)).length === Math.ceil(clean.slices.c.itemIds.length / 250) && clean.slices.c.itemIds.length > 250,
  "slices: 2 Batch insert calls, 2 line-number calls, " + Math.ceil(clean.slices.c.itemIds.length / 250) + " Item-stamp calls (<= 250 rows each)", clean.slices.writes);
for (const name of ["plain", "mixed", "slices"]) {
  const total = clean[name].writes.length;
  for (let k = 1; k <= total; k++) {
    const c = X.makeCase(CASES[name]);
    const w = world(c, { crashAfter: k });
    w.numbers = numbersOf(c);
    const runs = drive(w);
    const what = w.crashed;
    ok(runs.filter((r) => r.err).length === 1, name + " crash@" + k + ": one run died right after write " + k + " (" + what + ")", runs.map((r) => r.err || r.out.path));
    ok(w.job.job_status === "COMPLETED", name + " crash@" + k + " (" + what + "): resumed to COMPLETED", { job: w.job, runs: runs.map((r) => r.err || r.out.path + " " + r.out.result_code) });
    expectCompleted(w, c, name + " crash@" + k);
    const st = state(w);
    for (const key of Object.keys(st)) ok(J(st[key]) === J(clean[name].state[key]), name + " crash@" + k + ": " + key + " = the clean run's", { got: st[key], want: clean[name].state[key] });
    const reqs = opCalls(w, "R").map((x) => x.text);
    ok(reqs.length >= 1 && reqs.every((t) => t === clean[name].opR[0]), name + " crash@" + k + ": op 2's request byte-identical to the clean run's", reqs.length);
    if (/engine APPLY IDC\|[0-9]+\|I$/.test(String(what))) ok(opCalls(w, "I").length === 2, name + " crash@" + k + ": op 1 called again and answered REPLAYED", opCalls(w, "I").length);
    if (/engine APPLY IDC\|[0-9]+\|R$/.test(String(what))) ok(opCalls(w, "R").length === 2, name + " crash@" + k + ": op 2 called again (same request) and answered REPLAYED", opCalls(w, "R").length);
  }
  console.log("ok   " + name + ": a crash after each of the " + total + " writes, then the resume -> the clean run's end state, op 1 / op 2 applied once, op 2's request identical");
}
{
  // a crash between D2 DONE and D3 (the SPLIT hand-over never written): the resumed phase B sends op 2 the same request
  const c = X.makeCase(CASES.mixed);
  const k = clean.mixed.writes.indexOf("step D2_ISSUE") + 1;
  const w = world(c, { crashAfter: k });
  w.numbers = numbersOf(c);
  drive(w);
  ok(w.crashed === "step D2_ISSUE" && w.job.job_status === "COMPLETED" && J(opCalls(w, "R").map((x) => x.text)) === J(clean.mixed.opR), "crash between D2 DONE and D3: op 2's request is the clean run's", w.crashed);
}

// ------------------------------------------------------------------ 3. the D1 decision table, rows 1-14, on the interpreter
{
  const corrupt = (c, f) => {
    const b = JSON.parse(J(c.parts.BATCH));
    f(b);
    return c.partStepRows.filter((r) => r.step_name.indexOf("P|" + X.NONCE + "|BATCH|") !== 0).concat(X.C.idaPartRows(JOB, ORG, "P|" + X.NONCE + "|BATCH|", b, "PAYLOAD"));
  };
  // row 1: the part unreadable / a row without kind
  let c = X.makeCase(CASES.mixed);
  let w = world(c, { partStepRows: corrupt(c, (b) => { b.rows[1].kind = ""; }) });
  drive(w);
  failed(w, "IDA_INVALID_DATA", "D1 row 1");
  ok(w.batches.length === 0 && w.cfgWrites.length === 0 && w.engine.calls.length === 0, "D1 row 1: no Batch row, no config written, no engine call");
  // row 2: an intent that does not parse
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.steps.push({ id: w.id(), job_id: JOB, step_name: "D1|I|001", step_status: "INTENT", result_ref: "{broken", is_deleted: 0 });
  drive(w);
  review(w, "IDA_RECONCILIATION_MISMATCH", "D1 row 2");
  // row 3: no default batch_number_config -> FAILED with GENERATE_BATCH's text, nothing written
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.bnc[0].is_deleted = 1;
  drive(w);
  failed(w, "IDA_BATCH_CONFIG", "D1 row 3");
  ok(w.job.error_message === "No default batch found: nothing was moved" && w.steps.every((r) => r.step_name.indexOf("D1|I|") !== 0) && w.batches.length === 0, "D1 row 3: GENERATE_BATCH's text, no intent, no row", w.job);
  // row 3 (intent): the config gone after the inserts -> FAILED + ours soft-deleted
  c = X.makeCase(CASES.mixed);
  w = world(c, { crashAfter: clean.mixed.writes.indexOf("batch insert x3") + 1 });
  runCommit(w);
  ok(w.crashed === "batch insert x3" && liveBatches(w).length === 3, "D1 row 3 (intent): crash right after the Batch insert", w.crashed);
  Object.assign(w, { crashAfter: 0, now: w.now + 11 * 60000 });
  w.bnc[0].is_deleted = 1;
  drive(w);
  failed(w, "IDA_BATCH_CONFIG", "D1 row 3 (intent)");
  ok(/batch number configuration 2062365526375706626 no longer exists/.test(w.job.error_message) && w.batchDeletes.length === 3, "D1 row 3 (intent): ours (3) soft-deleted", w.job.error_message);
  // row 4: a generated number held by another org row (any item) -> FAILED, the config NOT advanced
  c = X.makeCase(CASES.mixed);
  w = world(c, { batches: [{ id: "2111900000000000001", batch_number: "BATCH-00632", material_id: X.itemId(90), plant_id: X.PLANT, organization_id: ORG, transaction_no: "GR-2610-0007", is_deleted: 0, initial_quantity: "1.00000000" }] });
  drive(w);
  failed(w, "IDA_BATCH_DUPLICATE", "D1 row 4");
  ok(w.job.error_message === "Duplicate Batch Format found. (batch number Batch-00632) Nothing was moved." && w.cfgWrites.length === 0 && w.batches.length === 1 && w.batches[0].is_deleted === 0 && w.engine.calls.length === 0,
    "D1 row 4: GENERATE_BATCH's refusal, no config advance, the other row untouched, no engine call", w.job);
  // row 5: the TYPED number taken since SUBMIT -> FAILED with code_validate's wording
  c = X.makeCase(CASES.mixed);
  w = world(c, { batches: [{ id: "2111900000000000002", batch_number: "LOT-7", material_id: X.itemId(91), plant_id: X.PLANT, organization_id: ORG, transaction_no: "GD-1", is_deleted: 0, initial_quantity: "1.00000000" }] });
  drive(w);
  failed(w, "IDA_BATCH_DUPLICATE", "D1 row 5");
  ok(w.job.error_message === "Line 2 (Part 50): Batch No LOT-7 already exists. Nothing was moved." && w.partReads.some((x) => /d1dlab:LABELS/.test(x)), "D1 row 5: 'Line 2 (Part 50): Batch No LOT-7 already exists. Nothing was moved.'", w.job.error_message);
  // a holder in ANOTHER organization is not a duplicate
  c = X.makeCase(CASES.mixed);
  w = world(c, { batches: [{ id: "2111900000000000003", batch_number: "LOT-7", material_id: X.itemId(91), plant_id: X.PLANT, organization_id: "1123598813738675299", transaction_no: "GD-1", is_deleted: 0, initial_quantity: "1.00000000" }] });
  w.numbers = numbersOf(c);
  drive(w);
  ok(w.job.job_status === "COMPLETED", "D1: a holder of another organization does not count", w.job);
  // rows 6 / 7: after the inserts (crash) another row takes one of our numbers / one of ours is duplicated
  for (const [label, add, code] of [["row 6", (x) => ({ id: x.id(), batch_number: "Batch-00631", material_id: X.itemId(92), plant_id: X.PLANT, organization_id: ORG, transaction_no: "GR-1", is_deleted: 0 }), "IDA_BATCH_DUPLICATE"],
    ["row 7", (x) => Object.assign({}, liveBatches(x).find((b) => b.batch_number === "Batch-00633"), { id: x.id(), ours: true }), "IDA_BATCH_FAILED"]]) {
    c = X.makeCase(CASES.mixed);
    w = world(c, { crashAfter: clean.mixed.writes.indexOf("batch insert x3") + 1 });
    runCommit(w);
    w.batches.push(add(w));
    Object.assign(w, { crashAfter: 0, now: w.now + 11 * 60000 });
    w.job.attempt_count += 1;
    drive(w);
    failed(w, code, "D1 " + label);
    ok(w.batchDeletes.length === (label === "row 7" ? 4 : 3) && liveBatches(w).length === (label === "row 6" ? 1 : 0), "D1 " + label + ": ours soft-deleted (" + (label === "row 7" ? "all four" : "the foreign row kept") + ")",
      { del: w.batchDeletes, live: liveBatches(w) });
  }
  // row 9: an insert that never reads back -> retry, the next pass inserts again -> COMPLETED; persistently -> FAILED after 3 retries
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.numbers = numbersOf(c);
  let lost = 1;
  w.batchInsertHook = () => (lost-- > 0 ? false : true);
  drive(w);
  ok(w.job.job_status === "COMPLETED" && w.writes.some((x) => /lost/.test(x)) && liveBatches(w).length === 3 && w.cfgWrites.length === 1, "D1 row 9: a lost insert -> retry -> the rows inserted once, COMPLETED (the config written once)",
    { job: w.job.job_status, writes: w.writes });
  expectCompleted(w, c, "D1 row 9 (retried)");
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.batchInsertHook = () => false;
  drive(w);
  failed(w, "IDA_BATCH_FAILED", "D1 row 9 (persistent)");
  ok(/missing after the insert/.test(w.job.error_message) && w.writes.filter((x) => /lost/.test(x)).length === 4, "D1 row 9: 4 passes (3 retries) then FAILED IDA_BATCH_FAILED", w.writes.filter((x) => /lost/.test(x)).length);
  // row 10: a concurrent writer inserts one of our numbers in the read-write window -> the post-insert re-check FAILS the job
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.batchInsertHook = (x) => {
    if (!x.raced) {
      x.raced = true;
      x.batches.push({ id: x.id(), batch_number: "batch-00633", material_id: X.itemId(93), plant_id: X.PLANT, organization_id: ORG, transaction_no: "GD-2610-0001", is_deleted: 0, initial_quantity: "1.00000000" });
    }
    return true;
  };
  drive(w);
  failed(w, "IDA_BATCH_DUPLICATE", "D1 row 10");
  ok(w.job.error_message === "Duplicate Batch Format found. (batch number Batch-00633) Nothing was moved." && w.batchDeletes.length === 3 && liveBatches(w).length === 1 && w.engine.calls.length === 0,
    "D1 row 10: ours (3) soft-deleted, the other writer's row kept, no engine call", w.job);
  // row 11: nothing inserts (only a non-stock AUTO row) -> no re-PLAN, D1 DONE
  c = X.makeCase({ lines: [{ kind: "none" }, { kind: "nsauto" }] });
  w = world(c);
  w.numbers = numbersOf(c);
  drive(w);
  expectCompleted(w, c, "D1 row 11 (nothing inserts)");
  ok(opCalls(w, "R", "PLAN").length === 0 && JSON.parse(w.steps.find((r) => r.step_name === "D1_BATCH").result_ref).inserted === 0, "D1 row 11: no planned row inserts -> the re-PLAN is skipped (ruling 21)");
  // row 12: the re-PLAN refuses an R (the typed item's stock_control flipped to 0 after PREPARE) -> FAILED IDA_PLAN_SKIPPED + ours
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.items[X.itemId(50)].stock_control = 0;
  drive(w);
  failed(w, "IDA_PLAN_SKIPPED", "D1 row 12");
  ok(/line 2 \(RM-0050\), into bin BIN-002 \(Unrestricted\): nothing was moved\.$/.test(w.job.error_message) && w.batchDeletes.length === 3 && opCalls(w, "I").length === 0, "D1 row 12: LABELS-worded, ours soft-deleted, op 1 never called",
    w.job.error_message);
  // row 13: the re-PLAN answers 400 with a result_code -> FAILED IDA_INVENTORY_<code> + ours
  c = X.makeCase(CASES.mixed);
  w = world(c, { faults: { ["IDC|" + JOB + "|R|PLAN"]: ["400"] } });
  drive(w);
  failed(w, "IDA_INVENTORY_INSUFFICIENT", "D1 row 13");
  ok(w.batchDeletes.length === 3 && /line 1 \(RM-0001\)/.test(w.job.error_message), "D1 row 13: LABELS-worded, ours soft-deleted", w.job.error_message);
  // row 14: no answer once -> retry -> COMPLETED; no answer 4 times -> FAILED IDA_PLAN_FAILED + ours
  c = X.makeCase(CASES.mixed);
  w = world(c, { faults: { ["IDC|" + JOB + "|R|PLAN"]: ["null"] } });
  w.numbers = numbersOf(c);
  drive(w);
  expectCompleted(w, c, "D1 row 14 (no answer once)");
  ok(opCalls(w, "R", "PLAN").length === 2 && liveBatches(w).length === 3, "D1 row 14: the retry adopts the rows (not inserted again) and re-PLANs", opCalls(w, "R", "PLAN").length);
  c = X.makeCase(CASES.mixed);
  w = world(c, { faults: { ["IDC|" + JOB + "|R|PLAN"]: ["null", "409", "400env", "null"] } });
  drive(w);
  failed(w, "IDA_PLAN_FAILED", "D1 row 14 (persistent)");
  ok(w.batchDeletes.length === 3 && opCalls(w, "R", "PLAN").length === 4, "D1 row 14: 4 re-PLANs, then FAILED, ours soft-deleted", opCalls(w, "R", "PLAN").length);
  console.log("ok   D1 rows 1-14: part unusable, intent unreadable, config refusals, generated / typed numbers taken, a foreign / twice row after a crash, lost inserts, the post-insert re-check, no re-PLAN, re-PLAN refusals and silence");
}

// ------------------------------------------------------------------ 4. D2: op 1
{
  // 400 -> FAILED, LABELS-worded, Draft, our Batch rows soft-deleted
  let c = X.makeCase(CASES.mixed);
  let w = world(c, { faults: { ["IDC|" + JOB + "|I|APPLY"]: ["400"] } });
  drive(w);
  failed(w, "IDA_INVENTORY_INSUFFICIENT", "D2 400");
  ok(w.job.error_message === "Insufficient quantity - source pick 1 (FG-0001), bin SRC-505 (Unrestricted)" && w.batchDeletes.length === 3 && J(w.idaWrites) === J(["Draft"]), "D2 400: worded, unlock -> Batch soft-delete (3)",
    w.job);
  const order = w.writes.slice(-3);
  ok(/^update Item Disassembly/.test(order[0]) && /^update Batch x3/.test(order[1]) && /^update GD Async Job/.test(order[2]), "D2 400: the exit order unlock -> Batch rows -> job", order);
  // a real shortfall (the planner's own refusal)
  c = X.makeCase(Object.assign({}, CASES.mixed, { pickQty: 200000 }));
  w = world(c);
  drive(w);
  failed(w, "IDA_INVENTORY_INSUFFICIENT", "D2 shortfall");
  // 409 x 9 -> lock waits 15 s x 2^n (cap 300 s), then FAILED IDA_INVENTORY_LOCK_BUSY + Draft + ours soft-deleted
  c = X.makeCase(CASES.mixed);
  w = world(c, { faults: { ["IDC|" + JOB + "|I|APPLY"]: Array(20).fill("409") } });
  const waits = [];
  for (let i = 0; i < 14 && TERMINAL.indexOf(w.job.job_status) < 0; i++) {
    const before = w.now;
    runCommit(w);
    if (w.job.error_code === "IDA_LOCK_WAIT") {
      waits.push(Math.round((parse(w.job.next_attempt_at) - before) / 1000));
      w.now = parse(w.job.next_attempt_at) + 1000;
    }
  }
  ok(J(waits) === J([15, 30, 60, 120, 240, 300, 300, 300]), "D2 409: 8 lock waits 15 s x 2^n capped at 300 s", waits);
  failed(w, "IDA_INVENTORY_LOCK_BUSY", "D2 409 x 9");
  ok(opCalls(w, "I").length === 9 && w.batchDeletes.length === 3 && w.job.error_message === X.C.IDA_TEXT.lockBusy && opCalls(w, "R", "PLAN").length === 1, "D2 409: 9 calls, ours soft-deleted, D1 not redone",
    { calls: opCalls(w, "I").length, del: w.batchDeletes.length });
  // fix round 1 (review Minor 1): a READY_TO_COMMIT job PREPARE retried 3 times -> COMMIT's claim writes attempt_count 0: still 8 lock waits
  c = X.makeCase(CASES.mixed);
  w = world(c, { faults: { ["IDC|" + JOB + "|I|APPLY"]: Array(20).fill("409") } });
  w.job.attempt_count = 3;
  const waits2 = [];
  for (let i = 0; i < 14 && TERMINAL.indexOf(w.job.job_status) < 0; i++) {
    const before = w.now;
    runCommit(w);
    if (w.job.error_code === "IDA_LOCK_WAIT") {
      waits2.push(Math.round((parse(w.job.next_attempt_at) - before) / 1000));
      w.now = parse(w.job.next_attempt_at) + 1000;
    }
  }
  ok(J(waits2) === J([15, 30, 60, 120, 240, 300, 300, 300]) && w.job.error_code === "IDA_INVENTORY_LOCK_BUSY", "READY with PREPARE's 3 attempts: the claim resets the count, still 8 lock waits from 15 s", waits2);
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.numbers = numbersOf(c);
  w.job.attempt_count = 3;
  let lost2 = 1;
  w.batchInsertHook = () => (lost2-- > 0 ? false : true);
  drive(w);
  expectCompleted(w, c, "READY with 3 attempts + a lost insert (D1 retries from 0)");
  // the platform's 400 envelope / no answer once, then 200; applied but no answer -> retry -> REPLAYED
  for (const f of ["400env", "null"]) {
    c = X.makeCase({ n: 4 });
    w = world(c, { faults: { ["IDC|" + JOB + "|I|APPLY"]: [f] } });
    runCommit(w);
    ok(w.job.job_status === "COMMITTING_IDA" && w.job.error_code === "IDA_LOCK_WAIT" && w.job.attempt_count === 1 && w.mv.length === 0, "D2 " + f + " -> a lock wait (no intent row)", w.job);
    drive(w);
    expectCompleted(w, c, "D2 " + f + " then 200");
  }
  c = X.makeCase({ n: 4 });
  w = world(c, { faults: { ["IDC|" + JOB + "|I|APPLY"]: ["applied-none"] } });
  runCommit(w);
  ok(w.job.error_code === "IDA_STEP_RETRY" && w.ida.item_disassembly_status === "Processing", "D2 applied but no answer (intent rows) -> retry, never a lock wait / unlock", w.job);
  drive(w);
  expectCompleted(w, c, "D2 applied-none");
  ok(opCalls(w, "I").length === 2, "D2: the next APPLY replays (REPLAYED), moved once");
  // op 1 answers 500 (its own REQUIRES_REVIEW) -> REQUIRES_REVIEW at once; op 2 is never called; the Batch rows kept
  c = X.makeCase(CASES.mixed);
  w = world(c, { faults: { ["IDC|" + JOB + "|I|APPLY"]: ["500"] } });
  drive(w);
  review(w, "IDA_RECONCILIATION_MISMATCH", "D2 500");
  ok(opCalls(w, "R").length === 0 && liveBatches(w).length === 3, "D2 500: op 2 never applied, the Batch rows kept");
  // prevStatus unknown + a phase-A refusal -> REQUIRES_REVIEW IDA_PREV_STATUS_UNKNOWN, no unlock, nothing removed (no default)
  for (const prev of ["In Progress", null]) {
    c = X.makeCase(CASES.mixed);
    w = world(c, { request: { prevStatus: prev }, faults: { ["IDC|" + JOB + "|I|APPLY"]: ["400"] } });
    drive(w);
    review(w, "IDA_PREV_STATUS_UNKNOWN", "prevStatus " + J(prev) + " + D2 400");
  }
  console.log("ok   D2: 400 (mapped) / shortfall -> FAILED + Draft + ours removed; 409 x 8 waits then FAILED; envelope / no answer -> wait then DONE; applied-no-answer -> REPLAYED; 500 -> review");
}

// ------------------------------------------------------------------ 5. phase B (never unlocks)
{
  // D3: op 2 answers 409 every time -> 10 s waits, attempt_count unchanged, then REQUIRES_REVIEW IDA_RECEIPT_TIMEOUT 30 min after the first
  let c = X.makeCase(CASES.mixed);
  let w = world(c, { faults: { ["IDC|" + JOB + "|R|APPLY"]: Array(400).fill("409") } });
  runCommit(w);
  let waits = 0;
  let first = null;
  for (let i = 0; i < 400 && TERMINAL.indexOf(w.job.job_status) < 0; i++) {
    runCommit(w);
    if (w.job.error_code === "IDA_WAIT") {
      waits++;
      if (first === null) first = w.now;
      ok(w.job.attempt_count === 0 && parse(w.job.next_attempt_at) - w.now === 10000 && w.job.progress_percent === 75, "D3 409: a 10 s wait, not counted, progress 75", w.job);
      w.now = parse(w.job.next_attempt_at);
    }
  }
  review(w, "IDA_RECEIPT_TIMEOUT", "D3 409 x many");
  ok(waits >= 170 && w.now - first > 1800000 && liveBatches(w).length === 3 && inRows(w).length === 0, "D3: " + waits + " waits over 30 min from the first one, then IDA_RECEIPT_TIMEOUT, the Batch rows kept", waits);
  // the runbook's reset (error_details cleared) opens a fresh window: the next 409s wait again, then 200 -> COMPLETED, same request
  Object.assign(w.job, { job_status: "COMMITTING_IDA", attempt_count: 0, lease_owner: null, lease_expires_at: null, next_attempt_at: fmt(w.now), error_code: null, error_message: null, error_details: null, finished_at: null });
  w.engine.faults["IDC|" + JOB + "|R|APPLY"] = ["409"];
  runCommit(w);
  ok(w.job.error_code === "IDA_WAIT" && JSON.parse(w.job.error_details).waitFrom === fmt(w.now), "after the reset: the first 409 waits (a fresh window)", w.job);
  w.numbers = numbersOf(c);
  drive(w);
  expectCompleted(w, c, "D3 after the runbook reset");
  ok(new Set(opCalls(w, "R").map((x) => x.text)).size === 1, "D3: every op 2 call carried the same request", opCalls(w, "R").length);
  // op 1 under review (an IBA|REVIEW although D2 is DONE): op 2 is never started
  c = X.makeCase(CASES.mixed);
  w = world(c);
  runCommit(w);
  w.steps.push({ id: w.id(), job_id: "IDC|" + JOB + "|I", step_name: "IBA|REVIEW", step_status: "REVIEW", result_ref: "", is_deleted: 0 });
  drive(w);
  review(w, "IDA_RECEIPT_COUNT_MISMATCH", "op 1 under review");
  ok(opCalls(w, "R").length === 0, "op 1 under review -> op 2 never called");
  // a stored OUT row missing (count mismatch) -> REQUIRES_REVIEW before op 2
  c = X.makeCase(Object.assign({}, CASES.mixed, { picks: 2 }));
  w = world(c);
  runCommit(w);
  w.mv[0].is_deleted = 1;
  drive(w);
  review(w, "IDA_RECEIPT_COUNT_MISMATCH", "count mismatch");
  ok(opCalls(w, "R").length === 0 && /stored/.test(w.job.error_details), "count mismatch -> op 2 never called", w.job.error_details);
  // controller ruling (fix round 1): an R result "401" (a recovery item's stock_control flipped to 0 after both PLANs) is tolerated like
  // op 1's: COMPLETED, the line's share not received (classic parity: ADD answers 401), R4 named in the D3 DONE ref and on the job
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.numbers = numbersOf(c);
  runCommit(w);
  w.items[X.itemId(4)].stock_control = 0;
  drive(w);
  expectCompleted(w, c, "R 401 tolerated", ["R4"]);
  const exp4 = expectedPrices(w, c);
  const inTotal4 = inRows(w).reduce((t, m) => t + Number(m.total_price), 0);
  const notReceived = exp4.values[4].value + exp4.values[5].value + exp4.lines.R4.value;
  ok(Math.abs(inTotal4 - (Number(exp4.issued) - notReceived)) < 1e-6 && /completed \(1 receipt skipped, stock control 0: R4\)$/.test(w.job.progress_message),
    "R 401: the received value = the issued value minus the non-stock shares and R4's share; the COMPLETED job names R4", { inTotal4, issued: exp4.issued, notReceived, msg: w.job.progress_message });
  ok(liveBatches(w).some((b) => b.batch_number === "Batch-00631" && b.material_id === X.itemId(4)) && w.lines[3].batch_number === "Batch-00631",
    "R 401: the skipped AUTO line keeps its number and its Batch row (no stock on it)", liveBatches(w));
  // a per-movement code other than 200 / 401 inside a 200 stays REQUIRES_REVIEW IDA_RECEIPT_REFUSED
  c = X.makeCase(CASES.mixed);
  w = world(c, { faults: { ["IDC|" + JOB + "|R|APPLY"]: ["r400"] } });
  drive(w);
  review(w, "IDA_RECEIPT_REFUSED", "R per-movement 400");
  ok(/R2 answered 400/.test(w.job.error_details) && inRows(w).length === 0, "R per-movement 400: REQUIRES_REVIEW, nothing received", w.job.error_details);
  const again = runCommit(w);
  ok(again.out.path === "NO_WRITE" && w.job.job_status === "REQUIRES_REVIEW", "a review is terminal for COMMIT (no re-run writes)", again.out);
  for (const f of ["400", "500"]) {
    c = X.makeCase({ n: 3 });
    w = world(c, { faults: { ["IDC|" + JOB + "|R|APPLY"]: [f] } });
    drive(w);
    review(w, "IDA_RECEIPT_REFUSED", "op 2 " + f);
  }
  // a 409, then no answer, then the envelope, then 200 -> DONE (waits are not failures)
  c = X.makeCase({ n: 3 });
  w = world(c, { faults: { ["IDC|" + JOB + "|R|APPLY"]: ["409", "null", "400env"] } });
  drive(w);
  expectCompleted(w, c, "D3 409 / no answer / envelope");
  // the IDA soft-deleted after D2 -> REQUIRES_REVIEW, no unlock, op 2 never called
  c = X.makeCase(CASES.mixed);
  w = world(c);
  runCommit(w);
  w.ida.is_deleted = 1;
  drive(w);
  review(w, "IDA_RECONCILIATION_MISMATCH", "IDA deleted after D2");
  ok(w.idaWrites.length === 0 && opCalls(w, "R").length === 0, "IDA deleted after D2: no write to the deleted row, op 2 never called");
  // R2: the run dies right after op 1's APPLY (before D2 DONE), then the IDA is soft-deleted -> REQUIRES_REVIEW, never "nothing moved"
  c = X.makeCase(CASES.mixed);
  const k = clean.mixed.writes.findIndex((x) => /^engine APPLY IDC\|[0-9]+\|I$/.test(x)) + 1;
  w = world(c, { crashAfter: k });
  runCommit(w);
  ok(/engine APPLY IDC\|[0-9]+\|I$/.test(w.crashed) && !w.steps.some((r) => r.step_name === "D2_ISSUE"), "R2: the run died right after op 1's APPLY, before D2 DONE", w.crashed);
  w.ida.is_deleted = 1;
  Object.assign(w, { crashAfter: 0, now: w.now + 11 * 60000 });
  Object.assign(w.job, { attempt_count: w.job.attempt_count + 1, row_version: w.job.row_version + 1 });
  runCommit(w);
  const d9 = JSON.parse(w.job.error_details);
  ok(w.job.job_status === "REQUIRES_REVIEW" && w.job.error_code === "IDA_RECONCILIATION_MISMATCH" && d9.step === "D2_ISSUE" && d9.wouldFail === "IDA_NOT_LOCKED" && w.idaWrites.length === 0 && w.batchDeletes.length === 0
    && liveBatches(w).length === 3 && opCalls(w, "R", "APPLY").length === 0, "R2: resumed with the IDA deleted -> REQUIRES_REVIEW (wouldFail IDA_NOT_LOCKED), no unlock, the Batch rows kept", w.job);
  console.log("ok   phase B: D3 409 waits then IDA_RECEIPT_TIMEOUT, a reset opens a fresh window; op 1 review / count mismatch -> review; R 401 tolerated (COMPLETED, named); a per-movement 400 / op 2 400 / 500 -> review; IDA deleted after D2 -> review; R2");
}

// ------------------------------------------------------------------ 6. phase A edges: the IDA deleted before D0, lines changed, PARK
{
  // the IDA soft-deleted before D0 (a mobile delete): FAILED, nothing moved, no write to the deleted row
  let c = X.makeCase(CASES.mixed);
  let w = world(c);
  w.ida.is_deleted = 1;
  drive(w);
  ok(w.job.job_status === "FAILED" && w.job.error_code === "IDA_NOT_LOCKED" && w.idaWrites.length === 0 && w.mv.length === 0 && w.violations.length === 0 && w.batches.length === 0 && w.engine.calls.length === 0,
    "IDA soft-deleted before D0 -> FAILED IDA_NOT_LOCKED, nothing moved, no unlock of the deleted row", w.job);
  // an insert of D1, then the run died, then the IDA lost its lock: the entry finds ours by the intent and removes them
  c = X.makeCase(CASES.mixed);
  w = world(c, { crashAfter: clean.mixed.writes.indexOf("batch insert x3") + 1 });
  runCommit(w);
  w.ida.item_disassembly_status = "Draft";
  Object.assign(w, { crashAfter: 0, now: w.now + 11 * 60000 });
  runCommit(w);
  ok(w.job.job_status === "FAILED" && w.job.error_code === "IDA_NOT_LOCKED" && w.batchDeletes.length === 3 && liveBatches(w).length === 0 && w.idaWrites.length === 0 && w.violations.length === 0,
    "entry: the lock lost after D1's insert -> FAILED, ours (by the intent) soft-deleted, no unlock", { job: w.job, del: w.batchDeletes });
  // D0: the lines changed after PREPARE -> FAILED IDA_LINES_CHANGED + Draft before any write
  c = X.makeCase(CASES.mixed);
  w = world(c);
  w.lines[1].batch_number = "LOT-8";
  drive(w);
  failed(w, "IDA_LINES_CHANGED", "D0 lines changed");
  ok(w.batches.length === 0 && w.cfgWrites.length === 0, "D0: nothing written before the refusal");
  // PARK above 1,000 movements on EITHER leg (the next tick resumes phase B)
  for (const [label, o] of [["op 2: 1,001 receipts", { n: 1001 }], ["op 1: 1,001 picks", { n: 3, picks: 1001, pickQty: 1 }]]) {
    c = X.makeCase(o);
    w = world(c);
    const a = runCommit(w);
    ok(a.out.path === "PARK" && w.job.job_status === "COMMITTING_IDA" && w.job.lease_owner === null && w.job.next_attempt_at === fmt(w.now) && w.job.progress_percent === 75 && w.job.attempt_count === 0,
      "PARK (" + label + "): no lease, due now, 75, attempts 0", w.job);
    w.now += 5000;
    const b = runCommit(w);
    ok(b.out.path === "DONE" && w.job.job_status === "COMPLETED", "PARK (" + label + "): the next pass finishes phase B", b.out);
  }
  c = X.makeCase({ n: 1000 });
  w = world(c);
  ok(runCommit(w).out.path === "SPLIT", "1,000 receipts + 1 pick -> SPLIT");
  console.log("ok   IDA deleted before D0 -> FAILED, nothing moved; the lock lost after D1 -> ours removed; D0 lines changed; PARK on either leg above 1,000");
}

// ------------------------------------------------------------------ 7. node data at 2,000 and 5,000 lines (outputs; + recorded inputs)
{
  const rows = [];
  const MB = 1048576;
  const pattern = (i) => (i % 3 === 0 ? { kind: "auto", item: i } : i % 3 === 1 ? { kind: "typed", number: "T-" + Math.ceil(i / 6), item: 10000 + Math.ceil(i / 6) } : { kind: "none" });
  for (const n of [2000, 5000]) {
    const c = X.makeCase({ n: n, pattern: pattern });
    const w = world(c);
    w.numbers = numbersOf(c);
    const t0 = Date.now();
    drive(w);
    expectCompleted(w, c, n + " lines");
    const mb = (b) => (b / MB).toFixed(1);
    const runs = w.sizes.map((x) => x.out + x.in);
    ok(runs.every((x) => x <= 35 * MB), n + " lines: every run <= 35 MB of node data", w.sizes.map((x) => mb(x.out) + "/" + mb(x.out + x.in)));
    rows.push(n + " lines (" + c.batchRows.length + " Batch rows): " + w.sizes.map((x, i) => "run " + (i + 1) + " " + mb(x.out) + " MB out / " + mb(x.out + x.in) + " MB with inputs").join(", ") + " (" + (Date.now() - t0) + " ms sim)");
  }
  console.log("ok   node data: " + rows.join("; "));
}

console.log(checks + " checks passed");
