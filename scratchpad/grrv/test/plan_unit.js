// Harness (d): unit cases on built receipts (test/_scenario.js) through the assembled nodes (VPprep -> VPplan, VSgate).
// usage: TZ=Asia/Kuala_Lumpur node plan_unit.js
const vm = require("vm");
const H = require("./_harness");
const Sc = require("./_scenario");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
let pass = 0;
let fail = 0;
const ok = (cond, what, detail) => {
  if (cond) pass++;
  else {
    fail++;
    console.log("  FAIL " + what + (detail !== undefined ? ": " + JSON.stringify(detail).slice(0, 400) : ""));
  }
};
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const qs = (v) => Math.max(0, q8(v)).toFixed(8);
const F = { method: "First In First Out" };
const W = { method: "Weighted Average" };
const BIN2 = "2018912822846582786";
const BIN3 = "2018912972444823554";
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const setHdr = (sc, patch) => {
  const h = H.parseBig(sc.S.hdr[0].j);
  sc.S.hdr = [Sc.J(Object.assign(h, patch))];
};
const setLine = (sc, i, patch) => {
  const r = sc.S.lines[i];
  sc.S.lines[i] = Object.assign({}, r, { j: JSON.stringify(Object.assign(H.parseBig(r.j), patch)) });
};
const conflicts = (r) => (JSON.parse(r.plan.out.errorDetails || "{}").conflicts || []).map((c) => c.type);

console.log("== WA restate: B / C over every live row of the item, R2's formula gives grRvBuild's restate");
{
  const sc = Sc.scenario({ items: { W1: W, F1: F }, wa: { W1: [100, 6.5] },
    lines: [{ item: "W1", qty: 10, price: 5 }, { item: "F1", qty: 3 }, { item: "W1", qty: 20, price: 6 }, { item: "W1", qty: 30, price: 7 }] });
  const r = Sc.plan(sc);
  ok(r.plan.out.route === "READY", "READY", r.plan.out.message);
  const wr = r.parts && r.parts.COST.waRestate;
  ok(wr && wr.length === 1 && wr[0].B === 60 && wr[0].C === 10 * 5 + 20 * 6 + 30 * 7, "one restate, B 60, C 380", wr);
  const q0 = q8(100 - 60);
  const p0 = q8((6.5 * 100 - 380) / q0);
  ok(p0 === 6.75 && q0 === 40, "restated row: 40 @ 6.75");
  // the classic restates once, on the item's last live row; V2 carries the sums, R2 applies them to the fresh row
  ok(r.parts.ENGINE.movements.length === 4, "4 movements", r.parts.ENGINE.movements.length);
  // an earlier partial revert of the oldest row (a GRN-R): only the live tail is summed, as grRvBuild does
  const sc2 = Sc.scenario({ items: { W1: W }, wa: { W1: [100, 6.5] }, lines: [{ item: "W1", qty: 10, price: 5 }, { item: "W1", qty: 20, price: 6 }, { item: "W1", qty: 30, price: 7 }] });
  const first = H.parseBig(sc2.S.movs[0].j);
  sc2.S.movs.push(Sc.J(Object.assign({}, first, { id: Sc.id(), transaction_type: "GRN-R", movement: "OUT" })));
  const r2 = Sc.plan(sc2);
  const w2 = r2.parts && r2.parts.COST.waRestate[0];
  ok(r2.plan.out.route === "READY" && w2 && w2.B === 50 && w2.C === 330, "after a GRN-R of the oldest row: B 50, C 330 (the live rows)", w2 || r2.plan.out.message);
  // a restate that would go negative is grRvBuild's conflict, as the classic
  const sc3 = Sc.scenario({ items: { W1: W }, wa: { W1: [61, 1] }, lines: [{ item: "W1", qty: 60, price: 7 }] });
  const r3 = Sc.plan(sc3);
  ok(r3.plan.out.code === "GRV_STALE" && conflicts(r3).includes("wa_backsolve_negative"), "a negative back-solved cost: GRV_STALE", r3.plan.out.message);
}

console.log("== FIFO: untouched layers are removed as read; a drawn-down or missing layer is a conflict");
{
  const sc = Sc.scenario({ items: { F1: F, FB: Object.assign({ batch: true }, F) }, lines: [{ item: "F1", qty: 10, price: 2 }, { item: "FB", qty: 5, price: 3 }, { item: "F1", qty: 10, price: 2 }] });
  const r = Sc.plan(sc);
  const fifo = r.parts && r.parts.COST.fifo;
  ok(fifo && fifo.length === 3 && fifo.every((x) => x.initial === x.available) && new Set(fifo.map((x) => x.id)).size === 3, "three layers, each once, as read", fifo);
  const sc2 = Sc.scenario({ items: { F1: F }, lines: [{ item: "F1", qty: 10 }], fifoConsumed: { 0: 4 } });
  const r2 = Sc.plan(sc2);
  ok(r2.plan.out.code === "GRV_STALE" && conflicts(r2).includes("fifo_layer_consumed") && Number(r2.plan.out.unlockOk) === 1, "drawn down: GRV_STALE, unlock", r2.plan.out);
  ok(r2.plan.out.message.startsWith("Revert blocked: this receipt's stock has been used or its documents have moved on. "), "the classic's 409 text first", r2.plan.out.message);
  const sc3 = Sc.scenario({ items: { F1: F }, lines: [{ item: "F1", qty: 10 }] });
  sc3.S.fifo = [];
  ok(conflicts(Sc.plan(sc3)).includes("fifo_layer_mismatch"), "missing layer: fifo_layer_mismatch");
}

console.log("== PO: recv / res per PO line (split parents, children, alternate units), on-order base per line");
{
  const sc = Sc.scenario({ items: { F1: F }, lines: [{ item: "F1", qty: 8, base: 16 }, { item: "F1", qty: 6, split: [2, 4] }, { item: "F1", qty: 5, base: 0 }] });
  const r = Sc.plan(sc);
  const P = r.parts && r.parts.PO;
  const byId = Object.fromEntries((P ? P.poLines : []).map((l) => [l.id, l]));
  const lines = sc.S.lines.map((x) => H.parseBig(x.j));
  const l0 = lines[0].po_line_item_id;
  const l1 = lines[1].po_line_item_id;
  const l4 = lines[4].po_line_item_id;
  ok(P && byId[l0].recv === 8 && byId[l0].res === 8, "a plain line: recv = res = received", byId[l0]);
  ok(P && byId[l1].recv === 6 && byId[l1].res === 6, "a split parent: recv from the parent, res from its children", byId[l1]);
  const oo = Object.fromEntries((P ? P.onOrder : []).map((o) => [o.po_line_id, o.base]));
  ok(oo[l0] === 16 && oo[l1] === 6 && oo[l4] === 5, "on-order base: base_received_qty, else received_qty", oo);
  ok(P && P.poIds.length === 1 && P.poIds[0] === sc.po && P.poLines.every((l) => l.po_id === sc.po), "poIds + each line's PO", P && P.poIds);
  // R4's formula on the line as read gives grRvBuild's write
  const pol = H.parseBig(sc.S.po.find((x) => x.k === "POL" && H.parseBig(x.j).id === l0).j);
  ok(qs(Math.max(0, q8(pol.received_qty - byId[l0].recv))) === "0.00000000", "line back to 0 received");
}

console.log("== parts: chunks of 400,000 characters rebuild every part; header counts");
{
  const sc = Sc.scenario({ items: { F1: F }, lines: many(1200, () => ({ item: "F1", qty: 1 })) });
  const r = Sc.plan(sc);
  const man = r.parts && r.parts.manifest;
  ok(r.plan.out.route === "READY", "1,200 lines READY", r.plan.out.message);
  ok(man && man.parts.ENGINE.length >= 2 && r.plan.out.partRows.every((x) => x.result_ref.length <= 400000), "ENGINE in several chunks", man && man.parts.ENGINE);
  ok(man && ["ENGINE", "COST", "DOCS", "PO", "CHECK"].every((k) => man.parts[k].length >= 1), "every part has a row");
  ok(man && man.counts.movements === 1200 && r.parts.ENGINE.movements.length === 1200 && r.parts.ENGINE.movements[1199].movement_key === "R1200", "1,200 movements R1..R1200");
  ok(new Set(r.plan.out.partRows.map((x) => x.step_name)).size === r.plan.out.partRows.length, "step names unique");
  const sb = H.load(H.OUTPUTS.files.VPplan.filter((f) => !/_tail\.js$/.test(f)));
  const ch = vm.runInContext('rvChunks("a".repeat(399999) + "\\ud83d\\ude00" + "b", 400000)', sb);
  ok(ch.length === 2 && ch[0].length === 399999 && ch[1] === "😀b", "a surrogate pair is never split across two rows", ch.map((c) => c.length));
  const ch0 = vm.runInContext('rvChunks("", 400000)', sb);
  ok(ch0.length === 1 && ch0[0] === "", "an empty text: one row");
}

console.log("== the classic's 500-line guard is not V2's: refusals found again on <= 500-line slices");
{
  const big = (n, patch) => {
    const sc = Sc.scenario({ items: { F1: F }, lines: many(n, () => ({ item: "F1", qty: 1 })) });
    if (patch) patch(sc);
    return sc;
  };
  const r0 = Sc.plan(big(600));
  ok(r0.plan.out.route === "READY" && Sc.gate(big(600)).route === "GO", "600 clean lines: READY, gate GO", r0.plan.out.message);
  const posted = (sc) => setHdr(sc, { posted_status: "Posted" });
  ok(Sc.plan(big(600, posted)).plan.out.message === "This Goods Receiving has been posted to accounting and cannot be reverted.", "header refusal (posted)");
  const ret = (sc) => {
    posted(sc);
    setLine(sc, 550, { return_quantity: 1 });
  };
  const rr = Sc.plan(big(600, ret));
  ok(rr.plan.out.code === "GRV_400" && rr.plan.out.message === "A purchase return has already claimed quantity from this receipt.", "a return on line 551 wins over posted (its check comes first)", rr.plan.out.message);
  const gone = (sc) => {
    sc.S.movs = [];
  };
  ok(Sc.plan(big(600, gone)).plan.out.message === "No stock movements are left to reverse for this Goods Receiving. It may already have been reverted.", "nothing left to reverse");
  const g = Sc.gate(big(600, ret));
  ok(g.route === "STOP" && g.message === "A purchase return has already claimed quantity from this receipt.", "the gate: the same text", g);
  const huge = big(2600);
  const rh = Sc.plan(huge);
  ok(rh.plan.out.code === "GRV_TOO_LARGE" && Number(rh.plan.out.unlockOk) === 1, "2,600 lines: GRV_TOO_LARGE (unlock)", rh.plan.out);
  const gh = Sc.gate(big(2600));
  ok(gh.route === "STOP" && /2600 lines\. Reverting more than 2500 lines/.test(gh.message), "the gate: STOP above 2,500", gh);
  ok(Sc.gate(big(2500)).route === "GO", "2,500 lines: gate GO");
}

console.log("== the gate: handling units and serial items go to the classic up to 500 lines, STOP above");
{
  const hu = (n) => {
    const sc = Sc.scenario({ items: { F1: F }, lines: many(n, () => ({ item: "F1", qty: 1 })) });
    const m = H.parseBig(sc.S.movs[0].j);
    sc.S.movs[0] = Sc.J(Object.assign(m, { handling_unit_id: Sc.id() }));
    return sc;
  };
  const g1 = Sc.gate(hu(3));
  ok(g1.route === "NOT_ELIGIBLE" && g1.code === "300" && g1.reason === "it has handling units" && g1.lineCount === 3, "HU, 3 lines: NOT_ELIGIBLE", g1);
  const g2 = Sc.gate(hu(501));
  ok(g2.route === "STOP" && /501 lines and cannot be reverted in the background \(it has handling units\)/.test(g2.message), "HU, 501 lines: STOP", g2);
  ok(Sc.plan(hu(3)).plan.out.code === "GRV_NOT_ELIGIBLE", "the plan refuses it too (GRV_NOT_ELIGIBLE)");
  const huOut = Sc.scenario({ items: { F1: F, PK: F }, lines: [{ item: "F1", qty: 1 }] });
  huOut.S.movs.push(Sc.J({ id: Sc.id(), transaction_type: "HU", movement: "OUT", trx_no: "HU-1", parent_trx_no: huOut.grNo, item_id: huOut.items.PK.id, plant_id: huOut.plant,
    bin_location_id: BIN2, inventory_category: "Unrestricted", quantity: "1.00000000", base_qty: "1.00000000", unit_price: "1.00000000", costing_method_id: "First In First Out" }));
  ok(Sc.gate(huOut).route === "NOT_ELIGIBLE", "a packaging deduction (HU) of the receipt: NOT_ELIGIBLE");
  const serial = Sc.scenario({ items: { S1: Object.assign({ serial: true }, F) }, lines: [{ item: "S1", qty: 1 }] });
  const gs = Sc.gate(serial);
  ok(gs.route === "NOT_ELIGIBLE" && gs.reason === "it has serial-numbered items", "serial item: NOT_ELIGIBLE", gs);
  ok(Sc.plan(serial).plan.out.code === "GRV_NOT_ELIGIBLE", "the plan refuses serial receipts (GRV_NOT_ELIGIBLE)");
  const serialBig = Sc.scenario({ items: { S1: Object.assign({ serial: true }, F) }, lines: many(501, () => ({ item: "S1", qty: 1 })) });
  ok(Sc.gate(serialBig).route === "STOP", "serial, 501 lines: STOP");
  const done = Sc.scenario({ items: { F1: F }, lines: [{ item: "F1", qty: 1 }] });
  setHdr(done, { gr_status: "Created" });
  const gd = H.runNode("VSgate", H.gateCtx({ route: "GO", tenantId: done.entry.tenantId, grId: done.grId, organizationId: done.org }, done.S)).out;
  ok(gd.route === "STOP" && gd.message === "Only Completed or Received Goods Receiving can be reverted (this one is Created).", "the gate: grRvPrep's status text", gd);
}

console.log("== the lock: Processing under this job (lock row of its key, gr_v2_job_id) or GRV_NOT_LOCKED without unlock");
{
  const mk = () => Sc.scenario({ items: { F1: F }, lines: [{ item: "F1", qty: 1 }] });
  const a = mk();
  setHdr(a, { gr_status: "Completed" });
  const ra = Sc.plan(a);
  ok(ra.plan.out.code === "GRV_NOT_LOCKED" && Number(ra.plan.out.unlockOk) === 0, "not Processing", ra.plan.out);
  const b = mk();
  b.S.lock = [{ step_name: "LOCK|2", result_ref: "GRV:other" }];
  ok(Sc.plan(b).plan.out.code === "GRV_NOT_LOCKED", "the latest lock is another key's");
  const c = mk();
  setHdr(c, { gr_v2_job_id: "2110999999999999998" });
  ok(Sc.plan(c).plan.out.code === "GRV_NOT_LOCKED", "gr_v2_job_id is another job's");
  const d = mk();
  d.entry = Object.assign({}, d.entry, { organizationId: "1123598813738675299" });
  const rd = Sc.plan(d);
  ok(rd.plan.out.code === "GRV_400" && rd.plan.out.message === "Goods Receiving record not found for this organization." && Number(rd.plan.out.unlockOk) === 1, "another organization: the classic's not-found", rd.plan.out);
  ok(Sc.plan(mk()).plan.out.route === "READY", "locked by this job: READY");
}

console.log("== injection: an id that is not digits never reaches round 2");
{
  const sc = Sc.scenario({ items: { F1: F }, lines: [{ item: "F1", qty: 1 }] });
  setHdr(sc, { po_id: ["1) OR (1=1"] });
  const r = Sc.plan(sc);
  const p = r.prep.out;
  ok(p.route === "FAIL" && p.code === "GRV_INVALID_DATA" && ["sqlMinLiveId", "sqlPlantId", "sqlItemIds", "sqlBatchIds", "sqlHuIds", "sqlPoIds", "sqlPoLineIds"].every((k) => p[k] === "0"),
    "VPprep FAIL GRV_INVALID_DATA, every sql* 0", p);
  ok(r.plan.out.code === "GRV_INVALID_DATA" && Number(r.plan.out.unlockOk) === 1, "the plan fails, unlocks", r.plan.out);
  const sc2 = Sc.scenario({ items: { F1: F }, lines: [{ item: "F1", qty: 1 }] });
  setHdr(sc2, { plant_id: "12a" });
  ok(Sc.plan(sc2).prep.out.code === "GRV_INVALID_DATA", "a plant that is not digits");
  const refused = Sc.scenario({ items: { F1: F }, lines: [{ item: "F1", qty: 1 }] });
  setHdr(refused, { pi_status: "Fully Invoiced" });
  const rp = Sc.plan(refused).prep.out;
  ok(rp.route === "GO" && rp.refuse === 1 && rp.sqlItemIds === "0" && rp.sqlPoIds === "0", "a refusal passes through with sql* 0", rp);
}

console.log("== uncapped: 1,200 rows in each read grRvBuild caps at 1,000 - no fetch_truncated; the classic's arrays would trip it");
{
  const sc = Sc.scenario({ items: Object.fromEntries(many(1200, (i) => ["I" + i, F])), lines: many(1200, (i) => ({ item: "I" + i, qty: 1, transit: true })) });
  const r = Sc.plan(sc);
  ok(r.plan.out.route === "READY", "1,200 items / balances / on-order / in-transit rows: READY", r.plan.out.message);
  const sb = H.load(H.OUTPUTS.files.VPplan.filter((f) => !/_tail\.js$/.test(f)));
  sb.__args = { e: sc.entry, p: r.prep.out, S: sc.S };
  const plain = vm.runInContext("__Uncapped = function (rows) { return rows; }; rvPlan(__args.e, __args.p, __args.S, {})", sb);
  ok(plain.code === "GRV_STALE" && /hit the fetch limit/.test(plain.message), "with plain arrays: fetch_truncated", plain.message);
}

console.log("== multi-bin putaway: a row reversed out of every bin its stock went to; the classic's category / bin / batch");
{
  const sc = Sc.scenario({ items: { FB: Object.assign({ batch: true }, F) }, lines: [{ item: "FB", qty: 10, putaway: [[BIN2, 7], [BIN3, 3]], transit: true }] });
  const r = Sc.plan(sc);
  const mv = r.parts ? r.parts.ENGINE.movements : [];
  ok(mv.length === 2 && mv[0].location_id === BIN2 && mv[0].quantity === 7 && mv[1].location_id === BIN3 && mv[1].quantity === 3 && mv.every((m) => m.batch_id && m.inventory_category === "Unrestricted"),
    "two parts, the putaway's bins", mv);
  ok(r.parts && r.parts.DOCS.putaway.length === 1 && r.parts.DOCS.transit.length === 1 && r.parts.CHECK.putaway[0].to_status === "Completed", "the putaway and in-transit row", r.parts && r.parts.DOCS);
}

console.log("== documents: inspection lots, split-minted batches, in-transit rows, invoices, later movements");
{
  const mk = () => Sc.scenario({ items: { FB: Object.assign({ batch: true }, F) }, lines: [{ item: "FB", qty: 4, cat: "Quality Inspection", transit: true }] });
  const a = mk();
  const lot = Sc.id();
  a.S.qi.push(Sc.J({ id: lot, inspection_lot_no: "QI-1", receiving_insp_status: "Created" }));
  const bt = H.parseBig(a.S.batches[0].j);
  a.S.batches[0] = Sc.J(Object.assign(bt, { parent_transaction_no: a.grNo }));
  const ra = Sc.plan(a);
  ok(ra.parts && JSON.stringify(ra.parts.DOCS.qi) === JSON.stringify([lot]) && JSON.stringify(ra.parts.DOCS.batches) === JSON.stringify([bt.id]), "a Created lot and a split-minted batch go", ra.parts && ra.parts.DOCS);
  ok(ra.parts && ra.parts.ENGINE.movements[0].inventory_category === "Quality Inspection", "out of Quality Inspection, where the receipt put it");
  const b = mk();
  b.S.qi.push(Sc.J({ id: Sc.id(), inspection_lot_no: "QI-2", receiving_insp_status: "In Progress" }));
  ok(conflicts(Sc.plan(b)).includes("inspection_progressed"), "a lot in progress: conflict");
  const c = mk();
  const t = H.parseBig(c.S.transit[0].j);
  c.S.transit[0] = Sc.J(Object.assign(t, { status: "In Transit", open_qty: 1, transit_qty: 4 }));
  ok(conflicts(Sc.plan(c)).includes("transit_consumed"), "in transit partly put away: conflict");
  const d = mk();
  d.S.pi.push(Sc.J({ id: Sc.id(), purchase_invoice_no: "PI-1", pi_status: "Draft" }));
  d.S.pi.push(Sc.J({ id: Sc.id(), purchase_invoice_no: "PI-2-Cancelled", pi_status: "Completed" }));
  const rd = Sc.plan(d);
  ok(conflicts(rd).filter((x) => x === "invoiced").length === 1, "a live invoice (not a -Cancelled one): conflict", conflicts(rd));
  const e = mk();
  const anchor = H.parseBig(e.S.movs[0].j);
  e.S.later.push(Sc.J({ item_id: anchor.item_id, batch_id: anchor.batch_number_id, max_id: Sc.id(), latest: "GDL GD-1" }));
  const re = Sc.plan(e);
  ok(conflicts(re).includes("later_movement") && /has been used since this receipt \(latest: GDL GD-1\)/.test(re.plan.out.message), "a later movement: the classic's message", re.plan.out.message);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
