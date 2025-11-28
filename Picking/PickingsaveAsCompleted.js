const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.parentGenerateForm.hide("tabs_picking");
    this.hideLoading();
  }
};

const getPrefixData = async (
  organizationId,
  documentType = "Transfer Order"
) => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: documentType,
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    console.log("Prefix data result:", prefixEntry);

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      console.log("No prefix configuration found");
      return null;
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error getting prefix data:", error);
    throw error;
  }
};

const updatePrefix = async (
  organizationId,
  runningNumber,
  documentType = "Transfer Order"
) => {
  console.log(
    "Updating prefix for organization:",
    organizationId,
    "with running number:",
    runningNumber
  );
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: documentType,
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({
        running_number: parseInt(runningNumber) + 1,
        has_record: 1,
      });
    console.log("Prefix update successful");
  } catch (error) {
    console.error("Error updating prefix:", error);
    throw error;
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  console.log("Generating prefix with running number:", runNumber);
  try {
    let generated = prefixData.current_prefix_config;
    generated = generated.replace("prefix", prefixData.prefix_value);
    generated = generated.replace("suffix", prefixData.suffix_value);
    generated = generated.replace(
      "month",
      String(now.getMonth() + 1).padStart(2, "0")
    );
    generated = generated.replace(
      "day",
      String(now.getDate()).padStart(2, "0")
    );
    generated = generated.replace("year", now.getFullYear());
    generated = generated.replace(
      "running_number",
      String(runNumber).padStart(prefixData.padding_zeroes, "0")
    );
    console.log("Generated prefix:", generated);
    return generated;
  } catch (error) {
    console.error("Error generating prefix:", error);
    throw error;
  }
};

const checkUniqueness = async (
  generatedPrefix,
  organizationId,
  collection = "transfer_order",
  prefix = "to_id"
) => {
  const existingDoc = await db
    .collection(collection)
    .where({
      [prefix]: generatedPrefix,
      organization_id: organizationId,
      is_deleted: 0,
    })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (
  prefixData,
  organizationId,
  collection = "transfer_order",
  prefix = "to_id"
) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(
      prefixToShow,
      organizationId,
      collection,
      prefix
    );
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Transfer Order number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
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
const validateAndUpdateLineStatuses = (pickingItems) => {
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
        item.item_id || index
      }: qtyToPick=${qtyToPick}, pendingProcessQty=${pendingProcessQty}, pickedQty=${pickedQty}`
    );

    // Validation checks
    if (pickedQty < 0) {
      errors.push(
        `Picked quantity cannot be negative for item ${
          item.item_id || `#${index + 1}`
        }`
      );
      continue;
    }

    if (pickedQty > pendingProcessQty) {
      errors.push(
        `Picked quantity (${pickedQty}) cannot be greater than quantity to pick (${pendingProcessQty}) for item ${
          item.item_id || `#${index + 1}`
        }`
      );
      continue;
    }

    // Determine line status based on quantities
    let lineStatus;
    if (item.line_status === "Cancelled") {
      lineStatus = "Cancelled";
    } else if (pickedQty === 0 && pendingProcessQty > 0) {
      lineStatus = "Open";
    } else if (pickedQty === pendingProcessQty) {
      lineStatus = "Completed";
    } else if (pickedQty < pendingProcessQty) {
      lineStatus = "In Progress";
    }

    // Calculate pending process quantity
    const pending_process_qty = pendingProcessQty - pickedQty;

    updatedItems[index].line_status = lineStatus;
    updatedItems[index].pending_process_qty = pending_process_qty;

    // Update serial numbers for serialized items - calculate leftover serial numbers
    if (item.is_serialized_item === 1 && pending_process_qty > 0) {
      const leftoverSerialNumbers = calculateLeftoverSerialNumbers(item);
      updatedItems[index].serial_numbers = leftoverSerialNumbers;
      console.log(
        `Updated serial_numbers for partially processed item ${
          item.item_code || item.item_id
        }: "${leftoverSerialNumbers}"`
      );
    } else if (item.is_serialized_item === 1 && pending_process_qty === 0) {
      // If fully processed, clear serial numbers
      updatedItems[index].serial_numbers = "";
      console.log(
        `Cleared serial_numbers for fully processed item ${
          item.item_code || item.item_id
        }`
      );
    }

    console.log(`Item ${item.item_id || index} line status: ${lineStatus}`);
  }

  return { updatedItems, errors };
};

// Determine overall transfer order status based on line statuses
const determineTransferOrderStatus = (pickingItems) => {
  if (!Array.isArray(pickingItems) || pickingItems.length === 0) {
    return "Created";
  }

  const lineStatuses = pickingItems
    .map((item) => item.line_status)
    .filter((status) => status !== undefined);

  console.log("Line statuses:", lineStatuses);

  // Count statuses
  const completedCount = lineStatuses.filter(
    (status) => status === "Completed"
  ).length;

  const cancelledCount = lineStatuses.filter(
    (status) => status === "Cancelled"
  ).length;
  const inProgressCount = lineStatuses.filter(
    (status) => status === "In Progress"
  ).length;
  const nullCount = lineStatuses.filter(
    (status) => status === null || status === undefined || status === "Open"
  ).length;
  const totalItems = pickingItems.length;

  console.log(
    `Status counts - Completed: ${completedCount}, In Progress: ${inProgressCount}, Null: ${nullCount}, Total: ${totalItems}, Cancelled: ${cancelledCount}`
  );

  // Determine overall status
  if (completedCount + cancelledCount === totalItems) {
    return "Completed";
  } else if (inProgressCount > 0 || completedCount > 0) {
    return "In Progress";
  } else if (nullCount + cancelledCount === totalItems) {
    return "Created";
  } else {
    return "In Progress";
  }
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

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
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

const createTempQtyDataSummary = async (
  updatedTempQtyData,
  gdLineItem,
  materialId
) => {
  // Get item data to check if it's serialized
  let isSerializedItem = false;
  let gdUOM = "";

  if (materialId) {
    const resItem = await db.collection("Item").where({ id: materialId }).get();
    if (resItem.data && resItem.data[0]) {
      isSerializedItem = resItem.data[0].serial_number_management === 1;
    }
  }

  // Get UOM name
  if (gdLineItem.gd_order_uom_id) {
    const uomRes = await db
      .collection("unit_of_measurement")
      .where({ id: gdLineItem.gd_order_uom_id })
      .get();
    if (uomRes.data && uomRes.data[0]) {
      gdUOM = uomRes.data[0].uom_name;
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
    (sum, item) => sum + parseFloat(item.gd_quantity || 0),
    0
  );

  let summary = `Total: ${totalQty} ${gdUOM}\n\nDETAILS:\n`;

  const details = updatedTempQtyData
    .map((item, index) => {
      const locationName = locationMap[item.location_id] || item.location_id;
      const qty = item.gd_quantity || 0;

      let itemDetail = `${index + 1}. ${locationName}: ${qty} ${gdUOM}`;

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

// Enhanced goods delivery status update
const updateSalesOrderStatus = async (salesOrderId, tableGD) => {
  const soIds = Array.isArray(salesOrderId) ? salesOrderId : [salesOrderId];

  // Arrays to collect data for the return format
  let soDataArray = [];

  try {
    const updatePromises = soIds.map(async (salesOrderId) => {
      const filteredGD = tableGD.filter(
        (item) => item.line_so_id === salesOrderId
      );

      const resSO = await db
        .collection("sales_order")
        .where({ id: salesOrderId })
        .get();

      if (!resSO.data || !resSO.data.length) {
        console.log(`Sales order ${salesOrderId} not found`);
        return;
      }

      const soDoc = resSO.data[0];

      const soItems = soDoc.table_so || [];
      if (!soItems.length) {
        console.log(`No items found in sales order ${salesOrderId}`);
        return;
      }

      const filteredSO = soItems
        .map((item, index) => ({ ...item, originalIndex: index }))
        .filter((item) => item.item_name !== "" || item.so_desc !== "")
        .filter((item) =>
          filteredGD.some((gd) => gd.so_line_item_id === item.id)
        );

      // Create a map to sum delivered quantities for each item
      let totalItems = soItems.length;
      let partiallyDeliveredItems = 0;
      let fullyDeliveredItems = 0;

      // Count items with "Completed" status as fully delivered
      soItems.forEach((item) => {
        if (item.line_status === "Completed") {
          partiallyDeliveredItems++;
          fullyDeliveredItems++;
        }
      });

      // Create a copy of the SO items to update later
      const updatedSoItems = JSON.parse(JSON.stringify(soItems));

      filteredSO.forEach((filteredItem, filteredIndex) => {
        const originalIndex = filteredItem.originalIndex;
        const orderedQty = parseFloat(filteredItem.so_quantity || 0);
        const gdDeliveredQty = parseFloat(
          filteredGD[filteredIndex]?.gd_qty || 0
        );
        const currentDeliveredQty = parseFloat(
          updatedSoItems[originalIndex].delivered_qty || 0
        );
        const totalDeliveredQty = currentDeliveredQty + gdDeliveredQty;

        // Update the quantity in the original soItems structure
        updatedSoItems[originalIndex].delivered_qty = totalDeliveredQty;

        const outstandingQty = parseFloat(orderedQty - totalDeliveredQty);
        if (outstandingQty < 0) {
          updatedSoItems[originalIndex].outstanding_quantity = 0;
        } else {
          updatedSoItems[originalIndex].outstanding_quantity = outstandingQty;
        }

        // Add ratio for tracking purposes
        updatedSoItems[originalIndex].delivery_ratio =
          orderedQty > 0 ? totalDeliveredQty / orderedQty : 0;

        // Count items with ANY delivered quantity as "partially delivered"
        if (totalDeliveredQty > 0) {
          partiallyDeliveredItems++;
          updatedSoItems[originalIndex].line_status = "Processing";

          // Count fully delivered items separately
          if (totalDeliveredQty >= orderedQty) {
            fullyDeliveredItems++;
            updatedSoItems[originalIndex].line_status = "Completed";
          }
        }
      });

      // Check item completion status
      let allItemsComplete = fullyDeliveredItems === totalItems;
      let anyItemProcessing = partiallyDeliveredItems > 0;

      // Determine new status
      let newSOStatus = soDoc.so_status;
      let newGDStatus = soDoc.gd_status;

      if (allItemsComplete) {
        newSOStatus = "Completed";
        newGDStatus = "Fully Delivered";
      } else if (anyItemProcessing) {
        newSOStatus = "Processing";
        newGDStatus = "Partially Delivered";
      }

      // Create tracking ratios
      const partiallyDeliveredRatio = `${partiallyDeliveredItems} / ${totalItems}`;
      const fullyDeliveredRatio = `${fullyDeliveredItems} / ${totalItems}`;

      console.log(`SO ${salesOrderId} status:
        Total items: ${totalItems}
        Partially delivered items (including fully delivered): ${partiallyDeliveredItems} (${partiallyDeliveredRatio})
        Fully delivered items: ${fullyDeliveredItems} (${fullyDeliveredRatio})
      `);

      // Prepare a single update operation with all changes
      const updateData = {
        table_so: updatedSoItems,
        partially_delivered: partiallyDeliveredRatio,
        fully_delivered: fullyDeliveredRatio,
      };

      // Only include status changes if needed
      if (newSOStatus !== soDoc.so_status) {
        updateData.so_status = newSOStatus;
      }

      if (newGDStatus !== soDoc.gd_status) {
        updateData.gd_status = newGDStatus;
      }

      // Execute a single database update
      await db.collection("sales_order").doc(soDoc.id).update(updateData);

      const originalSOStatus = soDoc.so_status;
      // Log the status change if it occurred
      if (newSOStatus !== originalSOStatus) {
        console.log(
          `Updated SO ${salesOrderId} status from ${originalSOStatus} to ${newSOStatus}`
        );
      }
      return {
        soId: salesOrderId,
        newSOStatus,
        totalItems,
        partiallyDeliveredItems,
        fullyDeliveredItems,
        success: true,
      };
    });

    const results = await Promise.all(updatePromises);

    results.forEach((result) => {
      if (result && result.success) {
        // Add PO data
        soDataArray.push({
          so_id: result.soId,
          status: result.newSOStatus,
        });
      }
    });

    // Aggregate results for logging
    const successCount = results.filter((r) => r && r.success).length;
    const failCount = results.filter((r) => r && !r.success).length;

    console.log(`SO Status Update Summary: 
      Total SOs: ${soIds.length}
      Successfully updated: ${successCount}
      Failed updates: ${failCount}
    `);

    // Return in the requested format
    return {
      so_data_array: soDataArray,
    };
  } catch (error) {
    console.error(`Error in update sales order status process:`, error);
    return {
      so_data_array: [],
    };
  }
};

const updateSalesOrder = async (toData) => {
  try {
    // Group picking items by so_id
    const itemsBySoId = {};

    toData.table_picking_items.forEach((item) => {
      if (!item.so_id) return;

      if (!itemsBySoId[item.so_id]) {
        itemsBySoId[item.so_id] = [];
      }
      itemsBySoId[item.so_id].push(item);
    });

    // Process each SO
    for (const soId of Object.keys(itemsBySoId)) {
      const pickingItems = itemsBySoId[soId];
      const lineStatuses = pickingItems.map((item) => item.line_status);

      console.log(`SO ${soId} - Line statuses:`, lineStatuses);

      // Check line status distribution
      const allOpen = lineStatuses.every((status) => status === "Open");
      const allCompleted = lineStatuses.every(
        (status) => status === "Completed"
      );
      const hasInProgress = lineStatuses.some(
        (status) => status === "In Progress"
      );
      const hasCompleted = lineStatuses.some(
        (status) => status === "Completed"
      );
      const hasNonOpen = lineStatuses.some((status) => status !== "Open");

      // Case A: All line_status = "Open" - Don't update SO
      if (allOpen) {
        console.log(`SO ${soId}: All lines are Open, skipping SO update`);
        continue;
      }

      // Case B: All line_status = "Completed" - Check if quantities match
      if (allCompleted) {
        console.log(`SO ${soId}: All lines Completed, checking quantity match`);

        // Fetch SO to compare quantities
        const soRes = await db.collection("sales_order").doc(soId).get();

        if (!soRes || !soRes.data || soRes.data.length === 0) {
          console.warn(`SO ${soId} not found, skipping`);
          continue;
        }

        const soDoc = soRes.data[0];
        const soLineItems = soDoc.table_so || [];

        // Check if all SO line items match: so_quantity === planned_qty
        let allQuantitiesMatch = true;

        for (const soLine of soLineItems) {
          const soQuantity = parseFloat(soLine.so_quantity || 0);
          const plannedQty = parseFloat(soLine.planned_qty || 0);

          if (soQuantity !== plannedQty) {
            allQuantitiesMatch = false;
            console.log(
              `SO ${soId} Line ${soLine.id}: Quantity mismatch - so_quantity=${soQuantity}, planned_qty=${plannedQty}`
            );
            break;
          }
        }

        if (allQuantitiesMatch) {
          // All quantities match - set SO to Completed
          await db.collection("sales_order").doc(soId).update({
            to_status: "Completed",
          });
          console.log(
            `SO ${soId}: Set to_status = "Completed" (all quantities matched)`
          );
        } else {
          // Some quantities don't match - set SO to In Progress
          await db.collection("sales_order").doc(soId).update({
            to_status: "In Progress",
          });
          console.log(
            `SO ${soId}: Set to_status = "In Progress" (quantities mismatch)`
          );
        }
        continue;
      }

      // Case C: Mixed statuses or has In Progress - Set SO to In Progress
      if (hasNonOpen && (hasInProgress || hasCompleted)) {
        await db.collection("sales_order").doc(soId).update({
          to_status: "In Progress",
        });
        console.log(
          `SO ${soId}: Set to_status = "In Progress" (mixed or in progress statuses)`
        );
      }
    }
  } catch (error) {
    console.error("Error updating Sales Order:", error);
    throw error;
  }
};

const addEntry = async (organizationId, toData, isPacking) => {
  try {
    const prefixData = await getPrefixData(organizationId, "Transfer Order");

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "transfer_order",
        "to_id"
      );

      await updatePrefix(organizationId, runningNumber, "Transfer Order");
      toData.to_id = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        toData.to_id,
        organizationId,
        "transfer_order",
        "to_id"
      );
      if (!isUnique) {
        throw new Error(
          `Picking Number "${toData.to_id}" already exists. Please use a different number.`
        );
      }
    }

    for (const item of toData.table_picking_items) {
      if (item.select_serial_number) {
        item.select_serial_number = null;
      }
    }

    // Add the record
    const createdRecord = await db.collection("transfer_order").add(toData);

    await updateSalesOrder(toData);

    if (!createdRecord.data || createdRecord.data.length === 0) {
      throw new Error("Failed to retrieve created transfer order record");
    }

    if (isPacking === 1 && toData.to_status === "Completed") {
      await this.triggerEvent("triggerPacking", {
        pickingData: createdRecord.data[0],
      });
    }

    const toId = createdRecord.data[0].id;
    console.log("Transfer order created successfully with ID:", toId);
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (
  organizationId,
  toData,
  toId,
  originalToStatus,
  isPacking
) => {
  try {
    if (originalToStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId, "Transfer Order");

      if (prefixData) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
          "transfer_order",
          "to_id"
        );

        await updatePrefix(organizationId, runningNumber, "Transfer Order");
        toData.to_id = prefixToShow;
      } else {
        const isUnique = await checkUniqueness(
          toData.to_id,
          organizationId,
          "transfer_order",
          "to_id"
        );
        if (!isUnique) {
          throw new Error(
            `Picking Number "${toData.to_id}" already exists. Please use a different number.`
          );
        }
      }
    }

    for (const item of toData.table_picking_items) {
      if (item.select_serial_number) {
        item.select_serial_number = null;
      }
    }

    await db.collection("transfer_order").doc(toId).update(toData);

    await updateSalesOrder(toData);

    if (isPacking === 1 && toData.to_status === "Completed") {
      await this.triggerEvent("triggerPacking", {
        pickingData: toData,
      });
    }

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

const setCreditLimitStatus = async (data, credit_limit_status) => {
  if (data.id && (data.gd_status === "Created" || data.gd_status === "Draft")) {
    await db.collection("goods_delivery").doc(data.id).update({
      credit_limit_status: credit_limit_status,
    });
    console.log("Credit limit status set to: ", credit_limit_status);
  }
};

// Simplified credit limit check without popups - for auto-complete GD only
const checkCreditLimitForAutoComplete = async (
  customer_name,
  gd_total,
  data
) => {
  try {
    const fetchCustomer = await db
      .collection("Customer")
      .where({ id: customer_name, is_deleted: 0 })
      .get();

    const customerData = fetchCustomer.data[0];
    if (!customerData) {
      console.error(`Customer ${customer_name} not found`);
      return false;
    }

    const controlTypes = customerData.control_type_list;

    const outstandingAmount =
      parseFloat(customerData.outstanding_balance || 0) || 0;
    const overdueAmount =
      parseFloat(customerData.overdue_inv_total_amount || 0) || 0;
    const overdueLimit = parseFloat(customerData.overdue_limit || 0) || 0;
    const creditLimit =
      parseFloat(customerData.customer_credit_limit || 0) || 0;
    const gdTotal = parseFloat(gd_total || 0) || 0;
    const revisedOutstandingAmount = outstandingAmount + gdTotal;

    // Check if accuracy flag is set
    if (controlTypes && Array.isArray(controlTypes)) {
      // Define control type behaviors according to specification
      const controlTypeChecks = {
        // Control Type 0: Ignore both checks (always pass)
        0: () => {
          console.log("Control Type 0: Ignoring all credit/overdue checks");
          setCreditLimitStatus(data, "Passed");
          return { result: true, priority: "unblock" };
        },

        // Control Type 1: Ignore credit, block overdue
        1: () => {
          if (overdueAmount > overdueLimit) {
            setCreditLimitStatus(data, "Blocked");
            return { result: false, priority: "block" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 2: Ignore credit, override overdue
        2: () => {
          if (overdueAmount > overdueLimit) {
            setCreditLimitStatus(data, "Override Required");
            return { result: false, priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 3: Block credit, ignore overdue
        3: () => {
          if (revisedOutstandingAmount > creditLimit) {
            setCreditLimitStatus(data, "Blocked");
            return { result: false, priority: "block" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 4: Block both
        4: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;

          if (creditExceeded && overdueExceeded) {
            setCreditLimitStatus(data, "Blocked");
            return { result: false, priority: "block" };
          } else if (creditExceeded) {
            setCreditLimitStatus(data, "Blocked");
            return { result: false, priority: "block" };
          } else if (overdueExceeded) {
            setCreditLimitStatus(data, "Blocked");
            return { result: false, priority: "block" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 5: Block credit, override overdue
        5: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;

          // Credit limit block takes priority
          if (creditExceeded) {
            setCreditLimitStatus(data, "Blocked");
            return { result: false, priority: "block" };
          } else if (overdueExceeded) {
            setCreditLimitStatus(data, "Override Required");
            return { result: false, priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 6: Override credit, ignore overdue
        6: () => {
          if (revisedOutstandingAmount > creditLimit) {
            setCreditLimitStatus(data, "Override Required");
            return { result: false, priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 7: Override credit, block overdue
        7: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;

          // Overdue block takes priority over credit override
          if (overdueExceeded) {
            setCreditLimitStatus(data, "Blocked");
            return { result: false, priority: "block" };
          } else if (creditExceeded) {
            setCreditLimitStatus(data, "Override Required");
            return { result: false, priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 8: Override both
        8: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;

          if (creditExceeded || overdueExceeded) {
            setCreditLimitStatus(data, "Override Required");
            return { result: false, priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 9: Suspended customer
        9: () => {
          setCreditLimitStatus(data, "Blocked");
          return { result: false, priority: "block" };
        },
      };

      // First, collect all applicable control types for Goods Delivery
      const applicableControls = controlTypes
        .filter((ct) => ct.document_type === "Goods Delivery")
        .map((ct) => {
          const checkResult = controlTypeChecks[ct.control_type]
            ? controlTypeChecks[ct.control_type]()
            : { result: true, priority: "unblock" };
          return {
            ...checkResult,
            control_type: ct.control_type,
          };
        });

      // Sort by priority: blocks first, then overrides, then unblocks
      const priorityOrder = { block: 1, override: 2, unblock: 3 };
      applicableControls.sort(
        (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
      );

      // Process in priority order
      for (const control of applicableControls) {
        if (control.result !== true) {
          console.log(
            `Control Type ${control.control_type} triggered with ${control.priority} - blocking auto-complete`
          );
          return false;
        }
      }

      // All checks passed - set status as Passed since there are controlTypes
      setCreditLimitStatus(data, "Passed");
      return true;
    } else {
      console.log(
        "No control type defined for customer or invalid control type format"
      );
      return true;
    }
  } catch (error) {
    console.error("Error checking credit/overdue limits:", error);
    return false;
  }
};

// Handle loading bay inventory movement - move Reserved inventory from source to target location
const handleLoadingBayInventoryMovement = async (
  gdData,
  gdNo,
  gdId,
  pickingItems,
  plantId,
  organizationId
) => {
  try {
    console.log("Starting handleLoadingBayInventoryMovement for GD:", gdNo);

    console.log(`Processing Goods Delivery: ID=${gdId}, delivery_no=${gdNo}`);

    // Create a map of picking items by gd_line_id for quick lookup
    const pickingItemsMap = {};
    for (const pickingItem of pickingItems) {
      pickingItemsMap[pickingItem.gd_line_id] = pickingItem;
    }

    // Get a mutable copy of table_gd for updates
    const gdTableGd = [...gdData.table_gd];

    // Process each GD line item
    for (const gdLineItem of gdTableGd) {
      const pickingItem = pickingItemsMap[gdLineItem.id];

      if (!pickingItem) {
        console.log(
          `No picking item found for GD line item ${gdLineItem.id}, skipping`
        );
        continue;
      }

      const targetLocation = pickingItem.target_location;

      if (!targetLocation) {
        console.log(
          `No target location for GD line item ${gdLineItem.id}, skipping`
        );
        continue;
      }

      console.log(
        `Processing GD line item ${gdLineItem.id} - moving to target location ${targetLocation}`
      );

      // Parse temp_qty_data
      const tempQtyData = parseJsonSafely(gdLineItem.temp_qty_data);

      if (!tempQtyData || tempQtyData.length === 0) {
        console.log(
          `No temp_qty_data for line item ${gdLineItem.id}, skipping`
        );
        continue;
      }

      // Get item details for costing and type checking
      const resItem = await db
        .collection("Item")
        .where({ id: gdLineItem.material_id })
        .get();

      if (!resItem.data || resItem.data.length === 0) {
        console.log(`Item ${gdLineItem.material_id} not found, skipping`);
        continue;
      }

      const itemData = resItem.data[0];
      const isSerializedItem = itemData.serial_number_management === 1;
      const baseUOM = itemData.base_unit_of_measurement;
      const altUOM = gdLineItem.gd_order_uom_id;
      const costingMethod = itemData.material_costing_method;

      // Get SO number from line item
      const soNumber = gdLineItem.line_so_no || gdData.so_no;

      // Process each temp_qty_data item (each location/batch/serial)
      const updatedTempQtyData = [];

      for (const tempItem of tempQtyData) {
        const sourceLocation = tempItem.location_id;
        const batchId = tempItem.batch_id || null;
        const quantityInOrderUOM = parseFloat(tempItem.gd_quantity || 0);
        const baseQty = parseFloat(tempItem.base_qty || quantityInOrderUOM);

        console.log(
          `Moving ${baseQty} base qty from location ${sourceLocation} to ${targetLocation}`
        );

        // Get costing price
        let unitPrice = 0;
        let totalPrice = 0;

        if (costingMethod === "First In First Out") {
          const fifoCostPrice = await getFIFOCostPrice(
            gdLineItem.material_id,
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
            gdLineItem.material_id,
            plantId,
            organizationId
          );
          unitPrice = roundPrice(waCostPrice);
          totalPrice = roundPrice(waCostPrice * baseQty);
        } else if (costingMethod === "Fixed Cost") {
          const fixedCostPrice = await getFixedCostPrice(
            gdLineItem.material_id
          );
          unitPrice = roundPrice(fixedCostPrice);
          totalPrice = roundPrice(fixedCostPrice * baseQty);
        }

        // Create base inventory movement data
        const baseInventoryMovement = {
          transaction_type: "TO - PICK",
          trx_no: gdNo,
          parent_trx_no: soNumber,
          unit_price: unitPrice,
          total_price: totalPrice,
          quantity: quantityInOrderUOM,
          item_id: gdLineItem.material_id,
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
            material_id: gdLineItem.material_id,
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
            material_id: gdLineItem.material_id,
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
              material_id: gdLineItem.material_id,
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
            material_id: gdLineItem.material_id,
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
            material_id: gdLineItem.material_id,
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
              material_id: gdLineItem.material_id,
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
              material_id: gdLineItem.material_id,
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
              material_id: gdLineItem.material_id,
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
                material_id: gdLineItem.material_id,
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
              trx_no: gdNo,
              parent_trx_no: soNumber,
              movement: "OUT",
              inventory_category: "Reserved",
              item_id: gdLineItem.material_id,
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
              trx_no: gdNo,
              parent_trx_no: soNumber,
              movement: "IN",
              inventory_category: "Reserved",
              item_id: gdLineItem.material_id,
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
                item_id: gdLineItem.material_id,
                batch_id: batchId,
                bin_location_id: sourceLocation,
                movement: "OUT",
                inventory_category: "Reserved",
              });

              // IN serial movement
              await db.collection("inv_serial_movement").add({
                inventory_movement_id: inMovementId,
                serial_number: serialNumber,
                item_id: gdLineItem.material_id,
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
                material_id: gdLineItem.material_id,
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
                material_id: gdLineItem.material_id,
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
                  material_id: gdLineItem.material_id,
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

      // Update GD line item with new temp_qty_data
      const updatedTempQtyDataJson = JSON.stringify(updatedTempQtyData);

      // Create updated view_stock summary
      const updatedViewStock = await createTempQtyDataSummary(
        updatedTempQtyData,
        gdLineItem,
        gdLineItem.material_id
      );

      // Find the line item in gdTableGd and update it
      const lineItemIndex = gdTableGd.findIndex(
        (item) => item.id === gdLineItem.id
      );

      if (lineItemIndex !== -1) {
        gdTableGd[lineItemIndex].temp_qty_data = updatedTempQtyDataJson;
        gdTableGd[lineItemIndex].view_stock = updatedViewStock;

        console.log(
          `Updated GD line item ${gdLineItem.id} temp_qty_data and view_stock`
        );
      }
    }

    // Update the entire GD document with modified table_gd
    await db.collection("goods_delivery").doc(gdId).update({
      table_gd: gdTableGd,
    });

    console.log("Updated Goods Delivery with new location data");

    // Update on_reserved_gd records
    const existingReserved = await db
      .collection("on_reserved_gd")
      .where({
        doc_type: "Good Delivery",
        doc_no: gdNo,
        organization_id: organizationId,
      })
      .get();

    if (existingReserved.data && existingReserved.data.length > 0) {
      console.log(
        `Found ${existingReserved.data.length} on_reserved_gd records to update`
      );

      const updatePromises = [];

      for (const reservedRecord of existingReserved.data) {
        // Find the corresponding line item in gdTableGd
        const matchingGDLineItem = gdTableGd.find(
          (item, index) => index + 1 === reservedRecord.line_no
        );

        if (matchingGDLineItem) {
          const matchingPickingItem = pickingItemsMap[matchingGDLineItem.id];

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

const updateGoodsDelivery = async (
  gdId,
  isAutoCompleteGD = 0,
  isLoadingBay = 0,
  organizationId,
  toData
) => {
  try {
    // Update each line item's picking status based on its line_status
    await Promise.all(
      toData.table_picking_items.map(async (toItem) => {
        // Map line_status to picking_status
        let linePickingStatus = "Created"; // Default
        if (toItem.line_status === "Completed") {
          linePickingStatus = "Completed";
        } else if (toItem.line_status === "In Progress") {
          linePickingStatus = "In Progress";
        } else if (toItem.line_status === "Cancelled") {
          linePickingStatus = "Cancelled";
        }

        return await db
          .collection("goods_delivery_fwii8mvb_sub")
          .doc(toItem.gd_line_id)
          .update({ picking_status: linePickingStatus });
      })
    );

    const gd = await db.collection("goods_delivery").doc(gdId).get();
    let gdData = gd.data[0];

    if (gdData.gd_status === "Cancelled") {
      console.log("GD is already cancelled");
      return;
    }

    const pickingStatus = gdData.picking_status;
    let newPickingStatus = "";

    if (pickingStatus === "Completed") {
      this.$message.error("Goods Delivery is already completed");
      return;
    }

    const isAllLineItemCompleted = gdData.table_gd
      .filter((lineItem) => {
        return (
          lineItem.material_id &&
          lineItem.material_id !== "" &&
          lineItem.material_id !== null
        );
      })
      .every((lineItem) => lineItem.picking_status === "Completed");

    if (isAllLineItemCompleted) {
      newPickingStatus = "Completed";
    } else {
      newPickingStatus = "In Progress";
    }

    await db.collection("goods_delivery").doc(gdId).update({
      picking_status: newPickingStatus,
    });

    if (isLoadingBay === 1 && newPickingStatus === "Completed") {
      await handleLoadingBayInventoryMovement(
        gdData,
        gdData.delivery_no,
        gdId,
        toData.table_picking_items,
        gdData.plant_id,
        organizationId
      );
    }

    // Check if we should auto-complete GD
    let shouldAutoComplete =
      isAutoCompleteGD === 1 && newPickingStatus === "Completed";

    if (shouldAutoComplete) {
      // Check credit limit before auto-completing GD
      console.log("Checking credit limit for auto-complete GD...");
      const creditCheckPassed = await checkCreditLimitForAutoComplete(
        gdData.customer_name,
        gdData.gd_total,
        gdData
      );

      if (!creditCheckPassed) {
        console.log(
          "Credit limit check failed - treating as if auto_completed_gd is 0"
        );
        shouldAutoComplete = false;
      }
    }

    if (shouldAutoComplete) {
      console.log("Auto-completing GD (credit limit check passed)");
      await db.collection("goods_delivery").doc(gdId).update({
        gd_status: "Completed",
      });

      await this.triggerEvent("func_processBalanceTable", {
        gdData,
      });

      await updateSalesOrderStatus(gdData.so_id, gdData.table_gd);

      await updateOnReserveGoodsDelivery(organizationId, gdData);
    }
  } catch (error) {
    this.$message.error("Error updating Goods Delivery picking status");
    console.error("Error flipping Goods Delivery picking status:", error);
  }
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

const updateOnReserveGoodsDelivery = async (organizationId, gdData) => {
  try {
    console.log(
      "Updating on_reserved_gd records for delivery (including serialized items):",
      gdData.delivery_no
    );

    // Get existing records for this GD
    const existingReserved = await db
      .collection("on_reserved_gd")
      .where({
        doc_no: gdData.delivery_no,
        organization_id: organizationId,
      })
      .get();

    // Prepare new data from current GD (including serialized items)
    const newReservedData = [];
    for (let i = 0; i < gdData.table_gd.length; i++) {
      const gdLineItem = gdData.table_gd[i];

      if (!gdLineItem.material_id || gdLineItem.material_id === "") {
        console.log(
          `Skipping item ${gdLineItem.material_id} due to no material_id`
        );
        continue;
      }

      const temp_qty_data = parseJsonSafely(gdLineItem.temp_qty_data);
      for (let j = 0; j < temp_qty_data.length; j++) {
        const tempItem = temp_qty_data[j];

        const reservedRecord = {
          doc_type: "Good Delivery",
          parent_no: gdLineItem.line_so_no,
          doc_no: gdData.delivery_no,
          material_id: gdLineItem.material_id,
          item_name: gdLineItem.material_name,
          item_desc: gdLineItem.gd_material_desc || "",
          batch_id: tempItem.batch_id || null,
          bin_location: tempItem.location_id,
          item_uom: gdLineItem.gd_order_uom_id,
          line_no: i + 1,
          reserved_qty: tempItem.gd_quantity,
          delivered_qty: tempItem.gd_quantity, // For Completed status, delivered = reserved
          open_qty: 0, // For Completed status, open_qty = 0
          reserved_date: new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
          plant_id: gdData.plant_id,
          organization_id: organizationId,
          updated_by: this.getVarGlobal("nickname"),
          updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        };

        // Add serial number for serialized items
        if (tempItem.serial_number) {
          reservedRecord.serial_number = tempItem.serial_number;
        }

        newReservedData.push(reservedRecord);
      }
    }

    if (existingReserved.data && existingReserved.data.length > 0) {
      console.log(
        `Found ${existingReserved.data.length} existing reserved records to update (including serialized items)`
      );

      const updatePromises = [];

      // Update existing records (up to the number of existing records)
      for (
        let i = 0;
        i < Math.min(existingReserved.data.length, newReservedData.length);
        i++
      ) {
        const existingRecord = existingReserved.data[i];
        const newData = newReservedData[i];

        updatePromises.push(
          db.collection("on_reserved_gd").doc(existingRecord.id).update(newData)
        );
      }

      // If there are more existing records than new data, delete the extras
      if (existingReserved.data.length > newReservedData.length) {
        for (
          let i = newReservedData.length;
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
      }

      // If there are more new records than existing, create the extras
      if (newReservedData.length > existingReserved.data.length) {
        for (
          let i = existingReserved.data.length;
          i < newReservedData.length;
          i++
        ) {
          const extraData = {
            ...newReservedData[i],
            created_by: this.getVarGlobal("nickname"),
            created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          };
          updatePromises.push(db.collection("on_reserved_gd").add(extraData));
        }
      }

      await Promise.all(updatePromises);
      console.log(
        "Successfully updated existing reserved records (including serialized items)"
      );
    } else {
      // No existing records, create new ones
      console.log(
        "No existing records found, creating new ones (including serialized items)"
      );

      const createPromises = newReservedData.map((data) => {
        return db.collection("on_reserved_gd").add({
          ...data,
          created_by: this.getVarGlobal("nickname"),
          created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        });
      });

      await Promise.all(createPromises);
      console.log(
        `Created ${newReservedData.length} new reserved goods records (including serialized items)`
      );
    }

    console.log(
      "Updated reserved goods records successfully (including serialized items)"
    );
  } catch (error) {
    console.error(
      "Error updating reserved goods delivery (serialized items):",
      error
    );
    throw error;
  }
};

const isPackingRequired = async (organizationId) => {
  try {
    const packingData = await db
      .collection("packing_setup")
      .where({ organization_id: organizationId })
      .get();
    return packingData.data[0].packing_required;
  } catch (error) {
    console.error("Error in isPacking:", error);
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
    const isLoadingBay = this.models["is_loading_bay"];

    console.log(
      `Page Status: ${page_status}, Original TO Status: ${originalToStatus}`
    );

    // Define required fields
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "to_id", label: "Transfer Order No" },
      { name: "movement_type", label: "Movement Type" },
      { name: "ref_doc_type", label: "Reference Document Type" },
      { name: "gd_no", label: "Reference Document No" },
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

    const isPacking = await isPackingRequired(organizationId);

    const tablePickingItems = this.getValue("table_picking_items");
    console.log("Table Picking Items:", tablePickingItems);
    // Validate quantities and update line statuses
    const { updatedItems, errors } =
      validateAndUpdateLineStatuses(tablePickingItems);

    console.log("Updated items:", updatedItems);

    if (errors.length > 0) {
      this.hideLoading();
      this.$message.error(errors.join("; "));
      return;
    }

    // Determine the new transfer order status dynamically based on picked quantities
    const newTransferOrderStatus = determineTransferOrderStatus(updatedItems);
    console.log(
      `Determined new transfer order status: ${newTransferOrderStatus}`
    );

    // Prepare transfer order object
    const toData = {
      to_status: newTransferOrderStatus,
      plant_id: data.plant_id,
      to_id: data.to_id,
      movement_type: data.movement_type,
      customer_id: data.customer_id,
      ref_doc_type: data.ref_doc_type,
      gd_no: data.gd_no,
      delivery_no: data.delivery_no,
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

    const isAutoCompleteGD = await db
      .collection("picking_setup")
      .where({
        plant_id: toData.plant_id,
        picking_after: "Goods Delivery",
        organization_id: organizationId,
      })
      .get()
      .then((res) => {
        if (res.data.length > 0) {
          return res.data[0].auto_completed_gd;
        }
      });

    let toId;

    // Perform action based on page status
    if (page_status === "Add") {
      await addEntry(organizationId, toData, isPacking);
      for (const gdId of data.gd_no) {
        await updateGoodsDelivery(
          gdId,
          isAutoCompleteGD,
          isLoadingBay,
          organizationId,
          toData
        );
      }
    } else if (page_status === "Edit") {
      toId = data.id;
      await updateEntry(
        organizationId,
        toData,
        toId,
        originalToStatus,
        isPacking
      );
      for (const gdId of data.gd_no) {
        await updateGoodsDelivery(
          gdId,
          isAutoCompleteGD,
          isLoadingBay,
          organizationId,
          toData
        );
      }
    }

    // Success message with status information
    const statusMessage =
      newTransferOrderStatus !== originalToStatus
        ? ` (Status updated to: ${newTransferOrderStatus})`
        : "";

    this.$message.success(
      `${
        page_status === "Add" ? "Added" : "Updated"
      } successfully${statusMessage}`
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
