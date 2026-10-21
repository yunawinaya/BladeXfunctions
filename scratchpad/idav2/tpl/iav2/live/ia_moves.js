// CONTRACT section 5 engine requests of one Item Assembly, built from its document - the reference E checks the recorded classic
// child calls against (replay_ia.js MOVES) and plans live requests with (plan_ia.js). Read-only, self-contained.
//   iaEngineMoves(doc, hdr, items, opts) -> { I: <ENGINE_I request>, R: <ENGINE_R request>, bad: [...], counts }
//   doc   = the lines' document (stock_movement rows: line_index, item_selection, quantity_uom, temp_qty_data) - the classic's
//           code_fillback allData or the stored IA
//   hdr   = the STORED header (issuing_operation_faci, organization_id, stock_movement_no, item_assembly_date 'YYYY-MM-DD HH:MM:SS',
//           item_id, item_qty, item_uom, location_id, inventory_category, manufacturing_date, expired_date, remarks, remarks_2, remarks_3)
//   items = { <id>: { stock_control, ... } } (non-stock lines give no movement); opts.jobId names the operation keys
"use strict";
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const raw = (v) => (v === undefined || v === null ? "" : String(v));
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const list = (v) => {
  if (Array.isArray(v)) return { ok: true, rows: v };
  const t = s(v);
  if (!t) return { ok: true, rows: [] };
  try {
    const p = JSON.parse(t.replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
    return Array.isArray(p) ? { ok: true, rows: p } : { ok: false, rows: [] };
  } catch (e) {
    return { ok: false, rows: [] };
  }
};
const dt = (v) => {
  const t = s(v).replace("T", " ").replace(/Z$/, "");
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t + " 00:00:00";
  return t.slice(0, 19);
};
const digitsOrNull = (v) => (/^[0-9]{1,20}$/.test(s(v)) ? s(v) : null);

function iaEngineMoves(doc, hdr, items, opts) {
  const o = opts || {};
  const h = hdr || {};
  const jobId = s(o.jobId) || "0";
  const bad = [];
  const lines = (doc && Array.isArray(doc.stock_movement) ? doc.stock_movement : []).filter((l) => l && Number(l.is_deleted || 0) === 0)
    .map((l, i) => ({ l, i })).sort((a, b) => (Number(s(a.l.line_index)) || a.i + 1) - (Number(s(b.l.line_index)) || b.i + 1) || a.i - b.i).map((x) => x.l);
  const plant = s(h.issuing_operation_faci);
  const org = s(h.organization_id);
  const trx = raw(h.stock_movement_no);
  const docDate = dt(h.item_assembly_date);
  const movements = [];
  let picks = 0;
  let nonStock = 0;
  for (const l of lines) {
    const it = (items || {})[s(l.item_selection)];
    const e = list(l.temp_qty_data);
    if (!e.ok) bad.push("line " + s(l.line_index) + ": temp_qty_data does not parse");
    const ps = e.rows.filter((p) => p && typeof p === "object" && (parseFloat(p.sm_quantity) || 0) > 0);
    picks += ps.length;
    if (it && Number(it.stock_control) === 0) {
      nonStock++;
      if (ps.length) bad.push("non-stock line " + s(l.line_index) + " carries " + ps.length + " pick(s)");
      continue;
    }
    if (!it) bad.push("line " + s(l.line_index) + ": item " + s(l.item_selection) + " not in the item set");
    for (const p of ps) {
      movements.push({
        movement_key: "M" + (movements.length + 1), direction: "SUBTRACT", plant_id: plant, organization_id: org, material_id: s(l.item_selection),
        quantity: q8(p.sm_quantity), material_uom: digitsOrNull(l.quantity_uom) || "", transaction_type: "IA", trx_no: trx, parent_trx_no: "",
        inventory_category: s(p.category) || "Unrestricted", location_id: s(p.location_id), batch_id: digitsOrNull(p.batch_id),
        manufacturing_date: p.manufacturing_date || null, expired_date: p.expired_date || null, doc_date: docDate, isMovingInv: 0, handling_unit_id: null,
      });
    }
  }
  const I = { operation_key: "IAC|" + jobId + "|I", mode: "APPLY", organization_id: org, movements };
  const R = {
    operation_key: "IAC|" + jobId + "|R", mode: "APPLY", organization_id: org, receiptBaseQty: o.receiptBaseQty, assemblyCost: o.assemblyCost,
    movements: [{
      movement_key: "R1", direction: "ADD", plant_id: plant, organization_id: org, material_id: s(h.item_id), quantity: q8(h.item_qty),
      material_uom: digitsOrNull(h.item_uom) || "", transaction_type: "IA", trx_no: trx, parent_trx_no: "", inventory_category: s(h.inventory_category) || "Unrestricted",
      location_id: s(h.location_id), batch_id: o.batchId ? s(o.batchId) : null, unit_price: o.unitPrice === undefined ? 0 : o.unitPrice, doc_date: docDate,
      manufacturing_date: dt(h.manufacturing_date), expired_date: dt(h.expired_date), remark: raw(h.remarks), remark2: raw(h.remarks_2), remark3: raw(h.remarks_3),
      isMovingInv: 0, handling_unit_id: null,
    }],
  };
  return { I, R, bad, counts: { lines: lines.length, picks, nonStock, movementsI: movements.length } };
}

module.exports = { iaEngineMoves, dt, q8 };
