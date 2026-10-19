// Picking V2 1c - classic PICKING code_node_iES7iMKA's allocation rewrite for a pick that moves stock (its non-force,
// non-split branch, kept verbatim so temp_qty_data / view_stock come out byte-equal). Only a GD line with a moved record is
// rewritten: classic also tidied lines without a move, V2 leaves those. A moved record with no allocation entry at its
// source is refused (classic moved nothing and still recorded the pick at the target).
// IN = { records, gdLines: [{id, goods_delivery_id, material_id, picking_status, temp_qty_data, view_stock}], locations, batches, hus }
const pkMovePlan = function pkMovePlan(IN) {
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const locationNameMap = {};
  for (const loc of IN.locations || []) locationNameMap[loc.id] = loc.bin_location_combine || loc.bin_name || loc.id;
  const batchNameMap = {};
  for (const batch of IN.batches || []) batchNameMap[batch.id] = batch.batch_number || batch.id;
  const huNameMap = {};
  for (const hu of IN.hus || []) huNameMap[hu.id] = hu.handling_no || hu.id;

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

  const moves = (record) => {
    const hasLocationChange = record.source_bin && record.target_location && record.source_bin !== record.target_location;
    const hasBatchChange = record.batch_no && record.target_batch && record.batch_no !== record.target_batch;
    return !!((hasLocationChange || hasBatchChange) && (record.store_out_qty || 0) > 0);
  };

  const recordsByGdLineId = {};
  for (const record of IN.records || []) {
    if (!record.gd_line_id) continue;
    if (!recordsByGdLineId[record.gd_line_id]) recordsByGdLineId[record.gd_line_id] = [];
    recordsByGdLineId[record.gd_line_id].push(record);
  }

  const lines = [];
  const gdOrder = [];
  const gdLines = {};
  const errors = [];
  for (const lineItem of IN.gdLines || []) {
    const lineRecords = recordsByGdLineId[lineItem.id];
    if (lineItem.picking_status === 'Completed') continue;
    if (!lineRecords || !lineRecords.some(moves)) continue;

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

    let wasModified = false;
    let missing = false;
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
            if (hasLocationChange) tempQtyDataArray[sourceEntryIndex].location_id = targetLocationId;
            if (hasBatchChange) tempQtyDataArray[sourceEntryIndex].batch_id = targetBatch;
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
        } else {
          missing = true;
          errors.push({ code: "PK_MOVE_NO_ALLOCATION", gd_line_id: String(lineItem.id), item: record.item_name || record.item_code || "" });
        }
      }
    }
    if (missing) continue;

    const beforeFilter = tempQtyDataArray.length;
    tempQtyDataArray = tempQtyDataArray.filter(entry => q8(entry.gd_quantity) > 0);
    if (tempQtyDataArray.length !== beforeFilter) wasModified = true;

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
    if (!wasModified) continue;

    let uom = 'PCS';
    if (lineItem.view_stock) {
      const uomMatch = lineItem.view_stock.match(/Total:\s*[\d.]+\s+(\w+)/);
      if (uomMatch && uomMatch[1]) uom = uomMatch[1];
    }
    const gdId = String(lineItem.goods_delivery_id);
    if (!gdLines[gdId]) {
      gdLines[gdId] = [];
      gdOrder.push(gdId);
    }
    gdLines[gdId].push(String(lineItem.id));
    lines.push({
      id: String(lineItem.id),
      gd_id: gdId,
      temp_qty_data: JSON.stringify(tempQtyDataArray),
      view_stock: buildViewStock(tempQtyDataArray, uom),
      before_temp: originalTempQtyData,
      before_view: lineItem.view_stock || "",
    });
  }
  return { lines: lines, gds: gdOrder.map((g) => ({ gd_id: g, line_ids: gdLines[g] })), errors: errors };
};
