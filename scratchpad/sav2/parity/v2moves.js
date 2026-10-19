// CONTRACT §5 ENGINE movements of one Stock Adjustment document - the reference the parity checks against the recorded
// classic child calls (replay_sa.js MOVES: prod 167 / dev 15 SA runs identical, 2026-10-16) and the 2k payload builders
// plan with (live/plan_check.js). One movement per balance entry with sa_quantity > 0, in the classic loop order (lines in
// code_node_O4tWJ5JH's order = line_index, entries in array order), fields = workflow_node_p9gVSMG0 / ABYSBRCw's params
// minus itemData, plus movement_key / direction.
//   v2Movements(allData, hdr) -> { ms, bad }   allData = the lines' document (O4tWJ5JH output), hdr = the stored header
//   (plant_id, organization_id, adjustment_no, adjustment_date) - code_node_qrsgEz2F's allData; defaults to allData
"use strict";
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const s = (v) => (v === undefined || v === null ? "" : String(v));

function v2Movements(allData, hdr) {
  const all = allData || {};
  const h = hdr || all;
  const ms = [];
  const bad = [];
  for (const line of all.stock_adjustment || []) {
    let entries = [];
    const t = line.balance_index;
    if (t) {
      try {
        entries = Array.isArray(t) ? t : JSON.parse(t);
      } catch (e) {
        bad.push("line " + s(line.line_index) + ": balance_index is not JSON");
        entries = [];
      }
      entries = Array.isArray(entries) ? entries.filter((e) => e && e.sa_quantity > 0) : [];
    }
    for (const e of entries) {
      const mt = s(e.movement_type).toLowerCase();
      const dir = mt === "in" ? "ADD" : mt === "out" ? "SUBTRACT" : null;
      const m = {
        movement_key: "M" + (ms.length + 1),
        direction: dir,
        plant_id: e.plant_id || h.plant_id,
        organization_id: h.organization_id,
        material_id: line.material_id,
        quantity: q8(e.sa_quantity),
        material_uom: line.uom_id || "",
        transaction_type: "SA",
        trx_no: h.adjustment_no,
        inventory_category: e.category || "Unrestricted",
        location_id: e.location_id,
        batch_id: e.batch_id || null,
        manufacturing_date: e.manufacturing_date || null,
        expired_date: e.expired_date || null,
        doc_date: h.adjustment_date,
        isMovingInv: 0,
        unit_price: parseFloat(line.unit_price) || 0,
      };
      if (dir === "ADD") {
        m.remark = line.item_remark || null;
        m.remark2 = line.item_remark2 || null;
        m.remark3 = line.item_remark3 || null;
      }
      if (!dir) bad.push(m.movement_key + ": movement_type " + JSON.stringify(e.movement_type) + " (SUBMIT refuses)");
      ms.push(m);
    }
  }
  return { ms, bad };
}

module.exports = { v2Movements };
