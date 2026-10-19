// table_picking_items is a tree: an item bundle is ONE row with the items under it
// as `children`. A row with no `children` yields just itself, so a document with
// no bundles is unaffected.
const flattenPickingRows = (rows) =>
  (rows || []).flatMap((row) => [
    row,
    ...(Array.isArray(row.children) ? row.children : []),
  ]);

// Computed remainders are rounded to the 8dp column scale so float residue never survives.
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));

const gdLines = {{node:search_node_krPmTbfL.data.data}};
const newRecords = {{node:code_node_oHIIKfiw.data.records}};
const updatedItems = {{node:code_node_Z5JH4g2u.data.updatedItems}};
const locations = {{node:search_node_kUwlb6md.data.data}} || [];
const batches = {{node:search_node_kdhCN7Yu.data.data}} || [];
const hus = {{node:search_node_ko6ZYIQp.data.data}} || [];
const allData = {{workflowparams:allData}};

const isForceComplete = {{workflowparams:isForceComplete}} || 0;
const existingPickingRecords = allData.table_picking_records || [];
const allowFullPicking = ({{node:get_node_Uj1uV9PU.data.data.allow_full_picking}} || 0) === 1;

if (!gdLines || gdLines.length === 0) {
  return { code: "200", updatedGdLines: [], hasAnyChanges: false, updatedCount: 0 };
}

if (isForceComplete !== 1 && (!newRecords || newRecords.length === 0)) {
  return { code: "200", updatedGdLines: [], hasAnyChanges: false, updatedCount: 0 };
}

if (isForceComplete === 1 && existingPickingRecords.length === 0) {
  return { code: "200", updatedGdLines: [], hasAnyChanges: false, updatedCount: 0 };
}

const recordsToProcess = isForceComplete === 1 ? existingPickingRecords : newRecords;

// ============================================================================
// ITEM BUNDLES - all or nothing
// ----------------------------------------------------------------------------
// A bundle is delivered as a whole, so it has to be picked as a whole. Picking 2
// of item A and 1 of item B, when the bundle holds one of each, is not a bundle,
// and this is the last point where that can be caught before the quantities reach
// the delivery.
//
// Components are grouped by the bundle ROW they hang off rather than by the bundle
// itself, so the same bundle appearing twice on one document is judged twice -- a
// picker who finished one occurrence and left the other alone is not at fault.
//
// The rule only bites once the bundle is actually being closed out. Picking part of
// every component and saving leaves the Picking In Progress and nothing reaches the
// delivery, so that is left alone. It bites when one component is finished while
// another is short, and -- because both of these close a line whatever was picked --
// whenever anything was picked under Full Picking or Force Complete.
// Only the ITEMS under a bundle are checked. The bundle row itself carries no
// stock and never produces a picking record, so it would always read as unpicked
// and raise a shortfall against itself.
const pickingRows = flattenPickingRows(allData.table_picking_items);

// The items are grouped by the bundle ROW they hang off rather than by the bundle
// itself, so the same bundle appearing twice on one document is judged twice. A
// document that arrives flat instead -- items pointing back at the bundle row
// through parent_id -- is handled too.
const bundleGroups = {};
const bundleLabels = {};

for (const parentRow of allData.table_picking_items || []) {
  if (!parentRow || !parentRow.item_bundle_id || parentRow.item_code) continue;

  const groupKey = String(parentRow.id || parentRow.fm_key || "");
  if (!groupKey) continue;

  const nestedKids = Array.isArray(parentRow.children) ? parentRow.children : [];
  const flatKids = parentRow.id
    ? pickingRows.filter(
        (r) => r && String(r.parent_id || "") === String(parentRow.id)
      )
    : [];

  const kids = (nestedKids.length > 0 ? nestedKids : flatKids).filter(
    (r) => r && r.row_type !== "header" && r.line_status !== "Cancelled"
  );

  if (kids.length === 0) continue;

  bundleGroups[groupKey] = kids;
  bundleLabels[groupKey] = parentRow.item_name || parentRow.item_bundle_id;
}

if (Object.keys(bundleGroups).length > 0) {
  const bundlePickedById = {};
  for (const rec of recordsToProcess || []) {
    const key = String(rec.picking_item_id || "");
    if (!key) continue;
    bundlePickedById[key] = (bundlePickedById[key] || 0) + (parseFloat(rec.store_out_qty) || 0);
  }

  const closesShortLines = allowFullPicking || isForceComplete === 1;
  const bundleShortfalls = [];

  for (const key of Object.keys(bundleGroups)) {
    const state = bundleGroups[key].map((row) => {
      const pending = parseFloat(row.pending_process_qty) || 0;
      const picked = bundlePickedById[String(row.id).split("_split_")[0]] || 0;
      return { row: row, pending: pending, picked: picked, short: Math.max(0, pending - picked) };
    });

    const anyFinished = state.some((s) => s.pending > 0 && s.short === 0);
    const anyPicked = state.some((s) => s.picked > 0);

    if (!anyFinished && !(closesShortLines && anyPicked)) continue;

    for (const s of state) {
      if (s.short > 0) {
        bundleShortfalls.push(
          (bundleLabels[key] || s.row.item_bundle_id) +
            " / " + (s.row.item_name || s.row.item_code || "item") +
            ": picked " + s.picked + " of " + s.pending
        );
      }
    }
  }

  if (bundleShortfalls.length > 0) {
    return {
      code: "400",
      message:
        "An item bundle must be picked in full. Short: " +
        bundleShortfalls.join("; ") +
        ". Pick every item of the bundle to its full quantity, or none of them.",
      updatedGdLines: [],
      hasAnyChanges: false,
      updatedCount: 0,
      isForceComplete
    };
  }
}

// --- Loading Bay guard rails -------------------------------------------------
// is_loading_bay stages picked stock into a bay bin purely by rewriting
// temp_qty_data.location_id further down. The Reserved allocation only follows
// it when GD runs detectBinHuMigrations, which fires on a "Created" save and
// needs a real target bin. Fail here, before the first write node, rather than
// let either condition slip through and strand the reservation at the source.
const isLoadingBay = ({{node:get_node_Uj1uV9PU.data.data.is_loading_bay}} || 0) === 1;
const autoCompletedGd = ({{node:get_node_Uj1uV9PU.data.data.auto_completed_gd}} || 0) === 1;

if (isLoadingBay && autoCompletedGd) {
  return {
    code: "400",
    message: "Picking Setup has both Loading Bay and Auto Complete GD enabled. Auto Complete GD skips the Created state that the loading bay move depends on, which would strand the reserved stock at the source bin. Please turn off Auto Complete GD.",
    updatedGdLines: [],
    hasAnyChanges: false,
    updatedCount: 0,
    isForceComplete
  };
}

if (isLoadingBay && isForceComplete !== 1) {
  const missingTarget = [];
  for (const record of recordsToProcess) {
    if (!(record.store_out_qty > 0)) continue;
    if (record.target_location && String(record.target_location) !== String(record.source_bin)) continue;
    const label = record.item_code || record.item_name || record.gd_line_id;
    if (label && missingTarget.indexOf(label) === -1) missingTarget.push(label);
  }
  if (missingTarget.length > 0) {
    return {
      code: "400",
      message: "Loading Bay is enabled but Target Location is missing (or the same as the source bin) on these picked items: " + missingTarget.join(", ") + ". Set a loading bay bin on every picked line before completing.",
      updatedGdLines: [],
      hasAnyChanges: false,
      updatedCount: 0,
      isForceComplete
    };
  }
}

const locationNameMap = {};
for (const loc of locations) {
  locationNameMap[loc.id] = loc.bin_location_combine || loc.bin_name || loc.id;
}

const batchNameMap = {};
for (const batch of batches) {
  batchNameMap[batch.id] = batch.batch_number || batch.id;
}

// HU id -> handling_no map (for view_stock HU section display)
const huNameMap = {};
for (const hu of hus) {
  huNameMap[hu.id] = hu.handling_no || hu.id;
}

const splitData = allData.split_data || {};
for (const gdLineId in splitData) {
  const data = splitData[gdLineId];
  if (data && data.split_locations) {
    for (const loc of data.split_locations) {
      if (loc.target_location_id && loc.target_location_name) {
        locationNameMap[loc.target_location_id] = loc.target_location_name;
      }
      if (loc.location_id && loc.location_name) {
        locationNameMap[loc.location_id] = loc.location_name;
      }
      if (loc.batch_no && loc.batch_number) {
        batchNameMap[loc.batch_no] = loc.batch_number;
      }
      if (loc.target_batch && loc.batch_number) {
        batchNameMap[loc.target_batch] = loc.batch_number;
      }
    }
  }
}

const lineStatusByGdLineId = {};
const statusesByGdLineId = {};
// updatedItems arrives as a TREE (the status node rebuilds it so a bundle keeps
// its items), so it is flattened here. Reading the top level alone saw only the
// bundle ROW, whose gd_line_id/to_line_id is the bundle's own source line -- the
// components' lines were never keyed, so their status fell back to whatever the
// document already had ("Not Created") even after a full pick.
for (const item of flattenPickingRows(updatedItems)) {
  if (item.gd_line_id) {
    if (!statusesByGdLineId[item.gd_line_id]) statusesByGdLineId[item.gd_line_id] = [];
    statusesByGdLineId[item.gd_line_id].push(item.line_status);
  }
}
// A GD line can fan out into multiple picking rows (multi-batch/location).
// Aggregate so the line is Completed only when every non-cancelled row is
// Completed; In Progress if any row is picked; otherwise Open.
for (const gdLineId in statusesByGdLineId) {
  const statuses = statusesByGdLineId[gdLineId].filter(s => s !== 'Cancelled');
  if (statuses.length === 0) {
    lineStatusByGdLineId[gdLineId] = 'Cancelled';
  } else if (statuses.every(s => s === 'Completed')) {
    lineStatusByGdLineId[gdLineId] = 'Completed';
  } else if (statuses.some(s => s === 'Completed' || s === 'In Progress')) {
    lineStatusByGdLineId[gdLineId] = 'In Progress';
  } else {
    lineStatusByGdLineId[gdLineId] = 'Open';
  }
}

const recordsByGdLineId = {};
for (const record of recordsToProcess) {
  if (!record.gd_line_id) continue;
  if (!recordsByGdLineId[record.gd_line_id]) {
    recordsByGdLineId[record.gd_line_id] = [];
  }
  recordsByGdLineId[record.gd_line_id].push(record);
}

const sourceInfoByGdLineId = {};
for (const item of pickingRows) {
  if (item.gd_line_id) {
    sourceInfoByGdLineId[item.gd_line_id] = {
      source_bin: item.source_bin,
      batch_no: item.batch_no,
      item_code: item.item_code
    };
  }
}

// Build view_stock matching GDconfirmDialog.js format:
// loose entries -> "DETAILS" or "LOOSE STOCK", HU entries -> "HANDLING UNIT" with handling_no.
const buildViewStock = (entries, uom) => {
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

const updatedGdLines = [];
let hasAnyChanges = false;
// Any line whose allocation was rewritten (bin/batch move, force complete): the GD re-save must run.
let anyTempChanged = 0;
let updatedCount = 0;
const overPickedItems = [];

for (const lineItem of gdLines) {
  const lineRecords = recordsByGdLineId[lineItem.id];

  if (lineItem.picking_status === 'Completed' && isForceComplete !== 1) {
    updatedGdLines.push(lineItem);
    continue;
  }

  if (!lineRecords || lineRecords.length === 0) {
    if (isForceComplete === 1) {
      updatedGdLines.push({ ...lineItem, picking_status: 'Completed' });
    } else {
      updatedGdLines.push(lineItem);
    }
    continue;
  }

  hasAnyChanges = true;
  updatedCount++;

  const lineSplitData = splitData[lineItem.id];
  const isSplitItem = lineSplitData && lineSplitData.is_split === true;
  const sourceInfo = sourceInfoByGdLineId[lineItem.id] || {};

  const pickingStatus = lineStatusByGdLineId[lineItem.id] || lineItem.picking_status || 'Created';
  const originalTempQtyData = lineItem.temp_qty_data || '[]';

  let tempQtyDataArray = [];
  if (lineItem.temp_qty_data) {
    try {
      tempQtyDataArray = typeof lineItem.temp_qty_data === 'string'
        ? JSON.parse(lineItem.temp_qty_data)
        : (Array.isArray(lineItem.temp_qty_data) ? lineItem.temp_qty_data : []);
    } catch (e) {
      tempQtyDataArray = [];
    }
  }

  let sessionPickedQty = 0;
  for (const record of lineRecords) {
    sessionPickedQty += record.store_out_qty || 0;
  }

  const originalTotalQuantity = lineItem.gd_qty || lineItem.gd_order_quantity || 0;

  // Tracks whether tempQtyDataArray actually changed; drives cheap-path preservation
  // of the original view_stock + temp_qty_data when picking didn't shift anything.
  let wasModified = false;

  if (isForceComplete === 1) {
    tempQtyDataArray = lineRecords.map(record => ({
      material_id: record.item_code || lineItem.material_id,
      location_id: record.target_location || record.source_bin,
      batch_id: record.target_batch || record.batch_no || null,
      handling_unit_id: record.handling_unit_id || null,
      gd_quantity: record.store_out_qty
    }));
    wasModified = true;
  } else if (isSplitItem) {
    // Alt-UOM fix: split allocations arrive in the PICK UOM. Convert them to the
    // GD order UOM so gd_quantity matches gd_qty (mirrors store_out_qty).
    const __pi = pickingRows.find(
      (i) => (i.gd_line_id || i.to_line_id || (i.id ? String(i.id).split('_split_')[0] : '')) === lineItem.id
    ) || {};
    let __factor = 1;
    if (Number(__pi.order_base_qty) > 0) {
      __factor = (Number(__pi.picking_base_qty) || Number(__pi.order_base_qty) || 1) / Number(__pi.order_base_qty);
    } else if (lineRecords && lineRecords.length) {
      const __r = lineRecords.find((r) => Number(r.picked_qty_alt) > 0);
      if (__r && Number(__r.picked_qty_alt) > 0) __factor = (Number(__r.store_out_qty) || 0) / Number(__r.picked_qty_alt);
    }
    const toOrderUom = (alt) => Math.round((Number(alt) || 0) * __factor * 1000) / 1000;
    const totalProcessedQuantity = lineSplitData.split_locations.reduce(
      (sum, loc) => sum + toOrderUom(loc.allocated_quantity), 0
    );

    const remainingQuantity = originalTotalQuantity - totalProcessedQuantity;
    const locationQuantityMap = {};

    if (remainingQuantity > 0 && sourceInfo.source_bin) {
      const sourceBatchNo = sourceInfo.batch_no || null;
      const normalizedBatch = (sourceBatchNo === 'undefined' || sourceBatchNo === null || sourceBatchNo === undefined) ? null : sourceBatchNo;
      const sourceKey = sourceInfo.source_bin + '_' + (normalizedBatch || 'none');
      locationQuantityMap[sourceKey] = {
        location_id: sourceInfo.source_bin,
        batch_id: normalizedBatch,
        quantity: remainingQuantity
      };
    }

    for (const splitLoc of lineSplitData.split_locations) {
      const splitQty = toOrderUom(splitLoc.allocated_quantity);
      const targetLocationId = splitLoc.target_location_id;

      if (splitQty > 0 && targetLocationId) {
        const batchNo = splitLoc.batch_no || splitLoc.target_batch || null;
        const normalizedBatch = (batchNo === 'undefined' || batchNo === null || batchNo === undefined) ? null : batchNo;
        const targetKey = targetLocationId + '_' + (normalizedBatch || 'none');

        if (locationQuantityMap[targetKey]) {
          locationQuantityMap[targetKey].quantity += splitQty;
        } else {
          locationQuantityMap[targetKey] = {
            location_id: targetLocationId,
            batch_id: normalizedBatch,
            quantity: splitQty
          };
        }
      }
    }

    tempQtyDataArray = [];
    for (const key in locationQuantityMap) {
      const locData = locationQuantityMap[key];
      tempQtyDataArray.push({
        material_id: lineItem.material_id,
        location_id: locData.location_id,
        batch_id: locData.batch_id,
        block_qty: 0,
        reserved_qty: 0,
        unrestricted_qty: locData.quantity,
        qualityinsp_qty: 0,
        intransit_qty: 0,
        balance_quantity: locData.quantity,
        plant_id: lineItem.plant_id,
        organization_id: lineItem.organization_id,
        is_deleted: 0,
        gd_quantity: locData.quantity
      });
    }
    wasModified = true;
  } else {
    for (const record of lineRecords) {
      const sourceBinId = record.source_bin;
      const targetLocationId = record.target_location;
      const originalBatchNo = record.batch_no;
      const targetBatch = record.target_batch;
      const pickedQty = record.store_out_qty || 0;

      const hasLocationChange = sourceBinId && targetLocationId && sourceBinId !== targetLocationId;
      const hasBatchChange = originalBatchNo && targetBatch && originalBatchNo !== targetBatch;

      if ((hasLocationChange || hasBatchChange) && pickedQty > 0) {
        let sourceEntryIndex = -1;

        if (originalBatchNo) {
          sourceEntryIndex = tempQtyDataArray.findIndex(entry =>
            entry.material_id === lineItem.material_id &&
            entry.location_id === sourceBinId &&
            entry.batch_id === originalBatchNo
          );
        } else {
          sourceEntryIndex = tempQtyDataArray.findIndex(entry =>
            entry.material_id === lineItem.material_id &&
            entry.location_id === sourceBinId
          );
        }

        if (sourceEntryIndex !== -1) {
          const sourceEntry = tempQtyDataArray[sourceEntryIndex];
          const originalQuantity = sourceEntry.gd_quantity || 0;

          if (q8(pickedQty) >= q8(originalQuantity)) {
            if (hasLocationChange) {
              tempQtyDataArray[sourceEntryIndex].location_id = targetLocationId;
            }
            if (hasBatchChange) {
              tempQtyDataArray[sourceEntryIndex].batch_id = targetBatch;
            }
          } else {
            const remainingQty = q8(originalQuantity - pickedQty);

            tempQtyDataArray[sourceEntryIndex].gd_quantity = remainingQty;
            tempQtyDataArray[sourceEntryIndex].unrestricted_qty = remainingQty;
            tempQtyDataArray[sourceEntryIndex].balance_quantity = remainingQty;

            const newEntry = {
              ...sourceEntry,
              location_id: hasLocationChange ? targetLocationId : sourceBinId,
              batch_id: hasBatchChange ? targetBatch : originalBatchNo,
              gd_quantity: pickedQty,
              unrestricted_qty: pickedQty,
              balance_quantity: pickedQty
            };

            tempQtyDataArray.push(newEntry);
          }
          wasModified = true;
        }
      }
    }

    const beforeFilter = tempQtyDataArray.length;
    tempQtyDataArray = tempQtyDataArray.filter(entry => q8(entry.gd_quantity) > 0);
    if (tempQtyDataArray.length !== beforeFilter) wasModified = true;

    // Dedup key now includes handling_unit_id so HU and loose stock at the same
    // bin/batch don't collapse into one entry.
    const locationBatchMap = {};
    for (const entry of tempQtyDataArray) {
      const normalizedBatch = (entry.batch_id === 'undefined' || entry.batch_id === null || entry.batch_id === undefined) ? null : entry.batch_id;
      const huKey = entry.handling_unit_id || 'no_hu';
      const key = entry.location_id + '_' + (normalizedBatch || 'none') + '_' + huKey;

      if (locationBatchMap[key]) {
        locationBatchMap[key].gd_quantity += entry.gd_quantity || 0;
        locationBatchMap[key].unrestricted_qty += (entry.unrestricted_qty || 0);
        locationBatchMap[key].balance_quantity += (entry.balance_quantity || 0);
      } else {
        locationBatchMap[key] = { ...entry, batch_id: normalizedBatch };
      }
    }
    const beforeDedup = tempQtyDataArray.length;
    tempQtyDataArray = Object.values(locationBatchMap);
    if (tempQtyDataArray.length !== beforeDedup) wasModified = true;
  }

  let uom = 'PCS';
  if (lineItem.view_stock) {
    const uomMatch = lineItem.view_stock.match(/Total:\s*[\d.]+\s+(\w+)/);
    if (uomMatch && uomMatch[1]) {
      uom = uomMatch[1];
    }
  }

  // Cheap path: nothing actually moved, so keep the GD-built view_stock (which has
  // proper LOOSE/HU sections) and the original temp_qty_data string verbatim.
  if (wasModified) anyTempChanged = 1;
  const viewStock = wasModified
    ? buildViewStock(tempQtyDataArray, uom)
    : (lineItem.view_stock || buildViewStock(tempQtyDataArray, uom));
  const newTempQtyDataStr = wasModified ? JSON.stringify(tempQtyDataArray) : originalTempQtyData;

  const forceCompleteFields = isForceComplete === 1 ? {
    plan_qty: lineItem.gd_qty,
    plan_temp_qty_data: originalTempQtyData,
    plan_view_stock: lineItem.view_stock,
    is_force_complete: 1,
    gd_qty: sessionPickedQty,
    base_qty: sessionPickedQty,
    gd_delivered_qty: sessionPickedQty + (lineItem.gd_initial_delivered_qty || 0),
    gd_undelivered_qty: lineItem.gd_order_quantity - (sessionPickedQty + (lineItem.gd_initial_delivered_qty || 0))
  } : {};

  // M:N cumulative tracking. When allow_full_picking is ON, a single GD line can
  // be split across multiple Pickings; this block accumulates picked qty across
  // sessions on the GD line itself (mirrors PP-branch code_node_AGoxWP7x).
  let pickedQtyAddon = null;
  if (allowFullPicking && isForceComplete !== 1) {
    let existingPickedTempQtyData = [];
    if (lineItem.picked_temp_qty_data) {
      try {
        existingPickedTempQtyData = typeof lineItem.picked_temp_qty_data === 'string'
          ? JSON.parse(lineItem.picked_temp_qty_data)
          : (Array.isArray(lineItem.picked_temp_qty_data) ? lineItem.picked_temp_qty_data : []);
      } catch (e) {
        existingPickedTempQtyData = [];
      }
    }

    const sessionPickedItems = [];
    for (const record of lineRecords) {
      const pickedQty = record.store_out_qty || 0;
      if (pickedQty > 0) {
        sessionPickedItems.push({
          material_id: lineItem.material_id,
          location_id: record.target_location || record.source_bin,
          batch_id: record.target_batch || record.batch_no || null,
          handling_unit_id: record.handling_unit_id || null,
          gd_quantity: pickedQty,
          plant_id: lineItem.plant_id,
          organization_id: lineItem.organization_id
        });
      }
    }

    const mergeKey = (locId, batchId, huId) => {
      const normBatch = (batchId === 'undefined' || batchId === null || batchId === undefined) ? 'none' : batchId;
      return (locId || 'no-location') + '_' + normBatch + '_' + (huId || 'no_hu');
    };
    const mergedMap = new Map();
    const collect = (entry) => {
      const k = mergeKey(entry.location_id, entry.batch_id, entry.handling_unit_id);
      if (mergedMap.has(k)) {
        const ex = mergedMap.get(k);
        ex.gd_quantity = Math.round(((ex.gd_quantity || 0) + (entry.gd_quantity || 0)) * 1000) / 1000;
      } else {
        const normBatch = (entry.batch_id === 'undefined' || entry.batch_id === null || entry.batch_id === undefined) ? null : entry.batch_id;
        mergedMap.set(k, { ...entry, batch_id: normBatch });
      }
    };
    existingPickedTempQtyData.forEach(collect);
    sessionPickedItems.forEach(collect);
    const mergedPickedTempQtyData = Array.from(mergedMap.values());

    const totalPickedQty = Math.round(
      mergedPickedTempQtyData.reduce((sum, e) => sum + (e.gd_quantity || 0), 0) * 1000
    ) / 1000;

    const pickedViewStock = buildViewStock(mergedPickedTempQtyData, uom);

    const planQty = parseFloat(lineItem.gd_qty || 0);

    // M:N splits one GD line across sibling Pickings, and the cumulative above is a
    // read-modify-write of the line's own picked_temp_qty_data -- the picking mutex is
    // per Picking DOCUMENT, so it cannot serialise two siblings. A lost accumulation
    // makes Convert to Picking mint a follow-up for more than really remains. Mirrors
    // the PP branch (code_node_AGoxWP7x): refuse rather than over-pick silently.
    // Compared at 3dp: store_out_qty is rounded to 3dp everywhere, but summing
    // those floats can land on 10.000000000000002 and a bare `>` would then
    // block a picker who picked exactly the plan quantity.
    if (Math.round((totalPickedQty - planQty) * 1000) / 1000 > 0 && planQty > 0) {
      overPickedItems.push({
        item_name: lineItem.material_name || lineItem.item_name || lineItem.material_id || '',
        picked_qty: totalPickedQty,
        plan_qty: planQty
      });
    }

    let cumulativePickingStatus;
    if (totalPickedQty >= planQty && planQty > 0) {
      cumulativePickingStatus = 'Completed';
    } else if (totalPickedQty > 0) {
      cumulativePickingStatus = 'In Progress';
    } else {
      cumulativePickingStatus = 'Created';
    }

    pickedQtyAddon = {
      picked_qty: totalPickedQty,
      picked_temp_qty_data: JSON.stringify(mergedPickedTempQtyData),
      picked_view_stock: pickedViewStock,
      picking_status: cumulativePickingStatus
    };
  }

  updatedGdLines.push({
    ...lineItem,
    temp_qty_data: newTempQtyDataStr,
    prev_temp_qty_data: originalTempQtyData,
    view_stock: viewStock,
    picking_status: isForceComplete === 1 ? 'Completed' : pickingStatus,
    ...forceCompleteFields,
    ...(pickedQtyAddon || {})
  });
}

if (overPickedItems.length > 0) {
  const errorDetails = overPickedItems
    .map((item) => `${item.item_name} (Picked: ${item.picked_qty}, Plan: ${item.plan_qty})`)
    .join(', ');

  return {
    code: "400",
    message: `Picked quantity cannot exceed plan quantity: ${errorDetails}`,
    updatedGdLines: [],
    hasAnyChanges: false,
    updatedCount: 0,
    isForceComplete
  };
}

return {
  code: "200",
  updatedGdLines,
  hasAnyChanges,
  updatedCount,
  isForceComplete,
  anyTempChanged
};
