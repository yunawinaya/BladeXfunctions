// IA_REVERT_V2_PREPARE unit cases on synthetic Item Assemblies (_synth.js, Revert V2's own SQL shapes): the paths the recorded
// runs do not cover - weighted-average parents (batch row removed / running average restated with the classic's formula),
// conflicts, eligibility, refusals, the lock, IM1, the 5,000 limit, a header-only revert; the entry; the ready node on every
// engine answer. usage: node prepare_unit.js
const H = require("./_harness");
const X = require("./_rows");
const { synth } = require("./_synth");
const FILES = ["code/revert/prepare/adapter.js", "code/revert/prepare/prep.js", "code/revert/prepare/plan.js"];
const sb = H.load(FILES, Date.UTC(2026, 9, 19, 4, 0, 0), ["iarvPrepNode", "iarvPlanNode", "iaMovesFingerprint"]);
const I = (v) => H.intoBox(sb, v);
const O = H.fromBox;
const fpOf = (S) => sb.iaMovesFingerprint(I(S.moves));
const entryOf = (z, extra) => X.entryFor(z.run, z.S, fpOf(z.S), extra);
function plan(z, extra, track) {
  const e = entryOf(z, extra);
  const pr = O(sb.iarvPrepNode(I(e), I(z.S), I(track || {})));
  if (pr.route !== "GO") return { pr: pr, P: null, parts: null };
  const raw = sb.iarvPlanNode(I(e), I(pr), I(z.S), I({ debug: true }));
  return { pr: pr, P: O(raw), parts: raw.__parts ? O(raw.__parts) : null, build: raw.__build ? O(raw.__build) : null };
}

// ---------------------------------------------------------------- FIFO parent: the happy path
{
  const z = synth({});
  const r = plan(z);
  H.ok(r.pr.route === "GO" && r.pr.liveRows === 3 && r.pr.liveOut === 2 && r.pr.liveIn === 1, "FIFO: prep GO, 3 live rows", r.pr);
  H.ok(r.P.route === "READY" && r.P.needPlan === "YES" && r.P.movementCount === 3, "FIFO: plan READY, 3 movements", r.P);
  const m = r.parts.ENGINE.movements;
  H.ok(m[0].movement_key === "M1" && m[0].direction === "SUBTRACT" && m[0].material_id === z.parent.id && m[0].isMovingInv === 1 && m[0].transaction_type === "IA-R"
    && m[0].trx_no === z.iaNo && m[0].parent_trx_no === "" && m[0].batch_id === null && !("handling_unit_id" in m[0]) && m[0].unit_price === 5 && m[0].quantity === 2,
  "FIFO: M1 = the assembled item taken back (isMovingInv 1, at its receipt price)", m[0]);
  H.ok(m[1].direction === "ADD" && m[1].isMovingInv === 0 && m[1].handling_unit_id === null && m[1].unit_price === 1 && m[1].quantity === 3 && m[2].unit_price === 2 && !("batch_number" in m[1]),
    "FIFO: M2 / M3 = the components returned at the cost they left at (no batch_number)", m.slice(1));
  H.ok(r.parts.COST.fifo.length === 1 && r.parts.COST.fifo[0].before.fifo_initial_quantity === "2.00000000" && r.parts.COST.fifo[0].after.is_deleted === 1
    && r.parts.COST.waDelete.length === 0 && r.parts.COST.waRestate.length === 0, "FIFO: COST = the parent's layer, before as read, after removed", r.parts.COST);
  H.ok(r.parts.BATCH.batchDeletes.length === 1, "FIFO: the blank Batch row of a non-batch parent is removed (the classic's rule)", r.parts.BATCH);
  H.ok(r.parts.LABELS.M1.side === "out" && r.parts.LABELS.M1.bin === "FG-01" && r.parts.LABELS.M2.side === "in" && r.parts.LABELS.M2.item_code === "RM-1", "FIFO: LABELS", r.parts.LABELS);
  H.ok(r.P.partRows.length === 5 && r.P.partRows.every((x) => /^P\|Ab12Cd34\|(ENGINE|COST|BATCH|HDR|LABELS)\|001$/.test(x.step_name) && x.step_status === "PAYLOAD" && x.job_id === X.JOB),
    "FIFO: five part rows P|<nonce>|<PART>|001", r.P.partRows.map((x) => x.step_name));
}
// ---------------------------------------------------------------- weighted average: batch parent (row removed) / non-batch (restated)
{
  const z = synth({ parent: { method: "Weighted Average", batch: true, qty: 2, price: 5 } });
  const r = plan(z);
  H.ok(r.P && r.P.route === "READY" && r.parts.COST.waDelete.length === 1 && r.parts.COST.waDelete[0].before.wa_quantity === "2.00000000"
    && r.parts.COST.waDelete[0].before.wa_cost_price === "5.00000000" && r.parts.COST.fifo.length === 0 && r.parts.ENGINE.movements[0].batch_id === z.batchId,
  "WA batch parent: COST.waDelete = its batch row (update_node_iaRvWaDel), M1 on its batch", r.parts && r.parts.COST);
  const y = synth({ parent: { method: "Weighted Average", qty: 4, price: 6 }, waRow: [10, 5] });
  const q = plan(y);
  const w = q.parts && q.parts.COST.waRestate[0];
  H.ok(q.P.route === "READY" && w && w.after.wa_quantity === "6.00000000" && w.after.wa_cost_price === "4.33333333" && w.before.wa_quantity === "10.00000000",
    "WA running average: restated with the classic's formula (q0 = 10 - 4, p0 = (5 x 10 - 24) / 6), before as read", w);
  const all = synth({ parent: { method: "Weighted Average", qty: 4, price: 6 }, waRow: [4, 6] });
  const a = plan(all);
  H.ok(a.parts.COST.waRestate[0].after.wa_quantity === "0.000" && a.parts.COST.waRestate[0].after.wa_cost_price === "6.00000000",
    "WA: all of it was this assembly's -> the classic's '0.000' at the old price, verbatim", a.parts.COST.waRestate[0]);
  const fixed = synth({ parent: { method: "Fixed Cost" } });
  const f = plan(fixed);
  H.ok(f.P.route === "READY" && f.parts.COST.fifo.length + f.parts.COST.waDelete.length + f.parts.COST.waRestate.length === 0, "Fixed Cost parent: no costing row to restore", f.parts.COST);
}
// ---------------------------------------------------------------- conflicts, eligibility, refusals, lock, IM1, limits
{
  let r = plan(synth({ consumed: 1 }));
  H.ok(r.P.route === "FAIL" && r.P.code === "IA_RV_CONFLICTS" && r.P.message.indexOf("Revert blocked: the assembled item has been used or its stock has moved on.") === 0
    && /already been used/.test(r.P.message) && JSON.parse(r.P.details).conflicts[0].type === "fifo_layer_consumed" && r.P.unlockOk === 1,
  "a used FIFO layer -> IA_RV_CONFLICTS with the classic's 409 text + its conflict list, unlock", r.P);
  r = plan(synth({ onHand: 1 }));
  H.ok(r.P.route === "FAIL" && r.P.code === "IA_RV_CONFLICTS" && JSON.parse(r.P.details).conflicts.some((c) => c.type === "balance_short"), "stock moved on (balance short) -> IA_RV_CONFLICTS", r.P);
  r = plan(synth({ comps: [{ qty: 1, price: 1, serial: true }] }));
  H.ok(r.P.route === "FAIL" && r.P.code === "IA_RV_NOT_ELIGIBLE" && /serial numbers/.test(r.P.message) && r.P.unlockOk === 1, "a serial-numbered item -> IA_RV_NOT_ELIGIBLE, unlock", r.P);
  r = plan(synth({ comps: [{ qty: 1, price: 1, hu: true }] }));
  H.ok(r.pr.route === "FAIL" && r.pr.code === "IA_RV_NOT_ELIGIBLE" && /handling units/.test(r.pr.message) && r.pr.unlockOk === 1, "a handling unit on a live row -> IA_RV_NOT_ELIGIBLE (prep), unlock", r.pr);
  r = plan(synth({ posted: "Posted" }));
  H.ok(r.pr.route === "FAIL" && r.pr.code === "IA_RV_REFUSED" && r.pr.message === "This Item Assembly has been posted to accounting and cannot be reverted." && r.pr.unlockOk === 1,
    "posted to accounting -> IA_RV_REFUSED with the classic's text, unlock", r.pr);
  r = plan(synth({ org: "999" }));
  H.ok(r.pr.code === "IA_RV_REFUSED" && r.pr.message === "Item Assembly record not found for this organization.", "another organization's IA -> the classic's 'not found' refusal", r.pr);
  r = plan(synth({ status: "Completed" }));
  H.ok(r.pr.route === "FAIL" && r.pr.code === "IA_RV_NOT_LOCKED" && r.pr.unlockOk === 0, "not Processing under this job -> IA_RV_NOT_LOCKED, no unlock", r.pr);
  const z = synth({});
  const e = entryOf(z);
  e.request.movesFingerprint = "IM1:9:0000000000000000";
  const pr = O(sb.iarvPrepNode(I(e), I(z.S), I({})));
  H.ok(pr.route === "FAIL" && pr.code === "IA_RV_ROWS_CHANGED" && pr.unlockOk === 1, "movement rows changed since SUBMIT (IM1) -> IA_RV_ROWS_CHANGED, unlock", pr);
  r = plan(synth({ manyComps: 5000 }));
  H.ok(r.pr.route === "FAIL" && r.pr.code === "IA_RV_SPLIT_REQUIRED" && /5001 stock movements/.test(r.pr.message), "5,001 live rows -> IA_RV_SPLIT_REQUIRED", r.pr);
  r = plan(synth({ reverted: true }));
  H.ok(r.pr.route === "GO" && r.pr.liveRows === 0 && r.P.route === "READY" && r.P.needPlan === "NO" && r.P.movementCount === 0, "every row already reverted (header only) -> READY, no PLAN call", r.P);
}
H.done("prepare unit");
