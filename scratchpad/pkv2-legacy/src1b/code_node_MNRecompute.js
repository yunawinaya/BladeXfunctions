// M:N cumulative, RECOMPUTED rather than accumulated.
//
// One GD line can be picked across several Picking documents. Accumulating it
// (read the line's running total, add this session, write it back) loses an
// addition whenever two sibling Pickings are confirmed at the same moment: the
// picking mutex is per Picking DOCUMENT, so it cannot serialise siblings.
// Counting every picking record that exists for the line is idempotent, so a
// concurrent run can no longer erase one.
//
// Safe with revert: RevertCompleted clears a reverted Picking's
// table_picking_records, so the count naturally drops with it.
const gdLines = {{node:search_node_krPmTbfL.data.data}} || [];
const _sib = {{node:sql_node_SibRecs.data}};
const siblingRecords = Array.isArray(_sib) ? _sib : _sib ? [_sib] : [];
const ownRecords = {{node:code_node_Z5JH4g2u.data.combinedRecords}} || [];
const allData = {{workflowparams:allData}};
const isForceComplete = {{workflowparams:isForceComplete}} || 0;
const locations = {{node:search_node_kUwlb6md.data.data}} || [];
const batches = {{node:search_node_kdhCN7Yu.data.data}} || [];
const hus = {{node:search_node_ko6ZYIQp.data.data}} || [];

// Force complete owns picking_status and gd_qty outright -- leave it alone.
if (isForceComplete === 1 || gdLines.length === 0) {
  return { updatedLines: [], hasUpdates: 0 };
}

const ownId = String(allData.id || "");

// Every record for this GD line, from every Picking holding one. This Picking
// contributes combinedRecords: its own stored copy is not written back until
// update_node_o19MykBA, so the sibling search would read it stale.
const recordsByLine = {};
const addRecord = (rec) => {
  const key = rec && rec.gd_line_id ? String(rec.gd_line_id) : "";
  if (!key) return;
  if (!recordsByLine[key]) recordsByLine[key] = [];
  recordsByLine[key].push(rec);
};
for (const r of siblingRecords) {
  if (String(r.sibling_id || "") === ownId) continue;
  addRecord(r);
}
for (const r of ownRecords) addRecord(r);

const locationNameMap = {};
for (const loc of locations) locationNameMap[loc.id] = loc.bin_location_combine || loc.bin_name || loc.id;
const batchNameMap = {};
for (const b of batches) batchNameMap[b.id] = b.batch_number || b.id;
const huNameMap = {};
for (const h of hus) huNameMap[h.id] = h.handling_no || h.id;

const buildViewStock = (entries, uom) => {
  const active = entries.filter((e) => (e.gd_quantity || 0) > 0);
  if (active.length === 0) return 'Total: 0 ' + uom + '\n\nDETAILS:\nNo stock allocated';
  const loose = active.filter((e) => !e.handling_unit_id);
  const huRows = active.filter((e) => e.handling_unit_id);
  const total = active.reduce((s, e) => s + (e.gd_quantity || 0), 0);
  const fmtBatch = (e) => (e.batch_id ? '\n[Batch: ' + (batchNameMap[e.batch_id] || e.batch_id) + ']' : '');
  const looseSection = loose.map((e, i) =>
    (i + 1) + '. ' + (locationNameMap[e.location_id] || e.location_id) + ': ' + e.gd_quantity + ' ' + uom + fmtBatch(e)
  ).join('\n');
  const huSection = huRows.map((e, i) =>
    (i + 1) + '. ' + (huNameMap[e.handling_unit_id] || e.handling_unit_id) + ': ' + e.gd_quantity + ' ' + uom + fmtBatch(e)
  ).join('\n');
  let out = 'Total: ' + total + ' ' + uom + '\n\n';
  if (loose.length > 0 && huRows.length > 0) out += 'LOOSE STOCK:\n' + looseSection + '\n\nHANDLING UNIT:\n' + huSection;
  else if (huRows.length > 0) out += 'HANDLING UNIT:\n' + huSection;
  else out += 'DETAILS:\n' + looseSection;
  return out;
};

const mergeKey = (locId, batchId, huId) => {
  const b = (batchId === 'undefined' || batchId === null || batchId === undefined) ? 'none' : batchId;
  return (locId || 'no-location') + '_' + b + '_' + (huId || 'no_hu');
};

// iES7iMKA already wrote every line; a line whose recount equals what it wrote needs no second write.
const writtenById = {};
for (const w of ({{node:code_node_iES7iMKA.data.updatedGdLines}} || [])) writtenById[String(w.id)] = w;
const qtyByKey = (entries) => {
  const out = {};
  for (const e of entries || []) {
    const q = Math.round((parseFloat(e.gd_quantity) || 0) * 1000);
    if (q <= 0) continue;
    const k = mergeKey(e.location_id, e.batch_id, e.handling_unit_id);
    out[k] = (out[k] || 0) + q;
  }
  return out;
};
const sameAsWritten = (id, entries, total, status) => {
  const w = writtenById[String(id)];
  if (!w || w.picking_status !== status) return false;
  if (Math.round((parseFloat(w.picked_qty) || 0) * 1000) !== Math.round(total * 1000)) return false;
  let written;
  try {
    written = typeof w.picked_temp_qty_data === 'string' ? JSON.parse(w.picked_temp_qty_data) : w.picked_temp_qty_data;
  } catch (e) {
    return false;
  }
  const a = qtyByKey(written);
  const b = qtyByKey(entries);
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);
};

const updatedLines = [];
for (const lineItem of gdLines) {
  const recs = recordsByLine[String(lineItem.id)] || [];
  if (recs.length === 0) continue;

  const merged = new Map();
  for (const rec of recs) {
    const qty = parseFloat(rec.store_out_qty) || 0;
    if (qty <= 0) continue;
    const locId = rec.target_location || rec.source_bin;
    const rawBatch = rec.target_batch || rec.batch_no || null;
    const batchId = (rawBatch === 'undefined' || rawBatch === undefined) ? null : rawBatch;
    const huId = rec.handling_unit_id || null;
    const k = mergeKey(locId, batchId, huId);
    if (merged.has(k)) {
      merged.get(k).gd_quantity += qty;
    } else {
      merged.set(k, {
        material_id: lineItem.material_id,
        location_id: locId,
        batch_id: batchId,
        handling_unit_id: huId,
        gd_quantity: qty,
        plant_id: lineItem.plant_id,
        organization_id: lineItem.organization_id
      });
    }
  }

  const mergedPicked = Array.from(merged.values());
  const totalPickedQty = Math.round(mergedPicked.reduce((s, e) => s + (e.gd_quantity || 0), 0) * 1000) / 1000;
  const planQty = parseFloat(lineItem.gd_qty || 0);

  let uom = 'PCS';
  if (lineItem.view_stock) {
    const m = lineItem.view_stock.match(/Total:\s*[\d.]+\s+(\w+)/);
    if (m && m[1]) uom = m[1];
  }

  let pickingStatus;
  if (totalPickedQty >= planQty && planQty > 0) pickingStatus = 'Completed';
  else if (totalPickedQty > 0) pickingStatus = 'In Progress';
  else pickingStatus = 'Created';

  if (sameAsWritten(lineItem.id, mergedPicked, totalPickedQty, pickingStatus)) continue;

  updatedLines.push({
    id: lineItem.id,
    picked_qty: totalPickedQty,
    picked_temp_qty_data: JSON.stringify(mergedPicked),
    picked_view_stock: buildViewStock(mergedPicked, uom),
    picking_status: pickingStatus
  });
}

return {
  updatedLines,
  hasUpdates: updatedLines.length > 0 ? 1 : 0
};
