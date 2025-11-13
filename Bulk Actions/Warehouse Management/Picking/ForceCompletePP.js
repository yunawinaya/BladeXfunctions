// Bulk Action: Force Complete Picking Plan
// This action handles force completing pickings from Picking Plans with partial quantities
// It updates PP, creates inventory readjustments, reverses SO planned_qty, and updates SO statuses

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

// Helper function to safely parse JSON
const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

// Function to get FIFO cost price
const getFIFOCostPrice = async (
  materialId,
  deductionQty,
  plantId,
  locationId,
  organizationId,
  batchId = null
) => {
  try {
    const query = batchId
      ? db.collection("fifo_costing_history").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db
          .collection("fifo_costing_history")
          .where({ material_id: materialId, plant_id: plantId });

    const response = await query.get();
    const result = response.data;

    if (result && Array.isArray(result) && result.length > 0) {
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      if (!deductionQty) {
        for (const record of sortedRecords) {
          const availableQty = roundQty(record.fifo_available_quantity || 0);
          if (availableQty > 0) {
            return roundPrice(record.fifo_cost_price || 0);
          }
        }
        return roundPrice(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
      }

      let remainingQtyToDeduct = roundQty(deductionQty);
      let totalCost = 0;
      let totalDeductedQty = 0;

      for (const record of sortedRecords) {
        if (remainingQtyToDeduct <= 0) break;

        const availableQty = roundQty(record.fifo_available_quantity || 0);
        if (availableQty <= 0) continue;

        const costPrice = roundPrice(record.fifo_cost_price || 0);
        const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
        const costContribution = roundPrice(qtyToDeduct * costPrice);

        totalCost = roundPrice(totalCost + costContribution);
        totalDeductedQty = roundQty(totalDeductedQty + qtyToDeduct);
        remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
      }

      if (remainingQtyToDeduct > 0 && sortedRecords.length > 0) {
        const lastRecord = sortedRecords[sortedRecords.length - 1];
        const lastCostPrice = roundPrice(lastRecord.fifo_cost_price || 0);
        const additionalCost = roundPrice(remainingQtyToDeduct * lastCostPrice);
        totalCost = roundPrice(totalCost + additionalCost);
        totalDeductedQty = roundQty(totalDeductedQty + remainingQtyToDeduct);
      }

      if (totalDeductedQty > 0) {
        return roundPrice(totalCost / totalDeductedQty);
      }

      return roundPrice(sortedRecords[0].fifo_cost_price || 0);
    }

    return 0;
  } catch (error) {
    console.error(`Error retrieving FIFO cost price for ${materialId}:`, error);
    return 0;
  }
};

// Function to get Weighted Average cost price
const getWeightedAverageCostPrice = async (
  materialId,
  plantId,
  organizationId
) => {
  try {
    const query = db.collection("wa_costing_method").where({
      material_id: materialId,
      plant_id: plantId,
      organization_id: organizationId,
    });

    const response = await query.get();
    const waData = response.data;

    if (waData && Array.isArray(waData) && waData.length > 0) {
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      return roundPrice(waData[0].wa_cost_price || 0);
    }

    return 0;
  } catch (error) {
    console.error(`Error retrieving WA cost price for ${materialId}:`, error);
    return 0;
  }
};

// Function to get Fixed Cost price
const getFixedCostPrice = async (materialId) => {
  try {
    const query = db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;

    if (result && result.length > 0) {
      return roundPrice(parseFloat(result[0].purchase_unit_price || 0));
    }

    return 0;
  } catch (error) {
    console.error(
      `Error retrieving fixed cost price for ${materialId}:`,
      error
    );
    return 0;
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

const createTempQtyDataSummary = async (
  updatedTempQtyData,
  toLineItem,
  materialId
) => {
  // Get item data to check if it's serialized
  let isSerializedItem = false;
  let toUOM = "";

  if (materialId) {
    const resItem = await db.collection("Item").where({ id: materialId }).get();
    if (resItem.data && resItem.data[0]) {
      isSerializedItem = resItem.data[0].serial_number_management === 1;
    }
  }

  // Get UOM name
  if (toLineItem.to_order_uom_id) {
    const uomRes = await db
      .collection("unit_of_measurement")
      .where({ id: toLineItem.to_order_uom_id })
      .get();
    if (uomRes.data && uomRes.data[0]) {
      toUOM = uomRes.data[0].uom_name;
    }
  }

  // Get unique location IDs
  const locationIds = [
    ...new Set(updatedTempQtyData.map((item) => item.location_id)),
  ];

  // Get unique batch IDs (filter out null/undefined values)
  const batchIds = [
    ...new Set(
      updatedTempQtyData
        .map((item) => item.batch_id)
        .filter((batchId) => batchId != null && batchId !== "")
    ),
  ];

  // Fetch locations in parallel
  const locationPromises = locationIds.map(async (locationId) => {
    try {
      const resBinLocation = await db
        .collection("bin_location")
        .where({ id: locationId })
        .get();

      return {
        id: locationId,
        name:
          resBinLocation.data?.[0]?.bin_location_combine ||
          `Location ID: ${locationId}`,
      };
    } catch (error) {
      console.error(`Error fetching location ${locationId}:`, error);
      return { id: locationId, name: `${locationId} (Error)` };
    }
  });

  // Fetch batches in parallel (only if there are batch IDs)
  const batchPromises = batchIds.map(async (batchId) => {
    try {
      const resBatch = await db
        .collection("batch")
        .where({ id: batchId })
        .get();

      return {
        id: batchId,
        name: resBatch.data?.[0]?.batch_number || `Batch ID: ${batchId}`,
      };
    } catch (error) {
      console.error(`Error fetching batch ${batchId}:`, error);
      return { id: batchId, name: `${batchId} (Error)` };
    }
  });

  // Wait for both location and batch data
  const [locations, batches] = await Promise.all([
    Promise.all(locationPromises),
    Promise.all(batchPromises),
  ]);

  // Create lookup maps
  const locationMap = locations.reduce((map, loc) => {
    map[loc.id] = loc.name;
    return map;
  }, {});

  const batchMap = batches.reduce((map, batch) => {
    map[batch.id] = batch.name;
    return map;
  }, {});

  const totalQty = updatedTempQtyData.reduce(
    (sum, item) => sum + parseFloat(item.to_quantity || 0),
    0
  );

  let summary = `Total: ${totalQty} ${toUOM}\n\nDETAILS:\n`;

  const details = updatedTempQtyData
    .map((item, index) => {
      const locationName = locationMap[item.location_id] || item.location_id;
      const qty = item.to_quantity || 0;

      let itemDetail = `${index + 1}. ${locationName}: ${qty} ${toUOM}`;

      // Add serial number if serialized item
      if (isSerializedItem) {
        if (item.serial_number && item.serial_number.trim() !== "") {
          itemDetail += ` [Serial: ${item.serial_number.trim()}]`;
        } else {
          itemDetail += ` [Serial: NOT SET]`;
        }
      }

      // Add batch info if batch exists
      if (item.batch_id) {
        const batchName = batchMap[item.batch_id] || item.batch_id;
        if (isSerializedItem) {
          itemDetail += `\n   [Batch: ${batchName}]`;
        } else {
          itemDetail += `\n[Batch: ${batchName}]`;
        }
      }

      return itemDetail;
    })
    .join("\n");

  return summary + details;
};
const updatePickingPlanWithPickedQty = async (
  ppId,
  pickingRecords,
  pickingItems
) => {
  try {
    console.log("Starting updatePickingPlanWithPickedQty for PP:", ppId);

    // Fetch PP data
    const ppResponse = await db.collection("picking_plan").doc(ppId).get();
    if (!ppResponse.data || ppResponse.data.length === 0) {
      throw new Error(`Picking Plan ${ppId} not found`);
    }

    const ppData = ppResponse.data[0];
    console.log("PP Data fetched:", ppData);

    // Get table_to from PP data (embedded array)
    const ppLineItems = ppData.table_to || [];

    if (ppLineItems.length === 0) {
      console.log("No PP line items found in table_to");
      return { ppDataUpdated: false, ppLineItems: [] };
    }

    console.log(`Found ${ppLineItems.length} PP line items`);

    let ppDataUpdated = false;

    // Process each PP line item
    for (const ppLineItem of ppLineItems) {
      console.log(`Processing PP line item: ${ppLineItem.id}`);

      // Find ALL picking records for this line item (including qty=0)
      const allPickingRecords = pickingRecords.filter(
        (record) => record.to_line_id === ppLineItem.id
      );

      // Calculate total picked quantity from all records
      const totalPickedQty = allPickingRecords.reduce(
        (sum, record) => sum + parseFloat(record.store_out_qty || 0),
        0
      );

      console.log(
        `Line item ${ppLineItem.id}: Found ${allPickingRecords.length} picking records, total picked qty=${totalPickedQty}`
      );

      // Check if this item exists in picking items (to detect zero-picked items)
      const pickingItem = pickingItems.find(
        (item) => item.to_line_id === ppLineItem.id
      );

      // If no picking records AND no picking item exists, skip (item was never in picking)
      if (allPickingRecords.length === 0 && !pickingItem) {
        console.log(
          `Line item ${ppLineItem.id} not found in picking records or items, skipping`
        );
        continue;
      }

      // If no picking records but item exists in picking items, this is a zero-picked item
      if (allPickingRecords.length === 0 && pickingItem) {
        console.log(
          `Line item ${ppLineItem.id} found in picking items but no picking records - treating as zero-picked`
        );
        // Set totalPickedQty will remain 0, will be handled by the zero-picking logic below
      }

      // Filter to only records with picked qty > 0 for building updated temp_qty_data
      const filteredPickingRecords = allPickingRecords.filter(
        (record) => record.store_out_qty > 0
      );

      console.log(
        `Line item ${ppLineItem.id}: Original qty=${ppLineItem.to_qty}, Picked qty=${totalPickedQty}`
      );

      // Handle different picking scenarios
      if (totalPickedQty === 0) {
        // Zero picking - nothing was picked at all
        console.log(
          `Zero picking for line item ${ppLineItem.id}, marking as cancelled...`
        );

        // Store original values
        ppLineItem.plan_qty = ppLineItem.to_qty;
        ppLineItem.plan_temp_qty_data = ppLineItem.temp_qty_data;
        ppLineItem.plan_view_stock = ppLineItem.view_stock;
        ppLineItem.is_force_complete = 1;

        // Set to zero
        ppLineItem.to_qty = 0;
        ppLineItem.base_qty = 0;
        ppLineItem.temp_qty_data = JSON.stringify([]);
        ppLineItem.view_stock = "Total: 0\n\nDETAILS:\n(No items picked)";
        ppLineItem.to_delivered_qty = roundQty(
          parseFloat(ppLineItem.to_initial_delivered_qty || 0)
        );
        ppLineItem.to_undelivered_qty = roundQty(
          parseFloat(ppLineItem.to_order_quantity || 0) -
            ppLineItem.to_delivered_qty
        );
        ppLineItem.picking_status = "Cancelled"; // Mark as cancelled

        console.log(
          `Line item ${ppLineItem.id} marked as cancelled (zero picking)`
        );
        ppDataUpdated = true;
      } else if (totalPickedQty < parseFloat(ppLineItem.to_qty || 0)) {
        // Partial picking - some was picked but not all
        console.log(
          `Partial picking detected for line item ${ppLineItem.id}, updating...`
        );

        // Build new temp_qty_data from actual picked quantities only
        // Only include items that were actually picked (store_out_qty > 0)
        const updatedTempQtyData = filteredPickingRecords.map((record) => {
          // Find the original temp_qty_data item to get base_qty and other details
          const originalTempQtyData = parseJsonSafely(ppLineItem.temp_qty_data);
          const originalItem = originalTempQtyData.find((item) => {
            const locationMatch = record.source_bin === item.location_id;
            const batchMatch =
              (!record.target_batch && !item.batch_id) ||
              record.target_batch === item.batch_id;
            const serialMatch =
              (!record.serial_number && !item.serial_number) ||
              record.serial_number === item.serial_number;
            return locationMatch && batchMatch && serialMatch;
          });

          // Build temp_qty_data item with picked quantity
          const tempQtyItem = {
            location_id: record.source_bin,
            batch_id: record.target_batch || null,
            serial_number: record.serial_number || "",
            to_quantity: parseFloat(record.store_out_qty || 0),
            base_qty: originalItem
              ? parseFloat(originalItem.base_qty || record.store_out_qty)
              : parseFloat(record.store_out_qty || 0),
          };

          return tempQtyItem;
        });

        console.log("Updated temp_qty_data for line item:", updatedTempQtyData);

        // Create human-readable summary
        const viewStockSummary = await createTempQtyDataSummary(
          updatedTempQtyData,
          ppLineItem,
          ppLineItem.material_id
        );

        console.log("View stock summary:", viewStockSummary);

        // Store original values
        ppLineItem.plan_qty = ppLineItem.to_qty;
        ppLineItem.plan_temp_qty_data = ppLineItem.temp_qty_data;
        ppLineItem.plan_view_stock = ppLineItem.view_stock;
        ppLineItem.is_force_complete = 1;

        // Update with actual picked values
        ppLineItem.temp_qty_data = JSON.stringify(updatedTempQtyData);
        ppLineItem.view_stock = viewStockSummary;
        ppLineItem.to_qty = roundQty(totalPickedQty);
        ppLineItem.base_qty = ppLineItem.to_qty;
        ppLineItem.to_delivered_qty = roundQty(
          ppLineItem.to_qty +
            parseFloat(ppLineItem.to_initial_delivered_qty || 0)
        );
        ppLineItem.to_undelivered_qty = roundQty(
          parseFloat(ppLineItem.to_order_quantity || 0) -
            ppLineItem.to_delivered_qty
        );
        ppLineItem.picking_status = "Completed";

        console.log(`Updated PP line item ${ppLineItem.id} successfully`);
        ppDataUpdated = true;
      } else {
        console.log(
          `Line item ${ppLineItem.id}: Fully picked, no force complete needed`
        );

        // Just update picking_status to Completed
        ppLineItem.picking_status = "Completed";
      }
    }

    // Filter out cancelled items (items with zero picked quantity)
    const activePPLineItems = ppLineItems.filter(
      (item) => item.picking_status !== "Cancelled"
    );

    console.log(
      `Filtered PP line items: ${ppLineItems.length} total, ${
        activePPLineItems.length
      } active (${ppLineItems.length - activePPLineItems.length} cancelled)`
    );

    // Check if all ACTIVE line items are completed
    const allLineItemsCompleted = activePPLineItems.every(
      (item) => item.picking_status === "Completed"
    );

    // Update the entire PP document with only active items (cancelled items removed)
    const updateData = {
      table_to: activePPLineItems,
    };

    if (allLineItemsCompleted && activePPLineItems.length > 0) {
      updateData.picking_status = "Completed";
      updateData.to_status = "Completed";
      console.log("All active PP line items completed, updating header status");
    } else if (activePPLineItems.length === 0) {
      // All items were cancelled
      updateData.picking_status = "Cancelled";
      updateData.to_status = "Cancelled";
      console.log(
        "All PP line items cancelled, marking entire PP as cancelled"
      );
    }

    await db.collection("picking_plan").doc(ppId).update(updateData);
    console.log(
      "PP document updated with modified table_to (cancelled items removed)"
    );

    if (ppDataUpdated) {
      console.log("Picking Plan updated with partial picked quantities");
    } else {
      console.log("No partial picking detected, no updates needed");
    }

    // Return both ALL line items (including cancelled for readjustment) and active items only
    return {
      ppDataUpdated,
      ppLineItems, // All items including cancelled (for readjustment processing)
      activePPLineItems, // Only active items (for reference)
    };
  } catch (error) {
    console.error("Error in updatePickingPlanWithPickedQty:", error);
    throw error;
  }
};

// Update on_reserved_gd records to reflect actual picked quantities
const updateOnReservedForPartialPicking = async (
  ppNo,
  plantId,
  organizationId,
  ppLineItems
) => {
  try {
    console.log("Starting updateOnReservedForPartialPicking for PP:", ppNo);

    // Get existing on_reserved_gd records for this PP
    const existingReserved = await db
      .collection("on_reserved_gd")
      .where({
        doc_type: "Picking Plan",
        doc_no: ppNo,
        organization_id: organizationId,
      })
      .get();

    if (!existingReserved.data || existingReserved.data.length === 0) {
      console.log("No existing on_reserved_gd records found");
      return;
    }

    console.log(
      `Found ${existingReserved.data.length} existing on_reserved_gd records`
    );

    // Build new reserved data from actual picked quantities
    const newReservedDataBatch = [];

    for (const ppLineItem of ppLineItems) {
      // Only process items that were force completed (partial picking)
      if (ppLineItem.is_force_complete !== 1) {
        continue;
      }

      console.log(
        `Processing line item ${ppLineItem.id} for on_reserved_gd update`
      );

      // Parse the updated temp_qty_data (contains actual picked quantities)
      const temp_qty_data = parseJsonSafely(ppLineItem.temp_qty_data);

      if (!ppLineItem.material_id) {
        console.log(`Skipping line item ${ppLineItem.id}, no material`);
        continue;
      }

      // For zero-picked items, temp_qty_data will be empty
      // We still need to process them to remove on_reserved_gd records

      // Find line number for this item (1-indexed)
      const lineNo =
        ppLineItems.findIndex((item) => item.id === ppLineItem.id) + 1;

      // Get SO number from line item or header
      const soNumber = ppLineItem.line_so_no || ppLineItem.so_no;

      // Build reserved records from actual picked data
      for (const tempItem of temp_qty_data) {
        const reservedRecord = {
          doc_type: "Picking Plan",
          parent_no: soNumber,
          doc_no: ppNo,
          material_id: ppLineItem.material_id,
          item_name: ppLineItem.material_name,
          item_desc: ppLineItem.to_material_desc || "",
          batch_id: tempItem.batch_id || null,
          bin_location: tempItem.location_id,
          item_uom: ppLineItem.to_order_uom_id,
          line_no: lineNo,
          reserved_qty: tempItem.to_quantity,
          delivered_qty: 0,
          open_qty: tempItem.to_quantity,
          reserved_date: new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
          plant_id: plantId,
          organization_id: organizationId,
        };

        // Add serial number for serialized items
        if (tempItem.serial_number) {
          reservedRecord.serial_number = tempItem.serial_number;
        }

        newReservedDataBatch.push(reservedRecord);
      }
    }

    console.log(
      `Built ${newReservedDataBatch.length} new reserved records from picked quantities`
    );

    // Update strategy: Update existing records with new data, mark extras as deleted
    const updatePromises = [];

    // Update existing records with new data (up to the number of new records)
    const updateCount = Math.min(
      existingReserved.data.length,
      newReservedDataBatch.length
    );

    for (let i = 0; i < updateCount; i++) {
      const existingRecord = existingReserved.data[i];
      const newData = newReservedDataBatch[i];

      updatePromises.push(
        db.collection("on_reserved_gd").doc(existingRecord.id).update(newData)
      );
    }

    console.log(`Updating ${updateCount} existing on_reserved_gd records`);

    // If there are more existing records than new records, mark extras as deleted
    if (existingReserved.data.length > newReservedDataBatch.length) {
      for (
        let i = newReservedDataBatch.length;
        i < existingReserved.data.length;
        i++
      ) {
        const extraRecord = existingReserved.data[i];
        updatePromises.push(
          db.collection("on_reserved_gd").doc(extraRecord.id).update({
            is_deleted: 1,
          })
        );
      }
      console.log(
        `Marking ${
          existingReserved.data.length - newReservedDataBatch.length
        } extra records as deleted`
      );
    }

    // If there are more new records than existing records, create new ones
    if (newReservedDataBatch.length > existingReserved.data.length) {
      for (
        let i = existingReserved.data.length;
        i < newReservedDataBatch.length;
        i++
      ) {
        const extraData = {
          ...newReservedDataBatch[i],
          created_by: this.getVarGlobal("nickname"),
          created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        };
        updatePromises.push(db.collection("on_reserved_gd").add(extraData));
      }
      console.log(
        `Creating ${
          newReservedDataBatch.length - existingReserved.data.length
        } new records`
      );
    }

    // Execute all updates/creates/deletes in parallel
    await Promise.all(updatePromises);
    console.log("on_reserved_gd records updated successfully");
  } catch (error) {
    console.error("Error in updateOnReservedForPartialPicking:", error);
    throw error;
  }
};
// Create inventory readjustment movements for unpicked quantities
const createInventoryReadjustmentMovements = async (
  ppNo,
  ppLineItems,
  plantId,
  organizationId
) => {
  try {
    console.log("Starting createInventoryReadjustmentMovements for PP:", ppNo);

    for (const ppLineItem of ppLineItems) {
      // Only process items that were force completed (partial picking)
      if (ppLineItem.is_force_complete !== 1) {
        continue;
      }

      // Calculate unpicked quantity
      const plannedQty = parseFloat(ppLineItem.plan_qty || 0);
      const pickedQty = parseFloat(ppLineItem.to_qty || 0);
      const unpickedQty = roundQty(plannedQty - pickedQty);

      if (unpickedQty <= 0) {
        console.log(`Line item ${ppLineItem.id}: No unpicked quantity`);
        continue;
      }

      console.log(
        `Line item ${ppLineItem.id}: Unpicked qty=${unpickedQty} (planned=${plannedQty}, picked=${pickedQty})`
      );

      // Parse original temp_qty_data to get location/batch/serial details
      const originalTempQtyData = parseJsonSafely(
        ppLineItem.plan_temp_qty_data
      );
      const pickedTempQtyData = parseJsonSafely(ppLineItem.temp_qty_data);

      // Get item details for costing
      const resItem = await db
        .collection("Item")
        .where({ id: ppLineItem.material_id })
        .get();

      if (!resItem.data || resItem.data.length === 0) {
        console.log(`Item ${ppLineItem.material_id} not found`);
        continue;
      }

      const itemData = resItem.data[0];
      const isSerializedItem = itemData.serial_number_management === 1;
      const baseUOM = itemData.base_unit_of_measurement;
      const altUOM = ppLineItem.to_order_uom_id;
      const costingMethod = itemData.item_costing_method;

      // Process each original temp_qty_data to find unpicked items
      for (const originalTemp of originalTempQtyData) {
        // Calculate how much was picked from this location/batch
        const pickedFromThisLocation = pickedTempQtyData
          .filter(
            (picked) => {
              const locationMatch = picked.location_id === originalTemp.location_id;
              const batchMatch =
                (!picked.batch_id && !originalTemp.batch_id) ||
                picked.batch_id === originalTemp.batch_id;
              const serialMatch =
                !isSerializedItem ||
                (!picked.serial_number && !originalTemp.serial_number) ||
                picked.serial_number === originalTemp.serial_number;
              return locationMatch && batchMatch && serialMatch;
            }
          )
          .reduce((sum, item) => sum + parseFloat(item.to_quantity || 0), 0);

        const unpickedFromThisLocation = roundQty(
          parseFloat(originalTemp.to_quantity || 0) - pickedFromThisLocation
        );

        if (unpickedFromThisLocation <= 0) {
          continue;
        }

        console.log(
          `Creating readjustment for location ${originalTemp.location_id}, batch ${originalTemp.batch_id}, unpicked qty: ${unpickedFromThisLocation}`
        );

        // Calculate base_qty from the ratio in original temp_qty_data
        // The unpickedFromThisLocation is already in the order UOM
        // We need to calculate the corresponding base_qty
        const originalQtyInOrderUOM = parseFloat(originalTemp.to_quantity || 0);
        const originalBaseQtyFromTemp = parseFloat(
          originalTemp.base_qty || originalQtyInOrderUOM
        ); // Use base_qty if available

        // Calculate the base_qty for unpicked amount proportionally
        const baseQty =
          originalQtyInOrderUOM > 0
            ? roundQty(
                (unpickedFromThisLocation / originalQtyInOrderUOM) *
                  originalBaseQtyFromTemp
              )
            : roundQty(unpickedFromThisLocation);

        // Get costing price
        let unitPrice = 0;
        let totalPrice = 0;

        if (costingMethod === "FIFO") {
          const fifoCostPrice = await getFIFOCostPrice(
            ppLineItem.material_id,
            baseQty,
            plantId,
            originalTemp.location_id,
            organizationId,
            originalTemp.batch_id
          );
          unitPrice = roundPrice(fifoCostPrice);
          totalPrice = roundPrice(fifoCostPrice * baseQty);
        } else if (costingMethod === "Weighted Average") {
          const waCostPrice = await getWeightedAverageCostPrice(
            ppLineItem.material_id,
            plantId,
            organizationId
          );
          unitPrice = roundPrice(waCostPrice);
          totalPrice = roundPrice(waCostPrice * baseQty);
        } else if (costingMethod === "Fixed Cost") {
          const fixedCostPrice = await getFixedCostPrice(
            ppLineItem.material_id
          );
          unitPrice = roundPrice(fixedCostPrice);
          totalPrice = roundPrice(fixedCostPrice * baseQty);
        }

        // Get SO number from line item
        const soNumber = ppLineItem.line_so_no || ppLineItem.so_no;

        // Create base inventory movement data
        const baseInventoryMovement = {
          transaction_type: "PP",
          trx_no: ppNo,
          parent_trx_no: soNumber,
          unit_price: unitPrice,
          total_price: totalPrice,
          quantity: unpickedFromThisLocation,
          item_id: ppLineItem.material_id,
          uom_id: altUOM,
          base_qty: baseQty,
          base_uom_id: baseUOM,
          bin_location_id: originalTemp.location_id,
          batch_number_id: originalTemp.batch_id || null,
          costing_method_id: costingMethod,
          plant_id: plantId,
          organization_id: organizationId,
          is_deleted: 0,
        };

        // Create OUT movement from Reserved
        await db.collection("inventory_movement").add({
          ...baseInventoryMovement,
          movement: "OUT",
          inventory_category: "Reserved",
        });

        console.log(
          `Created PP OUT movement from Reserved: ${baseQty} base qty`
        );

        // Wait a bit before creating IN movement
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Create IN movement to Unrestricted
        await db.collection("inventory_movement").add({
          ...baseInventoryMovement,
          movement: "IN",
          inventory_category: "Unrestricted",
        });

        console.log(
          `Created PP-ADJ IN movement to Unrestricted: ${baseQty} base qty`
        );

        // Update balance tables based on item type
        if (isSerializedItem) {
          // For serialized items: Update aggregate item_balance (without batch_id)
          const aggregateBalanceParams = {
            material_id: ppLineItem.material_id,
            location_id: originalTemp.location_id,
            plant_id: plantId,
            organization_id: organizationId,
          };
          // Note: Don't include batch_id for aggregate balance, even if item has batches

          const aggregateBalanceQuery = await db
            .collection("item_balance")
            .where(aggregateBalanceParams)
            .get();

          if (
            aggregateBalanceQuery.data &&
            aggregateBalanceQuery.data.length > 0
          ) {
            const aggregateDoc = aggregateBalanceQuery.data[0];
            const currentUnrestrictedQty = roundQty(
              parseFloat(aggregateDoc.unrestricted_qty || 0)
            );
            const currentReservedQty = roundQty(
              parseFloat(aggregateDoc.reserved_qty || 0)
            );
            const currentBalanceQty = roundQty(
              parseFloat(aggregateDoc.balance_quantity || 0)
            );

            // Move quantity from Reserved back to Unrestricted
            const finalUnrestrictedQty = roundQty(
              currentUnrestrictedQty + baseQty
            );
            const finalReservedQty = roundQty(currentReservedQty - baseQty);
            // balance_quantity stays the same

            await db.collection("item_balance").doc(aggregateDoc.id).update({
              unrestricted_qty: finalUnrestrictedQty,
              reserved_qty: finalReservedQty,
              balance_quantity: currentBalanceQty,
            });

            console.log(
              `Updated aggregate item_balance for serialized item: moved ${baseQty} from Reserved (${currentReservedQty}→${finalReservedQty}) to Unrestricted (${currentUnrestrictedQty}→${finalUnrestrictedQty})`
            );
          } else {
            console.warn(
              `Aggregate item_balance not found for serialized item ${ppLineItem.material_id} at location ${originalTemp.location_id}`
            );
          }
        } else {
          // For non-serialized items: Update item_balance or item_batch_balance
          const itemBalanceParams = {
            material_id: ppLineItem.material_id,
            location_id: originalTemp.location_id,
            plant_id: plantId,
            organization_id: organizationId,
          };

          if (originalTemp.batch_id) {
            itemBalanceParams.batch_id = originalTemp.batch_id;
          }

          const balanceCollection = originalTemp.batch_id
            ? "item_batch_balance"
            : "item_balance";

          const balanceQuery = await db
            .collection(balanceCollection)
            .where(itemBalanceParams)
            .get();

          if (balanceQuery.data && balanceQuery.data.length > 0) {
            const existingDoc = balanceQuery.data[0];
            const currentUnrestrictedQty = roundQty(
              parseFloat(existingDoc.unrestricted_qty || 0)
            );
            const currentReservedQty = roundQty(
              parseFloat(existingDoc.reserved_qty || 0)
            );

            // Move quantity from Reserved back to Unrestricted
            const finalUnrestrictedQty = roundQty(
              currentUnrestrictedQty + baseQty
            );
            const finalReservedQty = roundQty(currentReservedQty - baseQty);

            await db.collection(balanceCollection).doc(existingDoc.id).update({
              unrestricted_qty: finalUnrestrictedQty,
              reserved_qty: finalReservedQty,
            });

            console.log(
              `Updated ${balanceCollection}: moved ${baseQty} from Reserved (${currentReservedQty}→${finalReservedQty}) to Unrestricted (${currentUnrestrictedQty}→${finalUnrestrictedQty})`
            );

            // For batch items, also update aggregate item_balance
            if (
              balanceCollection === "item_batch_balance" &&
              originalTemp.batch_id
            ) {
              const aggregateBatchBalanceParams = {
                material_id: ppLineItem.material_id,
                location_id: originalTemp.location_id,
                plant_id: plantId,
                organization_id: organizationId,
              };
              // Don't include batch_id for aggregate balance

              const aggregateBatchBalanceQuery = await db
                .collection("item_balance")
                .where(aggregateBatchBalanceParams)
                .get();

              if (
                aggregateBatchBalanceQuery.data &&
                aggregateBatchBalanceQuery.data.length > 0
              ) {
                const aggregateBatchDoc = aggregateBatchBalanceQuery.data[0];
                const currentAggUnrestrictedQty = roundQty(
                  parseFloat(aggregateBatchDoc.unrestricted_qty || 0)
                );
                const currentAggReservedQty = roundQty(
                  parseFloat(aggregateBatchDoc.reserved_qty || 0)
                );
                const currentAggBalanceQty = roundQty(
                  parseFloat(aggregateBatchDoc.balance_quantity || 0)
                );

                // Move from Reserved back to Unrestricted
                const finalAggUnrestrictedQty = roundQty(
                  currentAggUnrestrictedQty + baseQty
                );
                const finalAggReservedQty = roundQty(
                  currentAggReservedQty - baseQty
                );

                await db
                  .collection("item_balance")
                  .doc(aggregateBatchDoc.id)
                  .update({
                    unrestricted_qty: finalAggUnrestrictedQty,
                    reserved_qty: finalAggReservedQty,
                    balance_quantity: currentAggBalanceQty,
                  });

                console.log(
                  `Updated aggregate item_balance for batch item: moved ${baseQty} from Reserved (${currentAggReservedQty}→${finalAggReservedQty}) to Unrestricted (${currentAggUnrestrictedQty}→${finalAggUnrestrictedQty})`
                );
              } else {
                console.warn(
                  `Aggregate item_balance not found for batch item ${ppLineItem.material_id} at location ${originalTemp.location_id}`
                );
              }
            }
          } else {
            console.warn(
              `${balanceCollection} record not found for material ${ppLineItem.material_id} at location ${originalTemp.location_id}`
            );
          }
        }

        // Handle serialized items - create inv_serial_movement records
        if (isSerializedItem && originalTemp.serial_number) {
          // Query the movements we just created
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Get OUT movement ID
          const outMovementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: "PP",
              trx_no: ppNo,
              parent_trx_no: soNumber,
              movement: "OUT",
              inventory_category: "Reserved",
              item_id: ppLineItem.material_id,
              bin_location_id: originalTemp.location_id,
              base_qty: baseQty,
            })
            .get();

          let outMovementId = null;
          if (outMovementQuery.data && outMovementQuery.data.length > 0) {
            outMovementId = outMovementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;
          }

          // Get IN movement ID
          const inMovementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: "PP",
              trx_no: ppNo,
              parent_trx_no: soNumber,
              movement: "IN",
              inventory_category: "Unrestricted",
              item_id: ppLineItem.material_id,
              bin_location_id: originalTemp.location_id,
              base_qty: baseQty,
            })
            .get();

          let inMovementId = null;
          if (inMovementQuery.data && inMovementQuery.data.length > 0) {
            inMovementId = inMovementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;
          }

          // Create inv_serial_movement records if we have movement IDs
          if (outMovementId && inMovementId) {
            const serialNumbers = originalTemp.serial_number
              .split("\n")
              .map((sn) => sn.trim())
              .filter((sn) => sn !== "");

            for (const serialNumber of serialNumbers) {
              // OUT serial movement
              await db.collection("inv_serial_movement").add({
                inventory_movement_id: outMovementId,
                serial_number: serialNumber,
                item_id: ppLineItem.material_id,
                batch_id: originalTemp.batch_id || null,
                bin_location_id: originalTemp.location_id,
                movement: "OUT",
                inventory_category: "Reserved",
              });

              // IN serial movement
              await db.collection("inv_serial_movement").add({
                inventory_movement_id: inMovementId,
                serial_number: serialNumber,
                item_id: ppLineItem.material_id,
                batch_id: originalTemp.batch_id || null,
                bin_location_id: originalTemp.location_id,
                movement: "IN",
                inventory_category: "Unrestricted",
              });
            }

            console.log(
              `Created inv_serial_movement records for ${serialNumbers.length} serial numbers`
            );

            // Update item_serial_balance for each serial number
            for (const serialNumber of serialNumbers) {
              const serialBalanceParams = {
                material_id: ppLineItem.material_id,
                serial_number: serialNumber,
                plant_id: plantId,
                organization_id: organizationId,
                location_id: originalTemp.location_id,
              };

              // Add batch_id if item has batch management
              if (originalTemp.batch_id) {
                serialBalanceParams.batch_id = originalTemp.batch_id;
              }

              const serialBalanceQuery = await db
                .collection("item_serial_balance")
                .where(serialBalanceParams)
                .get();

              if (
                serialBalanceQuery.data &&
                serialBalanceQuery.data.length > 0
              ) {
                const serialDoc = serialBalanceQuery.data[0];
                const currentUnrestrictedQty = roundQty(
                  parseFloat(serialDoc.unrestricted_qty || 0)
                );
                const currentReservedQty = roundQty(
                  parseFloat(serialDoc.reserved_qty || 0)
                );

                // Move 1 unit from Reserved back to Unrestricted (serial = 1 qty)
                const finalUnrestrictedQty = roundQty(
                  currentUnrestrictedQty + 1
                );
                const finalReservedQty = roundQty(currentReservedQty - 1);

                await db
                  .collection("item_serial_balance")
                  .doc(serialDoc.id)
                  .update({
                    unrestricted_qty: finalUnrestrictedQty,
                    reserved_qty: finalReservedQty,
                  });

                console.log(
                  `Updated item_serial_balance for ${serialNumber}: Reserved ${currentReservedQty}→${finalReservedQty}, Unrestricted ${currentUnrestrictedQty}→${finalUnrestrictedQty}`
                );
              } else {
                console.warn(
                  `item_serial_balance not found for serial ${serialNumber}`
                );
              }
            }
          }
        }
      }
    }

    console.log("Inventory readjustment movements created successfully");
  } catch (error) {
    console.error("Error in createInventoryReadjustmentMovements:", error);
    throw error;
  }
};
// Reverse unrealized planned_qty in Sales Orders
const reversePlannedQtyInSO = async (ppLineItems) => {
  try {
    console.log("Starting reversePlannedQtyInSO");

    // Group line items by SO ID
    const soGrouped = {};

    for (const ppLineItem of ppLineItems) {
      // Only process items that were force completed (partial picking)
      if (ppLineItem.is_force_complete !== 1) {
        continue;
      }

      // PP line item fields: line_so_id (SO header ID), so_line_item_id (SO line item ID)
      const soId = ppLineItem.line_so_id;
      const soLineId = ppLineItem.so_line_item_id;

      if (!soId || !soLineId) {
        console.log(
          `Line item ${ppLineItem.id}: Missing SO ID (${soId}) or SO Line ID (${soLineId})`
        );
        continue;
      }

      // Calculate unrealized quantity (planned but not picked)
      const plannedQty = parseFloat(ppLineItem.plan_qty || 0);
      const pickedQty = parseFloat(ppLineItem.to_qty || 0);
      const unrealizedQty = roundQty(plannedQty - pickedQty);

      if (unrealizedQty <= 0) {
        console.log(`Line item ${ppLineItem.id}: No unrealized quantity`);
        continue;
      }

      console.log(
        `Line item ${ppLineItem.id}: Unrealized qty=${unrealizedQty} (planned=${plannedQty}, picked=${pickedQty})`
      );

      // Group by SO ID
      if (!soGrouped[soId]) {
        soGrouped[soId] = [];
      }

      soGrouped[soId].push({
        soLineId: soLineId,
        unrealizedQty: unrealizedQty,
        ppLineItemId: ppLineItem.id,
      });
    }

    // Process each SO line item directly
    for (const soId of Object.keys(soGrouped)) {
      console.log(
        `Processing SO: ${soId} with ${soGrouped[soId].length} line items`
      );

      // Update each SO line item
      for (const item of soGrouped[soId]) {
        try {
          // Fetch the SO line item by ID
          const soLineItemResponse = await db
            .collection("sales_order_axszx8cj_sub")
            .where({ id: item.soLineId })
            .get();

          if (
            !soLineItemResponse.data ||
            soLineItemResponse.data.length === 0
          ) {
            console.log(`SO line item ${item.soLineId} not found`);
            continue;
          }

          const soLineItem = soLineItemResponse.data[0];

          // Reverse the unrealized planned_qty
          const currentPlannedQty = parseFloat(soLineItem.planned_qty || 0);
          const newPlannedQty = roundQty(
            currentPlannedQty - item.unrealizedQty
          );

          console.log(
            `SO line ${item.soLineId}: Current planned_qty=${currentPlannedQty}, Unrealized=${item.unrealizedQty}, New planned_qty=${newPlannedQty}`
          );

          // Update the SO line item
          await db
            .collection("sales_order_axszx8cj_sub")
            .doc(item.soLineId)
            .update({
              planned_qty: newPlannedQty,
            });

          console.log(
            `Updated SO line ${item.soLineId} planned_qty to ${newPlannedQty}`
          );
        } catch (error) {
          console.error(`Error updating SO line item ${item.soLineId}:`, error);
        }
      }

      console.log(`Completed reversing planned_qty for SO ${soId}`);
    }

    console.log("Successfully reversed planned_qty in all affected SOs");
  } catch (error) {
    console.error("Error in reversePlannedQtyInSO:", error);
    throw error;
  }
};
// Update Sales Order header to_status based on planned_qty vs so_quantity
// Accepts either soGrouped object or array of SO IDs
const updateSOHeaderStatus = async (soIds) => {
  try {
    console.log("Starting updateSOHeaderStatus");

    // Handle both object (from soGrouped) and array (from PP line items)
    const soIdArray = Array.isArray(soIds) ? soIds : Object.keys(soIds);

    for (const soId of soIdArray) {
      // Fetch all line items for this SO
      const soResponse = await db
        .collection("sales_order")
        .where({ id: soId })
        .get();

      if (!soResponse.data || soResponse.data.length === 0) {
        console.log(`Sales Order ${soId} not found`);
        continue;
      }

      const soData = soResponse.data[0];
      const soLineItems = soData.table_so || [];

      if (soLineItems.length === 0) {
        console.log(`No line items found for SO ${soId}`);
        continue;
      }

      // Check if all line items are fully planned
      const allFullyPlanned = soLineItems.every((lineItem) => {
        const soQuantity = parseFloat(lineItem.so_quantity || 0);
        const plannedQty = parseFloat(lineItem.planned_qty || 0);
        return plannedQty >= soQuantity;
      });

      // Determine new to_status
      let newToStatus;
      if (allFullyPlanned) {
        newToStatus = "Completed";
        console.log(
          `SO ${soId}: All items fully planned, setting to_status=Completed`
        );
      } else {
        // Check if any items have been partially planned
        const anyPlanned = soLineItems.some((lineItem) => {
          const plannedQty = parseFloat(lineItem.planned_qty || 0);
          return plannedQty > 0;
        });

        if (anyPlanned) {
          newToStatus = "In Progress";
          console.log(
            `SO ${soId}: Some items planned, setting to_status=In Progress`
          );
        } else {
          // No items planned at all, keep original status or set to null
          console.log(
            `SO ${soId}: No items planned, keeping original to_status`
          );
          continue; // Don't update
        }
      }

      // Update SO header
      await db.collection("sales_order").doc(soId).update({
        to_status: newToStatus,
      });

      console.log(`Updated SO ${soId} to_status to ${newToStatus}`);
    }

    console.log("Successfully updated SO header statuses");
  } catch (error) {
    console.error("Error in updateSOHeaderStatus:", error);
    throw error;
  }
};

// Handle loading bay inventory movement - move Reserved inventory from source to target location
const handleLoadingBayInventoryMovement = async (
  ppData,
  ppNo,
  ppId,
  pickingItems,
  plantId,
  organizationId
) => {
  try {
    console.log("Starting handleLoadingBayInventoryMovement for PP:", ppNo);

    const ppTableTo = ppData.table_to || [];

    console.log(`Found Picking Plan: ID=${ppId}, to_no=${ppNo}`);

    // Create a map of picking items by to_line_id for quick lookup
    const pickingItemsMap = {};
    for (const pickingItem of pickingItems) {
      pickingItemsMap[pickingItem.to_line_id] = pickingItem;
    }

    // Process each PP line item
    for (const ppLineItem of ppTableTo) {
      const pickingItem = pickingItemsMap[ppLineItem.id];

      if (!pickingItem) {
        console.log(
          `No picking item found for PP line item ${ppLineItem.id}, skipping`
        );
        continue;
      }

      const targetLocation = pickingItem.target_location;

      if (!targetLocation) {
        console.log(
          `No target location for PP line item ${ppLineItem.id}, skipping`
        );
        continue;
      }

      console.log(
        `Processing PP line item ${ppLineItem.id} - moving to target location ${targetLocation}`
      );

      // Parse temp_qty_data
      const tempQtyData = parseJsonSafely(ppLineItem.temp_qty_data);

      if (!tempQtyData || tempQtyData.length === 0) {
        console.log(
          `No temp_qty_data for line item ${ppLineItem.id}, skipping`
        );
        continue;
      }

      // Get item details for costing and type checking
      const resItem = await db
        .collection("Item")
        .where({ id: ppLineItem.material_id })
        .get();

      if (!resItem.data || resItem.data.length === 0) {
        console.log(`Item ${ppLineItem.material_id} not found, skipping`);
        continue;
      }

      const itemData = resItem.data[0];
      const isSerializedItem = itemData.serial_number_management === 1;
      const baseUOM = itemData.base_unit_of_measurement;
      const altUOM = ppLineItem.to_order_uom_id;
      const costingMethod = itemData.item_costing_method;

      // Get SO number from line item
      const soNumber = ppLineItem.line_so_no || ppLineItem.so_no;

      // Process each temp_qty_data item (each location/batch/serial)
      const updatedTempQtyData = [];

      for (const tempItem of tempQtyData) {
        const sourceLocation = tempItem.location_id;
        const batchId = tempItem.batch_id || null;
        const quantityInOrderUOM = parseFloat(tempItem.to_quantity || 0);
        const baseQty = parseFloat(tempItem.base_qty || quantityInOrderUOM);

        console.log(
          `Moving ${baseQty} base qty from location ${sourceLocation} to ${targetLocation}`
        );

        // Get costing price
        let unitPrice = 0;
        let totalPrice = 0;

        if (costingMethod === "FIFO") {
          const fifoCostPrice = await getFIFOCostPrice(
            ppLineItem.material_id,
            baseQty,
            plantId,
            sourceLocation,
            organizationId,
            batchId
          );
          unitPrice = roundPrice(fifoCostPrice);
          totalPrice = roundPrice(fifoCostPrice * baseQty);
        } else if (costingMethod === "Weighted Average") {
          const waCostPrice = await getWeightedAverageCostPrice(
            ppLineItem.material_id,
            plantId,
            organizationId
          );
          unitPrice = roundPrice(waCostPrice);
          totalPrice = roundPrice(waCostPrice * baseQty);
        } else if (costingMethod === "Fixed Cost") {
          const fixedCostPrice = await getFixedCostPrice(
            ppLineItem.material_id
          );
          unitPrice = roundPrice(fixedCostPrice);
          totalPrice = roundPrice(fixedCostPrice * baseQty);
        }

        // Create base inventory movement data
        const baseInventoryMovement = {
          transaction_type: "TO - PICK",
          trx_no: ppNo,
          parent_trx_no: soNumber,
          unit_price: unitPrice,
          total_price: totalPrice,
          quantity: quantityInOrderUOM,
          item_id: ppLineItem.material_id,
          uom_id: altUOM,
          base_qty: baseQty,
          base_uom_id: baseUOM,
          batch_number_id: batchId,
          costing_method_id: costingMethod,
          plant_id: plantId,
          organization_id: organizationId,
          is_deleted: 0,
        };

        // Create OUT movement from source Reserved
        await db.collection("inventory_movement").add({
          ...baseInventoryMovement,
          movement: "OUT",
          inventory_category: "Reserved",
          bin_location_id: sourceLocation,
        });

        console.log(
          `Created OUT movement from Reserved at ${sourceLocation}: ${baseQty} base qty`
        );

        // Wait before creating IN movement
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Create IN movement to target Reserved
        await db.collection("inventory_movement").add({
          ...baseInventoryMovement,
          movement: "IN",
          inventory_category: "Reserved",
          bin_location_id: targetLocation,
        });

        console.log(
          `Created IN movement to Reserved at ${targetLocation}: ${baseQty} base qty`
        );

        // Update balance tables based on item type
        if (isSerializedItem) {
          // For serialized items: Update aggregate item_balance (without batch_id)
          // Update source location - decrement Reserved
          const sourceBalanceParams = {
            material_id: ppLineItem.material_id,
            location_id: sourceLocation,
            plant_id: plantId,
            organization_id: organizationId,
          };

          const sourceBalanceQuery = await db
            .collection("item_balance")
            .where(sourceBalanceParams)
            .get();

          if (sourceBalanceQuery.data && sourceBalanceQuery.data.length > 0) {
            const sourceDoc = sourceBalanceQuery.data[0];
            const currentReservedQty = roundQty(
              parseFloat(sourceDoc.reserved_qty || 0)
            );
            const currentBalanceQty = roundQty(
              parseFloat(sourceDoc.balance_quantity || 0)
            );

            const finalReservedQty = roundQty(currentReservedQty - baseQty);
            const finalBalanceQty = roundQty(currentBalanceQty - baseQty);

            await db.collection("item_balance").doc(sourceDoc.id).update({
              reserved_qty: finalReservedQty,
              balance_quantity: finalBalanceQty,
            });

            console.log(
              `Updated source item_balance: Reserved ${currentReservedQty}→${finalReservedQty}, Balance ${currentBalanceQty}→${finalBalanceQty}`
            );
          }

          // Update target location - increment Reserved
          const targetBalanceParams = {
            material_id: ppLineItem.material_id,
            location_id: targetLocation,
            plant_id: plantId,
            organization_id: organizationId,
          };

          const targetBalanceQuery = await db
            .collection("item_balance")
            .where(targetBalanceParams)
            .get();

          if (targetBalanceQuery.data && targetBalanceQuery.data.length > 0) {
            const targetDoc = targetBalanceQuery.data[0];
            const currentReservedQty = roundQty(
              parseFloat(targetDoc.reserved_qty || 0)
            );
            const currentBalanceQty = roundQty(
              parseFloat(targetDoc.balance_quantity || 0)
            );

            const finalReservedQty = roundQty(currentReservedQty + baseQty);
            const finalBalanceQty = roundQty(currentBalanceQty + baseQty);

            await db.collection("item_balance").doc(targetDoc.id).update({
              reserved_qty: finalReservedQty,
              balance_quantity: finalBalanceQty,
            });

            console.log(
              `Updated target item_balance: Reserved ${currentReservedQty}→${finalReservedQty}, Balance ${currentBalanceQty}→${finalBalanceQty}`
            );
          } else {
            // Create new item_balance record for target location
            await db.collection("item_balance").add({
              material_id: ppLineItem.material_id,
              location_id: targetLocation,
              plant_id: plantId,
              organization_id: organizationId,
              reserved_qty: baseQty,
              unrestricted_qty: 0,
              balance_quantity: baseQty,
            });

            console.log(
              `Created new item_balance at target location with Reserved ${baseQty}`
            );
          }
        } else {
          // For non-serialized items: Update item_balance or item_batch_balance
          const balanceCollection = batchId
            ? "item_batch_balance"
            : "item_balance";

          // Update source location
          const sourceBalanceParams = {
            material_id: ppLineItem.material_id,
            location_id: sourceLocation,
            plant_id: plantId,
            organization_id: organizationId,
          };

          if (batchId) {
            sourceBalanceParams.batch_id = batchId;
          }

          const sourceBalanceQuery = await db
            .collection(balanceCollection)
            .where(sourceBalanceParams)
            .get();

          if (sourceBalanceQuery.data && sourceBalanceQuery.data.length > 0) {
            const sourceDoc = sourceBalanceQuery.data[0];
            const currentReservedQty = roundQty(
              parseFloat(sourceDoc.reserved_qty || 0)
            );
            const currentBalanceQty = roundQty(
              parseFloat(sourceDoc.balance_quantity || 0)
            );

            const finalReservedQty = roundQty(currentReservedQty - baseQty);
            const finalBalanceQty = roundQty(currentBalanceQty - baseQty);

            await db.collection(balanceCollection).doc(sourceDoc.id).update({
              reserved_qty: finalReservedQty,
              balance_quantity: finalBalanceQty,
            });

            console.log(
              `Updated source ${balanceCollection}: Reserved ${currentReservedQty}→${finalReservedQty}, Balance ${currentBalanceQty}→${finalBalanceQty}`
            );
          }

          // Update target location
          const targetBalanceParams = {
            material_id: ppLineItem.material_id,
            location_id: targetLocation,
            plant_id: plantId,
            organization_id: organizationId,
          };

          if (batchId) {
            targetBalanceParams.batch_id = batchId;
          }

          const targetBalanceQuery = await db
            .collection(balanceCollection)
            .where(targetBalanceParams)
            .get();

          if (targetBalanceQuery.data && targetBalanceQuery.data.length > 0) {
            const targetDoc = targetBalanceQuery.data[0];
            const currentReservedQty = roundQty(
              parseFloat(targetDoc.reserved_qty || 0)
            );
            const currentBalanceQty = roundQty(
              parseFloat(targetDoc.balance_quantity || 0)
            );

            const finalReservedQty = roundQty(currentReservedQty + baseQty);
            const finalBalanceQty = roundQty(currentBalanceQty + baseQty);

            await db.collection(balanceCollection).doc(targetDoc.id).update({
              reserved_qty: finalReservedQty,
              balance_quantity: finalBalanceQty,
            });

            console.log(
              `Updated target ${balanceCollection}: Reserved ${currentReservedQty}→${finalReservedQty}, Balance ${currentBalanceQty}→${finalBalanceQty}`
            );
          } else {
            // Create new balance record
            const newBalanceRecord = {
              material_id: ppLineItem.material_id,
              location_id: targetLocation,
              plant_id: plantId,
              organization_id: organizationId,
              reserved_qty: baseQty,
              unrestricted_qty: 0,
              balance_quantity: baseQty,
            };

            if (batchId) {
              newBalanceRecord.batch_id = batchId;
            }

            await db.collection(balanceCollection).add(newBalanceRecord);

            console.log(
              `Created new ${balanceCollection} at target with Reserved ${baseQty}`
            );
          }

          // For batch items, also update aggregate item_balance
          if (batchId) {
            // Update source aggregate
            const sourceAggParams = {
              material_id: ppLineItem.material_id,
              location_id: sourceLocation,
              plant_id: plantId,
              organization_id: organizationId,
            };

            const sourceAggQuery = await db
              .collection("item_balance")
              .where(sourceAggParams)
              .get();

            if (sourceAggQuery.data && sourceAggQuery.data.length > 0) {
              const sourceAggDoc = sourceAggQuery.data[0];
              const currentReservedQty = roundQty(
                parseFloat(sourceAggDoc.reserved_qty || 0)
              );
              const currentBalanceQty = roundQty(
                parseFloat(sourceAggDoc.balance_quantity || 0)
              );

              const finalReservedQty = roundQty(currentReservedQty - baseQty);
              const finalBalanceQty = roundQty(currentBalanceQty - baseQty);

              await db.collection("item_balance").doc(sourceAggDoc.id).update({
                reserved_qty: finalReservedQty,
                balance_quantity: finalBalanceQty,
              });

              console.log(
                `Updated source aggregate item_balance: Reserved ${currentReservedQty}→${finalReservedQty}`
              );
            }

            // Update target aggregate
            const targetAggParams = {
              material_id: ppLineItem.material_id,
              location_id: targetLocation,
              plant_id: plantId,
              organization_id: organizationId,
            };

            const targetAggQuery = await db
              .collection("item_balance")
              .where(targetAggParams)
              .get();

            if (targetAggQuery.data && targetAggQuery.data.length > 0) {
              const targetAggDoc = targetAggQuery.data[0];
              const currentReservedQty = roundQty(
                parseFloat(targetAggDoc.reserved_qty || 0)
              );
              const currentBalanceQty = roundQty(
                parseFloat(targetAggDoc.balance_quantity || 0)
              );

              const finalReservedQty = roundQty(currentReservedQty + baseQty);
              const finalBalanceQty = roundQty(currentBalanceQty + baseQty);

              await db.collection("item_balance").doc(targetAggDoc.id).update({
                reserved_qty: finalReservedQty,
                balance_quantity: finalBalanceQty,
              });

              console.log(
                `Updated target aggregate item_balance: Reserved ${currentReservedQty}→${finalReservedQty}`
              );
            } else {
              // Create new aggregate
              await db.collection("item_balance").add({
                material_id: ppLineItem.material_id,
                location_id: targetLocation,
                plant_id: plantId,
                organization_id: organizationId,
                reserved_qty: baseQty,
                unrestricted_qty: 0,
                balance_quantity: baseQty,
              });

              console.log(
                `Created new aggregate item_balance at target with Reserved ${baseQty}`
              );
            }
          }
        }

        // Handle serialized items - create inv_serial_movement records
        if (isSerializedItem && tempItem.serial_number) {
          // Wait for movements to be created
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Get OUT movement ID
          const outMovementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: "TO - PICK",
              trx_no: ppNo,
              parent_trx_no: soNumber,
              movement: "OUT",
              inventory_category: "Reserved",
              item_id: ppLineItem.material_id,
              bin_location_id: sourceLocation,
              base_qty: baseQty,
            })
            .get();

          let outMovementId = null;
          if (outMovementQuery.data && outMovementQuery.data.length > 0) {
            outMovementId = outMovementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;
          }

          // Get IN movement ID
          const inMovementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: "TO - PICK",
              trx_no: ppNo,
              parent_trx_no: soNumber,
              movement: "IN",
              inventory_category: "Reserved",
              item_id: ppLineItem.material_id,
              bin_location_id: targetLocation,
              base_qty: baseQty,
            })
            .get();

          let inMovementId = null;
          if (inMovementQuery.data && inMovementQuery.data.length > 0) {
            inMovementId = inMovementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;
          }

          // Create inv_serial_movement records if we have movement IDs
          if (outMovementId && inMovementId) {
            const serialNumbers = tempItem.serial_number
              .split("\n")
              .map((sn) => sn.trim())
              .filter((sn) => sn !== "");

            for (const serialNumber of serialNumbers) {
              // OUT serial movement
              await db.collection("inv_serial_movement").add({
                inventory_movement_id: outMovementId,
                serial_number: serialNumber,
                item_id: ppLineItem.material_id,
                batch_id: batchId,
                bin_location_id: sourceLocation,
                movement: "OUT",
                inventory_category: "Reserved",
              });

              // IN serial movement
              await db.collection("inv_serial_movement").add({
                inventory_movement_id: inMovementId,
                serial_number: serialNumber,
                item_id: ppLineItem.material_id,
                batch_id: batchId,
                bin_location_id: targetLocation,
                movement: "IN",
                inventory_category: "Reserved",
              });
            }

            console.log(
              `Created inv_serial_movement records for ${serialNumbers.length} serial numbers`
            );

            // Update item_serial_balance for each serial number
            for (const serialNumber of serialNumbers) {
              // Update source location - decrement Reserved
              const sourceSerialParams = {
                material_id: ppLineItem.material_id,
                serial_number: serialNumber,
                plant_id: plantId,
                organization_id: organizationId,
                location_id: sourceLocation,
              };

              if (batchId) {
                sourceSerialParams.batch_id = batchId;
              }

              const sourceSerialQuery = await db
                .collection("item_serial_balance")
                .where(sourceSerialParams)
                .get();

              if (sourceSerialQuery.data && sourceSerialQuery.data.length > 0) {
                const sourceSerialDoc = sourceSerialQuery.data[0];
                const currentReservedQty = roundQty(
                  parseFloat(sourceSerialDoc.reserved_qty || 0)
                );

                const finalReservedQty = roundQty(currentReservedQty - 1);

                await db
                  .collection("item_serial_balance")
                  .doc(sourceSerialDoc.id)
                  .update({
                    reserved_qty: finalReservedQty,
                  });

                console.log(
                  `Updated source item_serial_balance for ${serialNumber}: Reserved ${currentReservedQty}→${finalReservedQty}`
                );
              }

              // Update target location - increment Reserved
              const targetSerialParams = {
                material_id: ppLineItem.material_id,
                serial_number: serialNumber,
                plant_id: plantId,
                organization_id: organizationId,
                location_id: targetLocation,
              };

              if (batchId) {
                targetSerialParams.batch_id = batchId;
              }

              const targetSerialQuery = await db
                .collection("item_serial_balance")
                .where(targetSerialParams)
                .get();

              if (targetSerialQuery.data && targetSerialQuery.data.length > 0) {
                const targetSerialDoc = targetSerialQuery.data[0];
                const currentReservedQty = roundQty(
                  parseFloat(targetSerialDoc.reserved_qty || 0)
                );

                const finalReservedQty = roundQty(currentReservedQty + 1);

                await db
                  .collection("item_serial_balance")
                  .doc(targetSerialDoc.id)
                  .update({
                    reserved_qty: finalReservedQty,
                  });

                console.log(
                  `Updated target item_serial_balance for ${serialNumber}: Reserved ${currentReservedQty}→${finalReservedQty}`
                );
              } else {
                // Create new serial balance at target
                const newSerialBalance = {
                  material_id: ppLineItem.material_id,
                  serial_number: serialNumber,
                  plant_id: plantId,
                  organization_id: organizationId,
                  location_id: targetLocation,
                  reserved_qty: 1,
                  unrestricted_qty: 0,
                };

                if (batchId) {
                  newSerialBalance.batch_id = batchId;
                }

                await db
                  .collection("item_serial_balance")
                  .add(newSerialBalance);

                console.log(
                  `Created new item_serial_balance for ${serialNumber} at target with Reserved 1`
                );
              }
            }
          }
        }

        // Build updated temp_qty_data with new location
        const updatedTempItem = {
          ...tempItem,
          location_id: targetLocation,
        };

        updatedTempQtyData.push(updatedTempItem);
      }

      // Update PP line item with new temp_qty_data
      const updatedTempQtyDataJson = JSON.stringify(updatedTempQtyData);

      // Create updated view_stock summary
      const updatedViewStock = await createTempQtyDataSummary(
        updatedTempQtyData,
        ppLineItem,
        ppLineItem.material_id
      );

      // Find the line item in ppTableTo and update it
      const lineItemIndex = ppTableTo.findIndex(
        (item) => item.id === ppLineItem.id
      );

      if (lineItemIndex !== -1) {
        ppTableTo[lineItemIndex].temp_qty_data = updatedTempQtyDataJson;
        ppTableTo[lineItemIndex].view_stock = updatedViewStock;

        console.log(
          `Updated PP line item ${ppLineItem.id} temp_qty_data and view_stock`
        );
      }
    }

    // Update the entire PP document with modified table_to
    await db.collection("picking_plan").doc(ppId).update({
      table_to: ppTableTo,
    });

    console.log("Updated Picking Plan with new location data");

    // Update on_reserved_gd records
    const existingReserved = await db
      .collection("on_reserved_gd")
      .where({
        doc_type: "Picking Plan",
        doc_no: ppNo,
        organization_id: organizationId,
      })
      .get();

    if (existingReserved.data && existingReserved.data.length > 0) {
      console.log(
        `Found ${existingReserved.data.length} on_reserved_gd records to update`
      );

      const updatePromises = [];

      for (const reservedRecord of existingReserved.data) {
        // Find the corresponding line item in ppTableTo
        const matchingPPLineItem = ppTableTo.find(
          (item, index) => index + 1 === reservedRecord.line_no
        );

        if (matchingPPLineItem) {
          const matchingPickingItem = pickingItemsMap[matchingPPLineItem.id];

          if (matchingPickingItem && matchingPickingItem.target_location) {
            updatePromises.push(
              db.collection("on_reserved_gd").doc(reservedRecord.id).update({
                bin_location: matchingPickingItem.target_location,
              })
            );

            console.log(
              `Updating on_reserved_gd record ${reservedRecord.id} bin_location to ${matchingPickingItem.target_location}`
            );
          }
        }
      }

      await Promise.all(updatePromises);
      console.log("Updated on_reserved_gd records with new bin locations");
    }

    console.log("Loading bay inventory movement completed successfully");
  } catch (error) {
    console.error("Error in handleLoadingBayInventoryMovement:", error);
    throw error;
  }
};

// Main bulk action execution
(async () => {
  try {
    this.showLoading();

    const allListID = "custom_9zz4lqcj";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (!selectedRecords || selectedRecords.length === 0) {
      this.$message.warning("No picking records selected");
      this.hideLoading();
      return;
    }

    console.log(
      `Processing ${selectedRecords.length} picking records for force complete`
    );

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const pickingIds = selectedRecords
      .filter((item) => item.to_status === "In Progress")
      .map((item) => item.id);

    if (pickingIds.length === 0) {
      this.$message.error("Please select at least one in progress picking.");
      return;
    }

    const pickingNumbers = selectedRecords
      .filter((item) => item.to_status === "In Progress")
      .map((item) => item.to_id);

    await this.$confirm(
      `You've selected ${
        pickingNumbers.length
      } picking(s) to force complete. <br> <strong>Picking Numbers:</strong> <br>${pickingNumbers.join(
        ", "
      )} <br>Do you want to proceed?`,
      "Picking Force Completion",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      }
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    for (const record of selectedRecords) {
      try {
        const pickingId = record.id;

        const pickingData = await db
          .collection("transfer_order")
          .where({ id: pickingId })
          .get()
          .then((res) => res.data[0]);

        const refDocType = record.ref_doc_type;
        const tablePickingItems = pickingData.table_picking_items;
        const tablePickingRecords = pickingData.table_picking_records;
        const pickingNumber = record.to_id;
        const toPlantId = pickingData.plant_id;
        const organizationId = pickingData.organization_id;

        const isLoadingBay = await db
          .collection("picking_setup")
          .where({
            plant_id: toPlantId,
            organization_id: organizationId,
            picking_after: "Sales Order",
          })
          .get()
          .then((res) => res.data[0].is_loading_bay);

        console.log(
          `\n========== Processing Picking: ${pickingNumber} ==========`
        );

        // Only process Picking Plan pickings
        if (refDocType !== "Picking Plan") {
          console.log(
            `Skipping ${pickingNumber} - not a Picking Plan picking (ref_doc_type: ${refDocType})`
          );
          errors.push(`${pickingNumber}: Not a Picking Plan picking`);
          errorCount++;
          continue;
        }

        for (const item of tablePickingItems) {
          if (item.line_status !== "Cancelled") {
            item.line_status = "Completed";
          }
        }

        await db.collection("transfer_order").doc(pickingId).update({
          to_status: "Completed",
          table_picking_items: tablePickingItems,
        });

        console.log(`Picking ${pickingNumber} updated to completed`);

        // Fetch Picking Plan using the to_id (which matches PP's to_no)
        const ppResponse = await db
          .collection("picking_plan")
          .where({
            to_no: pickingNumber,
            organization_id: organizationId,
            is_deleted: 0,
          })
          .get();

        if (!ppResponse.data || ppResponse.data.length === 0) {
          console.warn(`Picking Plan with to_no ${pickingNumber} not found`);
          errors.push(`${pickingNumber}: Picking Plan not found`);
          errorCount++;
          continue;
        }

        const ppData = ppResponse.data[0];

        if (ppData.to_status === "Cancelled") {
          console.warn(
            `Skipping Picking Plan ${pickingNumber} - Status is Cancelled`
          );
          errors.push(`${pickingNumber}: Picking Plan status is Cancelled`);
          errorCount++;
          continue;
        }

        const ppId = ppData.id;
        const ppNo = ppData.to_no;
        const plantId = toPlantId;

        console.log(`Found Picking Plan: ID=${ppId}, to_no=${ppNo}`);

        // Step 1: Update Picking Plan with actual picked quantities
        const { ppDataUpdated, ppLineItems } =
          await updatePickingPlanWithPickedQty(
            ppId,
            tablePickingRecords || [],
            tablePickingItems || []
          );

        if (ppDataUpdated) {
          console.log("Picking Plan updated with partial quantities");

          // Step 2: Update on_reserved_gd records
          await updateOnReservedForPartialPicking(
            ppNo,
            plantId,
            organizationId,
            ppLineItems
          );

          // Step 3: Create inventory readjustment movements
          await createInventoryReadjustmentMovements(
            ppNo,
            ppLineItems,
            plantId,
            organizationId
          );

          // Step 4: Reverse unrealized planned_qty in Sales Orders
          await reversePlannedQtyInSO(ppLineItems);

          console.log("Force complete processing completed successfully");
        } else {
          console.log(
            "No partial picking detected, skipping force complete logic"
          );
        }

        // Step 4.5: Handle loading bay inventory movement if enabled
        if (isLoadingBay === 1) {
          try {
            console.log("\n========== Loading Bay Logic ==========");
            console.log(
              "Loading bay is enabled, processing inventory movement"
            );

            // Fetch the updated PP data after all updates
            const updatedPPResponse = await db
              .collection("picking_plan")
              .where({
                id: ppId,
                organization_id: organizationId,
                is_deleted: 0,
              })
              .get();

            if (
              updatedPPResponse.data &&
              updatedPPResponse.data.length > 0 &&
              updatedPPResponse.data[0].to_status === "Completed"
            ) {
              const updatedPPData = updatedPPResponse.data[0];
              console.log(
                "PP is Completed, calling handleLoadingBayInventoryMovement"
              );

              await handleLoadingBayInventoryMovement(
                updatedPPData,
                ppNo,
                ppId,
                tablePickingItems,
                plantId,
                organizationId
              );

              console.log(
                "Loading bay inventory movement completed successfully"
              );
            } else {
              console.log(
                "PP is not completed or not found, skipping loading bay logic"
              );
            }
          } catch (loadingBayError) {
            console.error("Error in loading bay logic:", loadingBayError);
            // Don't break the entire process, just log the error
            errors.push(
              `${pickingNumber}: Loading bay error - ${
                findFieldMessage(loadingBayError) ||
                loadingBayError.message ||
                loadingBayError
              }`
            );
          }
        } else {
          console.log("Loading bay is not enabled, skipping");
        }

        // Step 5: Update SO header status
        const soIds = [
          ...new Set(
            ppLineItems
              .map((item) => item.line_so_id)
              .filter((id) => id != null && id !== "")
          ),
        ];

        if (soIds.length > 0) {
          console.log(
            `Updating SO header status for ${
              soIds.length
            } Sales Orders: ${soIds.join(", ")}`
          );
          await updateSOHeaderStatus(soIds);
        } else {
          console.log(
            "No SO IDs found in PP line items, skipping SO status update"
          );
        }

        successCount++;
        console.log(`✓ Successfully force completed: ${pickingNumber}`);
      } catch (error) {
        console.error(`Error processing ${record.to_id}:`, error);
        const errorMessage = findFieldMessage(error) || error.message || error;
        errors.push(`${record.to_id}: ${errorMessage}`);
        errorCount++;
      }
    }

    // Show results
    console.log(`\n========== Force Complete Summary ==========`);
    console.log(`Total: ${selectedRecords.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${errorCount}`);

    if (successCount > 0 && errorCount === 0) {
      this.$message.success(
        `Successfully force completed ${successCount} picking(s) from Picking Plan`
      );
    } else if (successCount > 0 && errorCount > 0) {
      this.$message.warning(
        `Completed ${successCount} picking(s), ${errorCount} failed. Check console for details.`
      );
      console.error("Errors:", errors);
    } else {
      this.$message.error(
        `Failed to force complete pickings. Errors: ${errors.join("; ")}`
      );
    }

    this.hideLoading();
    this.refresh(); // Refresh the bulk action grid
    this.hide("custom_9zz4lqcj");
  } catch (error) {
    this.hideLoading();

    const errorMessage = findFieldMessage(error) || error.message || error;
    this.$message.error(`Error in bulk force complete: ${errorMessage}`);
    console.error("Bulk force complete error:", error);
  }
})();
