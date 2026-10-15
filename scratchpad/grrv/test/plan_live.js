// Harness (c): the assembled PREPARE nodes (VPprep -> VPplan, exactly the bodies the builder embeds) and the SUBMIT gate on
// live dev reads of stored receipts (run_prepare_sql.py dumps), each receipt presented as locked by a test job whose
// previous status is its stored one. Per receipt: both nodes run without throwing, every token has a value, the plan
// function (debug) answers what the assembled node answers; for a READY plan the manifest is checked against grRvBuild's
// own answer, independently of the plan's own checks:
//   ENGINE  one movement per subtract, in order: R<n>, SUBTRACT, GRN-R, isMovingInv 1, trx_no = the receipt number, its plant /
//           organization, no handling unit, the subtract's item / quantity / unit / price / category / bin / batch / date;
//           walking the live rows in id order, each row's parts are consecutive, carry its item, price (q8) and parent number
//           and add up to its base quantity; every (item, batch, bin, category) is one the ledger replay holds, never over-drawn
//   COST    the FIFO / WA-batch rows grRvBuild matched, as read; each restate's B / C gives grRvBuild's quantity / price on the
//           row as read (R2's formula)
//   DOCS    grRvBuild's lists; PO: R4's formulas on the rows as read give grRvBuild's line / on-order writes
//   parts   every part present, its chunks rebuild it exactly, the header's counts are the parts' lengths
// and grRvBuild with plain (capped) arrays answers the same as with the uncapped views below 1,000 rows.
// usage: TZ=Asia/Kuala_Lumpur node plan_live.js <dir> [prefix=dev_]   (SHOW=n prints n notes)
const fs = require("fs");
const path = require("path");
const H = require("./_harness");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const [dir, prefix] = [process.argv[2], process.argv[3] || "dev_"];
const CLOCK = Date.parse("2026-10-15T04:00:00Z");
const EPS = 0.005;
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const qs = (v) => Math.max(0, q8(v)).toFixed(8);
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const S_ = (v) => (v === undefined || v === null ? "" : String(v));
const cmpId = (a, b) => (S_(a).length - S_(b).length) || (S_(a) < S_(b) ? -1 : S_(a) > S_(b) ? 1 : 0);
const PLAN_FILES = H.OUTPUTS.files.VPplan.filter((f) => !/_tail\.js$/.test(f));
const tally = { files: 0, READY: 0, FAIL: 0, threw: 0, broken: 0 };
const codes = {};
const conflictTypes = {};
const refusals = {};
const features = { movements: 0, multiPartRows: 0, batchMovements: 0, fifo: 0, waDelete: 0, waRestate: 0, putaway: 0, transit: 0, qi: 0, batches: 0, poLines: 0, onOrder: 0,
  bundles: 0, splitLines: 0, uncappedChecked: 0 };
const gates = {};
const notes = [];
let maxMs = 0;
const bad = (f, why) => {
  tally.broken++;
  notes.push(`${f}: ${why}`);
};
for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith(".json") && !x.includes("_run_")).sort()) {
  const S = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (!S.hdr || !S.hdr.length) continue;
  tally.files++;
  const L = H.locked(S);
  let prep;
  let plan;
  try {
    prep = H.runNode("VPprep", H.prepCtx(L.entry, S, L.hdr, L.lock), { clock: CLOCK });
    plan = H.runNode("VPplan", H.planCtx(L.entry, prep.out, S), { clock: CLOCK });
  } catch (e) {
    tally.threw++;
    notes.push(`${f}: THREW ${String(e && e.stack).slice(0, 300)}`);
    continue;
  }
  maxMs = Math.max(maxMs, prep.ms + plan.ms);
  if (prep.missing.length || plan.missing.length) bad(f, "tokens without a value: " + prep.missing.concat(plan.missing).join(", "));
  const out = plan.out;
  tally[out.route] = (tally[out.route] || 0) + 1;
  codes[out.code] = (codes[out.code] || 0) + 1;
  // the gate on the SUBMIT reads of the same receipt (before any lock)
  const gate = H.runNode("VSgate", H.gateCtx({ route: "GO", tenantId: L.entry.tenantId, grId: L.entry.grId, organizationId: L.entry.organizationId }, S.submit));
  gates[gate.out.route] = (gates[gate.out.route] || 0) + 1;
  if (gate.out.route === "GO" && out.code === "GRV_400") bad(f, "the gate let through what the plan refuses: " + out.message);
  if (gate.out.route === "STOP" && out.route === "READY") bad(f, "the gate stops what the plan takes: " + gate.out.message);
  // the plan function in debug: same answer, grRvBuild's own output and the parts
  const sb = H.load(PLAN_FILES, CLOCK);
  sb.__args = { e: L.entry, p: prep.out, S: S };
  const dbg = require("vm").runInContext("const __r = rvPlan(__args.e, __args.p, __args.S, { debug: true }); ({ r: __r, b: __r.__build, parts: __r.__parts })", sb);
  if (JSON.stringify(H.platformOut(dbg.r, "VPplan")) !== JSON.stringify(out)) bad(f, "the plan function and the assembled node answer differently");
  if (out.route === "FAIL") {
    if (out.code === "GRV_STALE") {
      const det = JSON.parse(out.errorDetails || "{}");
      for (const c of det.conflicts || []) conflictTypes[c.type] = (conflictTypes[c.type] || 0) + 1;
      if (!det.conflicts || !det.conflicts.length) bad(f, "a GRV_STALE answer without its conflicts");
    } else if (out.code === "GRV_400" || out.code === "GRV_NOT_ELIGIBLE") {
      const k = out.code + ": " + out.message.replace(/\d+/g, "#");
      refusals[k] = (refusals[k] || 0) + 1;
    } else notes.push(`${f}: FAIL ${out.code} ${out.message}`);
    if (Number(out.unlockOk) !== 1) bad(f, "a failure after the lock that does not unlock: " + out.code);
    continue;
  }
  // ---- READY: the manifest against grRvBuild's answer
  const b = dbg.b;
  const parts = dbg.parts;
  const man = JSON.parse(out.payload);
  const hdr = H.parseBig(S.hdr[0].j);
  const prepOut = prep.out;
  const subs = b.subtracts || [];
  const mv = parts.ENGINE.movements;
  if (parts.ENGINE.operation_key !== "GRV|" + H.TEST_JOB) bad(f, "operation key " + parts.ENGINE.operation_key);
  if (mv.length !== subs.length) bad(f, `movements ${mv.length} vs subtracts ${subs.length}`);
  for (let i = 0; i < Math.min(mv.length, subs.length); i++) {
    const m = mv[i];
    const s = subs[i];
    const want = { movement_key: "R" + (i + 1), direction: "SUBTRACT", plant_id: S_(hdr.plant_id), organization_id: S_(hdr.organization_id), material_id: s.material_id,
      quantity: s.quantity, material_uom: s.material_uom, unit_price: s.unit_price, transaction_type: "GRN-R", trx_no: S_(hdr.gr_no), parent_trx_no: s.parent_trx_no,
      inventory_category: s.inventory_category, location_id: s.location_id, batch_id: s.batch_id || null, handling_unit_id: null, doc_date: s.doc_date, isMovingInv: 1 };
    if (JSON.stringify(m) !== JSON.stringify(want)) {
      bad(f, `movement ${i + 1}: ${JSON.stringify(m).slice(0, 200)} | want ${JSON.stringify(want).slice(0, 200)}`);
      break;
    }
    if (m.batch_id) features.batchMovements++;
  }
  // each live row's parts: consecutive, its item / price / parent number, summing to its base quantity
  const live = (prepOut.liveRows || []).slice().sort((x, y) => cmpId(x.id, y.id));
  let j = 0;
  for (const r of live) {
    let need = q8(r.base_qty);
    let partsOfRow = 0;
    while (need > EPS && j < subs.length) {
      const s = subs[j++];
      partsOfRow++;
      if (s.material_id !== S_(r.item_id) || s.unit_price !== q8(r.unit_price) || s.parent_trx_no !== S_(r.parent_trx_no)) bad(f, `subtract ${j} is not live row ${r.id}'s`);
      need = q8(need - s.quantity);
    }
    if (Math.abs(need) > EPS) bad(f, `live row ${r.id}: ${need} left unreversed`);
    if (partsOfRow > 1) features.multiPartRows++;
  }
  if (j !== subs.length) bad(f, `${subs.length - j} subtract(s) beyond the live rows`);
  // every place is one the replay holds, never over-drawn
  const locQty = {};
  for (const l of prepOut.locations || []) locQty[[l.material_id, l.batch_id, l.location_id, l.inventory_category].join("|")] = num(l.qty);
  for (const s of subs) {
    const k = [s.material_id, S_(s.batch_id), s.location_id, s.inventory_category].join("|");
    if (locQty[k] === undefined) bad(f, "a reversal out of a place the replay does not hold: " + k);
    else locQty[k] = q8(locQty[k] - s.quantity);
    if (locQty[k] < -EPS) bad(f, "the replay's place is over-drawn: " + k);
  }
  features.movements += mv.length;
  // COST
  const fifoBy = Object.fromEntries((S.fifo || []).map((r) => H.parseBig(r.j)).map((r) => [r.id, r]));
  const waBy = Object.fromEntries((S.wa || []).map((r) => H.parseBig(r.j)).map((r) => [r.id, r]));
  const fifoIds = [...new Set(subs.filter((s) => s.hasFifoDelete === 1).map((s) => s.fifoDeleteId))];
  const waDelIds = [...new Set(subs.filter((s) => s.hasWaDelete === 1).map((s) => s.waDeleteId))];
  const waUpd = subs.filter((s) => s.hasWaUpdate === 1);
  if (JSON.stringify(parts.COST.fifo.map((x) => x.id).sort()) !== JSON.stringify(fifoIds.sort())) bad(f, "COST.fifo is not grRvBuild's layers");
  for (const x of parts.COST.fifo) if (x.initial !== fifoBy[x.id].fifo_initial_quantity || x.available !== fifoBy[x.id].fifo_available_quantity) bad(f, "a FIFO layer not as read");
  if (JSON.stringify(parts.COST.waDelete.map((x) => x.id).sort()) !== JSON.stringify(waDelIds.sort())) bad(f, "COST.waDelete is not grRvBuild's rows");
  for (const x of parts.COST.waDelete) if (x.wa_quantity !== waBy[x.id].wa_quantity || x.wa_cost_price !== waBy[x.id].wa_cost_price) bad(f, "a WA batch row not as read");
  if (parts.COST.waRestate.length !== waUpd.length) bad(f, "COST.waRestate is not grRvBuild's restates");
  for (const x of parts.COST.waRestate) {
    const s = waUpd.find((u) => u.waUpdateId === x.id);
    const w = waBy[x.id];
    const q1 = num(w.wa_quantity);
    const p1 = num(w.wa_cost_price);
    const q0 = q8(q1 - num(x.B));
    const p0 = q0 > 0.0005 ? q8((p1 * q1 - num(x.C)) / q0) : p1;
    if (!s || s.waQuantity !== (q0 > 0.0005 ? qs(q0) : "0.00000000") || s.waCostPrice !== qs(p0)) bad(f, "a WA restate that R2 would not reproduce: " + x.id);
  }
  // DOCS
  const ids = (a) => JSON.stringify((a || []).map((x) => S_(x.id)));
  if (JSON.stringify(parts.DOCS.putaway) !== ids(b.putawayDeletes) || JSON.stringify(parts.DOCS.qi) !== ids(b.qiDeletes) || JSON.stringify(parts.DOCS.batches) !== ids(b.batchDeletes)
    || JSON.stringify(parts.DOCS.transit) !== JSON.stringify(b.transitUpdates || [])) bad(f, "DOCS are not grRvBuild's lists");
  // PO: R4's formulas on the rows as read give grRvBuild's writes
  const po = {};
  for (const r of S.po || []) if (r.k === "POL") po[H.parseBig(r.j).id] = H.parseBig(r.j);
  const ooRows = (S.oo || []).map((r) => H.parseBig(r.j));
  const r4 = {};
  for (const l of parts.PO.poLines) {
    const cur = po[l.id];
    const quantity = num(cur.quantity);
    const newRecv = Math.max(0, q8(num(cur.received_qty) - num(l.recv)));
    const st = S_(cur.line_status) === "Cancelled" || S_(cur.line_status) === "Draft" ? S_(cur.line_status) : quantity > 0 && newRecv >= quantity - EPS ? "Completed" : newRecv > EPS ? "Processing" : "Issued";
    r4[l.id] = { id: l.id, received_qty: qs(newRecv), outstanding_quantity: qs(Math.max(0, q8(quantity - newRecv))), line_status: st, created_received_qty: qs(num(cur.created_received_qty) + num(l.res)) };
  }
  for (const u of b.poLineUpdates || []) if (JSON.stringify(r4[u.id]) !== JSON.stringify(u)) bad(f, `PO line ${u.id}: R4 gives ${JSON.stringify(r4[u.id])} | grRvBuild ${JSON.stringify(u)}`);
  if (Object.keys(r4).length !== (b.poLineUpdates || []).length) bad(f, "PO.poLines is not grRvBuild's lines");
  const ooOut = [];
  for (const o of parts.PO.onOrder) for (const r of ooRows.filter((x) => S_(x.po_line_id) === o.po_line_id)) {
    const newRecv = Math.max(0, q8(num(r.received_qty) - num(o.base)));
    ooOut.push({ id: S_(r.id), received_qty: qs(newRecv), open_qty: qs(Math.max(0, q8(num(r.scheduled_qty) - newRecv))) });
  }
  const sortId = (a) => a.slice().sort((x, y) => cmpId(x.id, y.id));
  if (JSON.stringify(sortId(ooOut)) !== JSON.stringify(sortId(b.onOrderUpdates || []))) bad(f, "on-order: R4 does not give grRvBuild's writes");
  if (JSON.stringify(parts.PO.poIds) !== JSON.stringify(man.po_ids) || man.po_ids.some((x) => !/^[0-9]{1,20}$/.test(x))) bad(f, "po_ids");
  // parts: present, rebuilt exactly from the chunks; the header's counts
  for (const name of ["ENGINE", "COST", "DOCS", "PO", "CHECK"]) {
    const rows = out.partRows.filter((r) => r.step_name.startsWith("P|" + man.nonce + "|" + name + "|"));
    if (!rows.length || JSON.stringify(man.parts[name]) !== JSON.stringify(rows.map((r) => r.step_name))) bad(f, "part " + name + " rows");
    if (rows.map((r) => r.result_ref).join("") !== JSON.stringify(parts[name])) bad(f, "part " + name + " does not rebuild");
    if (rows.some((r) => r.step_status !== "PAYLOAD" || r.job_id !== H.TEST_JOB || r.organization_id !== S_(hdr.organization_id) || r.result_ref.length > 400000)) bad(f, "part " + name + " row fields");
  }
  const c = man.counts;
  const want = { lines: prepOut.lineCount, movements: mv.length, fifo: parts.COST.fifo.length, waDelete: parts.COST.waDelete.length, waRestate: parts.COST.waRestate.length,
    putaway: parts.DOCS.putaway.length, transit: parts.DOCS.transit.length, qi: parts.DOCS.qi.length, batches: parts.DOCS.batches.length, poLines: parts.PO.poLines.length,
    onOrder: parts.PO.onOrder.length };
  if (JSON.stringify(c) !== JSON.stringify(want)) bad(f, "counts " + JSON.stringify(c) + " | " + JSON.stringify(want));
  if (man.gr_id !== S_(hdr.id) || man.gr_no !== S_(hdr.gr_no) || man.job_id !== H.TEST_JOB || man.previous_status !== L.entry.request.previousStatus || man.nonce !== "Ab12Cd34") bad(f, "manifest header");
  if (JSON.stringify(parts.CHECK.anchors) !== JSON.stringify(prepOut.tupleAnchors || {}) || parts.CHECK.minLiveId !== prepOut.minLiveIdSql) bad(f, "CHECK anchors");
  for (const k of ["fifo", "waDelete", "waRestate", "putaway", "transit", "qi", "batches", "poLines", "onOrder"]) features[k] += c[k];
  const flatLines = H.parseBig(JSON.stringify(prepOut.lines || []));
  if (flatLines.some((l) => l.item_bundle_id || l.parent_id)) features.bundles++;
  if (flatLines.some((l) => l.is_split === "Yes")) features.splitLines++;
  // grRvBuild with plain arrays (the classic's) answers the same below its 1,000-row ceiling
  const sizes = ["bbal", "ibal", "oo", "items", "transit"].map((k) => (S[k] || []).length);
  if (Math.max(...sizes) < 1000) {
    const sb2 = H.load(PLAN_FILES, CLOCK);
    sb2.__args = { e: L.entry, p: prep.out, S: S };
    const plainB = require("vm").runInContext("const __U = __Uncapped; __Uncapped = function (rows) { return rows; }; rvPlan(__args.e, __args.p, __args.S, { debug: true }).__build", sb2);
    if (JSON.stringify(plainB) !== JSON.stringify(b)) bad(f, "grRvBuild answers differently on the uncapped views");
    else features.uncappedChecked++;
  }
}
console.log(`receipts ${tally.files}: READY ${tally.READY}, FAIL ${tally.FAIL}, threw ${tally.threw}; checks broken: ${tally.broken}; slowest prep + plan ${maxMs.toFixed(0)} ms`);
console.log("  plan codes", JSON.stringify(codes));
console.log("  gate routes on the same receipts", JSON.stringify(gates));
console.log("  conflicts (GRV_STALE)", JSON.stringify(conflictTypes));
console.log("  refusals", JSON.stringify(refusals, null, 1));
console.log("  READY manifests covered", JSON.stringify(features));
for (const n of notes.slice(0, Number(process.env.SHOW || 30))) console.log("  " + n);
process.exit(tally.broken || tally.threw ? 1 : 0);
