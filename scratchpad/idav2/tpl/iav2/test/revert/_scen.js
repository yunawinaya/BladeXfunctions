// A world (_world.js) holding an Item Assembly COMPLETED THE WAY IA V2 COMPLETES IT: the engine core ran op 1 (one SUBTRACT per
// component pick, IAC|<job>|I, isMovingInv 0) and op 2 (the receipt ADD, IAC|<job>|R, priced q8(OUT total / base qty + 0)); a
// batch parent got its Batch row first (I1), a non-batch parent none (V2's deliberate difference). spec:
//   { parent: { method: FIFO | WA | FIXED, batch?, qty }, comps: [{ qty, method?, layers?: [[qty, price], ...], batch?, serial? }],
//     parentStock?: [qty, price] (stock of the parent before: a FIFO layer / the WA running row), manyComps?: n, cat?: Blocked }
// Also: { classic: true } marks the IA as completed by the classic (a blank Batch row for a non-batch parent; no op keys).
const { World } = require("./_world");
const { iaMovesFingerprint } = require("../../code/shared/fingerprint.js");
const FIFO = "First In First Out";
const WA = "Weighted Average";
const FIXED = "Fixed Cost";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const UOM = "2018906563477008392";
const BIN = "2018912822846582786";
const FG_BIN = "2018912822846582799";
const KEY = "IAV:" + ORG + ":<ia>:click01";

function completed(spec) {
  const sp = spec || {};
  const w = new World();
  const P = Object.assign({ method: FIFO, batch: false, qty: 2 }, sp.parent || {});
  const item = (o) => {
    const it = Object.assign({ id: w.id(), stock_control: 1, based_uom: UOM, item_batch_management: 0, purchase_unit_price: 0, uoms: [{ alt_uom_id: UOM, base_qty: 1 }] }, o);
    w.items[it.id] = it;
    return it;
  };
  const parent = item({ material_code: "FG-1", material_name: "Assembly", material_costing_method: P.method, item_batch_management: P.batch ? 1 : 0, serial: !!P.serial });
  let compSpecs = sp.comps || [{ qty: 3, layers: [[10, 1]] }, { qty: 4, layers: [[10, 2], [5, 3]] }];
  if (sp.manyComps) compSpecs = Array.from({ length: sp.manyComps }, () => ({ qty: 1, layers: [[2, 1]] }));
  const comps = compSpecs.map((c, i) => Object.assign({}, c, { it: item({ material_code: "RM-" + (i + 1), material_name: "Part " + (i + 1), material_costing_method: c.method || FIFO,
    item_batch_management: c.batch ? 1 : 0, serial: !!c.serial }) }));
  w.bins[BIN] = "A1-01";
  w.bins[FG_BIN] = "FG-01";
  // stock before the completion
  for (const c of comps) {
    const total = (c.layers || [[10, 1]]).reduce((n, l) => n + l[0], 0);
    const batchId = c.batch ? w.id() : null;
    c.batchId = batchId;
    w.ib.push({ id: w.id(), material_id: c.it.id, location_id: BIN, plant_id: PLANT, organization_id: ORG, unrestricted_qty: total, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0,
      intransit_qty: 0, balance_quantity: total, is_deleted: 0 });
    if (batchId) w.bb.push({ id: w.id(), material_id: c.it.id, location_id: BIN, batch_id: batchId, plant_id: PLANT, organization_id: ORG, unrestricted_qty: total, reserved_qty: 0, block_qty: 0,
      qualityinsp_qty: 0, intransit_qty: 0, balance_quantity: total, is_deleted: 0 });
    if ((c.method || FIFO) === FIFO) {
      let n = 0;
      for (const [q, p] of c.layers || [[10, 1]]) w.fifo.push({ id: w.id(), material_id: c.it.id, plant_id: PLANT, organization_id: ORG, batch_id: batchId, fifo_sequence: String(++n),
        fifo_cost_price: p, fifo_initial_quantity: q, fifo_available_quantity: q, is_deleted: 0 });
    } else if (c.method === WA) {
      const [q, p] = (c.layers || [[10, 1]])[0];
      w.wa.push({ id: w.id(), material_id: c.it.id, plant_id: PLANT, organization_id: ORG, batch_id: batchId, wa_quantity: q, wa_cost_price: p, created_at: "2026-10-01 00:00:00", is_deleted: 0 });
    }
  }
  if (sp.parentStock) {
    const [q, p] = sp.parentStock;
    w.ib.push({ id: w.id(), material_id: parent.id, location_id: FG_BIN, plant_id: PLANT, organization_id: ORG, unrestricted_qty: q, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0,
      balance_quantity: q, is_deleted: 0 });
    if (P.method === FIFO) w.fifo.push({ id: w.id(), material_id: parent.id, plant_id: PLANT, organization_id: ORG, batch_id: null, fifo_sequence: "1", fifo_cost_price: p, fifo_initial_quantity: q,
      fifo_available_quantity: q, is_deleted: 0 });
    if (P.method === WA) w.wa.push({ id: w.id(), material_id: parent.id, plant_id: PLANT, organization_id: ORG, batch_id: null, wa_quantity: q, wa_cost_price: p, created_at: "2026-10-01 00:00:00", is_deleted: 0 });
  }
  const before = snapshot(w);
  // the IA (its id precedes every row the completion writes)
  const ia = { id: w.id(), item_id: parent.id, item_qty: P.qty, item_uom: UOM, location_id: FG_BIN, inventory_category: sp.cat || "Unrestricted", batch_no: P.batch ? "B-0001" : "",
    issuing_operation_faci: PLANT, organization_id: ORG, stock_movement_no: "IA-SIM-" + String(w.seq).slice(-4), item_assembly_status: "Processing", posted_status: null, ia_v2_job_id: null, is_deleted: 0 };
  w.ias.push(ia);
  const cjob = w.id();
  const op = (side, movements) => {
    const a = w.engine({ operation_key: "IAC|" + cjob + "|" + side, mode: "APPLY", organization_id: ORG, movements: movements });
    if (!a || a.code !== "200") throw new Error("the completion's op " + side + " failed: " + JSON.stringify(a));
    return a;
  };
  const doc = "2026-10-19 00:00:00";
  const a1 = op("I", comps.map((c, i) => ({ movement_key: "M" + (i + 1), direction: "SUBTRACT", plant_id: PLANT, organization_id: ORG, material_id: c.it.id, quantity: c.qty, material_uom: UOM,
    transaction_type: "IA", trx_no: ia.stock_movement_no, parent_trx_no: "", inventory_category: "Unrestricted", location_id: BIN, batch_id: c.batchId, doc_date: doc, isMovingInv: 0,
    handling_unit_id: null })));
  const outTotal = w.mv.filter((m) => /\|I\|/.test(m.operation_effect_key || "") && m.operation_effect_key.indexOf("IAC|" + cjob + "|I|") === 0).reduce((n, m) => n + Number(m.total_price), 0);
  const price = Number((outTotal / P.qty).toFixed(8));
  let batchId = null;
  if (P.batch || sp.classic) {
    batchId = w.id();
    w.batch.push({ id: batchId, batch_number: P.batch ? "B-0001" : "", material_id: parent.id, plant_id: PLANT, organization_id: ORG, transaction_no: ia.stock_movement_no, is_deleted: 0 });
  }
  op("R", [{ movement_key: "R1", direction: "ADD", plant_id: PLANT, organization_id: ORG, material_id: parent.id, quantity: P.qty, material_uom: UOM, transaction_type: "IA",
    trx_no: ia.stock_movement_no, parent_trx_no: "", inventory_category: sp.cat || "Unrestricted", location_id: FG_BIN, batch_id: P.batch ? batchId : null, unit_price: price, doc_date: doc,
    manufacturing_date: null, expired_date: null, remark: "", remark2: "", remark3: "", isMovingInv: 0, handling_unit_id: null }]);
  Object.assign(ia, { item_assembly_status: "Completed", posted_status: "Unposted", ia_v2_job_id: sp.classic ? null : cjob });
  // the completion's lock row and job (the IA's lock sequence continues from it)
  w.steps.push({ id: w.id(), job_id: "IAC|" + ia.id, step_name: "LOCK|1", step_status: "LOCK", result_ref: "IA:" + ORG + ":" + ia.id + ":h:1", is_deleted: 0, started_at: w.now - 3600000 });
  w.jobs.push({ id: cjob, organization_id: ORG, plant_id: PLANT, command: "COMPLETE_IA", idempotency_key: "IA:" + ORG + ":" + ia.id + ":h:1", job_status: "COMPLETED", progress_percent: 100,
    progress_message: "done", attempt_count: 0, row_version: 9, cancel_requested: 0, next_attempt_at: null, request_payload: JSON.stringify({ v: 1, action: "DIRECT", iaNo: ia.stock_movement_no }),
    causation_id: ia.id, correlation_id: "IA|" + ia.id, line_count: comps.length, queued_at: null, lease_owner: null, lease_expires_at: null, error_code: null, error_message: null,
    error_details: null, finished_at: null, prepared_payload: null, is_deleted: 0, create_time: w.now - 3600000 });
  w.engineCalls = [];
  w.writes = [];
  w.now += 60000;
  const row = { id: ia.id, item_assembly_status: "Completed", stock_movement_no: ia.stock_movement_no, organization_id: ORG };
  return { w: w, ia: ia, parent: parent, comps: comps, cjob: cjob, before: before, price: price, outTotal: outTotal, batchId: batchId, row: row, key: KEY.replace("<ia>", ia.id), a1: a1 };
}

// what a revert must bring back: per material the item / batch balances, the FIFO available sum and its value, the WA rows
function snapshot(w) {
  const per = {};
  const at = (m) => per[m] || (per[m] = { qty: 0, block: 0, batch: 0, fifoQty: 0, fifoValue: 0, wa: [] });
  for (const b of w.ib) if (!b.is_deleted) {
    at(b.material_id).qty = Number((at(b.material_id).qty + Number(b.unrestricted_qty)).toFixed(8));
    at(b.material_id).block = Number((at(b.material_id).block + Number(b.block_qty)).toFixed(8));
  }
  for (const b of w.bb) if (!b.is_deleted) at(b.material_id).batch = Number((at(b.material_id).batch + Number(b.balance_quantity)).toFixed(8));
  for (const f of w.fifo) if (!f.is_deleted) {
    at(f.material_id).fifoQty = Number((at(f.material_id).fifoQty + Number(f.fifo_available_quantity)).toFixed(8));
    at(f.material_id).fifoValue = Number((at(f.material_id).fifoValue + Number(f.fifo_available_quantity) * Number(f.fifo_cost_price)).toFixed(6));
  }
  for (const r of w.wa) if (!r.is_deleted) at(r.material_id).wa.push([Number(r.wa_quantity), Number(Number(r.wa_cost_price).toFixed(6))]);
  for (const k of Object.keys(per)) per[k].wa.sort((a, b) => a[0] - b[0]);
  return per;
}

// the job the list's SUBMIT would queue, handed straight to the worker's states (for the COMMIT / PREPARE sims)
function queuedJob(z, opts) {
  const o = opts || {};
  const w = z.w;
  const jobId = w.id();
  const fp = o.fp === undefined ? iaMovesFingerprint(w.moves(z.ia.id)) : o.fp;
  w.steps.push({ id: w.id(), job_id: "IAC|" + z.ia.id, step_name: "LOCK|2", step_status: "LOCK", result_ref: z.key, is_deleted: 0, started_at: w.now });
  w.jobs.push({ id: jobId, organization_id: ORG, plant_id: PLANT, command: "REVERT_IA", idempotency_key: z.key, job_status: o.status || "VALIDATING", progress_percent: 10, progress_message: "Validating",
    attempt_count: 0, row_version: 2, cancel_requested: 0, next_attempt_at: null, request_payload: JSON.stringify(Object.assign({ v: 1, action: "REVERT", prevStatus: "Completed", iaId: z.ia.id,
      iaNo: z.ia.stock_movement_no, organizationId: ORG, plantId: PLANT, liveRows: 0, movesFingerprint: fp, source: "LIST", nonce: "ab12cd34", parts: {} }, o.request || {})),
    causation_id: z.ia.id, correlation_id: "IA|" + z.ia.id, line_count: 0, queued_at: null, lease_owner: "WRK|" + "f".repeat(24), lease_expires_at: w.now + 600000, error_code: null,
    error_message: null, error_details: null, finished_at: null, prepared_payload: null, is_deleted: 0, create_time: w.now });
  Object.assign(z.ia, { item_assembly_status: "Processing", ia_v2_job_id: jobId });
  return jobId;
}

module.exports = { completed, snapshot, queuedJob, FIFO, WA, FIXED, ORG, PLANT, UOM, BIN, FG_BIN };
