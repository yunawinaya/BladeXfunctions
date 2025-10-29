const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value)) {
        missingFields.push(field.label);
      }
      return;
    }

    // Handle array fields
    if (!Array.isArray(value)) {
      missingFields.push(`${field.label}`);
      return;
    }

    if (value.length === 0) {
      missingFields.push(`${field.label}`);
      return;
    }

    // Check each item in the array
    if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue)) {
            missingFields.push(
              `${subField.label} (in ${field.label} #${index + 1})`
            );
          }
        });
      });
    }
  });

  return missingFields;
};

const validateField = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

// Helper function to calculate leftover serial numbers after partial processing
const calculateLeftoverSerialNumbers = (item) => {
  // Only process serialized items
  if (item.is_serialized_item !== 1) {
    return item.serial_numbers; // Return original if not serialized
  }

  // Get the original serial numbers and processed serial numbers
  const originalSerialNumbers = item.serial_numbers
    ? item.serial_numbers
        .split(",")
        .map((sn) => sn.trim())
        .filter((sn) => sn !== "")
    : [];

  const processedSerialNumbers = Array.isArray(item.select_serial_number)
    ? item.select_serial_number.map((sn) => sn.trim()).filter((sn) => sn !== "")
    : [];

  console.log(
    `Item ${
      item.item_code || item.item_id
    }: Original serial numbers: [${originalSerialNumbers.join(", ")}]`
  );
  console.log(
    `Item ${
      item.item_code || item.item_id
    }: Processed serial numbers: [${processedSerialNumbers.join(", ")}]`
  );

  // Calculate leftover serial numbers by removing processed ones
  const leftoverSerialNumbers = originalSerialNumbers.filter(
    (originalSN) => !processedSerialNumbers.includes(originalSN)
  );

  console.log(
    `Item ${
      item.item_code || item.item_id
    }: Leftover serial numbers: [${leftoverSerialNumbers.join(", ")}]`
  );

  // Return the leftover serial numbers as a comma-separated string
  return leftoverSerialNumbers.length > 0
    ? leftoverSerialNumbers.join(", ")
    : "";
};

// Enhanced quantity validation and line status determination
const validateAndUpdateTablePickingItems = (pickingItems) => {
  const errors = [];
  const updatedItems = pickingItems;

  console.log("before updated items:", updatedItems);
  for (const [index, item] of updatedItems.entries()) {
    // Safely parse quantities
    const qtyToPick = parseFloat(item.qty_to_pick) || 0;
    const pendingProcessQty = parseFloat(item.pending_process_qty) || 0;
    const pickedQty = parseFloat(item.picked_qty) || 0;

    console.log(
      `Item ${
        item.item_name || index
      }: qtyToPick=${qtyToPick}, pendingProcessQty=${pendingProcessQty}, pickedQty=${pickedQty}`
    );

    // Validation checks
    if (pickedQty < 0) {
      errors.push(
        `Picked quantity cannot be negative for item ${
          item.item_name || `#${index + 1}`
        }`
      );
      continue;
    }

    if (pickedQty > pendingProcessQty) {
      errors.push(
        `Picked quantity (${pickedQty}) cannot be greater than quantity to pick (${pendingProcessQty}) for item ${
          item.item_name || `#${index + 1}`
        }`
      );
      continue;
    }

    // Calculate pending process quantity
    const pending_process_qty = pendingProcessQty - pickedQty;

    updatedItems[index].line_status = "Completed";
    updatedItems[index].pending_process_qty = pending_process_qty;

    // Update serial numbers for serialized items - calculate leftover serial numbers
    if (item.is_serialized_item === 1 && pending_process_qty > 0) {
      const leftoverSerialNumbers = calculateLeftoverSerialNumbers(item);
      updatedItems[index].serial_numbers = leftoverSerialNumbers;
      console.log(
        `Updated serial_numbers for partially processed item ${item.item_name}: "${leftoverSerialNumbers}"`
      );
    } else if (item.is_serialized_item === 1 && pending_process_qty === 0) {
      // If fully processed, clear serial numbers
      updatedItems[index].serial_numbers = "";
      console.log(
        `Cleared serial_numbers for fully processed item ${item.item_name}`
      );
    }

    console.log(`Item ${item.item_name || index} line status: Completed`);
  }

  return { updatedItems, errors };
};

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

const updateEntry = async (toData, toId) => {
  try {
    for (const item of toData.table_picking_items) {
      if (item.select_serial_number) {
        item.select_serial_number = null;
      }
    }

    await db.collection("transfer_order").doc(toId).update(toData);

    console.log("Transfer order updated successfully");
    return toId;
  } catch (error) {
    console.error("Error in updateEntry:", error);
    throw error;
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

const createPickingRecord = async (toData) => {
  const pickingRecords = [];
  for (const item of toData.table_picking_items) {
    if (item.picked_qty > 0 && item.line_status !== "Cancelled") {
      const pickingRecord = {
        item_code: item.item_code,
        item_name: item.item_name,
        item_desc: item.item_desc,
        batch_no: item.batch_no,
        target_batch: item.batch_no,
        so_no: item.so_no,
        gd_no: item.gd_no,
        so_id: item.so_id,
        gd_id: item.gd_id,
        so_line_id: item.so_line_id,
        gd_line_id: item.gd_line_id,
        store_out_qty: item.picked_qty,
        item_uom: item.item_uom,
        source_bin: item.source_bin,
        target_location: item.source_bin,
        remark: item.remark,
        confirmed_by: this.getVarGlobal("nickname"),
        confirmed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      };

      // Add serial numbers for serialized items with line break formatting
      if (
        item.is_serialized_item === 1 &&
        item.select_serial_number &&
        Array.isArray(item.select_serial_number)
      ) {
        const trimmedSerialNumbers = item.select_serial_number
          .map((sn) => sn.trim())
          .filter((sn) => sn !== "");

        if (trimmedSerialNumbers.length > 0) {
          pickingRecord.serial_numbers = trimmedSerialNumbers.join("\n");

          console.log(
            `Added ${trimmedSerialNumbers.length} serial numbers to picking record for ${item.item_code}: ${pickingRecord.serial_numbers}`
          );
        }
      }

      pickingRecords.push(pickingRecord);
    }
  }

  toData.table_picking_records =
    toData.table_picking_records.concat(pickingRecords);
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

// Update Picking Plan with picked quantities from picking records
const updatePickingPlanWithPickedQty = async (ppId, pickingRecords) => {
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

      // Find picking records for this line item
      const filteredPickingRecords = pickingRecords.filter(
        (record) =>
          record.to_line_id === ppLineItem.id && record.store_out_qty > 0
      );

      if (filteredPickingRecords.length === 0) {
        console.log(`No picking records found for line item ${ppLineItem.id}`);
        continue;
      }

      console.log(
        `Found ${filteredPickingRecords.length} picking records for line item ${ppLineItem.id}`
      );

      // Calculate total picked quantity
      const totalPickedQty = filteredPickingRecords.reduce(
        (sum, record) => sum + parseFloat(record.store_out_qty || 0),
        0
      );

      console.log(
        `Line item ${ppLineItem.id}: Original qty=${ppLineItem.to_qty}, Picked qty=${totalPickedQty}`
      );

      // Only update if picked quantity is less than planned quantity (partial picking)
      if (totalPickedQty < parseFloat(ppLineItem.to_qty || 0)) {
        console.log(
          `Partial picking detected for line item ${ppLineItem.id}, updating...`
        );

        // Build updated temp_qty_data from picking records
        const updatedTempQtyData = filteredPickingRecords.map((record) => {
          const tempQtyItem = {
            material_id: record.item_code,
            location_id: record.target_location,
            batch_id: record.target_batch || undefined,
            to_quantity: record.store_out_qty,
          };

          // Add serial_number if it exists (for serialized items)
          if (record.serial_numbers) {
            tempQtyItem.serial_number = record.serial_numbers;
          }

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

    // Check if all line items are completed
    const allLineItemsCompleted = ppLineItems.every(
      (item) => item.picking_status === "Completed"
    );

    // Update the entire PP document with modified table_to
    const updateData = {
      table_to: ppLineItems,
    };

    if (allLineItemsCompleted) {
      updateData.picking_status = "Completed";
      console.log("All PP line items completed, updating header");
    }

    await db.collection("picking_plan").doc(ppId).update(updateData);
    console.log("PP document updated with modified table_to");

    if (ppDataUpdated) {
      console.log("Picking Plan updated with partial picked quantities");
    } else {
      console.log("No partial picking detected, no updates needed");
    }

    return { ppDataUpdated, ppLineItems };
  } catch (error) {
    console.error("Error in updatePickingPlanWithPickedQty:", error);
    throw error;
  }
};

// Update on_reserved_gd records to reflect actual picked quantities
const updateOnReservedForPartialPicking = async (
  ppNo,
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

      if (!ppLineItem.material_id || temp_qty_data.length === 0) {
        console.log(
          `Skipping line item ${ppLineItem.id}, no material or temp_qty_data`
        );
        continue;
      }

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
          plant_id: ppLineItem.plant_id,
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
            (picked) =>
              picked.location_id === originalTemp.location_id &&
              picked.batch_id === originalTemp.batch_id &&
              (!isSerializedItem ||
                picked.serial_number === originalTemp.serial_number)
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
          `Created PP IN movement to Unrestricted: ${baseQty} base qty`
        );

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

      const soId = ppLineItem.so_id;
      const soLineId = ppLineItem.so_line_item_id;

      if (!soId || !soLineId) {
        console.log(`Line item ${ppLineItem.id}: Missing SO ID or SO Line ID`);
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

    // Process each SO
    for (const soId of Object.keys(soGrouped)) {
      console.log(`Processing SO: ${soId}`);

      // Fetch SO line items
      const soLineItemsResponse = await db
        .collection("sales_order_axszx8cj_sub")
        .where({ sales_order_id: soId })
        .get();

      if (!soLineItemsResponse.data || soLineItemsResponse.data.length === 0) {
        console.log(`No line items found for SO ${soId}`);
        continue;
      }

      const soLineItems = soLineItemsResponse.data;

      // Update each SO line item
      for (const item of soGrouped[soId]) {
        const soLineItem = soLineItems.find((so) => so.id === item.soLineId);

        if (!soLineItem) {
          console.log(`SO line item ${item.soLineId} not found`);
          continue;
        }

        // Reverse the unrealized planned_qty
        const currentPlannedQty = parseFloat(soLineItem.planned_qty || 0);
        const newPlannedQty = roundQty(currentPlannedQty - item.unrealizedQty);

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
      }

      console.log(`Completed reversing planned_qty for SO ${soId}`);
    }

    console.log("Successfully reversed planned_qty in all affected SOs");
  } catch (error) {
    console.error("Error in reversePlannedQtyInSO:", error);
    throw error;
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const page_status = data.page_status;
    const originalToStatus = data.to_status;

    console.log(
      `Page Status: ${page_status}, Original TO Status: ${originalToStatus}`
    );

    // Define required fields
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "to_id", label: "Transfer Order No" },
      { name: "movement_type", label: "Movement Type" },
      { name: "ref_doc_type", label: "Reference Document Type" },
      {
        name: "table_picking_items",
        label: "Picking Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate items
    for (const [index] of data.table_picking_items.entries()) {
      await this.validate(`table_picking_items.${index}.picked_qty`);
    }

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length > 0) {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
      return;
    }

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const tablePickingItems = this.getValue("table_picking_items");
    console.log("Table Picking Items:", tablePickingItems);
    // Validate quantities and update line statuses
    const { updatedItems, errors } =
      validateAndUpdateTablePickingItems(tablePickingItems);

    console.log("Updated items:", updatedItems);

    if (errors.length > 0) {
      this.hideLoading();
      this.$message.error(errors.join("; "));
      return;
    }

    // Prepare transfer order object
    const toData = {
      to_status: "Completed",
      plant_id: data.plant_id,
      to_id: data.to_id,
      movement_type: data.movement_type,
      customer_id: data.customer_id,
      ref_doc_type: data.ref_doc_type,
      pp_id: data.pp_id,
      so_no: data.so_no,
      assigned_to: data.assigned_to,
      created_by: data.created_by,
      created_at: data.created_at,
      organization_id: organizationId,
      ref_doc: data.ref_doc,
      table_picking_items: updatedItems,
      table_picking_records: data.table_picking_records,
      remarks: data.remarks,
    };

    await createPickingRecord(toData);

    // Clean up undefined/null values
    Object.keys(toData).forEach((key) => {
      if (toData[key] === undefined || toData[key] === null) {
        delete toData[key];
      }
    });

    const toId = data.id;
    const ppId = data.pp_id;
    const ppNo = data.to_no;
    const plantId = data.plant_id;

    await updateEntry(toData, toId);

    // Call the new force complete functions
    console.log("Starting force complete processing...");

    // Step 1: Update Picking Plan with actual picked quantities
    const { ppDataUpdated, ppLineItems } = await updatePickingPlanWithPickedQty(
      ppId,
      toData.table_picking_records
    );

    if (ppDataUpdated) {
      console.log("Picking Plan updated with partial quantities");

      // Step 2: Update on_reserved_gd records
      await updateOnReservedForPartialPicking(
        ppNo,
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
      console.log("No partial picking detected, skipping force complete logic");
    }

    // Success message with status information
    this.$message.success(
      `${page_status === "Add" ? "Added" : "Updated"} successfully`
    );

    this.hideLoading();
    closeDialog();
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";
    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
