// TZ=Asia/Kuala_Lumpur node scratchpad/idav2/test/integration/e2e.js [a b c d e f g ...] [--json out.json] - Item Disassembly V2 integration
// (CONTRACT section 13, E phase 2): the four BUILT V2 workflows + the built classic IDA_SAVE v7 run END TO END on ONE in-memory world
// (world.js) through lib/sim's interpreter (interp.js), the DEPLOYED INVENTORY_BULK_APPLY v10 + LOCK_TOKENS v5 + LOCK_SEED v5 as the child
// workflow every part calls, real ids (ids.json). Each scenario: SUBMIT -> WORKER ticks ({job_id} or {job_id: ""}) until terminal, then
// the world asserted. IDA_E2E_MUTANT = { wf, from, to, id } (mutants.js) breaks one cross-package interface in one built workflow's code
// bodies in memory.
const fs = require("fs");
const path = require("path");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  const r = require("child_process").spawnSync(process.execPath, [__filename].concat(process.argv.slice(2)), { env: Object.assign({}, process.env, { TZ: "Asia/Kuala_Lumpur" }), stdio: "inherit" });
  process.exit(r.status === null ? 1 : r.status);
}
const F = require("./fixture.js");
const { call } = require("./interp.js");
const W = F.W;
const C = F.C;
const PR = require(path.join(F.IDAV2, "code", "shared", "price.js"));
const FP = require(path.join(F.IDAV2, "code", "shared", "fingerprint.js"));

const argv = process.argv.slice(2);
const JSON_OUT = argv.indexOf("--json") >= 0 ? argv[argv.indexOf("--json") + 1] : null;
const WANT = argv.filter((a) => /^[a-z][0-9a-z]*$/.test(a) && a !== JSON_OUT);
const want = (k) => !WANT.length || WANT.indexOf(k) >= 0;
let checks = 0;
let fails = 0;
const failed = [];
const show = (x) => JSON.stringify(x === undefined ? "<undefined>" : x, (k, v) => (typeof v === "bigint" ? String(v) : v)).slice(0, 1600);
const ok = (cond, what, extra) => {
  checks++;
  if (!cond) {
    fails++;
    failed.push(what);
    console.log("FAIL " + what + (extra === undefined ? "" : "\n     " + show(extra)));
  }
  return !!cond;
};
const report = { scenarios: {}, sizes: {}, notes: [] };

const docs = F.loadDocs();
if (process.env.IDA_E2E_MUTANT) {
  const mu = JSON.parse(process.env.IDA_E2E_MUTANT);
  let hits = 0;
  const walk = (ns) => (ns || []).forEach((n) => {
    for (const where of [n.data && n.data.script, n.data && n.data.expression]) {
      if (where && typeof where.code === "string" && where.code.indexOf(mu.from) >= 0 && (!mu.node || n.id === mu.node)) {
        hits += where.code.split(mu.from).length - 1;
        where.code = where.code.split(mu.from).join(mu.to);
      }
    }
    walk(n.blocks);
  });
  walk(docs[mu.wf].nodes);
  if (!hits) {
    console.log("FAIL mutant " + mu.id + ": '" + mu.from + "' not found in " + mu.wf);
    process.exit(2);
  }
  console.log("MUTANT " + mu.id + ": " + hits + " replacement(s) in " + mu.wf);
}
const run = (w, name, params) => call(w, docs, F.IDS, name, params);
const submit = (w, page, idaId, key, form) => run(w, "IDA_V2_SUBMIT", F.submitReq(page, idaId, key, form));
const status = (w, idaId, key) => run(w, "IDA_V2_SUBMIT", F.statusReq(idaId, key));
const kick = (w, jobId) => run(w, "IDA_V2_WORKER", { job_id: jobId === undefined ? "" : jobId });
const classic = (w, form, saveAs, page) => run(w, "IDA_SAVE", F.classicReq(form, saveAs, page));
const MB = (b) => (b / 1048576).toFixed(2);
const runSize = (r) => r.out + r.in;
// the tick's runs: one line each (workflow, node outputs + inputs)
const sizesOf = (t) => t.runs.map((r) => ({ wf: r.name, depth: r.depth, out_mb: Number(MB(r.out)), in_mb: Number(MB(r.in)), mb: Number(MB(runSize(r))), ms: r.ms, nodes: r.nodes,
  maxCodeMs: r.maxCodeMs }));
const tickMb = (t) => Number(MB(t.runs.reduce((a, r) => a + runSize(r), 0)));
// node outputs only (what su_code_workflow_inst records is closest to this: IA's live 2,000-key op 1 = 18.2 MB, FACTS) and outputs + injected inputs
const tickOut = (t) => Number(MB(t.runs.reduce((a, r) => a + r.out, 0)));
const tickAgg = (t) => {
  const agg = {};
  for (const r of t.runs) {
    const k = r.depth + ":" + r.name;
    const a = (agg[k] = agg[k] || { wf: r.name, depth: r.depth, runs: 0, out: 0, in: 0, ms: 0 });
    a.runs++;
    a.out += r.out;
    a.in += r.in;
    a.ms += r.ms;
  }
  return Object.values(agg).map((a) => ({ wf: a.wf, depth: a.depth, runs: a.runs, out_mb: Number(MB(a.out)), out_in_mb: Number(MB(a.out + a.in)), ms: a.ms,
    max_run_out_mb: Number(MB(Math.max(...t.runs.filter((r) => r.name === a.wf && r.depth === a.depth).map((r) => r.out)))) }));
};
const jobOf = (w, key) => w.jobByKey(key);
const stepsOf = (w, jobId, re) => w.steps.filter((r) => !r.is_deleted && r.job_id === jobId && re.test(r.step_name)).map((r) => r.step_name + ":" + r.step_status).sort();
const movesOf = (w, op) => w.mv.filter((m) => !m.is_deleted && W.s(m.operation_effect_key).indexOf(op + "|") === 0);
const engCalls = (t, jobId) => t.calls.filter((c) => c.to === "INVENTORY_BULK_APPLY").map((c) => W.s(c.op).replace(jobId, "<job>") + " " + c.mode + " " + c.n);
const locksFree = (w) => w.locks.filter((l) => !l.is_deleted && (Number(l.free_token) !== 1 || W.s(l.owner_operation_id) !== ""));
const live = (rows) => rows.filter((r) => !r.is_deleted);
const q8 = C.idaQ8;
const near = (a, b, eps) => Math.abs(Number(a) - Number(b)) <= (eps === undefined ? 1e-8 : eps);
// drive a job: kick (job id or drain) until terminal or nothing more to do; each tick's sizes kept
function drive(w, jobId, opts) {
  const o = Object.assign({ max: 12, gap: 15000, drain: false }, opts || {});
  const ticks = [];
  for (let i = 0; i < o.max; i++) {
    const t = kick(w, o.drain ? "" : jobId);
    ticks.push(t);
    const j = w.job(jobId);
    t.after = j && { status: j.job_status, lease: W.s(j.lease_owner).split("|")[0], due: j.next_attempt_at !== null && j.next_attempt_at <= w.now, progress: j.progress_percent,
      steps: stepsOf(w, jobId, /^D[0-9]_/).map((x) => x.split(":")[0]), opI: movesOf(w, "IDC|" + jobId + "|I").length, opR: movesOf(w, "IDC|" + jobId + "|R").length };
    if (t.err || !j || ["COMPLETED", "FAILED", "REQUIRES_REVIEW"].indexOf(j.job_status) >= 0) break;
    w.now += j.next_attempt_at && j.next_attempt_at > w.now ? j.next_attempt_at - w.now + 1000 : o.gap;
  }
  return ticks;
}
const tickPath = (t) => t.runs.filter((r) => r.depth === 1).map((r) => r.name.replace("IDA_V2_", "")).join(",");

// ------------------------------------------------------------------------------------------------ the twin snapshot (natural keys)
function snapshot(w, idaId) {
  const bn = (id) => {
    const b = w.batches.find((x) => x.id === W.s(id));
    return b ? W.s(b.batch_number) : "";
  };
  const out = { stock: {}, bstock: {}, fifo: {}, wa: {}, mv: [], header: null, lines: [], stamps: [], batches: [], blankBatches: 0, bnc: w.bnc.map((c) => c.running_number) };
  for (const b of live(w.ib)) out.stock[[b.material_id, b.location_id, b.plant_id].join("|")] = [b.unrestricted_qty, b.reserved_qty, b.block_qty, b.qualityinsp_qty, b.intransit_qty, b.balance_quantity].map((x) => q8(x));
  for (const b of live(w.bb)) out.bstock[[b.material_id, b.location_id, bn(b.batch_id), b.plant_id].join("|")] = [b.unrestricted_qty, b.balance_quantity].map((x) => q8(x));
  for (const f of live(w.fifo).sort(W.byIdAsc)) (out.fifo[[f.material_id, f.plant_id, bn(f.batch_id)].join("|")] = out.fifo[[f.material_id, f.plant_id, bn(f.batch_id)].join("|")] || [])
    .push([W.s(f.fifo_sequence), q8(f.fifo_cost_price), q8(f.fifo_initial_quantity), q8(f.fifo_available_quantity)]);
  for (const r of live(w.wa)) out.wa[[r.material_id, W.s(r.plant_id), bn(r.batch_id)].join("|")] = [q8(r.wa_quantity), q8(r.wa_cost_price)];
  out.mv = live(w.mv).map((m) => [m.movement, m.item_id, m.bin_location_id, bn(m.batch_number_id), q8(m.quantity), q8(m.base_qty), q8(m.unit_price), q8(m.total_price), W.s(m.uom_id),
    W.s(m.base_uom_id), m.trx_no, m.transaction_type, m.inventory_category, W.s(m.parent_trx_no), W.dt(m.doc_date), W.dt(m.manufacturing_date), W.dt(m.expired_date),
    W.s(m.costing_method_id), q8(m.actual_qty), q8(m.actual_base_qty), W.s(m.handling_unit_id), W.s(m.plant_id), W.s(m.organization_id)].map(String).join(" ")).sort();
  const h = w.ida(idaId);
  if (h) {
    out.header = { status: h.item_disassembly_status, posted: h.posted_status, no: h.stock_movement_no, no_type: W.s(h.stock_movement_no_type), item_id: h.item_id, item_qty: q8(h.item_qty),
      item_uom: h.item_uom, plant: h.issuing_operation_faci, org: h.organization_id, date: W.dt(h.item_disassembly_date), picks: h.temp_qty_data };
    out.lines = w.liveLines(idaId).sort((a, b) => Number(a.line_index) - Number(b.line_index)).map((l) => [l.line_index, l.item_selection, q8(l.total_quantity), W.s(l.quantity_uom),
      W.s(l.location_id), W.s(l.storage_location_id), W.s(l.batch_number), W.dt(l.manufacturing_date), W.dt(l.expired_date), W.s(l.item_remark), W.s(l.issuing_plant), W.s(l.organization_id)].map(String).join(" "));
  }
  out.stamps = Array.from(w.items.values()).filter((it) => it.last_transaction_date).map((it) => it.id).sort();
  for (const b of live(w.batches)) {
    if (W.s(b.batch_number) === "") out.blankBatches++;
    else out.batches.push([W.s(b.batch_number), b.material_id, b.plant_id, b.organization_id, b.transaction_no, q8(b.initial_quantity), W.s(b.remark), W.dt(b.manufacturing_date), W.dt(b.expired_date)].map(String).join(" "));
  }
  out.batches.sort();
  return out;
}
function diffSnap(a, b) {
  const d = [];
  const keys = (x, y) => Array.from(new Set(Object.keys(x).concat(Object.keys(y)))).sort();
  for (const t of ["stock", "bstock", "fifo", "wa"]) for (const k of keys(a[t], b[t])) if (JSON.stringify(a[t][k]) !== JSON.stringify(b[t][k])) d.push({ t: t, k: k, v2: a[t][k], classic: b[t][k] });
  const lst = (t) => {
    const ax = a[t].slice();
    const bx = b[t].slice();
    const onlyA = ax.filter((x) => bx.indexOf(x) < 0);
    const onlyB = bx.filter((x) => ax.indexOf(x) < 0);
    if (onlyA.length || onlyB.length) d.push({ t: t, v2_only: onlyA.slice(0, 4), classic_only: onlyB.slice(0, 4), n: [onlyA.length, onlyB.length] });
  };
  lst("mv");
  lst("lines");
  lst("stamps");
  if (JSON.stringify(a.header) !== JSON.stringify(b.header)) d.push({ t: "header", v2: a.header, classic: b.header });
  return d;
}

// ================================================================================================ (a) 60 lines, non-batch FIFO, Add
if (want("a")) {
  const spec = { pickQty: 2, lines: Array.from({ length: 60 }, (_, i) => ({ kind: "none", qty: q8(((i * 7) % 5) + 1 + (i % 3) * 0.25) })) };
  const f = F.world(spec);
  const twin = F.world(spec);
  const w = f.w;
  const form = F.addForm(f);
  const key = F.keyOf("new-int-a1");
  const r = submit(w, "Add", "", key, form);
  const job = jobOf(w, key);
  ok(!r.err && r.out.route === "QUEUED" && r.out.code === "200" && job && r.out.job_id === job.id && /^[0-9]+$/.test(r.out.ida_id) && r.out.line_count === "61",
    "a SUBMIT (Add, 60 lines + 1 pick): QUEUED, the new IDA's id, 61 moves", r.err || r.out);
  const idaId = r.out && r.out.ida_id;
  const h = w.ida(idaId);
  ok(h && h.item_disassembly_status === "Processing" && h.ida_v2_job_id === job.id && h.ida_idem_key === key && h.stock_movement_no === "IDA-2610-0042" && r.out.ida_no === h.stock_movement_no
    && w.liveLines(idaId).length === 60, "a the IDA stored Processing under its job (key, issued number IDA-2610-0042, 60 lines)", h);
  const req = C.idaParseJ(job.request_payload);
  ok(job.correlation_id === "IDA|" + idaId && job.causation_id === idaId && job.job_status === "QUEUED" && job.next_attempt_at <= w.now && job.line_count === 61
    && JSON.stringify(stepsOf(w, "IDC|" + idaId, /^LOCK/)) === '["LOCK|1:LOCK"]' && w.latestLock(idaId).result_ref === key, "a the job linked, due now, LOCK|1 = the key", job);
  ok(req.action === "DIRECT" && req.prevStatus === "Draft" && req.saveAs === "Completed" && req.pageStatus === "Add" && req.idaId === idaId && req.idaNo === "IDA-2610-0042"
    && req.issuedNo === "IDA-2610-0042" && req.lineCount === 60 && req.pickCount === 1 && req.moveCount === 61 && req.stockLines === 60 && req.nonStockLines === 0
    && req.lineFingerprint === FP.idaLineFingerprint(W.HANDLERS.sql_node_DPlines.call(w, "l.sm_item_disassembly_id = " + idaId + " "), W.HANDLERS.sql_node_DPhdr.call(w, "h.id = " + idaId + " ")),
  "a request_payload: CONTRACT section 3's keys; lineFingerprint = DF1 of the STORED rows (PREPARE's FP_* read)", req);
  const ticks = drive(w, job.id);
  const t = ticks[0];
  ok(ticks.length === 1 && !t.err && t.out.worker_route === "WORKED" && t.out.job_status === "COMPLETED" && t.out.ida_id === idaId, "a one worker tick ({job_id}, the form's kick) -> COMPLETED",
    ticks.map((x) => x.err || x.out));
  ok(tickPath(t) === "PREPARE,COMMIT,COMMIT", "a the tick: PREPARE, COMMIT A (SPLIT), COMMIT B", tickPath(t));
  ok(JSON.stringify(engCalls(t, job.id)) === JSON.stringify(["IDC|<job>|I PLAN 1", "IDC|<job>|R PLAN 60", "IDC|<job>|I APPLY 1", "IDC|<job>|R APPLY 60"]),
    "a the engine: PLAN op 1 + op 2 (PREPARE), APPLY op 1 (D2), APPLY op 2 (D3) - the deployed v10 run as the child", engCalls(t, job.id));
  ok(job.job_status === "COMPLETED" && job.progress_percent === 100 && W.s(job.lease_owner) === "" && h.item_disassembly_status === "Completed" && h.posted_status === "Unposted",
    "a job COMPLETED 100, lease released; the IDA Completed / Unposted (D4 the unlock)", { job: [job.job_status, job.progress_percent, job.lease_owner], ida: [h.item_disassembly_status, h.posted_status] });
  ok(JSON.stringify(stepsOf(w, job.id, /^D[0-9]_/)) === JSON.stringify(["D0_REVALIDATE:DONE", "D2_ISSUE:DONE", "D3_RECEIPT:DONE", "D4_FINISH:DONE"]) && !stepsOf(w, job.id, /^D1/).length,
    "a D0 / D2 / D3 / D4 DONE, no D1 (batchMode none)", stepsOf(w, job.id, /^D/));
  const man = C.idaParseJ(job.prepared_payload);
  ok(man && man.batchMode === "none" && !man.parts.BATCH && man.counts.movementsI === 1 && man.counts.movementsR === 60 && man.ida_no === "IDA-2610-0042" && man.lineFingerprint === req.lineFingerprint,
    "a the manifest COMMIT read: batchMode none (no BATCH part), 1 + 60 movements, the request's fingerprint", man && { mode: man.batchMode, parts: Object.keys(man.parts), counts: man.counts });
  const outs = movesOf(w, "IDC|" + job.id + "|I");
  const ins = movesOf(w, "IDC|" + job.id + "|R");
  const issued = outs.reduce((a, m) => a + Number(m.total_price), 0);
  ok(outs.length === 1 && outs[0].movement === "OUT" && outs[0].transaction_type === "IDA" && outs[0].trx_no === "IDA-2610-0042" && near(outs[0].base_qty, 2) && near(issued, 1.5 * 10.1234 + 0.5 * 12.3456, 1e-6),
    "a op 1: ONE 'IDA' OUT row of 2, FIFO over both layers (1.5 x 10.1234 + 0.5 x 12.3456 = " + (1.5 * 10.1234 + 0.5 * 12.3456).toFixed(4) + ")", outs.map((m) => [m.base_qty, m.unit_price, m.total_price]));
  const alloc = PR.idaAllocate(Number(issued.toFixed(8)), spec.lines.map((l) => ({ share_qty: l.qty, base_qty: l.qty })));
  const byLine = ins.map((m) => Number(m.unit_price));
  ok(ins.length === 60 && ins.every((m) => m.movement === "IN" && m.trx_no === "IDA-2610-0042") && byLine.every((p, i) => near(p, alloc[i].unit_price)),
    "a op 2: 60 IN rows at idaAllocate(issued value, alloc) per base unit (the shared price.js = classic code_cost_alloc's)", { got: byLine.slice(0, 4), want: alloc.slice(0, 4) });
  const recv = ins.reduce((a, m) => a + Number(m.total_price), 0);
  ok(near(recv, issued, 1e-6), "a received value = issued value (" + issued.toFixed(8) + "), within q8 per line", { recv: recv, issued: issued });
  ok(locksFree(w).length === 0 && w.locks.length > 0, "a every engine lock row given back (" + w.locks.length + " rows, free_token 1, no owner)", locksFree(w).slice(0, 3));
  const st = status(w, idaId, key);
  ok(!st.err && st.out.route === "STATUS" && st.out.job_status === "COMPLETED" && st.out.terminal === "YES" && st.out.ida_id === idaId && st.out.progress_percent === "100",
    "a STATUS by key: COMPLETED, terminal (the client's verdict)", st.err || st.out);
  ok(kick(w, "").out.worker_route === "IDLE", "a the worker is idle afterwards");
  // the classic v7 on the twin world, the same form
  const tw = twin.w;
  const cr = classic(tw, F.addForm(twin), "Completed", "Add");
  const cid = cr.out && W.s(cr.out.id);
  ok(!cr.err && cr.out && W.s(cr.out.code) === "200" && tw.ida(cid) && tw.ida(cid).item_disassembly_status === "Completed", "a twin: the classic IDA_SAVE v7 (Add, Completed) on the twin world -> 200",
    cr.err || cr.out);
  const a = snapshot(w, idaId);
  const b = snapshot(tw, cid);
  const d = diffSnap(a, b);
  ok(d.length === 0, "a twin: stock, FIFO layers, WA, every movement field, header, lines, Item stamps = the classic v7's (ids / operation_effect_key masked)", d.slice(0, 5));
  ok(a.blankBatches === 0 && b.blankBatches === 60 && a.batches.length === 0 && b.batches.length === 0, "a twin: the deliberate difference - the classic minted 60 blank Batch rows, V2 none",
    { v2: a.blankBatches, classic: b.blankBatches });
  ok(ins.every((m) => W.s(m.operation_effect_key).indexOf("IDC|" + job.id + "|R|R") === 0) && tw.mv.every((m) => !m.operation_effect_key),
    "a twin: the deliberate difference - V2 rows carry operation_effect_key IDC|<job>|R|R<k>, the classic's none");
  report.scenarios.a = { ida: idaId, job: job.id, ticks: ticks.length, path: tickPath(t), sizes: sizesOf(t), tick_mb: tickMb(t), submit_mb: tickMb(r), twin_diff: d.length };
  console.log("ok   a  60-line non-batch FIFO Add -> COMPLETED in one tick; twin = classic v7 (minus the deliberate differences); tick " + tickMb(t) + " MB");
}

// ================================================================================================ (a2) the same under the tenant's number rules
if (want("a2") || want("a")) {
  // "Inventory Price" 4 dp / "Inventory Qty" 3 dp, half-up (prod's set; 000000 has rules since 10-19): the engine stores rounded values and D3 prices from the STORED OUT total
  const RULES = [{ scope_type: "1", rule_key: "Inventory Price", table_id: null, field_name: null, decimal_places: "4", precision_rule: "1", store_raw_value: "0" },
    { scope_type: "1", rule_key: "Inventory Qty", table_id: null, field_name: null, decimal_places: "3", precision_rule: "1", store_raw_value: "0" }];
  const spec = { pickQty: 2.3333, lines: Array.from({ length: 55 }, (_, i) => ({ kind: "none", qty: q8(((i * 7) % 5) + 1 + (i % 3) * 0.3333) })) };
  const f = F.world(spec);
  const twin = F.world(spec);
  f.w.precRows = RULES;
  twin.w.precRows = RULES;
  const w = f.w;
  const key = F.keyOf("new-int-a2");
  const r = submit(w, "Add", "", key, F.addForm(f));
  const job = jobOf(w, key);
  drive(w, job.id);
  const outs = movesOf(w, "IDC|" + job.id + "|I");
  const ins = movesOf(w, "IDC|" + job.id + "|R");
  const stored = outs.reduce((a, m) => a + Number(m.total_price), 0);
  const prices = PR.idaAllocate(Number(stored.toFixed(8)), spec.lines.map((l) => ({ share_qty: l.qty, base_qty: l.qty })));
  ok(job.job_status === "COMPLETED" && outs.length === 1 && Number(outs[0].total_price).toFixed(4) === Number(outs[0].total_price).toFixed(8).slice(0, -4)
    && ins.every((m, i) => near(m.unit_price, Number(prices[i].unit_price.toFixed(4)), 1e-9)),
  "a2 under 4 / 3 dp rules: COMPLETED; the OUT total stored at 4 dp; every receipt at idaAllocate(the STORED OUT total) rounded to the rule's 4 dp", { job: job.job_status,
    out: outs.map((m) => m.total_price), got: ins.slice(0, 3).map((m) => m.unit_price), want: prices.slice(0, 3).map((p) => p.unit_price) });
  const cr = classic(twin.w, F.addForm(twin), "Completed", "Add");
  const d = diffSnap(snapshot(w, r.out.ida_id), snapshot(twin.w, cr.out && W.s(cr.out.id)));
  ok(!cr.err && W.s(cr.out && cr.out.code) === "200" && d.length === 0, "a2 twin under the same rules: = the classic v7 (its code_cost_alloc reads the same stored OUT rows)", cr.err || d.slice(0, 4));
  report.scenarios.a2 = { job: job.id, out_total: stored, twin_diff: d.length };
  console.log("ok   a2 the same under 4 / 3 dp number rules: prices from the stored OUT total; twin = classic v7");
}

// ================================================================================================ (b) stored Draft: TYPED / AUTO / NONE / alt UOM / non-stock last
const MIXB = [{ kind: "typed", item: 101, number: "LOT-B1", qty: 3, bin: F.BINS[0] }, { kind: "typed", item: 101, number: "LOT-B1", qty: 2, bin: F.BINS[1] },
  { kind: "none", item: 103, alt: true, qty: 2 }, { kind: "auto", item: 104, qty: 2 }, { kind: "auto", item: 105, qty: 1 }, { kind: "auto", item: 104, qty: 3, bin: F.BINS[2] },
  { kind: "none", item: 106, cost: F.WA, qty: 2 }, { kind: "none", item: 107, cost: F.FIXED, qty: 1 }];
function mixB(n) {
  const out = MIXB.slice();
  for (let i = out.length + 1; i < n; i++) out.push({ kind: "none", item: 100 + i, qty: (i % 4) + 1 });
  out.push({ kind: "ns", item: 199, qty: 4 });
  return out;
}
if (want("b")) {
  const spec = { pickQty: 2, lines: mixB(52) };
  const f = F.world(spec);
  const twin = F.world(spec);
  const w = f.w;
  const stored = F.storeDraft(f);
  const idaId = stored.id;
  const key = F.keyOf(idaId, "1b2c3d4e5f6a7b8c");
  const bncBefore = JSON.parse(JSON.stringify(w.bnc.map((c) => w.bncRow(c))));
  const r = submit(w, "Edit", idaId, key, F.editForm(w, idaId));
  const job = jobOf(w, key);
  ok(!r.err && r.out.route === "QUEUED" && r.out.ida_id === idaId && job && r.out.ida_no === "IDA-2610-0042" && w.ida(idaId).stock_movement_no === "IDA-2610-0042",
    "b SUBMIT (stored Draft 'Draft-IDA-0007', 52 lines + 1 pick): QUEUED, a real number issued (no earlier job issued the draft number)", r.err || r.out);
  ok(JSON.stringify(stepsOf(w, "IDC|" + idaId, /^LOCK/)) === '["LOCK|1:LOCK"]' && w.writeLog.slice(0, 3).map((x) => x.split(" ")[1]).join(",") === "add_node_DSlock,add_node_DSjob,update_node_DSidaNum",
    "b the stored-Draft write order: LOCK|1 first, then the job, then ONE document update (number props: 'issued')", w.writeLog.slice(0, 4));
  ok(w.liveLines(idaId).filter((l) => l.batch_number === F.PLACEHOLDER).length === 3, "b the three AUTO lines keep their placeholder until D4 (SUBMIT reserved nothing)",
    w.liveLines(idaId).map((l) => l.batch_number).slice(0, 8));
  const ticks = drive(w, job.id, { drain: true });
  const t = ticks[0];
  ok(ticks.length === 1 && !t.err && job.job_status === "COMPLETED" && w.ida(idaId).item_disassembly_status === "Completed" && t.out.worker_route === "WORKED" && t.out.processed === "1",
    "b one drain tick ({job_id: \"\"}, the list's kick) -> COMPLETED", ticks.map((x) => x.err || x.out));
  ok(JSON.stringify(stepsOf(w, job.id, /^D[0-9]_|^D1\|/)) === JSON.stringify(["D0_REVALIDATE:DONE", "D1_BATCH:DONE", "D1|I|001:INTENT", "D2_ISSUE:DONE", "D3_RECEIPT:DONE", "D4_FINISH:DONE"]),
    "b D0, D1 (intent + DONE), D2, D3, D4", stepsOf(w, job.id, /^D/));
  ok(JSON.stringify(engCalls(t, job.id)) === JSON.stringify(["IDC|<job>|I PLAN 1", "IDC|<job>|R PLAN 51", "IDC|<job>|R PLAN 51", "IDC|<job>|I APPLY 1", "IDC|<job>|R APPLY 51"]),
    "b the engine: PLAN I + R (PREPARE), the re-PLAN of R with the batch ids (D1), APPLY I (D2), APPLY R (D3): 51 receipts (the non-stock last line left out)", engCalls(t, job.id));
  // the AUTO numbers = what three sequential GENERATE_BATCH calls answer (code/shared/batchnum.js on the config SUBMIT read)
  const autoLines = f.lines.filter((L) => L.kind === "auto");
  const reqs = autoLines.map((L) => ({ item_id: L.id, document_date: F.DOC_DATE + " 00:00:00", manufacturing_date: "2026-10-01 00:00:00", expired_date: "2027-10-01 00:00:00", organization_id: F.ORG }));
  const bn = W.BA.idaBatchnum(bncBefore, autoLines.map((L) => ({ id: L.id, item_category: L.item.item_category, item_group_id: L.item.item_group_id })), reqs, w.now);
  const lines = w.liveLines(idaId).sort((a, b) => Number(a.line_index) - Number(b.line_index));
  const autoIdx = f.lines.map((L, k) => (L.kind === "auto" ? k : -1)).filter((k) => k >= 0);
  ok(!bn.error && JSON.stringify(bn.numbers) === '["Batch-00631","Batch-00632","Batch-00633"]' && JSON.stringify(autoIdx.map((k) => lines[k].batch_number)) === JSON.stringify(bn.numbers),
    "b the AUTO lines carry Batch-00631 / 632 / 633 after D4 = three sequential GENERATE_BATCH calls (batchnum.js) in line order", { want: bn.numbers, got: autoIdx.map((k) => lines[k].batch_number) });
  ok(w.bnc[0].running_number === 634, "b batch_number_config advanced 631 -> 634 (the AUTO count)", w.bnc[0].running_number);
  const ours = live(w.batches).filter((b) => W.big(b.id) > W.big(job.id));
  const typed = ours.filter((b) => b.batch_number === "LOT-B1");
  ok(ours.length === 4 && typed.length === 1 && typed[0].initial_quantity_given === "5.00000000" && typed[0].material_id === F.comp(101) && typed[0].transaction_no === "IDA-2610-0042"
    && ours.filter((b) => /^Batch-0063[123]$/.test(b.batch_number)).length === 3 && !ours.some((b) => W.s(b.batch_number) === ""),
  "b Batch rows: ONE for the shared typed LOT-B1 (initial_quantity '5.00000000' = 3 + 2, a fixed-scale string), one per AUTO line, none for NONE / non-stock",
  ours.map((b) => [b.batch_number, b.initial_quantity_given, b.material_id.slice(-3)]));
  const ins = movesOf(w, "IDC|" + job.id + "|R");
  const outs = movesOf(w, "IDC|" + job.id + "|I");
  const issued = outs.reduce((a, m) => a + Number(m.total_price), 0);
  const altIn = ins.find((m) => m.item_id === F.comp(103));
  const allocIn = f.lines.map((L) => ({ share_qty: L.qty, base_qty: L.alt ? L.qty * 12 : L.qty }));
  const prices = PR.idaAllocate(Number(issued.toFixed(8)), allocIn);
  ok(altIn && near(altIn.quantity, 2) && near(altIn.base_qty, 24) && W.s(altIn.uom_id) === F.BOX && near(altIn.unit_price, prices[2].unit_price) && near(altIn.total_price, prices[2].value, 1e-6),
    "b the alt-UOM line: 2 BOX = 24 base, priced per BASE unit (" + prices[2].unit_price + " x 24 = the line's share)", altIn && [altIn.quantity, altIn.base_qty, altIn.unit_price, altIn.total_price]);
  ok(!ins.some((m) => m.item_id === F.comp(199)) && !live(w.ib).some((b) => b.material_id === F.comp(199)), "b the non-stock last line received nothing (left out of op 2)");
  const fixedIn = ins.find((m) => m.item_id === F.comp(107));
  ok(fixedIn && near(fixedIn.unit_price, 7.25), "b the Fixed Cost item received at its purchase_unit_price 7.25 (the engine's rule)", fixedIn && fixedIn.unit_price);
  const lot = ins.filter((m) => m.item_id === F.comp(101));
  ok(lot.length === 2 && lot.every((m) => m.batch_number_id === typed[0].id) && live(w.bb).filter((b) => b.batch_id === typed[0].id).length === 2,
    "b both LOT-B1 lines received into the ONE Batch row (two bins, two batch balances)", lot.map((m) => m.batch_number_id));
  const recv = ins.reduce((a, m) => a + (m.item_id === F.comp(107) ? Number(prices[7].value) : Number(m.total_price)), 0);
  ok(near(recv + prices[prices.length - 1].value, issued, 1e-6), "b received value + the non-stock line's share = the issued value (Fixed Cost line counted at its allocated share)",
    { recv: recv, nonStockShare: prices[prices.length - 1].value, issued: issued });
  const stampSet = Array.from(w.items.values()).filter((it) => it.last_transaction_date).map((it) => it.id);
  ok(stampSet.length === 1 + new Set(f.lines.map((L) => L.id)).size && stampSet.indexOf(F.comp(199)) >= 0, "b Item stamps: the source + every line item (non-stock included)", stampSet.length);
  ok(locksFree(w).length === 0, "b every lock given back", locksFree(w).slice(0, 3));
  // the classic v7 twin: the same stored Draft completed by the classic (Edit)
  const tw = twin.w;
  const st2 = F.storeDraft(twin);
  const cr = classic(tw, F.editForm(tw, st2.id), "Completed", "Edit");
  ok(!cr.err && W.s(cr.out && cr.out.code) === "200" && tw.ida(st2.id).item_disassembly_status === "Completed", "b twin: the classic v7 completes the same stored Draft -> 200", cr.err || cr.out);
  const a = snapshot(w, idaId);
  const b = snapshot(tw, st2.id);
  // the shared typed number: V2's ONE Batch row holds both receipts as one FIFO chain (sequences 1, 2); the classic's two rows two chains (1, 1)
  const seqless = (x) => JSON.stringify((x || []).map((l) => l.slice(1)));
  const isShared = (k) => /\|LOT-B1$/.test(k);
  const d0 = diffSnap(a, b);
  const chain = d0.filter((x) => x.t === "fifo" && isShared(x.k) && seqless(x.v2) === seqless(x.classic));
  const d = d0.filter((x) => chain.indexOf(x) < 0);
  ok(d.length === 0, "b twin: stock, batch stock (by number), FIFO, WA, movements, header, lines (AUTO numbers incl.), Item stamps = the classic v7's", d.slice(0, 4));
  ok(chain.length === 1 && JSON.stringify(chain[0].v2.map((l) => l[0])) === '["1","2"]' && JSON.stringify(chain[0].classic.map((l) => l[0])) === '["1","1"]',
    "b twin: the consequence of one Batch row per shared typed number - its two FIFO layers form ONE chain (fifo_sequence 1, 2) where the classic's two rows hold two (1, 1); cost / quantity equal",
    chain);
  report.notes.push("b: a typed number shared by two lines of one item -> V2 receives both into ONE Batch row, so its FIFO layers form one chain (fifo_sequence 1, 2); the classic minted two Batch rows (two chains, sequence 1 each). Costs and quantities are identical; not in CONTRACT section 13's deliberate-difference list (it follows from 'one Batch row per shared typed number').");
  const ca = b.batches.filter((x) => /^LOT-B1 /.test(x));
  ok(a.batches.length === 4 && b.batches.length === 5 && ca.length === 2 && b.blankBatches === 46 && a.blankBatches === 0,
    "b twin: the deliberate differences - classic 2 LOT-B1 rows (one per line) + 46 blank rows, V2 one LOT-B1 row and no blank row", { v2: a.batches, classic: b.batches, blank: b.blankBatches });
  ok(tw.bnc[0].running_number === 634, "b twin: the classic's GENERATE_BATCH loop advanced the config the same (634)", tw.bnc[0].running_number);
  report.scenarios.b = { ida: idaId, job: job.id, ticks: ticks.length, path: tickPath(t), sizes: sizesOf(t), tick_mb: tickMb(t), submit_mb: tickMb(r), auto: bn.numbers, twin_diff: d.length };
  console.log("ok   b  stored Draft TYPED / AUTO / NONE / alt UOM / Fixed / WA / non-stock last -> COMPLETED; AUTO = batchnum; twin = classic v7; tick " + tickMb(t) + " MB");
}

// ================================================================================================ (c) short stock -> FAILED, Draft; corrected -> COMPLETED
if (want("c")) {
  const spec = { pickQty: 2, srcStock: 1, lines: Array.from({ length: 55 }, (_, i) => ({ kind: "none", qty: (i % 3) + 1 })) };
  const f = F.world(spec);
  const w = f.w;
  const key = F.keyOf("new-int-c1", "2c3d4e5f6a7b8c9d", 1);
  const r = submit(w, "Add", "", key, F.addForm(f));
  const job = jobOf(w, key);
  const idaId = r.out && r.out.ida_id;
  ok(!r.err && r.out.route === "QUEUED" && job, "c SUBMIT (Add, pick 2 of a balance of 1): QUEUED (SUBMIT checks no stock: PREPARE's PLAN does)", r.err || r.out);
  const ticks = drive(w, job.id);
  const t = ticks[0];
  const h = w.ida(idaId);
  ok(!t.err && job.job_status === "FAILED" && job.error_code === "IDA_INVENTORY_INSUFFICIENT", "c the tick: PREPARE's PLAN refuses -> FAILED IDA_INVENTORY_INSUFFICIENT",
    { err: t.err, job: [job.job_status, job.error_code, job.error_message] });
  ok(/source pick 1 \(FG-0001\), bin A1-01 \(Unrestricted\)/.test(W.s(job.error_message)), "c the message names the pick, item and bin (LABELS, idaMapEngineMessage): " + job.error_message);
  ok(h.item_disassembly_status === "Draft" && h.stock_movement_no === "IDA-2610-0042" && w.mv.length === 0 && t.calls.filter((c) => c.to === "INVENTORY_BULK_APPLY").every((c) => c.mode === "PLAN")
    && tickPath(t) === "PREPARE" && w.locks.length === 0, "c nothing moved (PLAN only, no lock taken), the new IDA a saved Draft with its number", { status: h.item_disassembly_status, mv: w.mv.length, path: tickPath(t) });
  const st = status(w, idaId, key);
  ok(!st.err && st.out.route === "STATUS" && st.out.job_status === "FAILED" && st.out.terminal === "YES" && st.out.error_message === job.error_message, "c STATUS: FAILED with the message (client: gen + 1)", st.out);
  // corrected: the user reopens the Draft, takes the 1 in stock (item_qty 1), completes again with the next generation's key
  const picks = JSON.parse(h.temp_qty_data).map((p) => Object.assign(p, { sm_quantity: 1 }));
  const key2 = F.keyOf(idaId, "2c3d4e5f6a7b8c9d", 2);
  const r2 = submit(w, "Edit", idaId, key2, F.editForm(w, idaId, { item_qty: 1, temp_qty_data: JSON.stringify(picks) }));
  const job2 = jobOf(w, key2);
  const req2 = job2 && C.idaParseJ(job2.request_payload);
  ok(!r2.err && r2.out.route === "QUEUED" && job2 && job2.id !== job.id && w.ida(idaId).stock_movement_no === "IDA-2610-0042" && req2.issuedNo === "" && req2.idaNo === "IDA-2610-0042"
    && w.latestLock(idaId).step_name === "LOCK|2", "c corrected SUBMIT (gen 2): a new job, LOCK|2, the number KEPT (issued by the failed job, none completed under it: no number props)",
  r2.err || { out: r2.out, req: req2 && [req2.idaNo, req2.issuedNo] });
  const ticks2 = drive(w, job2.id);
  ok(!ticks2[0].err && job2.job_status === "COMPLETED" && w.ida(idaId).item_disassembly_status === "Completed" && movesOf(w, "IDC|" + job2.id + "|I").length === 1
    && near(movesOf(w, "IDC|" + job2.id + "|I")[0].base_qty, 1) && movesOf(w, "IDC|" + job2.id + "|R").length === 55 && locksFree(w).length === 0,
  "c the corrected job COMPLETED: 1 issued, 55 received, locks given back", { job: job2.job_status, err: ticks2[0].err });
  report.scenarios.c = { ida: idaId, failed_job: job.id, message: job.error_message, job2: job2.id, tick_mb: [tickMb(t), tickMb(ticks2[0])] };
  console.log("ok   c  short stock -> FAILED IDA_INVENTORY_INSUFFICIENT, nothing moved, Draft; corrected (gen 2, number kept) -> COMPLETED");
}

// ================================================================================================ (d) 2,001 moves and 5,000 lines: the tick split, node data
function bigCase(n, mixed) {
  const lines = [];
  for (let i = 1; i <= n; i++) {
    if (!mixed) lines.push({ kind: "none", item: 1000 + i, qty: (i % 5) + 1 });
    else if (i % 3 === 0) lines.push({ kind: "auto", item: 1000 + i, qty: (i % 4) + 1 });
    else if (i % 3 === 1) lines.push({ kind: "typed", item: 20000 + Math.ceil(i / 6), number: "T-" + Math.ceil(i / 6), qty: 1, bin: F.BINS[i % 2] });
    else lines.push({ kind: "none", item: 1000 + i, qty: (i % 5) + 1 });
  }
  return lines;
}
// d2 = the largest V2 IDA after the controller's 2,500-per-leg cap at SUBMIT (10-21; was 5,000)
for (const [tag, n, mixed] of [["d1", 2000, false], ["d2", 2500, true]]) {
  if (!want("d") && !want(tag)) continue;
  const t0 = Date.now();
  const f = F.world({ pickQty: 3, lines: bigCase(n, mixed) });
  const w = f.w;
  const key = F.keyOf("new-int-" + tag, "3d4e5f6a7b8c9d0e");
  const r = submit(w, "Add", "", key, F.addForm(f));
  const job = jobOf(w, key);
  const moves = n + 1;
  ok(!r.err && r.out.route === "QUEUED" && job && job.line_count === moves, tag + " SUBMIT (Add, " + n + " lines + 1 pick = " + moves + " moves): QUEUED", r.err || r.out);
  const ticks = drive(w, job.id, { gap: 15000, drain: tag === "d1" });
  const paths = ticks.map(tickPath);
  const ok3 = ticks.length === 3 && paths[0] === "PREPARE" && paths[1] === "COMMIT" && paths[2] === "COMMIT";
  ok(ok3 && !ticks.some((x) => x.err) && job.job_status === "COMPLETED", tag + " three ticks: PREPARE alone (> 2,000 moves), COMMIT A (PARK: op 2 > 1,000), COMMIT B -> COMPLETED",
    { paths: paths, errs: ticks.map((x) => x.err), job: [job.job_status, job.error_code, job.error_message] });
  const [s1, s2, s3] = ticks.map((x) => x.after || {});
  ok(ok3 && s1.status === "READY_TO_COMMIT" && s1.lease === "" && s1.due && s1.progress === 60 && s1.opI === 0
    && s2.status === "COMMITTING_IDA" && s2.lease === "" && s2.due && s2.progress === 75 && JSON.stringify(s2.steps) === JSON.stringify(mixed ? ["D0_REVALIDATE", "D1_BATCH", "D2_ISSUE"] : ["D0_REVALIDATE", "D2_ISSUE"])
    && s2.opI === 1 && s2.opR === 0 && s3.status === "COMPLETED" && s3.opR === n && s3.progress === 100,
  tag + " the job between ticks: after 1 READY_TO_COMMIT 60, no lease, due now (PREPARE alone); after 2 COMMITTING_IDA 75, PARKed (no lease, due), D2 DONE, op 1 moved, op 2 not; after 3 COMPLETED 100",
  [s1, s2, s3]);
  const h = w.ida(r.out.ida_id);
  const ins = movesOf(w, "IDC|" + job.id + "|R");
  ok(h.item_disassembly_status === "Completed" && ins.length === n && locksFree(w).length === 0, tag + " the IDA Completed, " + n + " receipts, every lock given back",
    { status: h.item_disassembly_status, ins: ins.length, held: locksFree(w).length });
  if (mixed) {
    const ours = live(w.batches).filter((b) => W.big(b.id) > W.big(job.id));
    const nAuto = f.lines.filter((L) => L.kind === "auto").length;
    const nTyped = new Set(f.lines.filter((L) => L.kind === "typed").map((L) => L.number)).size;
    const autoNos = w.liveLines(h.id).filter((l) => /^Batch-\d{5}$/.test(W.s(l.batch_number))).length;
    ok(ours.length === nAuto + nTyped && autoNos === nAuto && w.bnc[0].running_number === 631 + nAuto, tag + " Batch rows " + ours.length + " (" + nAuto + " AUTO + " + nTyped
      + " shared TYPED), every AUTO line numbered, config +" + nAuto, { rows: ours.length, autoNos: autoNos, running: w.bnc[0].running_number });
  }
  const per = ticks.map((x, i) => ({ tick: i + 1, path: paths[i], out_mb: tickOut(x), out_in_mb: tickMb(x), by_workflow: tickAgg(x) }));
  for (const p of per) console.log("     tick " + p.tick + " (" + p.path + "): outputs " + p.out_mb + " MB, outputs + injected inputs " + p.out_in_mb + " MB = "
    + p.by_workflow.map((a) => a.wf.replace("INVENTORY_", "").replace("IDA_V2_", "") + (a.runs > 1 ? " x" + a.runs : "") + " " + a.out_mb + "/" + a.out_in_mb).join(", "));
  const v2only = per.map((p) => Number(p.by_workflow.filter((a) => /^IDA_V2_/.test(a.wf)).reduce((s0, a) => s0 + a.out_mb, 0).toFixed(2)));
  ok(v2only.every((x) => x <= 35), tag + " the V2 workflows' own node outputs per tick (worker + PREPARE / COMMIT) <= ~35 MB: " + v2only.join(", ") + " MB", v2only);
  // the WHOLE chain incl. the deployed engine's own runs: a concern for the controller (contract sizes / engine), not an interface check
  const over = per.filter((p) => p.out_mb > 35);
  if (over.length) {
    const msg = tag + " CONCERN: tick " + over.map((p) => p.tick + " (" + p.path + ") " + p.out_mb + " MB").join(", ") + " of node outputs in ONE synchronous chain - the deployed engine's "
      + "runs nested in it: " + over.map((p) => p.by_workflow.filter((a) => !/^IDA_V2_/.test(a.wf)).map((a) => a.wf + " " + a.out_mb).join(" + ")).join("; ");
    console.log("WARN " + msg);
    (report.concerns = report.concerns || []).push(msg);
  }
  report.scenarios[tag] = { lines: n, moves: moves, paths: paths, ticks: per, v2_out_mb: v2only, submit: { out_mb: tickOut(r), out_in_mb: tickMb(r), by_workflow: tickAgg(r) }, seconds: (Date.now() - t0) / 1000 };
  report.sizes[tag] = { submit_out_mb: tickOut(r), ticks_out_mb: per.map((p) => p.out_mb), ticks_out_in_mb: per.map((p) => p.out_in_mb), v2_out_mb: v2only };
  console.log("ok   " + tag + " " + moves + " moves: ticks " + paths.join(" | ") + "; per tick outputs " + per.map((p) => p.out_mb + " MB").join(", ") + " (V2 alone "
    + v2only.join(", ") + "); SUBMIT " + tickOut(r) + " MB (" + ((Date.now() - t0) / 1000).toFixed(0) + " s in-process)");
}

// ================================================================================================ (d3) 2,501 stock recovery lines: refused at SUBMIT (the 2,500 cap)
if (want("d") || want("d3")) {
  const f = F.world({ pickQty: 3, lines: bigCase(2501, false) });
  const w = f.w;
  const before = { writes: w.writeCount, jobs: w.jobs.length, idas: w.idas.size, steps: w.steps.length };
  const key = F.keyOf("new-int-d3", "3d4e5f6a7b8c9d0f");
  const r = submit(w, "Add", "", key, F.addForm(f));
  const want3 = "This Item Disassembly has 2501 recovery lines. At most 2,500 can be completed in the background at once - please split the disassembly.";
  ok(!r.err && r.out.route === "STOP" && r.out.code === "400" && r.out.error_code === "IDA_SPLIT_REQUIRED" && r.out.message === want3 && r.out.error_message === want3,
    "d3 2,501 stock recovery lines (+1 pick): SUBMIT STOP 400 IDA_SPLIT_REQUIRED '" + want3 + "'", r.err || r.out);
  ok(w.writeCount === before.writes && w.jobs.length === before.jobs && w.idas.size === before.idas && w.steps.length === before.steps && w.mv.length === 0,
    "d3 nothing written (no job, no IDA, no lock row, no movement)", { writes: w.writeCount - before.writes, jobs: w.jobs.length, idas: w.idas.size });
  report.scenarios.d3 = { route: r.out && r.out.route, code: r.out && r.out.error_code, message: r.out && r.out.message, submit_out_mb: tickOut(r) };
  console.log("ok   d3 2,501 stock recovery lines -> SUBMIT STOP IDA_SPLIT_REQUIRED (the 2,500 cap), nothing written");
}

// ================================================================================================ (e) the key twice, another key while Processing, the classic v7
if (want("e")) {
  const f = F.world({ lines: Array.from({ length: 55 }, (_, i) => ({ kind: "none", qty: 1 })) });
  const w = f.w;
  const key = F.keyOf("new-int-e1", "4e5f6a7b8c9d0e1f");
  const form = F.addForm(f);
  const r1 = submit(w, "Add", "", key, form);
  const job = jobOf(w, key);
  const idaId = r1.out && r1.out.ida_id;
  const writes = w.writeCount;
  const r2 = submit(w, "Add", "", key, form);
  ok(!r2.err && r2.out.route === "STATUS" && r2.out.job_id === job.id && r2.out.ida_id === idaId && w.jobs.length === 1 && w.writeCount === writes,
    "e the same key again (a lost answer re-sent): STATUS of that job, ONE job, nothing written", r2.err || r2.out);
  const busyForm = F.editForm(w, idaId);
  const r3 = submit(w, "Edit", idaId, F.keyOf(idaId, "4e5f6a7b8c9d0e1f", 2), busyForm);
  ok(!r3.err && r3.out.route === "BUSY" && r3.out.code === "409" && r3.out.error_code === "IDA_BUSY" && r3.out.job_id === job.id && w.jobs.length === 1 && w.writeCount === writes,
    "e another key while the IDA is Processing: BUSY 409 IDA_BUSY (the open job named), nothing written", r3.err || r3.out);
  for (const saveAs of ["Completed", "Draft"]) {
    const before = w.writeCount;
    const calls = w.childCalls.length;
    const cr = classic(w, F.editForm(w, idaId), saveAs, "Edit");
    ok(!cr.err && W.s(cr.out && cr.out.code) === "400" && W.s(cr.out.message) === C.IDA_TEXT.busy && w.writeCount === before && w.childCalls.length === calls
      && w.ida(idaId).item_disassembly_status === "Processing", "e the classic v7 (saveAs " + saveAs + ") on the Processing IDA: 400 '" + C.IDA_TEXT.busy.slice(0, 40) + "...', nothing written, no child called",
    cr.err || cr.out);
  }
  const ticks = drive(w, job.id);
  const r4 = submit(w, "Add", "", key, form);
  ok(job.job_status === "COMPLETED" && !r4.err && r4.out.route === "STATUS" && r4.out.job_status === "COMPLETED" && w.jobs.length === 1,
    "e completed; the same key once more: STATUS COMPLETED, still one job (no double completion)", r4.err || r4.out);
  const r5 = submit(w, "Edit", idaId, F.keyOf(idaId, "4e5f6a7b8c9d0e1f", 3), F.editForm(w, idaId));
  ok(!r5.err && r5.out.route === "STALE" && r5.out.code === "409" && r5.out.error_code === "IDA_ALREADY_FINAL", "e a new key on the Completed IDA: STALE 409 IDA_ALREADY_FINAL", r5.err || r5.out);
  report.scenarios.e = { ida: idaId, job: job.id, ticks: ticks.length };
  console.log("ok   e  idempotency: the key twice -> one job; another key -> BUSY 409; classic v7 on Processing -> 400, nothing written");
}

// ================================================================================================ (f) a typed number taken between SUBMIT and the tick
function typedCase(number) {
  const lines = [{ kind: "typed", item: 301, number: number, qty: 2 }];
  for (let i = 2; i <= 55; i++) lines.push({ kind: "none", item: 300 + i, qty: 1 });
  return lines;
}
if (want("f")) {
  // f1: taken (another case) before the tick -> PREPARE's BATCH_TYPED_STORED check
  {
    const f = F.world({ lines: typedCase("LOT-F1") });
    const w = f.w;
    const key = F.keyOf("new-int-f1", "5f6a7b8c9d0e1f2a");
    const r = submit(w, "Add", "", key, F.addForm(f));
    const job = jobOf(w, key);
    w.addBatch({ batch_number: "lot-f1 ", material_id: F.comp(999), plant_id: F.PLANT, organization_id: F.ORG, transaction_no: "GR-2610-0099" });
    const t = drive(w, job.id)[0];
    ok(!r.err && r.out.route === "QUEUED" && !t.err && job.job_status === "FAILED" && job.error_code === "IDA_BATCH_DUPLICATE"
      && job.error_message === C.IDA_TEXT.typedTaken(C.idaLineLabel(1, { item_name: "Part 301" }), "LOT-F1") && tickPath(t) === "PREPARE",
    "f1 'lot-f1 ' taken by a GR after SUBMIT: PREPARE -> FAILED IDA_BATCH_DUPLICATE '" + C.IDA_TEXT.typedTaken("Line 1 (Part 301)", "LOT-F1") + "'",
    { err: r.err || t.err, job: [job.job_status, job.error_code, job.error_message], path: tickPath(t) });
    ok(w.ida(r.out.ida_id).item_disassembly_status === "Draft" && w.mv.length === 0 && live(w.batches).length === 1 && w.locks.length === 0, "f1 nothing moved, no Batch row of ours, the IDA a Draft");
  }
  // f1x: the exact text taken: the lifted classic code_validate (PREPARE's re-run on fresh rows) refuses first
  {
    const f = F.world({ lines: typedCase("LOT-F1X") });
    const w = f.w;
    const key = F.keyOf("new-int-f1x", "5f6a7b8c9d0e1f2b");
    const r = submit(w, "Add", "", key, F.addForm(f));
    const job = jobOf(w, key);
    w.addBatch({ batch_number: "LOT-F1X", material_id: F.comp(998), plant_id: F.PLANT, organization_id: F.ORG, transaction_no: "GR-2610-0098" });
    const t = drive(w, job.id)[0];
    ok(!t.err && job.job_status === "FAILED" && job.error_code === "IDA_INVALID" && /Line 1 \(Part 301\): Batch No LOT-F1X already exists: nothing was moved\./.test(W.s(job.error_message))
      && w.mv.length === 0 && w.ida(r.out.ida_id).item_disassembly_status === "Draft",
    "f1x the EXACT text taken: PREPARE's lifted code_validate refuses first -> FAILED IDA_INVALID (code_validate's wording + ': nothing was moved.')",
    { job: [job.job_status, job.error_code, job.error_message] });
    report.notes.push("f1x: an exactly-equal typed number taken after SUBMIT fails PREPARE as IDA_INVALID (the lifted code_validate runs before PREPARE's own IDA_BATCH_DUPLICATE check); a case / trailing-space variant fails as IDA_BATCH_DUPLICATE. Both FAILED, nothing moved, Draft.");
  }
  // f2: taken between PREPARE and COMMIT D1 -> D1 rule 5
  {
    const f = F.world({ lines: typedCase("LOT-F2") });
    const w = f.w;
    const key = F.keyOf("new-int-f2", "5f6a7b8c9d0e1f2c");
    const r = submit(w, "Add", "", key, F.addForm(f));
    const job = jobOf(w, key);
    let once = 0;
    w.hooks.IDA_V2_COMMIT = () => {
      if (once++) return;
      w.addBatch({ batch_number: "LOT-F2", material_id: F.comp(997), plant_id: F.PLANT, organization_id: F.ORG, transaction_no: "GR-2610-0097" });
    };
    const t = drive(w, job.id)[0];
    ok(!t.err && job.job_status === "FAILED" && job.error_code === "IDA_BATCH_DUPLICATE" && job.error_message === C.IDA_TEXT.typedTaken("Line 1 (Part 301)", "LOT-F2"),
      "f2 taken between PREPARE and COMMIT: D1 (rule 5, no intent) -> FAILED IDA_BATCH_DUPLICATE", { err: t.err, job: [job.job_status, job.error_code, job.error_message], path: tickPath(t) });
    ok(w.ida(r.out.ida_id).item_disassembly_status === "Draft" && w.mv.length === 0 && live(w.batches).length === 1 && !stepsOf(w, job.id, /^D1\|I/).length
      && t.calls.filter((c) => c.to === "INVENTORY_BULK_APPLY").every((c) => c.mode === "PLAN"), "f2 nothing moved, no intent / config / Batch write, the IDA a Draft");
  }
  // f3: a concurrent writer inside D1's insert window (rule 10, the post-insert re-check)
  {
    const f = F.world({ lines: typedCase("LOT-F3") });
    const w = f.w;
    const key = F.keyOf("new-int-f3", "5f6a7b8c9d0e1f2d");
    const r = submit(w, "Add", "", key, F.addForm(f));
    const job = jobOf(w, key);
    const ins0 = w.insert.bind(w);
    let raced = 0;
    w.insert = (table, rows, nid, ctx) => {
      const out = ins0(table, rows, nid, ctx);
      if (table === "Batch" && nid === "add_node_DCd1iwrite" && !raced++) ins0("Batch", [{ batch_number: "LOT-F3", material_id: F.comp(996), plant_id: F.PLANT, organization_id: F.ORG,
        transaction_no: "GR-2610-0096", initial_quantity: "1.00000000", remark: "", remark2: "", remark3: "", manufacturing_date: null, expired_date: null }], "concurrent GR");
      return out;
    };
    const t = drive(w, job.id)[0];
    const mine = w.batches.filter((b) => b.transaction_no === w.ida(r.out.ida_id).stock_movement_no);
    ok(!t.err && raced === 1 && job.job_status === "FAILED" && job.error_code === "IDA_BATCH_DUPLICATE" && job.error_message === C.IDA_TEXT.batchDuplicate("LOT-F3")
      && mine.length === 1 && mine[0].is_deleted === 1 && w.mv.length === 0 && w.ida(r.out.ida_id).item_disassembly_status === "Draft",
    "f3 a concurrent GR inserts LOT-F3 inside D1's insert window: the post-insert re-check -> FAILED IDA_BATCH_DUPLICATE, ours soft-deleted, nothing moved, Draft",
    { err: t.err, job: [job.job_status, job.error_code, job.error_message], mine: mine.map((b) => [b.batch_number, b.is_deleted]) });
  }
  console.log("ok   f  typed number taken: PREPARE (case variant) / IDA_INVALID (exact) / D1 rule 5 / D1 rule 10 -> FAILED, nothing moved");
}

// ================================================================================================ (g) a recovery item turned non-stock after PREPARE
if (want("g")) {
  const f = F.world({ lines: Array.from({ length: 55 }, (_, i) => ({ kind: "none", item: 400 + i + 1, qty: (i % 3) + 1 })) });
  const w = f.w;
  const key = F.keyOf("new-int-g1", "6a7b8c9d0e1f2a3b");
  const r = submit(w, "Add", "", key, F.addForm(f));
  const job = jobOf(w, key);
  const flip = F.comp(410);
  let once = 0;
  w.hooks.IDA_V2_COMMIT = () => {
    if (!once++) w.items.get(flip).stock_control = 0;
  };
  const t = drive(w, job.id)[0];
  const ins = movesOf(w, "IDC|" + job.id + "|R");
  const outs = movesOf(w, "IDC|" + job.id + "|I");
  const d3 = w.steps.find((x) => x.job_id === job.id && x.step_name === "D3_RECEIPT");
  const ref = d3 ? C.idaParseJ(d3.result_ref) : {};
  ok(!t.err && job.job_status === "COMPLETED" && w.ida(r.out.ida_id).item_disassembly_status === "Completed", "g item 410 turned non-stock after PREPARE: op 2 answers '401' for it -> COMPLETED (tolerated)",
    { err: t.err, job: [job.job_status, job.error_code, job.error_message] });
  ok(ins.length === 54 && !ins.some((m) => m.item_id === flip) && !live(w.ib).some((b) => b.material_id === flip), "g that line not received (54 of 55 IN rows, no balance)", ins.length);
  ok(ref && Array.isArray(ref.skipped) && ref.skipped.indexOf("R10") >= 0 && Number(ref.skipped_count) === 1 && /R10/.test(W.s(job.progress_message)),
    "g the D3 DONE ref and the job's message name the skipped R10", { ref: ref, msg: job.progress_message });
  const issued = outs.reduce((a, m) => a + Number(m.total_price), 0);
  const recv = ins.reduce((a, m) => a + Number(m.total_price), 0);
  const prices = PR.idaAllocate(Number(issued.toFixed(8)), f.lines.map((L) => ({ share_qty: L.qty, base_qty: L.qty })));
  ok(near(recv + prices[9].value, issued, 1e-6), "g received value = issued - the skipped line's share (classic parity: ADD answers 401, the share is not received)",
    { recv: recv, share: prices[9].value, issued: issued });
  // g2: the batch variant - D1's re-PLAN runs after PREPARE and refuses it (nothing moved)
  {
    const f2 = F.world({ lines: [{ kind: "auto", item: 501, qty: 2 }].concat(Array.from({ length: 54 }, (_, i) => ({ kind: "none", item: 502 + i, qty: 1 }))) });
    const w2 = f2.w;
    const key2 = F.keyOf("new-int-g2", "6a7b8c9d0e1f2a3c");
    const r2 = submit(w2, "Add", "", key2, F.addForm(f2));
    const job2 = jobOf(w2, key2);
    let once2 = 0;
    w2.hooks.IDA_V2_COMMIT = () => {
      if (!once2++) w2.items.get(F.comp(510)).stock_control = 0;
    };
    const t2 = drive(w2, job2.id)[0];
    const ours = w2.batches.filter((b) => W.big(b.id) > W.big(job2.id));
    ok(!t2.err && job2.job_status === "FAILED" && job2.error_code === "IDA_PLAN_SKIPPED" && /nothing was moved\.$/.test(W.s(job2.error_message)) && w2.mv.length === 0
      && ours.length === 1 && ours[0].is_deleted === 1 && w2.ida(r2.out.ida_id).item_disassembly_status === "Draft",
    "g2 the same flip with a batch-numbered line: D1's re-PLAN refuses it -> FAILED IDA_PLAN_SKIPPED, the AUTO Batch row soft-deleted, nothing moved, Draft",
    { err: t2.err, job: [job2.job_status, job2.error_code, job2.error_message], ours: ours.map((b) => [b.batch_number, b.is_deleted]) });
  }
  report.scenarios.g = { job: job.id, skipped: ref && ref.skipped, message: job.progress_message };
  console.log("ok   g  stock_control 0 after PREPARE: non-batch IDA -> '401' tolerated, COMPLETED without that line; batch IDA -> D1 re-PLAN FAILED IDA_PLAN_SKIPPED");
}

// ================================================================================================ (h) a crash right after every write of the chain, then the resume
if (want("h")) {
  const lines = [{ kind: "typed", item: 601, number: "LOT-H1", qty: 2 }, { kind: "auto", item: 602, qty: 1 }, { kind: "none", item: 603, alt: true, qty: 1 }, { kind: "ns", item: 604, qty: 1 }];
  for (let i = 5; i <= 52; i++) lines.push({ kind: "none", item: 600 + i, qty: 1 });
  const fresh = () => {
    const f = F.world({ lines: lines });
    const key = F.keyOf("new-int-h", "7b8c9d0e1f2a3b4c");
    const r = submit(f.w, "Add", "", key, F.addForm(f));
    return { f: f, w: f.w, key: key, r: r, job: jobOf(f.w, key) };
  };
  // the clean run: the reference end state and the number of writes in its chain
  const clean = fresh();
  const base = clean.w.writeCount;
  drive(clean.w, clean.job.id);
  const total = clean.w.writeCount - base;
  const ref = snapshot(clean.w, clean.r.out.ida_id);
  ok(clean.job.job_status === "COMPLETED", "h the clean run COMPLETED (" + total + " writes in its ticks)", clean.job.job_status);
  const outcomes = {};
  const bad = [];
  for (let k = 1; k <= total; k++) {
    const c = fresh();
    c.w.crashAfter = c.w.writeCount + k;
    const t1 = kick(c.w, c.job.id);
    const what = c.w.crashed || "";
    c.w.crashAfter = 0;
    let ticks = 0;
    for (; ticks < 14 && ["COMPLETED", "FAILED", "REQUIRES_REVIEW"].indexOf(c.job.job_status) < 0; ticks++) {
      c.w.now += 11 * 60000;
      if (c.job.lease_expires_at && c.job.lease_expires_at > c.w.now) c.w.now = c.job.lease_expires_at + 1000;
      kick(c.w, c.job.id);
    }
    const snap = snapshot(c.w, c.r.out.ida_id);
    const dups = {};
    for (const m of live(c.w.mv)) if (m.operation_effect_key) dups[m.operation_effect_key] = (dups[m.operation_effect_key] || 0) + 1;
    const twice = Object.keys(dups).filter((x) => dups[x] > 1);
    const diff = diffSnap(snap, ref).filter((x) => x.t !== "stamps");
    const held = locksFree(c.w);
    const key = c.job.job_status + (twice.length ? " +dup" : "") + (diff.length ? " +diff" : "") + (held.length ? " +locks" : "");
    outcomes[key] = (outcomes[key] || 0) + 1;
    if (c.job.job_status !== "COMPLETED" || twice.length || diff.length || held.length) bad.push({ k: k, crashed: what.slice(0, 120), status: c.job.job_status, code: c.job.error_code,
      msg: W.s(c.job.error_message).slice(0, 160), dups: twice.slice(0, 3), diff: diff.slice(0, 2), held: held.slice(0, 2).map((l) => [l.lock_key, l.free_token, l.owner_operation_id]), ticks: ticks,
      first: !!t1.err });
  }
  const idaBad = bad.filter((b) => b.status !== "COMPLETED" || b.dups.length || b.diff.length);
  ok(idaBad.length === 0, "h a crash right after each of the " + total + " writes of the chain, then later ticks (lease expiry): every run COMPLETED with the clean run's stock / FIFO / "
    + "movements / header / lines / Batch rows, each operation applied once (" + JSON.stringify(outcomes) + ")", idaBad.slice(0, 6));
  const leak = bad.filter((b) => b.held.length);
  const byNode = {};
  for (const b of leak) {
    const n = b.crashed.split(" (")[0];
    byNode[n] = (byNode[n] || 0) + 1;
  }
  if (leak.length) {
    const msg = "h ENGINE (deployed INVENTORY_BULK_APPLY v10, not packages A-E): " + leak.length + " of " + total + " crash points leave the op's lock rows held (free_token 0) after the IDA "
      + "COMPLETED - a crash after add_node_IBdone (the IBA|DONE row) and before INVENTORY_LOCK_TOKENS GIVE finishes; the resumed COMMIT's APPLY of the same op takes the REPLAY route "
      + "(code_node_IBstate -> if_IBreplay -> return_node_IBreplay) BEFORE cor_IBrelease, so nothing gives the keys back: later operations on them answer 409 LOCK_BUSY. Crash points: "
      + JSON.stringify(byNode);
    console.log("WARN " + msg);
    (report.concerns = report.concerns || []).push(msg);
  }
  // the consequence, shown: after a crash right after op 1's IBA|DONE row, a SECOND IDA of the same source item cannot issue
  let second = null;
  const k1 = leak.find((b) => /add_node_IBdone/.test(b.crashed) && b.held.some((x) => /^ITEM\|2105489115887079441\|/.test(x[0])));
  if (k1) {
    const c = fresh();
    c.w.crashAfter = c.w.writeCount + k1.k;
    kick(c.w, c.job.id);
    c.w.crashAfter = 0;
    for (let i = 0; i < 14 && c.job.job_status !== "COMPLETED"; i++) {
      c.w.now = Math.max(c.w.now + 11 * 60000, (c.job.lease_expires_at || 0) + 1000);
      kick(c.w, c.job.id);
    }
    const f2 = { w: c.w, sp: c.f.sp, lines: c.f.lines.filter((L) => L.kind === "none").slice(0, 51) };
    const key2 = F.keyOf("new-int-h2", "7b8c9d0e1f2a3b4d");
    const r2 = submit(c.w, "Add", "", key2, F.addForm(f2));
    const job2 = jobOf(c.w, key2);
    const ticks2 = job2 ? drive(c.w, job2.id, { max: 30 }) : [];
    second = { first: c.job.job_status, route: r2.out && r2.out.route, job2: job2 && [job2.job_status, job2.error_code, job2.error_message], ticks: ticks2.length,
      moved: job2 ? movesOf(c.w, "IDC|" + job2.id + "|I").length : null };
    ok(c.job.job_status === "COMPLETED" && job2 && job2.job_status === "FAILED" && job2.error_code === "IDA_INVENTORY_LOCK_BUSY" && second.moved === 0,
      "h the leak's consequence: after the resumed job COMPLETED with op 1's keys still held, a second IDA of the same source fails D2 IDA_INVENTORY_LOCK_BUSY after its lock waits (nothing moved)",
      second);
  }
  report.scenarios.h = { writes: total, outcomes: outcomes, ida_bad: idaBad.slice(0, 10), leaks: leak.length, leak_by_node: byNode, leak_sample: leak.slice(0, 4), second: second };
  console.log("ok   h  crash after each of " + total + " chain writes -> resume: " + JSON.stringify(outcomes));
}

console.log((fails ? "FAILED " + fails + " of " : "") + checks + " checks" + (fails ? "" : " passed"));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(Object.assign(report, { checks: checks, fails: fails, failed: failed }), null, 1));
process.exit(fails ? 1 : 0);
