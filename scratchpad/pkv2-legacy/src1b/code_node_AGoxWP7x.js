// table_picking_items is a tree: an item bundle is ONE row with the items under it
// as `children`. A row with no `children` yields just itself, so a document with
// no bundles is unaffected.
const flattenPickingRows = (rows) =>
  (rows || []).flatMap((row) => [
    row,
    ...(Array.isArray(row.children) ? row.children : []),
  ]);

const toLines = {{node:search_node_6FNmsgp3.data.data}};
const newRecords = {{node:code_node_Q3hWck9R.data.records}};
const updatedItems = {{node:code_node_hojzwwoL.data.updatedItems}};
const locations = {{node:search_node_apbSGyG3.data.data}} || [];
const batches = {{node:search_node_LOxCODhY.data.data}} || [];
const hus = {{node:search_node_aKzC4Dkj.data.data}} || [];
const allData = {{workflowparams:allData}};

if (!toLines || toLines.length === 0 || !newRecords || newRecords.length === 0) {
  return { code: "200", updatedToLines: [], hasAnyChanges: false, updatedCount: 0 };
}

const locationNameMap = {};
for (const loc of locations) {
  locationNameMap[loc.id] = loc.bin_location_combine || loc.bin_name || loc.id;
}

const batchNameMap = {};
for (const batch of batches) {
  batchNameMap[batch.id] = batch.batch_number || batch.id;
}

const huNameMap = {};
for (const hu of hus) {
  huNameMap[hu.id] = hu.handling_no || hu.id;
}

const splitData = allData.split_data || {};

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
  for (const rec of newRecords || []) {
    const key = String(rec.picking_item_id || "");
    if (!key) continue;
    bundlePickedById[key] = (bundlePickedById[key] || 0) + (parseFloat(rec.store_out_qty) || 0);
  }

  const closesShortLines = false;
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
      updatedToLines: [],
      hasAnyChanges: false,
      updatedCount: 0
    };
  }
}
for (const toLineId in splitData) {
  const data = splitData[toLineId];
  if (data && data.split_locations) {
    for (const loc of data.split_locations) {
      if (loc.target_location_id && loc.target_location_name) {
        locationNameMap[loc.target_location_id] = loc.target_location_name;
      }
      if (loc.batch_no && loc.batch_number) {
        batchNameMap[loc.batch_no] = loc.batch_number;
      }
    }
  }
}

const lineStatusByToLineId = {};
// updatedItems arrives as a TREE (the status node rebuilds it so a bundle keeps
// its items), so it is flattened here. Reading the top level alone saw only the
// bundle ROW, whose gd_line_id/to_line_id is the bundle's own source line -- the
// components' lines were never keyed, so their status fell back to whatever the
// document already had ("Not Created") even after a full pick.
for (const item of flattenPickingRows(updatedItems)) {
  if (item.to_line_id) {
    lineStatusByToLineId[item.to_line_id] = item.line_status;
  }
}

const recordsByToLineId = {};
for (const record of newRecords) {
  if (!record.to_line_id) continue;
  if (!recordsByToLineId[record.to_line_id]) {
    recordsByToLineId[record.to_line_id] = [];
  }
  recordsByToLineId[record.to_line_id].push(record);
}

const sourceInfoByToLineId = {};
for (const item of pickingRows) {
  if (item.to_line_id) {
    sourceInfoByToLineId[item.to_line_id] = {
      source_bin: item.source_bin,
      batch_no: item.batch_no,
      item_code: item.item_code,
      item_name: item.item_name
    };
  }
}

const extractUomFromViewStock = (viewStock) => {
  if (!viewStock) return null;
  const uomMatch = viewStock.match(/Total:\s*[\d.]+\s+(\w+)/);
  return uomMatch && uomMatch[1] ? uomMatch[1] : null;
};

// Sectioned view_stock builder: LOOSE STOCK + HANDLING UNIT (with handling_no), like GDconfirmDialog.js.
const generateViewStock = (tempQtyDataArray, uom) => {
  const active = tempQtyDataArray.filter(entry => (entry.to_quantity || 0) > 0);
  if (active.length === 0) {
    return 'Total: 0 ' + uom + '\n\nDETAILS:\nNo stock allocated';
  }
  const looseEntries = active.filter(e => !e.handling_unit_id);
  const huEntries = active.filter(e => e.handling_unit_id);
  const total = active.reduce((s, e) => s + (e.to_quantity || 0), 0);

  const fmtBatch = (e) => {
    if (!e.batch_id) return '';
    const name = batchNameMap[e.batch_id] || e.batch_id;
    return '\n[Batch: ' + name + ']';
  };
  const looseSection = looseEntries.map((e, i) => {
    const locName = locationNameMap[e.location_id] || e.location_id;
    return (i + 1) + '. ' + locName + ': ' + e.to_quantity + ' ' + uom + fmtBatch(e);
  }).join('\n');
  const huSection = huEntries.map((e, i) => {
    const huName = huNameMap[e.handling_unit_id] || e.handling_unit_id;
    return (i + 1) + '. ' + huName + ': ' + e.to_quantity + ' ' + uom + fmtBatch(e);
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

// Merge picked items keyed on location + batch + HU so HU vs loose stay separate.
const mergePickedTempQtyData = (existingPicked, newPicked) => {
  const merged = new Map();

  const generateKey = (locationId, batchId, huId) => {
    const normalizedBatch = (batchId === 'undefined' || batchId === null || batchId === undefined) ? null : batchId;
    const huKey = huId || 'no_hu';
    return (locationId || 'no-location') + '_' + (normalizedBatch || 'none') + '_' + huKey;
  };

  for (const item of existingPicked) {
    const key = generateKey(item.location_id, item.batch_id, item.handling_unit_id);
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.to_quantity = Math.round(((existing.to_quantity || 0) + (item.to_quantity || 0)) * 1000) / 1000;
    } else {
      merged.set(key, {
        ...item,
        batch_id: (item.batch_id === 'undefined' || item.batch_id === null || item.batch_id === undefined) ? null : item.batch_id
      });
    }
  }

  for (const item of newPicked) {
    const key = generateKey(item.location_id, item.batch_id, item.handling_unit_id);
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.to_quantity = Math.round(((existing.to_quantity || 0) + (item.to_quantity || 0)) * 1000) / 1000;
    } else {
      merged.set(key, {
        ...item,
        batch_id: (item.batch_id === 'undefined' || item.batch_id === null || item.batch_id === undefined) ? null : item.batch_id
      });
    }
  }

  return Array.from(merged.values());
};

// Cumulative picked qty is RECOMPUTED from every picking record that exists for the
// line, not accumulated onto the line's running total. Accumulation adds again on
// every replay: a retry after a partial failure (PK-03471/PK-03472) counted the same
// 28 twice. Counting records is idempotent. Mirrors code_node_MNRecompute (GD).
// This Picking contributes combinedRecords -- its own stored copy is not written back
// until update_node_JBvmArxy, so the sibling search would read it stale.
const __ownId = String(allData.id || "");
const allRecordsByToLineId = {};
const __addRec = (rec) => {
  const k = rec && rec.to_line_id ? String(rec.to_line_id) : "";
  if (!k) return;
  if (!allRecordsByToLineId[k]) allRecordsByToLineId[k] = [];
  allRecordsByToLineId[k].push(rec);
};
// A deleted or cancelled Picking's records are not picks: sql_node_PpSibRecs leaves them out.
const __sib = {{node:sql_node_PpSibRecs.data}};
for (const r of (Array.isArray(__sib) ? __sib : __sib ? [__sib] : [])) {
  if (String(r.sibling_id || "") === __ownId) continue;
  __addRec(r);
}
for (const r of ({{node:code_node_hojzwwoL.data.combinedRecords}} || [])) __addRec(r);

const updatedToLines = [];
let hasAnyChanges = false;
let updatedCount = 0;
const overPickedItems = [];

for (const lineItem of toLines) {
  const lineRecords = recordsByToLineId[lineItem.id];

  if (lineItem.picking_status === 'Completed') {
    updatedToLines.push(lineItem);
    continue;
  }

  if (!lineRecords || lineRecords.length === 0) {
    updatedToLines.push(lineItem);
    continue;
  }

  hasAnyChanges = true;
  updatedCount++;

  const lineSplitData = splitData[lineItem.id];
  const isSplitItem = lineSplitData && lineSplitData.is_split === true;
  const sourceInfo = sourceInfoByToLineId[lineItem.id] || {};

  const uom = extractUomFromViewStock(lineItem.view_stock) || lineItem.to_uom || 'PCS';

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

  // Every record for this line, from every Picking holding one -- see the preamble.
  const cumulativeRecords = allRecordsByToLineId[String(lineItem.id)] || [];

  let sessionPickedQty = 0;
  for (const record of lineRecords) sessionPickedQty += record.store_out_qty || 0;

  const cumulativePickedItems = [];
  for (const record of cumulativeRecords) {
    const pickedQty = parseFloat(record.store_out_qty) || 0;
    if (pickedQty <= 0) continue;
    cumulativePickedItems.push({
      material_id: lineItem.material_id,
      location_id: record.target_location || record.source_bin,
      batch_id: record.target_batch || record.batch_no || null,
      handling_unit_id: record.handling_unit_id || null,
      to_quantity: pickedQty,
      plant_id: lineItem.plant_id,
      organization_id: lineItem.organization_id
    });
  }

  const mergedPickedTempQtyData = mergePickedTempQtyData([], cumulativePickedItems);

  const totalPickedQty = Math.round(mergedPickedTempQtyData.reduce((sum, item) => sum + (item.to_quantity || 0), 0) * 1000) / 1000;

  const planQty = parseFloat(lineItem.to_qty || 0);
  // 3dp: store_out_qty is rounded to 3dp everywhere, but summing those floats can
  // land just past the plan and block a picker who picked exactly the plan qty.
  if (Math.round((totalPickedQty - planQty) * 1000) / 1000 > 0 && planQty > 0) {
    overPickedItems.push({
      item_name: lineItem.item_name || lineItem.material_name || sourceInfo.item_name || '',
      picked_qty: totalPickedQty,
      plan_qty: planQty
    });
  }

  const pickedViewStock = generateViewStock(mergedPickedTempQtyData, uom);

  const originalTotalQuantity = lineItem.to_qty || lineItem.to_order_quantity || 0;

  // Tracks whether tempQtyDataArray actually changed; drives cheap-path preservation
  // of the original view_stock + temp_qty_data when picking didn't shift anything.
  let wasModified = false;

  if (isSplitItem) {
    // Alt-UOM fix: split allocations arrive in the PICK UOM. Convert them to the
    // order UOM so to_quantity matches to_qty (mirrors store_out_qty).
    const __pi = pickingRows.find(
      (i) => (i.to_line_id || i.gd_line_id || (i.id ? String(i.id).split('_split_')[0] : '')) === lineItem.id
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
        to_quantity: locData.quantity
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
          const originalQuantity = sourceEntry.to_quantity || 0;

          if (pickedQty >= originalQuantity) {
            if (hasLocationChange) {
              tempQtyDataArray[sourceEntryIndex].location_id = targetLocationId;
            }
            if (hasBatchChange) {
              tempQtyDataArray[sourceEntryIndex].batch_id = targetBatch;
            }
          } else {
            const remainingQty = originalQuantity - pickedQty;

            tempQtyDataArray[sourceEntryIndex].to_quantity = remainingQty;
            tempQtyDataArray[sourceEntryIndex].unrestricted_qty = remainingQty;
            tempQtyDataArray[sourceEntryIndex].balance_quantity = remainingQty;

            const newEntry = {
              ...sourceEntry,
              location_id: hasLocationChange ? targetLocationId : sourceBinId,
              batch_id: hasBatchChange ? targetBatch : originalBatchNo,
              to_quantity: pickedQty,
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
    tempQtyDataArray = tempQtyDataArray.filter(entry => (entry.to_quantity || 0) > 0);
    if (tempQtyDataArray.length !== beforeFilter) wasModified = true;

    // Dedup key now includes handling_unit_id so HU and loose stock at the same
    // bin/batch don't collapse into one entry.
    const locationBatchMap = {};
    for (const entry of tempQtyDataArray) {
      const normalizedBatch = (entry.batch_id === 'undefined' || entry.batch_id === null || entry.batch_id === undefined) ? null : entry.batch_id;
      const huKey = entry.handling_unit_id || 'no_hu';
      const key = entry.location_id + '_' + (normalizedBatch || 'none') + '_' + huKey;

      if (locationBatchMap[key]) {
        locationBatchMap[key].to_quantity += entry.to_quantity || 0;
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

  // Cheap path: nothing actually moved, so keep the form-built view_stock (HU
  // sections intact) and the original temp_qty_data string verbatim.
  const viewStock = wasModified
    ? generateViewStock(tempQtyDataArray, uom)
    : (lineItem.view_stock || generateViewStock(tempQtyDataArray, uom));
  const newTempQtyDataStr = wasModified ? JSON.stringify(tempQtyDataArray) : originalTempQtyData;

  const toQty = parseFloat(lineItem.to_qty || 0);
  let pickingStatus;
  if (totalPickedQty >= toQty && toQty > 0) {
    pickingStatus = 'Completed';
  } else if (totalPickedQty > 0) {
    pickingStatus = 'In Progress';
  } else {
    pickingStatus = 'Created';
  }

  updatedToLines.push({
    ...lineItem,
    temp_qty_data: newTempQtyDataStr,
    prev_temp_qty_data: originalTempQtyData,
    view_stock: viewStock,
    picked_temp_qty_data: JSON.stringify(mergedPickedTempQtyData),
    picked_view_stock: pickedViewStock,
    picked_qty: totalPickedQty,
    picking_status: pickingStatus
  });
}

if (overPickedItems.length > 0) {
  const errorDetails = overPickedItems
    .map(item => `${item.item_name} (Picked: ${item.picked_qty}, Plan: ${item.plan_qty})`)
    .join(', ');

  return {
    code: "400",
    message: `Picked quantity cannot exceed plan quantity: ${errorDetails}`,
    updatedToLines: [],
    hasAnyChanges: false,
    updatedCount: 0
  };
}

return {
  code: "200",
  updatedToLines,
  hasAnyChanges,
  updatedCount
};
