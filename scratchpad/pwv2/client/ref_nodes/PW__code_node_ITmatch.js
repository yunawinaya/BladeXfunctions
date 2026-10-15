// 8dp is the maximum configurable column precision: rounding COMPUTED values there keeps
// every client-configured scale intact while killing float residue.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// toFixed(3) STRINGS: the serializer emits full-precision floats that
// BigDecimal multipleOf rejects, and Number()/parseFloat() do not fix it.
const qtyStr = (v) => Math.max(0, q8(v)).toFixed(8);

// The ledger stores 3dp. A base -> alt -> base round trip on a fractional UOM
// conversion comes back high (GRbaseReceivedQty divides, code_node_M7XzDZ48
// multiplies again: 1 / 7 -> 0.143 -> x7 = 1.001), and a split putaway
// accumulates one such error per child. Anything at or under this is a rounding
// artefact, not a real shortage, and must not 400 the putaway.
const QTY_EPS = 0.005;

const allData = {{workflowparams:allData}};
const movements = {{node:code_node_M7XzDZ48.data.inventoryMovements}} || [];

const rowsRaw = {{node:code_node_PwTransit.data.rows}};
const allRows = Array.isArray(rowsRaw) ? rowsRaw : (rowsRaw ? [rowsRaw] : []);

// Goods Receivings completed before this ledger existed hold In-Transit stock with
// no rows behind it. Blocking their putaway would be an operational break, so fall
// through silently and let the inventory workflows behave as they always did.
if (allRows.length === 0) {
  return {
    transitUpdates: [], transitUpdatesLength: 0, hasTransitUpdates: 0,
    transitCreates: [], transitCreatesLength: 0, hasTransitCreates: 0,
    shortages: [], hasShortage: 0,
    message: "No in-transit ledger rows for this GR (legacy document) - skipped"
  };
}

const keyOf = (mat, batch, bin) =>
  String(mat || "") + "|" + String(batch || "") + "|" + String(bin || "");

// Two structures off the same fetch, deliberately built from different slices:
//
//   trackedTuples - every tuple this GR has EVER staged, whatever its status.
//     A tuple in here but absent from the pool has been fully consumed, so a
//     second claim on it is a double-consumption and must 400.
//   pool - only rows still open. The FIFO stock actually available to draw down.
//
// A tuple in NEITHER is untracked, and is skipped rather than shorted. Two ways
// that happens: Quality Inspection stock released by QIsaveAsCompleted.js, which
// appends its lines to this same putaway record, and legacy lines on a GR that
// predates the ledger. The ledger simply has no opinion about that stock.
const trackedTuples = {};
const pool = {};
for (const r of allRows) {
  const k = keyOf(r.material_id, r.batch_id, r.transit_bin);
  trackedTuples[k] = 1;
  if (r.status !== "In Transit") continue;
  if (!pool[k]) pool[k] = [];
  pool[k].push({ row: r, remaining: q8(r.open_qty), slices: [] });
}
for (const k in pool) {
  pool[k].sort((a, b) => {
    const da = String(a.row.transit_date || "");
    const db = String(b.row.transit_date || "");
    if (da !== db) return da < db ? -1 : 1;
    return (parseInt(a.row.line_no, 10) || 0) - (parseInt(b.row.line_no, 10) || 0);
  });
}

// Demand is accumulated against the shared pool across every line of this
// putaway, so two lines drawing on one balance cannot both pass -- the stateless
// per-row check is exactly what let the PT double-commit through.
const shortages = [];
for (const m of movements) {
  if (m.movement !== "OUT") continue;
  if (m.inventory_category !== "In Transit") continue;

  const k = keyOf(m.item_id, m.batch_id, m.bin_location_id);

  // Untracked tuple: this GR never staged this stock through the ledger.
  if (!trackedTuples[k]) continue;

  let need = q8(m.based_qty);
  const bucket = pool[k] || [];

  for (const entry of bucket) {
    if (need <= 0) break;
    if (entry.remaining <= 0) continue;
    const take = q8(Math.min(entry.remaining, need));
    if (take <= 0) continue;
    entry.remaining = q8(entry.remaining - take);
    entry.slices.push({
      qty: take,
      to_bin: m.target_bin || null,
      to_category: m.target_category || "",
      target_doc_line_id: m.target_doc_line_id || ""
    });
    need = q8(need - take);
  }

  if (need > QTY_EPS) {
    shortages.push({
      material_id: m.item_id,
      batch_id: m.batch_id || "",
      bin_location: m.bin_location_id,
      shortage: qtyStr(need)
    });
  }
}

if (shortages.length > 0) {
  const f = shortages[0];
  return {
    transitUpdates: [], transitUpdatesLength: 0, hasTransitUpdates: 0,
    transitCreates: [], transitCreatesLength: 0, hasTransitCreates: 0,
    shortages: shortages, hasShortage: 1,
    message: "Insufficient in-transit quantity for item " + f.material_id +
      " at bin " + f.bin_location + " (short by " + f.shortage +
      "). This putaway would consume stock already claimed by another transfer order."
  };
}

const receivedDate = new Date().toISOString().split("T")[0];
const targetDocId = allData.id || "";
const targetDocNo = allData.to_id || "";

const cloneOf = (r) => ({
  doc_type: r.doc_type, doc_id: r.doc_id, doc_no: r.doc_no, doc_line_id: r.doc_line_id,
  line_no: r.line_no,
  parent_id: r.parent_id, parent_no: r.parent_no, parent_line_id: r.parent_line_id,
  material_id: r.material_id, item_code: r.item_code, item_name: r.item_name,
  item_desc: r.item_desc, item_uom: r.item_uom, batch_id: r.batch_id,
  handling_unit_id: r.handling_unit_id, plant_id: r.plant_id,
  organization_id: r.organization_id, transit_bin: r.transit_bin,
  from_plant_id: r.from_plant_id, from_bin: r.from_bin, from_category: r.from_category,
  to_plant_id: r.to_plant_id, to_category: r.to_category,
  transit_date: r.transit_date, remark: r.remark,
  source_transit_id: r.source_transit_id || r.id
});

const transitUpdates = [];
const transitCreates = [];

for (const k in pool) {
  for (const entry of pool[k]) {
    if (entry.slices.length === 0) continue;
    const r = entry.row;

    // The first slice closes the original row in place; further slices become
    // their own closed rows chained by source_transit_id, and any leftover stays
    // open. Same split shape as on_reserved_gd's partial delivery, so each
    // portion keeps its own destination bin.
    const first = entry.slices[0];
    transitUpdates.push({
      id: r.id,
      transit_qty: qtyStr(first.qty),
      received_qty: qtyStr(q8((r.received_qty || 0) + first.qty)),
      open_qty: qtyStr(0),
      status: "Received",
      received_date: receivedDate,
      to_bin: first.to_bin,
      to_category: first.to_category,
      target_doc_type: "Putaway",
      target_doc_id: targetDocId,
      target_doc_no: targetDocNo,
      target_doc_line_id: first.target_doc_line_id
    });

    for (let i = 1; i < entry.slices.length; i++) {
      const s = entry.slices[i];
      const row = cloneOf(r);
      row.to_bin = s.to_bin;
      row.to_category = s.to_category;
      row.transit_qty = qtyStr(s.qty);
      row.received_qty = qtyStr(s.qty);
      row.open_qty = qtyStr(0);
      row.status = "Received";
      row.received_date = receivedDate;
      row.target_doc_type = "Putaway";
      row.target_doc_id = targetDocId;
      row.target_doc_no = targetDocNo;
      row.target_doc_line_id = s.target_doc_line_id;
      transitCreates.push(row);
    }

    if (entry.remaining > 0) {
      const row = cloneOf(r);
      row.to_bin = null;
      row.transit_qty = qtyStr(entry.remaining);
      row.received_qty = qtyStr(0);
      row.open_qty = qtyStr(entry.remaining);
      row.status = "In Transit";
      row.received_date = null;
      row.target_doc_type = "";
      row.target_doc_id = "";
      row.target_doc_no = "";
      row.target_doc_line_id = "";
      transitCreates.push(row);
    }
  }
}

return {
  transitUpdates,
  transitUpdatesLength: transitUpdates.length,
  hasTransitUpdates: transitUpdates.length > 0 ? 1 : 0,
  transitCreates,
  transitCreatesLength: transitCreates.length,
  hasTransitCreates: transitCreates.length > 0 ? 1 : 0,
  shortages: [],
  hasShortage: 0,
  message: "In transit ledger: " + transitUpdates.length + " closed, " +
    transitCreates.length + " created"
};
