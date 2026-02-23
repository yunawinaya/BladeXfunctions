// PP Lines Preparation - Code Node for Picking Plan Issued Workflow
// This code handles:
// 1. temp_qty_data - updates current allocation state with location changes
// 2. picked_temp_qty_data - tracks CUMULATIVE picked quantities (new)
// 3. picked_qty - total picked quantity for the line (new)
// 4. picked_view_stock - summary of picked quantities (new)
// 5. picking_status - based on picked_qty vs to_qty

// NOTE: Update these node references to match your actual workflow node IDs
const toLines = {{node:search_node_G9iYd264.data.data}};
const newRecords = {{node:code_node_xWmi2L1w.data.records}};
const updatedItems = {{node:code_node_qdF5iJK6.data.updatedItems}};
const locations = {{node:search_node_pvItsAuX.data.data}} || [];
const batches = {{node:search_node_AuqXUZZk.data.data}} || [];
const allData = {{workflowparams:allData}};

if (!toLines || toLines.length === 0 || !newRecords || newRecords.length === 0) {
  return { updatedToLines: [], hasAnyChanges: false, updatedCount: 0 };
}

// Build location name map
const locationNameMap = {};
for (const loc of locations) {
  locationNameMap[loc.id] = loc.bin_location_combine || loc.bin_name || loc.id;
}

// Build batch name map
const batchNameMap = {};
for (const batch of batches) {
  batchNameMap[batch.id] = batch.batch_number || batch.id;
}

// Also get names from split_data
const splitData = allData.split_data || {};
for (const toLineId in splitData) {
  const data = splitData[toLineId];
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

// Create map of to_line_id -> line_status from updatedItems
const lineStatusByToLineId = {};
for (const item of (updatedItems || [])) {
  if (item.to_line_id) {
    lineStatusByToLineId[item.to_line_id] = item.line_status;
  }
}

// Group records by to_line_id
const recordsByToLineId = {};
for (const record of newRecords) {
  if (!record.to_line_id) continue;
  if (!recordsByToLineId[record.to_line_id]) {
    recordsByToLineId[record.to_line_id] = [];
  }
  recordsByToLineId[record.to_line_id].push(record);
}

// Get source info from picking items
const sourceInfoByToLineId = {};
for (const item of (allData.table_picking_items || [])) {
  if (item.to_line_id) {
    sourceInfoByToLineId[item.to_line_id] = {
      source_bin: item.source_bin,
      batch_no: item.batch_no,
      item_code: item.item_code
    };
  }
}

// Helper: Generate view stock summary
const generateViewStock = (tempQtyDataArray, uom) => {
  const totalQuantity = tempQtyDataArray.reduce((sum, entry) => sum + (entry.to_quantity || 0), 0);

  let details = tempQtyDataArray
    .filter(entry => (entry.to_quantity || 0) > 0)
    .map((entry, idx) => {
      const locName = locationNameMap[entry.location_id] || entry.location_id;
      const batchName = entry.batch_id ? batchNameMap[entry.batch_id] || entry.batch_id : null;
      const batchInfo = batchName ? '\n[' + batchName + ']' : '';
      return (idx + 1) + '. ' + locName + ': ' + entry.to_quantity + ' ' + uom + batchInfo;
    })
    .join('\n');

  return 'Total: ' + totalQuantity + ' ' + uom + '\n\nDETAILS:\n' + (details || 'No stock allocated');
};

// Helper: Merge picked temp qty data (cumulative by location + batch)
const mergePickedTempQtyData = (existingPicked, newPicked) => {
  const merged = new Map();

  const generateKey = (locationId, batchId) => {
    const normalizedBatch = (batchId === 'undefined' || batchId === null || batchId === undefined) ? null : batchId;
    return (locationId || 'no-location') + '_' + (normalizedBatch || 'none');
  };

  // Process existing picked data
  for (const item of existingPicked) {
    const key = generateKey(item.location_id, item.batch_id);
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.to_quantity = (existing.to_quantity || 0) + (item.to_quantity || 0);
    } else {
      merged.set(key, {
        ...item,
        batch_id: (item.batch_id === 'undefined' || item.batch_id === null || item.batch_id === undefined) ? null : item.batch_id
      });
    }
  }

  // Process new picked data - ACCUMULATE with existing
  for (const item of newPicked) {
    const key = generateKey(item.location_id, item.batch_id);
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.to_quantity = (existing.to_quantity || 0) + (item.to_quantity || 0);
    } else {
      merged.set(key, {
        ...item,
        batch_id: (item.batch_id === 'undefined' || item.batch_id === null || item.batch_id === undefined) ? null : item.batch_id
      });
    }
  }

  return Array.from(merged.values());
};

const updatedToLines = [];
let hasAnyChanges = false;
let updatedCount = 0;

for (const lineItem of toLines) {
  const lineRecords = recordsByToLineId[lineItem.id];

  if (!lineRecords || lineRecords.length === 0) {
    updatedToLines.push(lineItem);
    continue;
  }

  hasAnyChanges = true;
  updatedCount++;

  const lineSplitData = splitData[lineItem.id];
  const isSplitItem = lineSplitData && lineSplitData.is_split === true;
  const sourceInfo = sourceInfoByToLineId[lineItem.id] || {};
  const uom = lineItem.to_uom || 'PCS';

  const originalTempQtyData = lineItem.temp_qty_data || '[]';

  // Parse existing temp_qty_data
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

  // Parse existing picked_temp_qty_data (CUMULATIVE from previous sessions)
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

  // Calculate session picked quantities from records (TARGET locations)
  let sessionPickedQty = 0;
  const sessionPickedItems = [];

  for (const record of lineRecords) {
    const pickedQty = record.store_out_qty || 0;
    sessionPickedQty += pickedQty;

    if (pickedQty > 0) {
      // Track TARGET location (where items were picked TO)
      sessionPickedItems.push({
        material_id: lineItem.material_id,
        location_id: record.target_location || record.source_bin,
        batch_id: record.target_batch || record.batch_no || null,
        to_quantity: pickedQty,
        plant_id: lineItem.plant_id,
        organization_id: lineItem.organization_id
      });
    }
  }

  // Merge session picked with existing picked (CUMULATIVE)
  const mergedPickedTempQtyData = mergePickedTempQtyData(existingPickedTempQtyData, sessionPickedItems);

  // Calculate total picked_qty from merged data
  const totalPickedQty = mergedPickedTempQtyData.reduce((sum, item) => sum + (item.to_quantity || 0), 0);

  // Generate picked_view_stock
  const pickedViewStock = generateViewStock(mergedPickedTempQtyData, uom);

  const originalTotalQuantity = lineItem.to_qty || lineItem.to_order_quantity || 0;

  // Update temp_qty_data based on split or location change logic
  if (isSplitItem) {
    // SPLIT ITEM LOGIC
    const totalProcessedQuantity = lineSplitData.split_locations.reduce(
      (sum, loc) => sum + (loc.allocated_quantity || 0), 0
    );

    const remainingQuantity = originalTotalQuantity - totalProcessedQuantity;
    const locationQuantityMap = {};

    // Add remaining quantity at source location
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

    // Add split quantities at target locations
    for (const splitLoc of lineSplitData.split_locations) {
      const splitQty = splitLoc.allocated_quantity || 0;
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

    // Rebuild temp_qty_data from location map
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
  } else {
    // NON-SPLIT LOGIC - handle location/batch changes
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

        // Find source entry in temp_qty_data
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
            // Move entire quantity - update location/batch in place
            if (hasLocationChange) {
              tempQtyDataArray[sourceEntryIndex].location_id = targetLocationId;
            }
            if (hasBatchChange) {
              tempQtyDataArray[sourceEntryIndex].batch_id = targetBatch;
            }
          } else {
            // Partial move - split the entry
            const remainingQty = originalQuantity - pickedQty;

            // Update source with remaining
            tempQtyDataArray[sourceEntryIndex].to_quantity = remainingQty;
            tempQtyDataArray[sourceEntryIndex].unrestricted_qty = remainingQty;
            tempQtyDataArray[sourceEntryIndex].balance_quantity = remainingQty;

            // Create new entry for moved quantity
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
        }
      }
    }

    // Filter out zero quantities and merge by location/batch
    tempQtyDataArray = tempQtyDataArray.filter(entry => (entry.to_quantity || 0) > 0);

    const locationBatchMap = {};
    for (const entry of tempQtyDataArray) {
      const normalizedBatch = (entry.batch_id === 'undefined' || entry.batch_id === null || entry.batch_id === undefined) ? null : entry.batch_id;
      const key = entry.location_id + '_' + (normalizedBatch || 'none');

      if (locationBatchMap[key]) {
        locationBatchMap[key].to_quantity += entry.to_quantity || 0;
        locationBatchMap[key].unrestricted_qty += entry.unrestricted_qty || 0;
        locationBatchMap[key].balance_quantity += entry.balance_quantity || 0;
      } else {
        locationBatchMap[key] = { ...entry, batch_id: normalizedBatch };
      }
    }

    tempQtyDataArray = Object.values(locationBatchMap);
  }

  // Generate view_stock for current allocation state
  const viewStock = generateViewStock(tempQtyDataArray, uom);

  // Determine picking_status based on picked_qty vs to_qty
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
    // Current allocation state
    temp_qty_data: JSON.stringify(tempQtyDataArray),
    prev_temp_qty_data: originalTempQtyData,
    view_stock: viewStock,
    // Cumulative picked tracking (NEW)
    picked_temp_qty_data: JSON.stringify(mergedPickedTempQtyData),
    picked_view_stock: pickedViewStock,
    picked_qty: totalPickedQty,
    // Status
    picking_status: pickingStatus
  });
}

return {
  updatedToLines,
  hasAnyChanges,
  updatedCount
};
