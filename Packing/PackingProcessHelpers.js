// Pure helpers for the Packing → GD reconciliation step.
// No DB, no form, no workflow wiring — inputs in, outputs out.
//
// Intended use:
//   - Inline these inside PackingProcessWorkflow's code-node, and/or
//   - Import into PackingSaveCompleted.js once wired up.
//
// Assumed GD.table_gd line shape (verify against actual schema):
//   { id, gd_qty, temp_qty_data, packing_id, ... }
//   temp_qty_data is a JSON string (or array) of:
//     { material_id, batch_id, location_id, handling_unit_id, qty, ... }
//
// Assumed packing.table_hu (DB) row shape:
//   { handling_unit_id, handling_no, hu_row_type, location_id, temp_data, ... }
//   temp_data is a JSON string of entries, each either:
//     direct  : { item_id, material_uom, location_id, batch_id, total_quantity, gd_line_id, ... }
//     nested  : { type: "nested_hu", nested_hu_id, children: [ <direct entries> ] }

/**
 * Flatten a parsed temp_data array: direct entries pass through;
 * nested_hu children are promoted to top-level.
 */
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

/**
 * Sum of packed quantity per gd_line_id across all completed packing.table_hu rows.
 * Nested HU children are included via flattenTempData.
 *
 * @param {Array} completedRows - packing.table_hu entries (DB-recorded)
 * @returns {Map<string, number>} gd_line_id → packed qty
 */
const sumPackedByGdLine = (completedRows) => {
  const map = new Map();
  for (const row of completedRows || []) {
    let entries;
    try {
      entries = JSON.parse(row.temp_data || "[]");
    } catch (_) {
      entries = [];
    }
    const flat = flattenTempData(entries);
    for (const e of flat) {
      if (!e.gd_line_id) continue;
      const prev = map.get(e.gd_line_id) || 0;
      map.set(e.gd_line_id, prev + (parseFloat(e.total_quantity) || 0));
    }
  }
  return map;
};

/**
 * Validate: every GD line is fully packed within tolerance.
 *
 * @param {Array} tableGdLines - { id, gd_qty }
 * @param {Array} completedRows - packing.table_hu entries (DB-recorded)
 * @param {number} [epsilon=0.001] - float tolerance
 * @returns {{ ok: boolean, errors: string[], shortages: Array<{gd_line_id, required, packed, shortfall}> }}
 */
const validateAllPacked = (tableGdLines, completedRows, epsilon = 0.001) => {
  const packed = sumPackedByGdLine(completedRows);
  const errors = [];
  const shortages = [];
  for (const line of tableGdLines || []) {
    const required = parseFloat(line.gd_qty) || 0;
    const actual = packed.get(line.id) || 0;
    const diff = required - actual;
    if (Math.abs(diff) > epsilon) {
      const msg =
        diff > 0
          ? `GD line ${line.id}: short-packed (required ${required}, packed ${actual})`
          : `GD line ${line.id}: over-packed (required ${required}, packed ${actual})`;
      errors.push(msg);
      shortages.push({
        gd_line_id: line.id,
        required,
        packed: actual,
        shortfall: diff,
      });
    }
  }
  return { ok: errors.length === 0, errors, shortages };
};

/**
 * Build the list of GD temp_qty_data patches from completed packing rows.
 *
 * Skips Locked rows: their handling_unit_id + bin_location were already set
 * correctly at pick time (via FULL_HU_PICK / NO_SPLIT policy in GD).
 *
 * Match key: (gd_line_id, material_id, batch_id, original_bin_location).
 * Patch:     { handling_unit_id: row.handling_unit_id, bin_location: row.location_id }
 *
 * @param {Array} completedRows - packing.table_hu entries (DB-recorded)
 * @returns {Array<{match: {...}, patch: {...}}>}
 */
const buildGdTempQtyPatches = (completedRows) => {
  const patches = [];
  for (const row of completedRows || []) {
    if (row.hu_row_type === "locked") continue;
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
          // Packing temp_data uses bin_location / batch_no (form relation field
          // names). Their stored values ARE the bin id / batch id — matches
          // what GD.temp_qty_data has under location_id / batch_id.
          batch_id: e.batch_no || null,
          bin_location: e.bin_location,
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

/**
 * Apply patches to a cloned table_gd. Does NOT mutate inputs.
 * For each matched line, its temp_qty_data entries whose 4-tuple matches a patch
 * get handling_unit_id + bin_location overwritten. Unmatched entries pass through.
 *
 * Also sets packing_id on every line that had at least one patch applied.
 *
 * @param {Array} tableGd - GD line items
 * @param {Array} patches - from buildGdTempQtyPatches
 * @param {string} packingId - the packing doc id to stamp on touched lines
 * @returns {{ tableGd: Array, touchedLineIds: string[], unmatched: Array }}
 */
const applyGdPatches = (tableGd, patches, packingId) => {
  const patchesByLine = new Map();
  for (const p of patches) {
    const arr = patchesByLine.get(p.match.gd_line_id) || [];
    arr.push(p);
    patchesByLine.set(p.match.gd_line_id, arr);
  }

  const touchedLineIds = [];
  const unmatchedSet = new Set(patches.map((_, i) => i));

  const newTableGd = (tableGd || []).map((line) => {
    const linePatches = patchesByLine.get(line.id);
    if (!linePatches || linePatches.length === 0) return line;

    const isStr = typeof line.temp_qty_data === "string";
    let tqd;
    if (isStr) {
      try {
        tqd = JSON.parse(line.temp_qty_data || "[]");
      } catch (_) {
        tqd = [];
      }
    } else {
      tqd = Array.isArray(line.temp_qty_data) ? line.temp_qty_data : [];
    }

    let anyMatched = false;
    const updatedTqd = tqd.map((entry) => {
      const idxInPatches = patches.findIndex((pp) => {
        if (pp.match.gd_line_id !== line.id) return false;
        return (
          String(pp.match.material_id) === String(entry.material_id) &&
          String(pp.match.batch_id || "") === String(entry.batch_id || "") &&
          String(pp.match.bin_location || "") ===
            String(entry.location_id || "") &&
          // Only touch entries that are still loose (no HU yet).
          (!entry.handling_unit_id || entry.handling_unit_id === "")
        );
      });
      if (idxInPatches < 0) return entry;

      unmatchedSet.delete(idxInPatches);
      anyMatched = true;
      const p = patches[idxInPatches];
      return {
        ...entry,
        handling_unit_id: p.patch.handling_unit_id,
        location_id: p.patch.bin_location,
      };
    });

    if (!anyMatched) return line;
    touchedLineIds.push(line.id);
    return {
      ...line,
      temp_qty_data: isStr ? JSON.stringify(updatedTqd) : updatedTqd,
      packing_id: packingId,
    };
  });

  const unmatched = Array.from(unmatchedSet).map((i) => patches[i]);
  return { tableGd: newTableGd, touchedLineIds, unmatched };
};

/**
 * Build the view_stock display string for a GD line, grouping by
 * handling_unit_id: entries with an HU go in the HU section regardless of
 * which array they came from (post-Packing-patch, some temp_qty_data entries
 * carry handling_unit_id and should render as HU-packed, not loose).
 *
 * Pure — takes pre-resolved lookup maps, returns string. Mirrors the client
 * formatter at GDconfirmDialog.js:515-549 but consolidated.
 *
 * Quantity is read from:
 *   tempQtyData: entry.gd_quantity || entry.qty || entry.quantity
 *   tempHuData:  entry.deliver_quantity || entry.qty || entry.quantity
 *
 * @param {Object} args
 * @param {Array}  args.tempQtyData
 * @param {Array}  args.tempHuData
 * @param {string} args.gdUom
 * @param {Object} args.locationMap  location_id → display name
 * @param {Object} args.batchMap     batch_id    → display name
 * @param {Object} args.huNoMap      handling_unit_id → handling_no
 * @returns {string}
 */
const buildViewStock = ({
  tempQtyData = [],
  tempHuData = [],
  gdUom = "",
  locationMap = {},
  batchMap = {},
  huNoMap = {},
} = {}) => {
  const roundQty = (v) => parseFloat(parseFloat(v || 0).toFixed(3));

  const looseEntries = [];
  const huEntries = [];

  for (const e of tempQtyData || []) {
    const qty =
      parseFloat(e.gd_quantity ?? e.qty ?? e.quantity ?? 0) || 0;
    if (qty <= 0) continue;
    const row = {
      huId: e.handling_unit_id || "",
      batchId: e.batch_id || null,
      locationId: e.location_id,
      qty,
    };
    (row.huId ? huEntries : looseEntries).push(row);
  }

  for (const e of tempHuData || []) {
    const qty =
      parseFloat(e.deliver_quantity ?? e.qty ?? e.quantity ?? 0) || 0;
    if (qty <= 0) continue;
    huEntries.push({
      huId: e.handling_unit_id || "",
      batchId: e.batch_id || null,
      locationId: e.location_id,
      qty,
    });
  }

  const looseTotal = roundQty(
    looseEntries.reduce((s, e) => s + e.qty, 0),
  );
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

  // loose only
  let out = `Total: ${looseTotal} ${gdUom}\n\nDETAILS:\n`;
  out += looseEntries.map(formatLooseLine).join("\n");
  return out;
};

// Export for Node / test harness. The low-code code-node will inline these.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    flattenTempData,
    sumPackedByGdLine,
    validateAllPacked,
    buildGdTempQtyPatches,
    applyGdPatches,
    buildViewStock,
  };
}
