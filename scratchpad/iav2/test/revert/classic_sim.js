// node test/revert/classic_sim.js - the classic IA_REVERT on the interpreter: base v4 (base/IA_REVERT.v4.json) and the BUILT v5
// (Item Assembly & BOM/AsyncV2/IA_REVERT.json) on identical copies of the same world (_scen.js; SUBTRACT_ / ADD_INVENTORY as
// one-movement engine-core calls, _world.js):
//   - up to 250 component rows (picks; 250 picks = 251 live rows with the receipt) v5 does exactly what v4 does (same answer,
//     same writes in the same order, same final state) - fix wave R1: the cap counts picks, as the classic completion's;
//   - 251 picks (252 live rows): v5 answers 400 IA_TEXT.rvClassicTooBig(252, 250) with conflicts [] and writes NOTHING;
//   - a refused IA above the cap keeps the classic's own refusal (v4's answer);
//   - TWIN: the classic v5 and Revert V2 (SUBMIT + one WORKER tick) on copies of one engine-completed IA leave the same stock,
//     FIFO / WA rows, Batch rows, header and IA-R movement rows (operation_effect_key aside: V2's engine stamps it).
const assert = require("assert");
const path = require("path");
const S = require("./_scen");
const { runWorkflow, cloneWorld } = require("./_world");
const { IA_TEXT, IA_CLASSIC_MAX_PICKS } = require("../../code/shared/ia_common.js");
const BASE_DIR = path.join(__dirname, "..", "..", "base");
const J = (o) => JSON.stringify(o);
let checks = 0;
const ok = (cond, what, extra) => {
  checks++;
  assert.ok(cond, what + (extra === undefined ? "" : " " + J(extra).slice(0, 900)));
};
const params = (z) => ({ ia_id: z.ia.id, ia_no: z.ia.stock_movement_no, organization_id: S.ORG });
const v4 = (w, z) => runWorkflow(w, "IA_REVERT.v4", params(z), BASE_DIR);
const v5 = (w, z) => runWorkflow(w, "IA_REVERT", params(z));
const classicCompleted = (spec) => S.completed(Object.assign({ classic: true }, spec));
function state(w, z) {
  const ia = w.ia(z.ia.id);
  const fifo = w.fifo.map((f) => [f.material_id, Number(f.fifo_initial_quantity), Number(f.fifo_available_quantity), Number(Number(f.fifo_cost_price).toFixed(8)), f.is_deleted]).sort();
  const wa = w.wa.map((r) => [r.material_id, r.batch_id || "", Number(r.wa_quantity), Number(Number(r.wa_cost_price).toFixed(8)), r.is_deleted]).sort();
  const mv = w.mv.filter((m) => m.transaction_type === "IA-R").map((m) => [m.movement, m.item_id, m.bin_location_id, m.batch_number_id || "", m.inventory_category, Number(m.base_qty),
    Number(m.unit_price), Number(m.total_price)]).sort();
  return { ia: [ia.item_assembly_status, ia.posted_status, ia.stock_movement_no, ia.material_hold_status === undefined ? null : ia.material_hold_status], stock: S.snapshot(w), fifo: fifo, wa: wa,
    batch: w.batch.map((b) => [b.material_id, b.batch_number, b.is_deleted]).sort(), mv: mv };
}

// ---------------------------------------------------------------- v4 = v5 at and below the cap
for (const [label, spec] of [["3 live rows", {}], ["WA running average", { parent: { method: S.WA, qty: 2 }, parentStock: [10, 4] }], ["FIFO batch parent", { parent: { batch: true, qty: 3 } }],
  ["249 picks (250 live rows)", { manyComps: 249, parent: { qty: 1 } }], ["250 picks (251 live rows: the classic completion's cap)", { manyComps: 250, parent: { qty: 1 } }]]) {
  const z = classicCompleted(spec);
  const a = cloneWorld(z.w);
  const b = cloneWorld(z.w);
  const r4 = v4(a, z);
  const r5 = v5(b, z);
  ok(!r4.err && !r5.err && r4.out.code === "200" && J(r4.out) === J(r5.out), label + ": v5 answers as v4 (" + (r4.out && r4.out.message) + ")", { v4: r4.out || r4.err, v5: r5.out || r5.err });
  ok(J(a.writes) === J(b.writes) && a.writes.length > 0, label + ": the same " + a.writes.length + " writes in the same order", { v4: a.writes.slice(0, 5), v5: b.writes.slice(0, 5) });
  ok(J(state(a, z)) === J(state(b, z)), label + ": the same final state", { v4: state(a, z).ia, v5: state(b, z).ia });
  ok(b.ia(z.ia.id).item_assembly_status === "Draft", label + ": reverted to Draft");
}
console.log("ok   up to 250 picks (251 live rows) v5 = v4: answer, writes, final state");

// ---------------------------------------------------------------- the guard at 251 picks
{
  const z = classicCompleted({ manyComps: 251, parent: { qty: 1 } });
  const a = cloneWorld(z.w);
  const b = cloneWorld(z.w);
  const r5 = v5(b, z);
  const want = IA_TEXT.rvClassicTooBig(252, IA_CLASSIC_MAX_PICKS);
  ok(!r5.err && r5.out.code === "400" && r5.out.message === want && r5.out.conflicts === "[]", "251 picks: v5 -> 400 '" + want + "', conflicts []", r5.out);
  ok(b.writes.length === 0 && b.engineCalls.length === 0 && b.ia(z.ia.id).item_assembly_status === "Completed", "251 picks: v5 wrote nothing, called nothing", { writes: b.writes, calls: b.engineCalls.length });
  const tr = r5.trace.map((x) => x.split(" ").pop());
  ok(tr[tr.length - 1] === "code_node_iaRvCap" && tr.indexOf("code_node_iaRvPrep") === tr.length - 2 && tr.indexOf("code_node_iaRvBuild") < 0,
    "251 picks: the run stopped right after the guard (prep -> guard -> return; no round-2 read, no build, no write node)", tr.slice(-4));
  const r4 = v4(a, z);
  ok(!r4.err && r4.out.code === "200" && a.ia(z.ia.id).item_assembly_status === "Draft", "251 picks: v4 (today) reverts it - the guard is the only difference", r4.out || r4.err);
  ok(Number(IA_CLASSIC_MAX_PICKS) === 250 && /const CAP = 250;/.test(require("fs").readFileSync(path.join(__dirname, "..", "..", "code", "revert", "classic", "cap.js"), "utf8")),
    "the guard's cap is IA_CLASSIC_MAX_PICKS (250)");
  const p = classicCompleted({ manyComps: 251, parent: { qty: 1 } });
  p.w.ia(p.ia.id).posted_status = "Posted";
  const c = cloneWorld(p.w);
  const d = cloneWorld(p.w);
  const q4 = v4(c, p);
  const q5 = v5(d, p);
  ok(J(q4.out) === J(q5.out) && q5.out.code === "400" && q5.out.message === "This Item Assembly has been posted to accounting and cannot be reverted." && d.writes.length === 0,
    "a refused IA above the cap keeps the classic's refusal (= v4)", { v4: q4.out, v5: q5.out });
  const pr = classicCompleted({ manyComps: 251, parent: { qty: 1 } });
  pr.w.ia(pr.ia.id).item_assembly_status = "Processing";
  const e = cloneWorld(pr.w);
  const p5 = v5(e, pr);
  ok(p5.out.code === "400" && p5.out.message === "Only Completed Item Assembly can be reverted (this one is Processing)." && e.writes.length === 0,
    "a Processing IA (a V2 job holds it) above the cap: the classic's refusal", p5.out);
  console.log("ok   251 picks: v5 -> 400 too large, nothing written or called (v4 would revert it); a refused / Processing IA keeps the classic's refusal");
}

// ---------------------------------------------------------------- TWIN: classic v5 vs Revert V2 on one engine-completed IA
for (const [label, spec] of [["FIFO", {}], ["WA running average", { parent: { method: S.WA, qty: 2 }, parentStock: [10, 4] }], ["WA batch parent", { parent: { method: S.WA, batch: true, qty: 2 } }],
  ["FIFO batch parent, batch components", { parent: { batch: true, qty: 3 }, comps: [{ qty: 2, layers: [[6, 1.5]], batch: true }, { qty: 1, layers: [[3, 4]] }] }],
  ["Blocked receipt", { cat: "Blocked" }], ["RES-01: a held component (issued from Reserved), an IA that reserves", { reserved: [0], hold: "CLOSED" }]]) {
  const z = S.completed(spec);
  const a = cloneWorld(z.w);
  const b = cloneWorld(z.w);
  const rc = v5(a, z);
  ok(!rc.err && rc.out.code === "200", label + " twin: the classic reverts", rc.out || rc.err);
  const zb = Object.assign({}, z, { w: b });
  const s = runWorkflow(b, "IA_REVERT_V2_SUBMIT", { operation: "SUBMIT", ia_id: z.ia.id, idempotency_key: z.key, source: "LIST", min_picks: "0", form: Object.assign({}, z.row) });
  const job = b.jobs.find((j) => j.command === "REVERT_IA");
  const t = runWorkflow(b, "IA_REVERT_V2_WORKER", { job_id: job.id });
  ok(!s.err && s.out.route === "QUEUED" && !t.err && job.job_status === "COMPLETED", label + " twin: V2 reverts (QUEUED, one tick, COMPLETED)", { s: s.out, t: t.out || t.err, job: job.job_status });
  const sa = state(a, z);
  const sb = state(b, zb);
  for (const k of ["ia", "stock", "fifo", "wa", "batch", "mv"]) ok(J(sa[k]) === J(sb[k]), label + " twin: " + k + " classic = V2", { classic: sa[k], v2: sb[k] });
  ok(b.mv.filter((m) => m.transaction_type === "IA-R").every((m) => /^IAV\|[0-9]+\|M[0-9]+$/.test(m.operation_effect_key)), label + " twin: V2's IA-R rows carry IAV|<job>|M<n>");
}
console.log("ok   TWIN classic v6 = Revert V2 (stock, FIFO, WA, Batch, header, IA-R rows): FIFO, WA running average, WA batch, FIFO batch + batch components, Blocked receipt, RES-01 held");
// RES-01 R5 through Revert V2: its holds still open -> FAILED IA_RV_HOLDS_OPEN, the IA back to Completed, nothing moved
{
  const o = S.completed({ reserved: [0], hold: "FULL" });
  o.w.holds.push({ id: o.w.id(), doc_type: "Item Assembly", doc_id: o.ia.id, organization_id: S.ORG, is_deleted: 0, open_qty: 1, status: "Allocated" });
  const b = cloneWorld(o.w);
  const s = runWorkflow(b, "IA_REVERT_V2_SUBMIT", { operation: "SUBMIT", ia_id: o.ia.id, idempotency_key: o.key, source: "LIST", min_picks: "0", form: Object.assign({}, o.row) });
  const job = b.jobs.find((j) => j.command === "REVERT_IA");
  const t = runWorkflow(b, "IA_REVERT_V2_WORKER", { job_id: job.id });
  ok(!s.err && !t.err && job.job_status === "FAILED" && job.error_code === "IA_RV_HOLDS_OPEN" && b.ia(o.ia.id).item_assembly_status === "Completed" &&
    b.mv.filter((m) => m.transaction_type === "IA-R").length === 0, "RES-01 R5 V2: open holds -> FAILED IA_RV_HOLDS_OPEN, back to Completed, nothing moved",
    { job: [job.job_status, job.error_code], ia: b.ia(o.ia.id).item_assembly_status });
  console.log("ok   RES-01 R5 through Revert V2: open holds refused (FAILED, back to Completed, nothing moved)");
}
// ---------------------------------------------------------------- RES-01 R5: an IA that reserves (its stored material_hold_status set)
{
  const bal = (w, z, c) => {
    const b = w.ib.find((x) => x.material_id === z.comps[c].it.id && !x.is_deleted);
    return [Number(b.unrestricted_qty), Number(b.reserved_qty)];
  };
  // component 1 (3 units) was held and issued from Reserved; component 2 (4) from Unrestricted
  const z = classicCompleted({ reserved: [0], hold: "CLOSED" });
  const a = cloneWorld(z.w);
  const b = cloneWorld(z.w);
  const r4 = v4(a, z);
  const r6 = v5(b, z);
  ok(!r6.err && r6.out.code === "200", "R5: an IA that reserves reverts", r6.out || r6.err);
  // [unrestricted, reserved]: 10 held in Reserved, 3 issued from it
  ok(J(bal(b, z, 0)) === J([3, 7]) && J(bal(a, z, 0)) === J([0, 10]), "R5: the held component comes back to Unrestricted (its hold was closed at completion); v4 put it back in Reserved",
    { v6: bal(b, z, 0), v4: bal(a, z, 0) });
  ok(J(bal(b, z, 1)) === J(bal(a, z, 1)), "R5: the component issued from Unrestricted as v4", { v6: bal(b, z, 1), v4: bal(a, z, 1) });
  ok(b.mv.filter((m) => m.transaction_type === "IA-R" && m.movement === "IN" && m.item_id === z.comps[0].it.id).every((m) => m.inventory_category === "Unrestricted"),
    "R5: its IA-R row says Unrestricted");
  ok(b.ia(z.ia.id).item_assembly_status === "Draft" && b.ia(z.ia.id).material_hold_status === "RESERVING", "R5: Draft, marked RESERVING (the next open or save reserves again)",
    b.ia(z.ia.id));
  // review I3: a component held from Blocked (its Delivered row says so) comes back to Blocked, never freed into Unrestricted
  const zb = classicCompleted({ reserved: [0], hold: "CLOSED", heldFrom: "Blocked" });
  const bb = cloneWorld(zb.w);
  const rb = v5(bb, zb);
  const ib = bb.ib.find((x) => x.material_id === zb.comps[0].it.id && !x.is_deleted);
  ok(!rb.err && rb.out.code === "200" && J([Number(ib.unrestricted_qty), Number(ib.reserved_qty), Number(ib.block_qty)]) === J([0, 7, 3]) &&
    bb.mv.filter((m) => m.transaction_type === "IA-R" && m.movement === "IN" && m.item_id === zb.comps[0].it.id).every((m) => m.inventory_category === "Blocked"),
    "R5 (review I3): a component held from Blocked comes back to Blocked", { out: rb.out || rb.err, bal: ib && [ib.unrestricted_qty, ib.reserved_qty, ib.block_qty] });
  // never reserved: v6 = v4 exactly, a Reserved-issued component included
  const n = classicCompleted({ reserved: [0] });
  const c = cloneWorld(n.w);
  const d = cloneWorld(n.w);
  const n4 = v4(c, n);
  const n6 = v5(d, n);
  ok(J(n4.out) === J(n6.out) && J(c.writes) === J(d.writes) && J(state(c, n)) === J(state(d, n)) && J(bal(d, n, 0)) === J([0, 10]), "R5: an IA that never reserved: v6 = v4 (answer, writes, state)",
    { v4: c.writes.length, v6: d.writes.length });
  // its holds still open (CLOSE not done) or a hold run in flight: refused, nothing written
  for (const [label, hold] of [["an Allocated hold", { status: "Allocated" }], ["a Releasing hold", { status: "Releasing" }]]) {
    const o = classicCompleted({ reserved: [0], hold: "FULL" });
    o.w.holds.push(Object.assign({ id: o.w.id(), doc_type: "Item Assembly", doc_id: o.ia.id, organization_id: S.ORG, is_deleted: 0, open_qty: 1 }, hold));
    const e = cloneWorld(o.w);
    const r = v5(e, o);
    ok(!r.err && r.out.code === "409" && /holds/.test(r.out.message) && e.writes.length === 0 && e.ia(o.ia.id).item_assembly_status === "Completed",
      "R5: " + label + " still open: 409, nothing written", r.out || r.err);
  }
  const l = classicCompleted({ reserved: [0], hold: "CLOSED" });
  l.w.steps.push({ id: l.w.id(), job_id: "IAH|" + l.ia.id, step_name: "TICKET|3", step_status: "HELD", result_ref: "IAH|" + l.ia.id + "|3", is_deleted: 0, started_at: l.w.now - 60000 });
  const f = cloneWorld(l.w);
  const rl = v5(f, l);
  ok(!rl.err && rl.out.code === "409" && f.writes.length === 0, "R5: a hold run in flight (a live ticket): 409, nothing written", rl.out || rl.err);
  console.log("ok   RES-01 R5: a held component back to Unrestricted, RESERVING; never reserved = v4; open holds or a live ticket refused");
}
console.log(checks + " checks passed");
