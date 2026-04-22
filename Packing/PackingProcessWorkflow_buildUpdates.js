// PackingProcessWorkflow — node 11: Build GD line updates
// Inlines pure helpers from PackingProcessHelpers.js. Outputs updatedGdLines
// which the next update-node writes to goods_delivery_fwii8mvb_sub.
//
// REPLACE the node references below with the actual IDs from your workflow:
//   {{node:search_node_GD_LINES.data.data}}  → GD line-items search-node
//   {{node:search_node_LOCATIONS.data.data}} → bin_location search-node
//   {{node:search_node_BATCHES.data.data}}   → batch search-node
//   {{node:search_node_HUS.data.data}}       → handling_unit search-node
//
// Fields from master records assumed (adjust selectors if your schema differs):
//   location:  .bin_location_combine || .name  (fallback to id)
//   batch:     .batch_number || .name          (fallback to id)
//   hu:        .handling_no                     (fallback to id)

const allData = {{workflowparams:allData}};
const gdLines = {{node:search_node_GD_LINES.data.data}} || [];
const locations = {{node:search_node_LOCATIONS.data.data}} || [];
const batches = {{node:search_node_BATCHES.data.data}} || [];
const hus = {{node:search_node_HUS.data.data}} || [];

const packingId = allData.id || "";

// ============================================================
// Helpers (pure, inlined from PackingProcessHelpers.js)
// ============================================================

const flattenTempData = (tempData) => {
  const out = [];
  for (const e of tempData || []) {
    if (e && e.type === "nested_hu") {
      for (const c of e.children || []) out.push(c);
    } else if (e) {
      out.push(e);
    }
  }
  return out;
};

const buildGdTempQtyPatches = (completedRows) => {
  const patches = [];
  for (const row of completedRows || []) {
    if (row.hu_row_type === "locked") continue; // Locked rows already correct
    const huId = row.handling_unit_id;
    const huBin = row.location_id;
    if (!huId || !huBin) continue;

    let entries;
    try {
      entries = JSON.parse(row.temp_data || "[]");
    } catch (_) {
      entries = [];
    }
    const flat = flattenTempData(entries);

    for (const e of flat) {
      if (!e.gd_line_id) continue;
      patches.push({
        match: {
          gd_line_id: e.gd_line_id,
          material_id: e.item_id,
          batch_id: e.batch_id || null,
          bin_location: e.location_id,
        },
        patch: {
          handling_unit_id: huId,
          bin_location: huBin,
        },
      });
    }
  }
  return patches;
};

const roundQty = (v) => parseFloat(parseFloat(v || 0).toFixed(3));

const buildViewStock = (args) => {
  const {
    tempQtyData = [],
    tempHuData = [],
    gdUom = "",
    locationMap = {},
    batchMap = {},
    huNoMap = {},
  } = args || {};

  const looseEntries = [];
  const huEntries = [];

  for (const e of tempQtyData) {
    const qty =
      parseFloat(e.gd_quantity != null ? e.gd_quantity : (e.qty != null ? e.qty : e.quantity) || 0) ||
      0;
    if (qty <= 0) continue;
    const row = {
      huId: e.handling_unit_id || "",
      batchId: e.batch_id || null,
      locationId: e.location_id,
      qty,
    };
    (row.huId ? huEntries : looseEntries).push(row);
  }

  for (const e of tempHuData) {
    const qty =
      parseFloat(
        e.deliver_quantity != null ? e.deliver_quantity : (e.qty != null ? e.qty : e.quantity) || 0,
      ) || 0;
    if (qty <= 0) continue;
    huEntries.push({
      huId: e.handling_unit_id || "",
      batchId: e.batch_id || null,
      locationId: e.location_id,
      qty,
    });
  }

  const looseTotal = roundQty(looseEntries.reduce((s, e) => s + e.qty, 0));
  const huTotal = roundQty(huEntries.reduce((s, e) => s + e.qty, 0));
  const grandTotal = roundQty(looseTotal + huTotal);

  const formatLooseLine = (e, i) => {
    const name = locationMap[e.locationId] || e.locationId || "(?)";
    let s = `${i + 1}. ${name}: ${e.qty} ${gdUom}`;
    if (e.batchId) {
      s += `\n[Batch: ${batchMap[e.batchId] || e.batchId}]`;
    }
    return s;
  };
  const formatHuLine = (e, i) => {
    const name = huNoMap[e.huId] || e.huId || "(?)";
    let s = `${i + 1}. ${name}: ${e.qty} ${gdUom}`;
    if (e.batchId) {
      s += `\n   [Batch: ${batchMap[e.batchId] || e.batchId}]`;
    }
    return s;
  };

  const hasLoose = looseEntries.length > 0;
  const hasHu = huEntries.length > 0;
  if (!hasLoose && !hasHu) return "";

  if (hasLoose && hasHu) {
    let out = `Total: ${grandTotal} ${gdUom}\n\n`;
    out += `LOOSE STOCK:\n`;
    out += looseEntries.map(formatLooseLine).join("\n");
    out += `\n\nHANDLING UNIT:\n`;
    out += huEntries.map(formatHuLine).join("\n");
    return out;
  }
  if (hasHu) {
    let out = `Total: ${huTotal} ${gdUom}\n\nHANDLING UNIT:\n`;
    out += huEntries.map(formatHuLine).join("\n");
    return out;
  }
  let out = `Total: ${looseTotal} ${gdUom}\n\nDETAILS:\n`;
  out += looseEntries.map(formatLooseLine).join("\n");
  return out;
};

// ============================================================
// Build master-data lookup maps
// ============================================================

const locationMap = {};
for (const loc of locations) {
  locationMap[loc.id] = loc.bin_location_combine || loc.name || loc.id;
}

const batchMap = {};
for (const b of batches) {
  batchMap[b.id] = b.batch_number || b.name || b.id;
}

const huNoMap = {};
for (const hu of hus) {
  huNoMap[hu.id] = hu.handling_no || hu.id;
}

// ============================================================
// Build patches, then per-line apply + rebuild view_stock
// ============================================================

const patches = buildGdTempQtyPatches(allData.table_hu || []);

// Index patches by gd_line_id
const patchesByLine = {};
for (const p of patches) {
  if (!patchesByLine[p.match.gd_line_id]) patchesByLine[p.match.gd_line_id] = [];
  patchesByLine[p.match.gd_line_id].push(p);
}

const updatedGdLines = [];

for (const line of gdLines) {
  const linePatches = patchesByLine[line.id];
  if (!linePatches || linePatches.length === 0) continue;

  const originalTempQtyData = line.temp_qty_data || "[]";

  let tqd;
  try {
    tqd = JSON.parse(originalTempQtyData);
  } catch (_) {
    tqd = [];
  }

  // Apply patches: match 4-tuple + only touch entries with empty handling_unit_id
  const updatedTqd = tqd.map((entry) => {
    const p = linePatches.find((pp) => {
      return (
        String(pp.match.material_id) === String(entry.material_id) &&
        String(pp.match.batch_id || "") === String(entry.batch_id || "") &&
        String(pp.match.bin_location || "") === String(entry.location_id || "") &&
        (!entry.handling_unit_id || entry.handling_unit_id === "")
      );
    });
    if (!p) return entry;
    return Object.assign({}, entry, {
      handling_unit_id: p.patch.handling_unit_id,
      location_id: p.patch.bin_location,
    });
  });

  // Parse temp_hu_data for view_stock (unchanged, but renders in HU section)
  let tempHuData;
  try {
    tempHuData = JSON.parse(line.temp_hu_data || "[]");
  } catch (_) {
    tempHuData = [];
  }

  const gdUom = line.item_uom_name || line.gd_order_uom || line.item_uom || "";

  const viewStock = buildViewStock({
    tempQtyData: updatedTqd,
    tempHuData,
    gdUom,
    locationMap,
    batchMap,
    huNoMap,
  });

  updatedGdLines.push({
    id: line.id,
    temp_qty_data: JSON.stringify(updatedTqd),
    prev_temp_qty_data: originalTempQtyData,
    view_stock: viewStock,
    packing_id: packingId,
  });
}

return { updatedGdLines };
