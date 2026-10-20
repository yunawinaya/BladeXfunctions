// Picking 1d - classic PICKING code_node_iES7iMKA's allocation text (buildViewStock, verbatim apart from the name maps,
// which are passed in instead of closed over), the per-key merge and the unit read Force Complete uses
const buildViewStock = (entries, uom, names) => {
  const locationNameMap = (names && names.bins) || {};
  const batchNameMap = (names && names.batches) || {};
  const huNameMap = (names && names.hus) || {};
  const active = entries.filter(e => (e.gd_quantity || 0) > 0);
  if (active.length === 0) {
    return 'Total: 0 ' + uom + '\n\nDETAILS:\nNo stock allocated';
  }
  const looseEntries = active.filter(e => !e.handling_unit_id);
  const huEntries = active.filter(e => e.handling_unit_id);
  const total = active.reduce((s, e) => s + (e.gd_quantity || 0), 0);

  const fmtBatch = (e) => {
    if (!e.batch_id) return '';
    const name = batchNameMap[e.batch_id] || e.batch_id;
    return '\n[Batch: ' + name + ']';
  };
  const looseSection = looseEntries.map((e, i) => {
    const locName = locationNameMap[e.location_id] || e.location_id;
    return (i + 1) + '. ' + locName + ': ' + e.gd_quantity + ' ' + uom + fmtBatch(e);
  }).join('\n');
  const huSection = huEntries.map((e, i) => {
    const huName = huNameMap[e.handling_unit_id] || e.handling_unit_id;
    return (i + 1) + '. ' + huName + ': ' + e.gd_quantity + ' ' + uom + fmtBatch(e);
  }).join('\n');

  let result = 'Total: ' + total + ' ' + uom + '\n\n';
  if (looseEntries.length > 0 && huEntries.length > 0) {
    result += 'LOOSE STOCK:\n' + looseSection + '\n\nHANDLING UNIT:\n' + huSection;
  } else if (huEntries.length > 0) {
    result += 'HANDLING UNIT:\n' + huSection;
  } else {
    result += 'DETAILS:\n' + looseSection;
  }
  return result;
};

const normBatch = (b) => (b === 'undefined' || b === null || b === undefined || b === '' ? null : b);

// One entry per (bin, batch, HU), in first-seen order; gd_quantity / to_quantity summed, the first entry's other fields kept
const mergeByKey = (entries) => {
  const map = new Map();
  for (const entry of entries || []) {
    const key = entry.location_id + '_' + (normBatch(entry.batch_id) || 'none') + '_' + (entry.handling_unit_id || 'no_hu');
    if (!map.has(key)) {
      map.set(key, Object.assign({}, entry, { batch_id: normBatch(entry.batch_id) }));
      continue;
    }
    const ex = map.get(key);
    ex.gd_quantity = (Number(ex.gd_quantity) || 0) + (Number(entry.gd_quantity) || 0);
    if (ex.to_quantity !== undefined || entry.to_quantity !== undefined) ex.to_quantity = (Number(ex.to_quantity) || 0) + (Number(entry.to_quantity) || 0);
  }
  return Array.from(map.values());
};

const uomFromViewStock = (text, fallback) => {
  const m = String(text || '').match(/Total:\s*[\d.]+\s+(\w+)/);
  return (m && m[1]) || fallback || 'PCS';
};

module.exports = { buildViewStock, mergeByKey, uomFromViewStock, normBatch };
