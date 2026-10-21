// node scratchpad/iav2/test/integration/e2e.js [--strict] - plan.md Task F, the end-to-end runs of the BUILT workflows on ONE world
// (world.js): every workflow built with stand-in shell ids IN MEMORY (build_standin.py over a pipe; ids.json untouched), callees
// resolved by those ids.
//   1a  Add -> Completed, non-batch parent, 56 picks (FIFO over two layers, one component on two bins) + a non-stock DL line:
//       IA_V2_SUBMIT -> IA_V2_WORKER (the form's kick) -> IA_V2_PREPARE -> IA_V2_COMMIT A (SPLIT) -> COMMIT B -> COMPLETED
//   1b  stored Draft -> Completed, a system-generated batch parent and a batch component (GENERATE_BATCH, I1's Batch row)
//   1c  short stock: (i) found by PREPARE's PLAN, (ii) stock taken between PREPARE and COMMIT (I2 refused after I1): FAILED,
//       nothing moved, back to Draft, the Batch row soft-deleted
//   2   the IA completed in 1a by C's COMMIT reverted by F's IA_REVERT_V2_SUBMIT (the list's request) -> WORKER -> PREPARE ->
//       COMMIT -> Draft, stock / FIFO restored; the cross-command BUSY both ways; completed again -> a new number (RV2)
//   3   the classic IA_REVERT v5 on V2-completed IAs: 3 picks (the list's NOT_ELIGIBLE -> classic route), a batch parent, and
//       252 live rows (v5 refuses: the ruling-9 go / no-go case; Revert V2 takes it)
const path = require("path");
const { spawnSync } = require("child_process");
const IAV2 = path.join(__dirname, "..", "..");
const W = require("./world.js");
const SH = require(path.join(IAV2, "code", "shared", "ia_common.js"));
const FP = require(path.join(IAV2, "code", "shared", "fingerprint.js"));
const PR = require(path.join(IAV2, "code", "shared", "price.js"));
const IDS = require(path.join(IAV2, "ids.json"));
const { snapshot } = require(path.join(IAV2, "test", "revert", "_scen.js"));

let checks = 0;
let fails = 0;
const show = (x) => JSON.stringify(x === undefined ? "<undefined>" : x).slice(0, 1500);
const ok = (cond, what, extra) => {
  checks++;
  if (!cond) {
    fails++;
    console.log("FAIL " + what + (extra === undefined ? "" : "\n     " + show(extra)));
  }
  return !!cond;
};

// ------------------------------------------------------------------------------------------------ the stand-in build (in memory)
const strict = process.argv.indexOf("--strict") >= 0;
const b = spawnSync("python3", [path.join(__dirname, "build_standin.py")].concat(strict ? ["--strict"] : []), { encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: "1" }) });
if (b.status !== 0) {
  console.log((b.stderr || "").split("\n").slice(-12).join("\n"));
  console.log("FAIL the stand-in build");
  process.exit(1);
}
const built = JSON.parse(b.stdout);
checks += built.checks.length;
console.log("ok   stand-in build (in memory): " + built.checks.length + " checks" + (built.warnings.length ? "\nWARN " + built.warnings.join("\nWARN ") : ""));
const docs = built.docs;
// mutants.js: one cross-package interface broken in one workflow's code bodies (IA_E2E_MUTANT = { wf, from, to })
if (process.env.IA_E2E_MUTANT) {
  const mu = JSON.parse(process.env.IA_E2E_MUTANT);
  let hits = 0;
  const walk = (ns) => (ns || []).forEach((n) => {
    if (n.type === "code-node" && n.data.script.code.indexOf(mu.from) >= 0) {
      hits += n.data.script.code.split(mu.from).length - 1;
      n.data.script.code = n.data.script.code.split(mu.from).join(mu.to);
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
const idToName = {};
for (const [k, v] of Object.entries(built.standin)) idToName[v] = k;
for (const k of ["GENERATE_BATCH", "INVENTORY_BULK_APPLY", "INVENTORY_LOCK_TOKENS", "SUBTRACT_INVENTORY", "ADD_INVENTORY", "HANDLING_UNIT"]) idToName[IDS[k]] = k;
const run = (w, name, params) => W.runWorkflow(w, docs, idToName, name, params);

// ------------------------------------------------------------------------------------------------ fixtures
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const UOM = "2018906563477008392";
const BIN = "2018912822846582786";
const BIN2 = "2018912822846582787";
const FG_BIN = "2018912822846582799";
const SLOC = "2018912759311265793";
const RULE = "2098266711093927937";
const q4 = (v) => Number(Number(v).toFixed(4));
const q8 = SH.iaQ8;

function world() {
  const w = new W.IntegrationWorld();
  Object.assign(w.bins, { [BIN]: "A1-01", [BIN2]: "A1-02", [FG_BIN]: "FG-01" });
  return w;
}
function item(w, o) {
  const it = Object.assign({ id: w.id(), stock_control: 1, based_uom: UOM, item_batch_management: 0, purchase_unit_price: 0, assembly_cost: 0, material_costing_method: W.FIFO,
    uoms: [{ alt_uom_id: UOM, base_qty: 1 }] }, o);
  w.items[it.id] = it;
  return it;
}
function balance(w, it, bin, qty, batchId) {
  const bal = { id: w.id(), material_id: it.id, location_id: bin, plant_id: PLANT, organization_id: ORG, unrestricted_qty: qty, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0,
    intransit_qty: 0, balance_quantity: qty, is_deleted: 0 };
  w.ib.push(bal);
  if (batchId) w.bb.push(Object.assign({}, bal, { id: w.id(), batch_id: batchId }));
  return bal;
}
// spec: comps (stock lines, one pick of 3 each), twoBin (the last component also picks 2 on BIN2), nonStock (a DL line of 4 h),
// batchParent (system-generated), batchComp (component 1 batch-managed), itemQty, assemblyCost
function bom(w, spec) {
  const sp = Object.assign({ itemQty: 2, assemblyCost: 0 }, spec);
  const parent = item(w, { material_code: "FG-INT", material_name: "Integration assembly", assembly_cost: sp.assemblyCost, item_batch_management: sp.batchParent ? 1 : 0,
    batch_number_genaration: sp.batchParent ? "According To System Settings" : null });
  const lines = [];
  for (let i = 1; i <= sp.comps; i++) {
    const batch = !!sp.batchComp && i === 1;
    const it = item(w, { material_code: "RM-" + i, material_name: "Part " + i, item_batch_management: batch ? 1 : 0 });
    const batchId = batch ? w.id() : null;
    if (batchId) w.batch.push({ id: batchId, batch_number: "RMB-0001", material_id: it.id, plant_id: PLANT, organization_id: ORG, transaction_no: "GR-0001", is_deleted: 0 });
    const layers = [[2, q4(1 + i * 0.0137)], [10, q4(2 + i * 0.0213)]];
    layers.forEach(([q, p], k) => w.fifo.push({ id: w.id(), material_id: it.id, plant_id: PLANT, organization_id: ORG, batch_id: batchId, fifo_sequence: String(k + 1), fifo_cost_price: p,
      fifo_initial_quantity: q, fifo_available_quantity: q, is_deleted: 0 }));
    const bal = balance(w, it, BIN, 10, batchId);
    const picks = [{ material_id: it.id, location_id: BIN, batch_id: batchId, balance_id: bal.id, sm_quantity: 3, category: "Unrestricted" }];
    if (sp.twoBin && i === sp.comps) {
      const bal2 = balance(w, it, BIN2, 4, batchId);
      picks.push({ material_id: it.id, location_id: BIN2, batch_id: batchId, balance_id: bal2.id, sm_quantity: 2, category: "Unrestricted" });
    }
    lines.push({ it: it, picks: picks, total: picks.reduce((n, p) => n + p.sm_quantity, 0), layers: layers });
  }
  if (sp.nonStock) lines.push({ it: item(w, { material_code: "DL", material_name: "Direct labour", stock_control: 0 }), picks: [], total: 4, layers: [] });
  return { spec: sp, parent: parent, lines: lines };
}
// what the form sends: getValues() minus NOT_RECORD (CONTRACT section 12)
function record(m, extra) {
  return Object.assign({ organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: "", stock_movement_no_type: RULE, item_assembly_status: "", item_id: m.parent.id,
    item_name: m.parent.material_name, item_desc: "", item_qty: m.spec.itemQty, item_uom: UOM, item_assembly_date: "2026-10-19", issued_by: "integration", project_id: "", batch_no: "",
    manufacturing_date: null, expired_date: null, storage_location_id: SLOC, location_id: FG_BIN, inventory_category: "Unrestricted", remarks: "", remarks_2: "", remarks_3: "",
    reference_documents: [], page_status: "Add", stock_movement: m.lines.map((l) => ({ item_selection: l.it.id, item_name: l.it.material_name, total_quantity: l.total, requested_qty: l.total,
      quantity_uom: UOM, temp_hu_data: "", temp_qty_data: JSON.stringify(l.picks) })) }, extra || {});
}
// the stored IA as the form opens it in Edit (its line ids, its stored status and number)
function editRecord(w, m, iaId) {
  const h = w.ia(iaId);
  const lines = w.lines.filter((l) => !l.is_deleted && l.sm_item_assembly_id === iaId).sort((a, b) => Number(a.line_index) - Number(b.line_index));
  return Object.assign(record(m), { id: iaId, page_status: "Edit", item_assembly_status: h.item_assembly_status, stock_movement_no: h.stock_movement_no, batch_no: h.batch_no || "",
    stock_movement: lines.map((l) => ({ id: l.id, item_selection: l.item_selection, item_name: l.item_name, total_quantity: Number(l.total_quantity), requested_qty: Number(l.requested_qty),
      quantity_uom: l.quantity_uom, temp_hu_data: "", temp_qty_data: l.temp_qty_data })) });
}
const submit = (w, page, iaId, key, form) => run(w, "IA_V2_SUBMIT", { operation: "SUBMIT", saveAs: "Completed", pageStatus: page, ia_id: iaId, idempotency_key: key, source: "FORM", form: form });
const status = (w, iaId, key) => run(w, "IA_V2_SUBMIT", { operation: "STATUS", saveAs: "Completed", pageStatus: "Edit", ia_id: iaId || "", idempotency_key: key || "", source: "FORM", form: {} });
const kick = (w, jobId) => run(w, "IA_V2_WORKER", { job_id: jobId || "" });
const listRow = (w, iaId) => ({ id: iaId, item_assembly_status: w.ia(iaId).item_assembly_status, stock_movement_no: w.ia(iaId).stock_movement_no, organization_id: ORG });
const revertSubmit = (w, iaId, click, minPicks) => run(w, "IA_REVERT_V2_SUBMIT", { operation: "SUBMIT", ia_id: iaId, idempotency_key: "IAV:" + ORG + ":" + iaId + ":" + click, source: "LIST",
  min_picks: minPicks === undefined ? "50" : minPicks, form: listRow(w, iaId) });
const jobOf = (w, key) => w.jobs.filter((j) => j.idempotency_key === key).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0] || null;
const stepsOf = (w, jobId, re) => w.steps.filter((r) => !r.is_deleted && r.job_id === jobId && re.test(r.step_name)).map((r) => r.step_name + ":" + r.step_status).sort();
const movesOf = (w, op) => w.mv.filter((x) => !x.is_deleted && String(x.operation_effect_key || "").indexOf(op + "|") === 0);
const live = (rows) => rows.filter((r) => !r.is_deleted);
const freeLocks = (w) => w.locks.every((l) => Number(l.free_token) === 1);
// two stock snapshots agree: every material's balance quantities, batch balance, FIFO quantity and value (4 dp), WA rows; a material
// with only zero rows counts as absent (the engine leaves a zeroed balance row behind)
const empty = (p) => !p || (p.qty === 0 && p.block === 0 && p.batch === 0 && p.fifoQty === 0 && Math.abs(p.fifoValue) < 1e-6 && p.wa.every((r) => r[0] === 0));
function stockDiff(a, b) {
  const out = [];
  for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
    const x = a[k];
    const y = b[k];
    if (empty(x) && empty(y)) continue;
    if (!x || !y || x.qty !== y.qty || x.block !== y.block || x.batch !== y.batch || x.fifoQty !== y.fifoQty || Math.abs(x.fifoValue - y.fifoValue) > 1e-4 || JSON.stringify(x.wa) !== JSON.stringify(y.wa)) {
      out.push({ material: k, a: x, b: y });
    }
  }
  return out;
}
// the FIFO cost op 1 takes for a component (layers in order)
function fifoCost(layers, qty) {
  let left = qty;
  let cost = 0;
  for (const [q, p] of layers) {
    const take = Math.min(q, left);
    cost += take * p;
    left -= take;
  }
  return cost;
}
const iaKey = (doc, hash, gen) => "IA:" + ORG + ":" + doc + ":" + hash + ":" + (gen || 1);

// ================================================================================================ 1a Add -> Completed (non-batch)
let A = null;
{
  const w = world();
  const m = bom(w, { comps: 55, twoBin: true, nonStock: true, itemQty: 2, assemblyCost: 1.25 });
  const before = snapshot(w);
  const key = iaKey("new-int1a", "0a1b2c3d4e5f6a7b");
  const r = submit(w, "Add", "", key, record(m));
  const job = jobOf(w, key);
  ok(!r.err && r.out.route === "QUEUED" && r.out.code === "200" && job && r.out.job_id === job.id && /^[0-9]+$/.test(r.out.ia_id), "1a SUBMIT (Add): QUEUED with the new IA's id", r.err || r.out);
  const iaId = r.out.ia_id;
  const ia = w.ia(iaId);
  ok(ia.item_assembly_status === "Processing" && ia.ia_v2_job_id === job.id && ia.ia_idem_key === key && ia.stock_movement_no === "IA-2610-0042" && r.out.ia_no === ia.stock_movement_no,
    "1a the IA written Processing under its job (key, issued number)", { ia: ia, out: r.out });
  ok(job.correlation_id === "IA|" + iaId && job.causation_id === iaId && job.job_status === "QUEUED" && job.next_attempt_at <= w.now && job.line_count === 56
    && JSON.stringify(stepsOf(w, "IAC|" + iaId, /^LOCK/)) === '["LOCK|1:LOCK"]' && w.latestLock(iaId).result_ref === key, "1a the job linked, due now, LOCK|1 = the key", job);
  const req = JSON.parse(job.request_payload);
  ok(req.action === "DIRECT" && req.prevStatus === "Draft" && req.pageStatus === "Add" && req.iaId === iaId && req.iaNo === ia.stock_movement_no && req.issuedNo === ia.stock_movement_no
    && req.pickCount === 56 && req.lineCount === 56 && req.nonStockLines === 1 && req.movementCount === 57 && req.lineFingerprint === FP.iaLineFingerprint(w.lineRows(iaId), w.header(iaId)),
  "1a request_payload: the keys PREPARE reads, the fingerprint of the STORED rows", req);
  // RV2: one open job per IA whatever it does - a revert of it now answers BUSY with the completion's job
  const rb = revertSubmit(w, iaId, "click1a");
  ok(!rb.err && rb.out.route === "BUSY" && rb.out.error_code === "IA_RV_BUSY" && rb.out.job_id === job.id && w.jobs.length === 1, "1a IA_REVERT_V2_SUBMIT while the completion is open -> BUSY (its job)", rb.err || rb.out);
  const t = kick(w, job.id);
  ok(!t.err && t.out.worker_route === "WORKED" && t.out.job_id === job.id && t.out.job_status === "COMPLETED" && t.out.ia_id === iaId, "1a one worker tick (the form's kick) -> COMPLETED", t.err || t.out);
  const order = t.calls.filter((c) => /^IA_V2_|INVENTORY_BULK_APPLY/.test(c.to)).map((c) => c.to + (c.to === "INVENTORY_BULK_APPLY" ? "" : ""));
  ok(JSON.stringify(t.calls.filter((c) => c.from === "IA_V2_WORKER").map((c) => c.to)) === '["IA_V2_PREPARE","IA_V2_COMMIT","IA_V2_COMMIT"]', "1a the tick: PREPARE, COMMIT A (SPLIT), COMMIT B", order);
  const eng = w.engineCalls.map((c) => c.op.replace(job.id, "<job>") + " " + c.mode + " " + c.n);
  ok(JSON.stringify(eng) === JSON.stringify(["IAC|<job>|I PLAN 56", "IAC|<job>|R PLAN 1", "IAC|<job>|I APPLY 56", "IAC|<job>|R APPLY 1"]), "1a the engine: PLAN op 1 + op 2 (PREPARE), APPLY op 1 (I2), APPLY op 2 (I3)", eng);
  ok(job.job_status === "COMPLETED" && job.progress_percent === 100 && job.lease_owner === null && ia.item_assembly_status === "Completed" && ia.posted_status === "Unposted",
    "1a job COMPLETED 100, the IA Completed / Unposted", { job: [job.job_status, job.progress_percent, job.lease_owner], ia: [ia.item_assembly_status, ia.posted_status] });
  ok(JSON.stringify(stepsOf(w, job.id, /^I[0-9]_/)) === JSON.stringify(["I0_REVALIDATE:DONE", "I2_ISSUE:DONE", "I3_RECEIPT:DONE", "I4_FINISH:DONE"]), "1a I0 / I2 / I3 / I4 DONE (no I1: not batch)",
    stepsOf(w, job.id, /^I/));
  const outs = movesOf(w, "IAC|" + job.id + "|I");
  const ins = movesOf(w, "IAC|" + job.id + "|R");
  ok(outs.length === 56 && outs.every((x) => x.movement === "OUT" && x.transaction_type === "IA" && x.trx_no === ia.stock_movement_no) && ins.length === 1 && ins[0].movement === "IN"
    && ins[0].item_id === m.parent.id && ins[0].bin_location_id === FG_BIN && Number(ins[0].base_qty) === 2, "1a 56 'IA' OUT rows (op 1) + the receipt IN row (op 2), the IA's number",
  { outs: outs.length, ins: ins.map((x) => [x.movement, x.item_id, x.bin_location_id, x.base_qty]) });
  ok(!w.mv.some((x) => x.item_id === m.lines[55].it.id), "1a the DL line moved no stock");
  let theory = 0;
  m.lines.slice(0, 55).forEach((l) => (theory += fifoCost(l.layers, l.total)));
  const stored = outs.reduce((n, x) => n + Number(x.total_price), 0);
  const price = PR.receiptUnitPrice({ outTotals: [stored.toFixed(8)], receiptBaseQty: 2, assemblyCost: 1.25 });
  ok(Math.abs(stored - theory) < 1e-6, "1a op 1 cost = the FIFO layers taken in order (" + theory.toFixed(4) + ")", { stored: stored, theory: theory });
  ok(Number(ins[0].unit_price) === price && price === q8(stored / 2 + 1.25), "1a the receipt priced q8(stored OUT total / base qty 2 + assembly cost 1.25) = " + price, { in: ins[0].unit_price, price: price });
  const layer = live(w.fifo).filter((f) => f.material_id === m.parent.id);
  ok(layer.length === 1 && Number(layer[0].fifo_available_quantity) === 2 && Number(layer[0].fifo_cost_price) === price, "1a the assembled item's FIFO layer: 2 at the receipt price", layer);
  const comp55 = m.lines[54].it.id;
  const balOf = (mat, bin) => live(w.ib).filter((x) => x.material_id === mat && x.location_id === bin).map((x) => Number(x.unrestricted_qty));
  ok(JSON.stringify(balOf(comp55, BIN)) === "[7]" && JSON.stringify(balOf(comp55, BIN2)) === "[2]" && JSON.stringify(balOf(m.lines[0].it.id, BIN)) === "[7]"
    && JSON.stringify(balOf(m.parent.id, FG_BIN)) === "[2]", "1a balances: each pick taken from its bin, the assembled item received at FG-01");
  ok(live(w.batch).length === 0, "1a no Batch row for a non-batch parent (V2's deliberate difference)");
  const dated = Object.keys(w.itemDates);
  ok(dated.length === 57 && m.lines.every((l) => dated.indexOf(l.it.id) >= 0) && dated.indexOf(m.parent.id) >= 0, "1a item dates: the parent + all 56 line items (the DL item too)", dated.length);
  const st = status(w, iaId, key);
  ok(!st.err && st.out.route === "STATUS" && st.out.job_status === "COMPLETED" && st.out.terminal === "YES" && st.out.action === "DIRECT" && st.out.ia_id === iaId
    && st.out.progress_percent === "100", "1a STATUS by key: COMPLETED, terminal, DIRECT (the client's verdict)", st.err || st.out);
  const again = submit(w, "Add", "", key, record(m));
  ok(!again.err && again.out.route === "STATUS" && again.out.job_status === "COMPLETED" && w.jobs.length === 1, "1a the same key again (a lost answer) -> STATUS COMPLETED, no second job", again.out);
  ok(kick(w, "").out.worker_route === "IDLE" && run(w, "IA_REVERT_V2_WORKER", { job_id: "" }).out.worker_route === "IDLE", "1a both workers idle afterwards");
  ok(w.violations.length === 0 && freeLocks(w), "1a no engine-ordering violation; every lock given back", w.violations);
  A = { w: w, m: m, iaId: iaId, key: key, job: job, before: before, price: price };
  console.log("ok   1a Add -> Completed: SUBMIT -> WORKER -> PREPARE -> COMMIT A / B, 56 picks + DL, price " + price);
}

// ================================================================================================ 2 the 1a IA reverted by Revert V2
{
  const w = A.w;
  const iaId = A.iaId;
  const no = w.ia(iaId).stock_movement_no;
  const rs = revertSubmit(w, iaId, "click2");
  const rjob = w.jobs.find((j) => j.command === "REVERT_IA");
  ok(!rs.err && rs.out.route === "QUEUED" && rs.out.action === "REVERT" && rjob && rs.out.job_id === rjob.id && rs.out.line_count === "57",
    "2 IA_REVERT_V2_SUBMIT (the list's request, min_picks 50): 57 live rows -> QUEUED", rs.err || rs.out);
  ok(w.ia(iaId).item_assembly_status === "Processing" && w.ia(iaId).ia_v2_job_id === rjob.id && w.latestLock(iaId).step_name === "LOCK|2" && rjob.correlation_id === "IA|" + iaId,
    "2 the IA Processing under the revert job: LOCK|2 continues the completion's lock sequence (one IAC| sequence)", { ia: w.ia(iaId), lock: w.latestLock(iaId) });
  const rreq = JSON.parse(rjob.request_payload);
  ok(rreq.prevStatus === "Completed" && rreq.liveRows === 57 && rreq.liveOut === 56 && rreq.liveIn === 1 && /^IM1:57:/.test(rreq.movesFingerprint), "2 the revert request: 56 OUT + 1 IN live rows", rreq);
  const formEdit = Object.assign(editRecord(w, A.m, iaId), { item_assembly_status: "Processing" });
  const cb = submit(w, "Edit", iaId, iaKey(iaId, "fedcba9876543210"), formEdit);
  ok(!cb.err && cb.out.route === "BUSY" && cb.out.error_code === "IA_BUSY" && cb.out.job_id === rjob.id, "2 IA_V2_SUBMIT while the revert is open -> BUSY (the revert's job)", cb.err || cb.out);
  ok(kick(w, "").out.worker_route === "IDLE" && rjob.job_status === "QUEUED", "2 IA_V2_WORKER leaves the REVERT_IA job alone");
  const fst = status(w, iaId, "");
  ok(!fst.err && fst.out.route === "STATUS" && fst.out.action === "REVERT" && fst.out.job_id === rjob.id, "2 the form's STATUS (IA_V2_SUBMIT) names the revert job: action REVERT (D's mounted kicks the revert worker)", fst.out);
  const rt = run(w, "IA_REVERT_V2_WORKER", { job_id: "" });
  ok(!rt.err && rt.out.worker_route === "WORKED" && rjob.job_status === "COMPLETED", "2 one IA_REVERT_V2_WORKER tick (the list's drain) -> COMPLETED", rt.err || rt.out);
  ok(JSON.stringify(rt.calls.filter((c) => c.from === "IA_REVERT_V2_WORKER").map((c) => c.to)) === '["IA_REVERT_V2_PREPARE","IA_REVERT_V2_COMMIT","IA_REVERT_V2_COMMIT"]',
    "2 the tick: PREPARE, COMMIT A (SPLIT), COMMIT B", rt.calls.map((c) => c.from + ">" + c.to));
  const h = w.ia(iaId);
  ok(h.item_assembly_status === "Draft" && h.posted_status === "" && h.stock_movement_no === no, "2 the IA back to Draft, number kept, posted_status ''", h);
  ok(JSON.stringify(stepsOf(w, rjob.id, /^V[0-9]_/)) === JSON.stringify(["V0_REVALIDATE:DONE", "V1_INVENTORY:DONE", "V2_COST:DONE", "V4_FINISH:DONE"]),
    "2 V0, V1, V2, V4 DONE (no V3: V2 minted no Batch row for a non-batch parent)", stepsOf(w, rjob.id, /^V/));
  const back = movesOf(w, "IAV|" + rjob.id);
  ok(back.length === 57 && back.filter((x) => x.movement === "OUT").length === 1 && back.every((x) => x.transaction_type === "IA-R" && x.trx_no === no), "2 57 IA-R rows (1 OUT of the assembly, 56 IN)", back.length);
  const diff = stockDiff(snapshot(w), A.before);
  ok(diff.length === 0, "2 stock, batch balances, FIFO quantity and value, WA: as before the completion", diff.slice(0, 3));
  ok(live(w.fifo).filter((f) => f.material_id === A.m.parent.id && Number(f.fifo_available_quantity) > 0).length === 0, "2 the receipt's FIFO layer taken back (COST part)");
  ok(w.violations.length === 0 && freeLocks(w), "2 no ordering violation; every lock (the engine's and IAV|<job>|C) given back", { v: w.violations, locks: w.locks.filter((l) => Number(l.free_token) !== 1) });
  // completed again: the number rule (CONTRACT section 3, RV2) issues a new number - a COMPLETED job ran under the old one
  const key2 = iaKey(iaId, "1111222233334444");
  const r2 = submit(w, "Edit", iaId, key2, editRecord(w, A.m, iaId));
  const job2 = jobOf(w, key2);
  ok(!r2.err && r2.out.route === "QUEUED" && w.ia(iaId).stock_movement_no === "IA-2610-0043" && JSON.parse(job2.request_payload).issuedNo === "IA-2610-0043"
    && w.latestLock(iaId).step_name === "LOCK|3", "2 completed again (stored Draft): LOCK|3, a NEW number IA-2610-0043 (the old one had a COMPLETED job)", r2.err || r2.out);
  const t2 = kick(w, job2.id);
  ok(!t2.err && job2.job_status === "COMPLETED" && w.ia(iaId).item_assembly_status === "Completed" && movesOf(w, "IAC|" + job2.id + "|I").every((x) => x.trx_no === "IA-2610-0043"),
    "2 the second completion COMPLETED under the new number", t2.err || job2);
  console.log("ok   2 Revert V2 of the C-completed IA (cross-package): BUSY both ways, Draft, stock / FIFO restored, completed again under a new number");
}

// ================================================================================================ 1b stored Draft, batch parent
{
  const w = world();
  const m = bom(w, { comps: 52, batchParent: true, batchComp: true, itemQty: 3, assemblyCost: 0.5 });
  const before = snapshot(w);
  // the Draft as the classic Draft save stored it (lines with ids and the fill-back's line fields)
  const iaId = w.id();
  w.ias.push(Object.assign(record(m), { id: iaId, page_status: "Edit", item_assembly_status: "Draft", stock_movement_no: "IA-2610-0040", posted_status: null, is_deleted: 0, stock_movement: undefined }));
  m.lines.forEach((l, i) => w.lines.push({ id: w.id(), sm_item_assembly_id: iaId, is_deleted: 0, line_index: i + 1, item_selection: l.it.id, item_name: l.it.material_name, total_quantity: l.total,
    requested_qty: l.total, quantity_uom: UOM, temp_hu_data: "", temp_qty_data: JSON.stringify(l.picks), organization_id: ORG, issuing_plant: PLANT }));
  const key = iaKey(iaId, "0a1b2c3d4e5f6a7c");
  const r = submit(w, "Edit", iaId, key, editRecord(w, m, iaId));
  const job = jobOf(w, key);
  const ia = w.ia(iaId);
  ok(!r.err && r.out.route === "QUEUED" && r.out.ia_id === iaId && job, "1b SUBMIT (stored Draft): QUEUED", r.err || r.out);
  ok(JSON.stringify(w.batchCalls) === JSON.stringify([{ item_id: m.parent.id, document_date: "2026-10-19", manufacturing_date: null, expired_date: null, organization_id: ORG }])
    && ia.batch_no === "1019-001-0001", "1b GENERATE_BATCH once (classic params + organization_id), its number in batch_no", { calls: w.batchCalls, batch_no: ia.batch_no });
  ok(w.writes.slice(0, 3).join(" | ").indexOf("insert GD Publish Step x1 (LOCK|1) | insert GD Async Job x1 | update Item Assembly") === 0 && ia.stock_movement_no === "IA-2610-0042",
    "1b write order: LOCK|1 first, then the job, then the document (a new number: no earlier job issued 0040)", w.writes.slice(0, 5));
  const t = kick(w, job.id);
  ok(!t.err && job.job_status === "COMPLETED" && ia.item_assembly_status === "Completed", "1b one tick -> COMPLETED", t.err || job);
  ok(JSON.stringify(stepsOf(w, job.id, /^I[0-9]_|^I1\|/)) === JSON.stringify(["I0_REVALIDATE:DONE", "I1_BATCH:DONE", "I1|I|001:INTENT", "I2_ISSUE:DONE", "I3_RECEIPT:DONE", "I4_FINISH:DONE"]),
    "1b I0, I1 (intent + DONE), I2, I3, I4", stepsOf(w, job.id, /^I/));
  const mine = live(w.batch).filter((x) => x.material_id === m.parent.id);
  ok(mine.length === 1 && mine[0].batch_number === "1019-001-0001" && mine[0].transaction_no === ia.stock_movement_no && mine[0].initial_quantity === "3.00000000" && BigInt(mine[0].id) > BigInt(job.id),
    "1b ONE Batch row of the parent (I1): the generated number, the IA number, initial_quantity '3.00000000', id > job", mine);
  const i1 = JSON.parse(w.steps.find((x) => x.job_id === job.id && x.step_name === "I1_BATCH").result_ref);
  const recv = movesOf(w, "IAC|" + job.id + "|R")[0];
  ok(i1.batch_id === mine[0].id && recv.batch_number_id === mine[0].id && live(w.bb).some((x) => x.material_id === m.parent.id && x.batch_id === mine[0].id && Number(x.unrestricted_qty) === 3),
    "1b the receipt on I1's batch: movement + batch balance 3", { i1: i1, recv: recv && recv.batch_number_id });
  const rm1 = m.lines[0].it.id;
  ok(live(w.bb).filter((x) => x.material_id === rm1).map((x) => Number(x.unrestricted_qty)).join() === "7", "1b the batch component's batch balance 10 -> 7");
  ok(w.violations.length === 0 && freeLocks(w), "1b no violation; locks given back", w.violations);
  // and Revert V2 brings the batch parent back (its Batch row soft-deleted by V3)
  const rs = revertSubmit(w, iaId, "click1b");
  const rjob = w.jobs.find((j) => j.command === "REVERT_IA");
  run(w, "IA_REVERT_V2_WORKER", { job_id: "" });
  ok(!rs.err && rs.out.route === "QUEUED" && rjob.job_status === "COMPLETED" && w.ia(iaId).item_assembly_status === "Draft" && live(w.batch).filter((x) => x.material_id === m.parent.id).length === 0
    && stockDiff(snapshot(w), before).length === 0, "1b reverted by Revert V2: Draft, I1's Batch row soft-deleted, stock as before", { rs: rs.out, job: rjob && rjob.job_status, diff: stockDiff(snapshot(w), before).slice(0, 2) });
  ok(JSON.stringify(stepsOf(w, rjob.id, /^V[0-9]_/)) === JSON.stringify(["V0_REVALIDATE:DONE", "V1_INVENTORY:DONE", "V2_COST:DONE", "V3_BATCH:DONE", "V4_FINISH:DONE"]),
    "1b the revert ran V0-V4 (V3 removed the Batch row C's I1 inserted)", stepsOf(w, rjob.id, /^V/));
  ok(w.violations.length === 0 && freeLocks(w), "1b revert: no violation; locks given back", w.violations);
  console.log("ok   1b stored Draft -> Completed, system-generated batch parent (GENERATE_BATCH, I1 Batch row, receipt on it) + its Revert V2");
}

// ================================================================================================ 1c short stock
{
  // (i) PREPARE's PLAN finds it: FAILED, nothing moved, the new IA a saved Draft
  const w = world();
  const m = bom(w, { comps: 51, itemQty: 1 });
  const rm7 = live(w.ib).find((x) => x.material_id === m.lines[6].it.id);
  Object.assign(rm7, { unrestricted_qty: 2, balance_quantity: 2 });
  const before = snapshot(w);
  const key = iaKey("new-int1c", "0a1b2c3d4e5f6a7d");
  const r = submit(w, "Add", "", key, record(m));
  const job = jobOf(w, key);
  const t = kick(w, job.id);
  const ia = w.ia(r.out.ia_id);
  ok(!r.err && r.out.route === "QUEUED" && !t.err && job.job_status === "FAILED" && job.error_code === "IA_INVENTORY_INSUFFICIENT", "1c-i PREPARE's PLAN refuses: FAILED IA_INVENTORY_INSUFFICIENT",
    { r: r.err || r.out.route, t: t.err, job: [job.job_status, job.error_code, job.error_message] });
  ok(/line 7 \(RM-7\), bin A1-01 \(Unrestricted\)/.test(job.error_message), "1c-i the message names the line, item and bin (LABELS): " + job.error_message);
  ok(ia.item_assembly_status === "Draft" && ia.ia_v2_job_id === job.id && w.mv.length === 0 && w.engineCalls.every((c) => c.mode === "PLAN") && stockDiff(snapshot(w), before).length === 0,
    "1c-i nothing moved (PLAN only), the new IA a saved Draft", { ia: ia.item_assembly_status, mv: w.mv.length, calls: w.engineCalls.map((c) => c.mode) });
  const st = status(w, ia.id, key);
  ok(st.out.route === "STATUS" && st.out.job_status === "FAILED" && st.out.terminal === "YES" && st.out.error_message === job.error_message, "1c-i STATUS: FAILED with the message (the client's gen + 1)", st.out);
  // (ii) the stock goes between PREPARE and COMMIT (batch parent: I1 has inserted its Batch row when I2 is refused)
  const w2 = world();
  const m2 = bom(w2, { comps: 51, batchParent: true, itemQty: 1 });
  const before2 = snapshot(w2);
  const key2 = iaKey("new-int1c2", "0a1b2c3d4e5f6a7e");
  const r2 = submit(w2, "Add", "", key2, record(m2));
  const job2 = jobOf(w2, key2);
  let taken = 0;
  w2.hooks.IA_V2_COMMIT = () => {
    if (taken++) return;
    const b3 = live(w2.ib).find((x) => x.material_id === m2.lines[2].it.id);
    Object.assign(b3, { unrestricted_qty: 0, balance_quantity: 0 });
  };
  const t2 = kick(w2, job2.id);
  const ia2 = w2.ia(r2.out.ia_id);
  const batches = w2.batch.filter((x) => x.material_id === m2.parent.id);
  ok(!t2.err && job2.job_status === "FAILED" && job2.error_code === "IA_INVENTORY_INSUFFICIENT" && /line 3 \(RM-3\)/.test(job2.error_message), "1c-ii I2 refused after I1: FAILED IA_INVENTORY_INSUFFICIENT",
    { t: t2.err, job: [job2.job_status, job2.error_code, job2.error_message] });
  ok(ia2.item_assembly_status === "Draft" && batches.length === 1 && batches[0].is_deleted === 1 && w2.mv.length === 0 && w2.engineCalls.filter((c) => c.mode === "APPLY").length === 1,
    "1c-ii back to Draft, I1's Batch row soft-deleted, no movement (the one APPLY refused)", { ia: ia2.item_assembly_status, batches: batches, mv: w2.mv.length });
  const d2 = stockDiff(snapshot(w2), before2).filter((x) => x.material !== m2.lines[2].it.id);
  ok(d2.length === 0, "1c-ii every other balance / FIFO untouched", d2.slice(0, 2));
  console.log("ok   1c short stock: refused by PREPARE's PLAN, and by I2 after I1 (Batch row soft-deleted) - FAILED, nothing moved, Draft");
}

// ================================================================================================ 3 the classic IA_REVERT v5 on V2-completed IAs
function completeV2(w, m, tag) {
  const key = iaKey("new-" + tag, "0a1b2c3d4e5f6a70");
  const r = submit(w, "Add", "", key, record(m));
  const job = jobOf(w, key);
  const t = kick(w, job && job.id);
  return { r: r, t: t, job: job, iaId: r.out && r.out.ia_id };
}
const classicRevert = (w, iaId) => run(w, "IA_REVERT", { ia_id: iaId, ia_no: w.ia(iaId).stock_movement_no, organization_id: ORG });
{
  // 3 picks: the list asks Revert V2 first (min_picks 50) -> NOT_ELIGIBLE classic -> the classic IA_REVERT v5
  const w = world();
  const m = bom(w, { comps: 3, itemQty: 1 });
  const before = snapshot(w);
  const c = completeV2(w, m, "int3a");
  ok(c.job && c.job.job_status === "COMPLETED", "3a a 3-pick IA completed by V2 (SUBMIT takes it; the client routes only > 50)", c.job);
  const rs = revertSubmit(w, c.iaId, "click3a");
  ok(!rs.err && rs.out.route === "NOT_ELIGIBLE" && rs.out.reason === "classic" && !w.jobs.some((j) => j.command === "REVERT_IA"), "3a IA_REVERT_V2_SUBMIT: 4 live rows <= 50 -> NOT_ELIGIBLE classic, nothing written", rs.err || rs.out);
  const cr = classicRevert(w, c.iaId);
  ok(!cr.err && cr.out && String(cr.out.code) === "200" && w.ia(c.iaId).item_assembly_status === "Draft", "3a the classic IA_REVERT v5 reverts the V2-completed IA -> 200, Draft", cr.err || cr.out);
  ok(stockDiff(snapshot(w), before).length === 0 && w.mv.filter((x) => x.transaction_type === "IA-R").length === 4, "3a stock / FIFO as before; 4 IA-R rows", stockDiff(snapshot(w), before).slice(0, 2));
  // a batch parent: the classic finds I1's Batch row by transaction_no and soft-deletes it
  const w2 = world();
  const m2 = bom(w2, { comps: 3, batchParent: true, itemQty: 2 });
  const before2 = snapshot(w2);
  const c2 = completeV2(w2, m2, "int3b");
  const row = w2.batch.find((x) => x.material_id === m2.parent.id);
  const cr2 = classicRevert(w2, c2.iaId);
  ok(c2.job.job_status === "COMPLETED" && !cr2.err && String(cr2.out.code) === "200" && row && row.is_deleted === 1 && w2.ia(c2.iaId).item_assembly_status === "Draft"
    && stockDiff(snapshot(w2), before2).length === 0, "3b batch parent: classic v5 reverts the V2 completion, I1's Batch row soft-deleted, stock as before",
  { job: c2.job.job_status, out: cr2.err || cr2.out, row: row, diff: stockDiff(snapshot(w2), before2).slice(0, 2) });
  // 251 picks (252 live rows): the classic v5 refuses it - only Revert V2 can take it back (CONTRACT ruling 9's go / no-go rule)
  const w3 = world();
  const m3 = bom(w3, { comps: 251, itemQty: 1 });
  const c3 = completeV2(w3, m3, "int3c");
  const cr3 = classicRevert(w3, c3.iaId);
  ok(c3.job.job_status === "COMPLETED" && !cr3.err && String(cr3.out.code) === "400" && cr3.out.message === SH.IA_TEXT.rvClassicTooBig(252, 250) && w3.ia(c3.iaId).item_assembly_status === "Completed",
    "3c 251 picks: the classic v5 refuses (252 stock rows; at most 250), the IA stays Completed", cr3.err || cr3.out);
  const rs3 = revertSubmit(w3, c3.iaId, "click3c");
  run(w3, "IA_REVERT_V2_WORKER", { job_id: "" });
  ok(!rs3.err && rs3.out.route === "QUEUED" && w3.ia(c3.iaId).item_assembly_status === "Draft", "3c ... and Revert V2 takes it back (so COMPLETE may be ON only with REVERT ON)", rs3.err || rs3.out);
  console.log("ok   3 classic IA_REVERT v5 on V2 completions: 3 picks via the list's NOT_ELIGIBLE route, a batch parent; 252 rows refused, Revert V2 takes it");
}

// ================================================================================================ 4 the fix wave across packages (ruling 10)
{
  // R1: the classic revert caps COMPONENT rows like the classic completion caps picks - 250 picks (251 live rows) stay revertible
  const w = world();
  const m = bom(w, { comps: 250, itemQty: 1 });
  const before = snapshot(w);
  const c = completeV2(w, m, "int4a");
  const cr = classicRevert(w, c.iaId);
  ok(c.job.job_status === "COMPLETED" && !cr.err && String(cr.out.code) === "200" && w.ia(c.iaId).item_assembly_status === "Draft" && stockDiff(snapshot(w), before).length === 0,
    "4a R1: a 250-pick V2 completion (251 live rows) is reverted by the classic v5 -> 200, Draft, stock as before", cr.err || cr.out);
  // R5: an IA of non-stock lines only consumes nothing - SUBMIT routes it to the classic (which refuses it with v11's text)
  const w2 = world();
  const m2 = bom(w2, { comps: 0, nonStock: true, itemQty: 1 });
  const r2 = submit(w2, "Add", "", iaKey("new-int4b", "0a1b2c3d4e5f6a71"), record(m2));
  ok(!r2.err && r2.out.route === "NOT_ELIGIBLE" && r2.out.reason === "no stock to issue" && w2.jobs.length === 0 && w2.ias.length === 0,
    "4b R5: an all-non-stock IA -> NOT_ELIGIBLE 'no stock to issue', nothing written", r2.err || r2.out);
  // R8: an Add whose SUBMIT died before its link: the job falls due, PREPARE finds the IA by ia_v2_job_id, writes FAILED + the
  // link, unlocks it; STATUS by the key then answers that IA (D's awaitLink closes the form)
  const w3 = world();
  const m3 = bom(w3, { comps: 51, itemQty: 1 });
  const key3 = iaKey("new-int4c", "0a1b2c3d4e5f6a72");
  w3.faults.add_node_ISlock1 = 1;
  const r3 = submit(w3, "Add", "", key3, record(m3));
  const job3 = jobOf(w3, key3);
  const ia3 = w3.ias[0];
  ok(r3.err && /injected fault at add_node_ISlock1/.test(r3.err) && job3 && job3.correlation_id === "" && ia3 && ia3.item_assembly_status === "Processing" && ia3.ia_v2_job_id === job3.id
    && !w3.latestLock(ia3.id), "4c R8 setup: SUBMIT died after the job and the IA, before LOCK|1 / link (job unlinked, IA Processing under it)", { err: r3.err, job: job3 && job3.correlation_id });
  w3.now += 121000;
  const t3 = kick(w3, "");
  const req3 = JSON.parse(job3.request_payload);
  ok(!t3.err && job3.job_status === "FAILED" && job3.error_code === "IA_INVALID_REQUEST" && job3.correlation_id === "IA|" + ia3.id && job3.causation_id === ia3.id
    && req3.iaId === ia3.id && req3.iaNo === ia3.stock_movement_no && ia3.item_assembly_status === "Draft" && w3.mv.length === 0,
  "4c R8: the worker's tick -> PREPARE FAILED IA_INVALID_REQUEST WITH the link (correlation, causation, iaId / iaNo), the IA back to Draft, nothing moved",
  { t: t3.err || t3.out, job: [job3.job_status, job3.error_code, job3.correlation_id], ia: ia3.item_assembly_status });
  const st3 = status(w3, "", key3);
  ok(!st3.err && st3.out.route === "STATUS" && st3.out.job_status === "FAILED" && st3.out.ia_id === ia3.id && st3.out.ia_no === ia3.stock_movement_no && st3.out.terminal === "YES",
    "4c R8: STATUS by the pinned key answers FAILED with the IA's id and number", st3.err || st3.out);
  console.log("ok   4 ruling 10 across packages: R1 250 picks revertible by v5; R5 non-stock-only -> NOT_ELIGIBLE; R8 unlinked SUBMIT -> FAILED + link -> STATUS has the IA");
}

console.log((fails ? "FAILED " + fails + " of " : "") + checks + " checks" + (fails ? "" : " passed"));
process.exit(fails ? 1 : 0);
