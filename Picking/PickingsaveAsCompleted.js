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

// Update FIFO inventory
const updateFIFOInventory = (materialId, deliveryQty, batchId, plantId) => {
  return new Promise((resolve, reject) => {
    const query = batchId
      ? db.collection("fifo_costing_history").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db
          .collection("fifo_costing_history")
          .where({ material_id: materialId, plant_id: plantId });

    query
      .get()
      .then((response) => {
        const result = response.data;

        if (result && Array.isArray(result) && result.length > 0) {
          // Sort by FIFO sequence (lowest/oldest first)
          const sortedRecords = result.sort(
            (a, b) => a.fifo_sequence - b.fifo_sequence
          );

          let remainingQtyToDeduct = parseFloat(deliveryQty);
          console.log(
            `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory`
          );

          // Process each FIFO record in sequence until we've accounted for all delivery quantity
          for (const record of sortedRecords) {
            if (remainingQtyToDeduct <= 0) {
              break;
            }

            const availableQty = roundQty(record.fifo_available_quantity || 0);
            console.log(
              `FIFO record ${record.fifo_sequence} has ${availableQty} available`
            );

            // Calculate how much to take from this record
            const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
            const newAvailableQty = roundQty(availableQty - qtyToDeduct);

            console.log(
              `Deducting ${qtyToDeduct} from FIFO record ${record.fifo_sequence}, new available: ${newAvailableQty}`
            );

            // Update this FIFO record
            db.collection("fifo_costing_history")
              .doc(record.id)
              .update({
                fifo_available_quantity: newAvailableQty,
              })
              .catch((error) =>
                console.error(
                  `Error updating FIFO record ${record.fifo_sequence}:`,
                  error
                )
              );

            // Reduce the remaining quantity to deduct
            remainingQtyToDeduct -= qtyToDeduct;
          }

          if (remainingQtyToDeduct > 0) {
            console.warn(
              `Warning: Couldn't fully satisfy FIFO deduction. Remaining qty: ${remainingQtyToDeduct}`
            );
          }
        } else {
          console.warn(`No FIFO records found for material ${materialId}`);
        }
      })
      .catch((error) =>
        console.error(
          `Error retrieving FIFO history for material ${materialId}:`,
          error
        )
      )
      .then(() => {
        resolve();
      })
      .catch((error) => {
        console.error(`Error in FIFO update:`, error);
        reject(error);
      });
  });
};

const updateWeightedAverage = (item, batchId, baseWAQty, plantId) => {
  // Input validation
  if (
    !item ||
    !item.material_id ||
    isNaN(parseFloat(baseWAQty)) ||
    parseFloat(baseWAQty) <= 0
  ) {
    console.error("Invalid item data for weighted average update:", item);
    return Promise.resolve();
  }

  const deliveredQty = parseFloat(baseWAQty);
  const query = batchId
    ? db.collection("wa_costing_method").where({
        material_id: item.material_id,
        batch_id: batchId,
        plant_id: plantId,
      })
    : db
        .collection("wa_costing_method")
        .where({ material_id: item.material_id, plant_id: plantId });

  return query
    .get()
    .then((waResponse) => {
      const waData = waResponse.data;
      if (!waData || !Array.isArray(waData) || waData.length === 0) {
        console.warn(
          `No weighted average records found for material ${item.material_id}`
        );
        return Promise.resolve();
      }

      // Sort by date (newest first) to get the latest record
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      const waDoc = waData[0];
      const waCostPrice = roundPrice(waDoc.wa_cost_price || 0);
      const waQuantity = roundQty(waDoc.wa_quantity || 0);

      if (waQuantity <= deliveredQty) {
        console.warn(
          `Warning: Cannot fully update weighted average for ${item.material_id} - ` +
            `Available: ${waQuantity}, Requested: ${deliveredQty}`
        );

        if (waQuantity <= 0) {
          return Promise.resolve();
        }
      }

      const newWaQuantity = Math.max(0, roundQty(waQuantity - deliveredQty));

      // If new quantity would be zero, handle specially
      if (newWaQuantity === 0) {
        return db
          .collection("wa_costing_method")
          .doc(waDoc.id)
          .update({
            wa_quantity: 0,
            updated_at: new Date(),
          })
          .then(() => {
            console.log(
              `Updated Weighted Average for item ${item.material_id} to zero quantity`
            );
            return Promise.resolve();
          });
      }

      // const calculatedWaCostPrice = roundPrice(
      //   (waCostPrice * waQuantity - waCostPrice * deliveredQty) / newWaQuantity
      // );
      // const newWaCostPrice = Math.round(calculatedWaCostPrice * 10000) / 10000;

      return db
        .collection("wa_costing_method")
        .doc(waDoc.id)
        .update({
          wa_quantity: newWaQuantity,
          wa_cost_price: waCostPrice,
          updated_at: new Date(),
        })
        .then(() => {
          console.log(
            `Successfully processed Weighted Average for item ${item.material_id}, ` +
              `new quantity: ${newWaQuantity}, new cost price: ${waCostPrice}`
          );
          return Promise.resolve();
        });
    })
    .catch((error) => {
      console.error(
        `Error processing Weighted Average for item ${
          item?.material_id || "unknown"
        }:`,
        error
      );
      return Promise.reject(error);
    });
};

// Function to get latest FIFO cost price with available quantity check
const getLatestFIFOCostPrice = async (
  materialId,
  batchId,
  deductionQty = null,
  previouslyConsumedQty = 0,
  plantId
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
      // Sort by FIFO sequence (lowest/oldest first, as per FIFO principle)
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      // Process previously consumed quantities to simulate their effect on available quantities
      if (previouslyConsumedQty > 0) {
        let qtyToSkip = previouslyConsumedQty;

        console.log(
          `Adjusting for ${previouslyConsumedQty} units already consumed in this transaction`
        );

        // Simulate the effect of previous consumption on available quantities
        for (let i = 0; i < sortedRecords.length && qtyToSkip > 0; i++) {
          const record = sortedRecords[i];
          const availableQty = roundQty(record.fifo_available_quantity || 0);

          if (availableQty <= 0) continue;

          // If this record has enough quantity, just reduce it
          if (availableQty >= qtyToSkip) {
            record._adjustedAvailableQty = roundQty(availableQty - qtyToSkip);
            console.log(
              `FIFO record ${record.fifo_sequence}: Adjusted available from ${availableQty} to ${record._adjustedAvailableQty} (consumed ${qtyToSkip})`
            );
            qtyToSkip = 0;
          } else {
            // Otherwise, consume all of this record and continue to next
            record._adjustedAvailableQty = 0;
            console.log(
              `FIFO record ${record.fifo_sequence}: Fully consumed ${availableQty} units, no remainder`
            );
            qtyToSkip = roundQty(qtyToSkip - availableQty);
          }
        }

        if (qtyToSkip > 0) {
          console.warn(
            `Warning: Could not account for all previously consumed quantity. Remaining: ${qtyToSkip}`
          );
        }
      }

      // If no deduction quantity is provided, just return the cost price of the first record with available quantity
      if (!deductionQty) {
        // First look for records with available quantity
        for (const record of sortedRecords) {
          // Use adjusted quantity if available, otherwise use original
          const availableQty = roundQty(
            record._adjustedAvailableQty !== undefined
              ? record._adjustedAvailableQty
              : record.fifo_available_quantity || 0
          );

          if (availableQty > 0) {
            console.log(
              `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
            );
            return roundPrice(record.fifo_cost_price || 0);
          }
        }

        // If no records with available quantity, use the most recent record
        console.warn(
          `No FIFO records with available quantity found for ${materialId}, using most recent cost price`
        );
        return roundPrice(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
      }

      // If deduction quantity is provided, calculate weighted average cost price across multiple FIFO records
      let remainingQtyToDeduct = roundQty(deductionQty);
      let totalCost = 0;
      let totalDeductedQty = 0;

      // Log the calculation process
      console.log(
        `Calculating weighted average FIFO cost for ${materialId}, deduction quantity: ${remainingQtyToDeduct}`
      );

      // Process each FIFO record in sequence until we've accounted for all deduction quantity
      for (const record of sortedRecords) {
        if (remainingQtyToDeduct <= 0) {
          break;
        }

        // Use adjusted quantity if available, otherwise use original
        const availableQty = roundQty(
          record._adjustedAvailableQty !== undefined
            ? record._adjustedAvailableQty
            : record.fifo_available_quantity || 0
        );

        if (availableQty <= 0) {
          continue; // Skip records with no available quantity
        }

        const costPrice = roundPrice(record.fifo_cost_price || 0);
        const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);

        const costContribution = roundPrice(qtyToDeduct * costPrice);
        totalCost = roundPrice(totalCost + costContribution);
        totalDeductedQty = roundQty(totalDeductedQty + qtyToDeduct);

        console.log(
          `FIFO record ${record.fifo_sequence}: Deducting ${qtyToDeduct} units at ${costPrice} per unit = ${costContribution}`
        );

        remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
      }

      // If we couldn't satisfy the full deduction from available records, issue a warning
      if (remainingQtyToDeduct > 0) {
        console.warn(
          `Warning: Not enough FIFO quantity available. Remaining to deduct: ${remainingQtyToDeduct}`
        );

        // For the remaining quantity, use the last record's cost price
        if (sortedRecords.length > 0) {
          const lastRecord = sortedRecords[sortedRecords.length - 1];
          const lastCostPrice = roundPrice(lastRecord.fifo_cost_price || 0);

          console.log(
            `Using last FIFO record's cost price (${lastCostPrice}) for remaining ${remainingQtyToDeduct} units`
          );

          const additionalCost = roundPrice(
            remainingQtyToDeduct * lastCostPrice
          );
          totalCost = roundPrice(totalCost + additionalCost);
          totalDeductedQty = roundQty(totalDeductedQty + remainingQtyToDeduct);
        }
      }

      // Calculate the weighted average cost price
      if (totalDeductedQty > 0) {
        const weightedAvgCost = roundPrice(totalCost / totalDeductedQty);
        console.log(
          `Weighted Average FIFO Cost: ${totalCost} / ${totalDeductedQty} = ${weightedAvgCost}`
        );
        return weightedAvgCost;
      }

      // Fallback to first record with cost if no quantity could be deducted
      return roundPrice(sortedRecords[0].fifo_cost_price || 0);
    }

    console.warn(`No FIFO records found for material ${materialId}`);
    return 0;
  } catch (error) {
    console.error(`Error retrieving FIFO cost price for ${materialId}:`, error);
    return 0;
  }
};

// Function to get Weighted Average cost price
const getWeightedAverageCostPrice = async (materialId, batchId, plantId) => {
  try {
    const query = batchId
      ? db.collection("wa_costing_method").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db
          .collection("wa_costing_method")
          .where({ material_id: materialId, plant_id: plantId });

    const response = await query.get();
    const waData = response.data;

    if (waData && Array.isArray(waData) && waData.length > 0) {
      // Sort by date (newest first) to get the latest record
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      return roundPrice(waData[0].wa_cost_price || 0);
    }

    console.warn(
      `No weighted average records found for material ${materialId}`
    );
    return 0;
  } catch (error) {
    console.error(`Error retrieving WA cost price for ${materialId}:`, error);
    return 0;
  }
};

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

const processBalanceTable = async (
  data,
  isUpdate,
  plantId,
  organizationId,
  gdStatus
) => {
  console.log(
    "Processing balance table with grouped movements (including serialized items)"
  );
  const items = data.table_gd;

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to process");
    return Promise.resolve();
  }

  // Create a map to track consumed FIFO quantities during this transaction
  const consumedFIFOQty = new Map();

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    const updatedDocs = [];
    const createdDocs = [];

    try {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      // Input validation
      if (!item.material_id || !item.temp_qty_data) {
        console.error(`Invalid item data for index ${itemIndex}:`, item);
        continue;
      }

      // First check if this item should be processed based on stock_control
      const itemRes = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.material_id}`);
        return;
      }

      const itemData = itemRes.data[0];
      if (itemData.stock_control === 0) {
        console.log(
          `Skipping inventory update for item ${item.material_id} (stock_control=0)`
        );
        return;
      }

      // Check if item is serialized
      const isSerializedItem = itemData.serial_number_management === 1;
      const isBatchManagedItem = itemData.item_batch_management === 1;

      console.log(
        `Item ${item.material_id}: Serialized=${isSerializedItem}, Batch=${isBatchManagedItem}`
      );

      const temporaryData = parseJsonSafely(item.temp_qty_data);
      const prevTempData = isUpdate
        ? parseJsonSafely(item.prev_temp_qty_data)
        : null;

      if (
        temporaryData.length > 0 &&
        (!isUpdate || (prevTempData && prevTempData.length > 0))
      ) {
        // GROUP temp_qty_data by location + batch combination for movement consolidation
        const groupedTempData = new Map();

        for (const temp of temporaryData) {
          // Create grouping key based on location and batch (if applicable)
          let groupKey;
          if (isBatchManagedItem && temp.batch_id) {
            groupKey = `${temp.location_id}|${temp.batch_id}`;
          } else {
            groupKey = temp.location_id;
          }

          if (!groupedTempData.has(groupKey)) {
            groupedTempData.set(groupKey, {
              location_id: temp.location_id,
              batch_id: temp.batch_id,
              items: [],
              totalQty: 0,
            });
          }

          const group = groupedTempData.get(groupKey);
          group.items.push(temp);
          group.totalQty += parseFloat(temp.gd_quantity || 0);
        }

        console.log(
          `Grouped ${temporaryData.length} items into ${groupedTempData.size} movement groups`
        );

        // Process each group to create consolidated movements
        for (const [groupKey, group] of groupedTempData) {
          console.log(
            `Processing group: ${groupKey} with ${group.items.length} items, total qty: ${group.totalQty}`
          );

          // UOM Conversion for the group
          let altQty = roundQty(group.totalQty);
          let baseQty = altQty;
          let altUOM = item.gd_order_uom_id;
          let baseUOM = itemData.based_uom;
          let altWAQty = roundQty(item.gd_qty);
          let baseWAQty = altWAQty;
          let uomConversion = null;

          if (
            Array.isArray(itemData.table_uom_conversion) &&
            itemData.table_uom_conversion.length > 0
          ) {
            console.log(`Checking UOM conversions for item ${item.item_id}`);

            uomConversion = itemData.table_uom_conversion.find(
              (conv) => conv.alt_uom_id === altUOM
            );

            if (uomConversion) {
              console.log(
                `Found UOM conversion: 1 ${uomConversion.alt_uom_id} = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
              );

              baseQty = roundQty(altQty / uomConversion.alt_qty);
              baseWAQty = roundQty(altWAQty / uomConversion.alt_qty);

              console.log(
                `Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`
              );
            } else {
              console.log(`No conversion found for UOM ${altUOM}, using as-is`);
            }
          } else {
            console.log(
              `No UOM conversion table for item ${item.item_id}, using received quantity as-is`
            );
          }

          // Calculate previous quantities for this specific GD group
          let prevBaseQty = 0;
          if (isUpdate && prevTempData) {
            // Find matching previous group quantities
            for (const prevTemp of prevTempData) {
              let prevGroupKey;
              if (isBatchManagedItem && prevTemp.batch_id) {
                prevGroupKey = `${prevTemp.location_id}|${prevTemp.batch_id}`;
              } else {
                prevGroupKey = prevTemp.location_id;
              }

              if (prevGroupKey === groupKey) {
                let prevAltQty = roundQty(prevTemp.gd_quantity);
                let currentPrevBaseQty = prevAltQty;

                if (uomConversion) {
                  currentPrevBaseQty = roundQty(
                    prevAltQty * uomConversion.base_qty
                  );
                }
                prevBaseQty += currentPrevBaseQty;
              }
            }
            console.log(
              `Previous quantity for this GD group ${groupKey}: ${prevBaseQty}`
            );
          }

          const costingMethod = itemData.material_costing_method;

          let unitPrice = roundPrice(item.unit_price);
          let totalPrice = roundPrice(unitPrice * altQty);

          if (costingMethod === "First In First Out") {
            // Define a key for tracking consumed FIFO quantities
            const materialBatchKey = group.batch_id
              ? `${item.material_id}-${group.batch_id}`
              : item.material_id;

            // Get previously consumed quantity (default to 0 if none)
            const previouslyConsumedQty =
              consumedFIFOQty.get(materialBatchKey) || 0;

            // Get unit price from latest FIFO sequence with awareness of consumed quantities
            const fifoCostPrice = await getLatestFIFOCostPrice(
              item.material_id,
              group.batch_id,
              baseQty,
              previouslyConsumedQty,
              plantId
            );

            // Update the consumed quantity for this material/batch
            consumedFIFOQty.set(
              materialBatchKey,
              previouslyConsumedQty + baseQty
            );

            unitPrice = roundPrice(fifoCostPrice);
            totalPrice = roundPrice(fifoCostPrice * baseQty);
          } else if (costingMethod === "Weighted Average") {
            // Get unit price from WA cost price
            const waCostPrice = await getWeightedAverageCostPrice(
              item.material_id,
              group.batch_id,
              plantId
            );
            unitPrice = roundPrice(waCostPrice);
            totalPrice = roundPrice(waCostPrice * baseQty);
          } else if (costingMethod === "Fixed Cost") {
            // Get unit price from Fixed Cost
            const fixedCostPrice = await getFixedCostPrice(item.material_id);
            unitPrice = roundPrice(fixedCostPrice);
            totalPrice = roundPrice(fixedCostPrice * baseQty);
          } else {
            return Promise.resolve();
          }

          // Get current balance to determine smart movement logic
          let itemBalanceParams = {
            material_id: item.material_id,
            plant_id: plantId,
            organization_id: organizationId,
          };

          let balanceCollection;
          let hasExistingBalance = false;
          let existingDoc = null;

          if (isSerializedItem) {
            // For serialized items, we'll process balance updates individually
            // but create consolidated movements
            console.log(
              `Processing serialized item group with ${group.items.length} serials`
            );
          } else {
            // For non-serialized items, use location-based balance
            itemBalanceParams.location_id = group.location_id;

            if (group.batch_id) {
              itemBalanceParams.batch_id = group.batch_id;
              balanceCollection = "item_batch_balance";
            } else {
              balanceCollection = "item_balance";
            }

            const balanceQuery = await db
              .collection(balanceCollection)
              .where(itemBalanceParams)
              .get();

            hasExistingBalance =
              balanceQuery.data &&
              Array.isArray(balanceQuery.data) &&
              balanceQuery.data.length > 0;
            existingDoc = hasExistingBalance ? balanceQuery.data[0] : null;
          }

          // Create base inventory movement data (CONSOLIDATED)
          const baseInventoryMovement = {
            transaction_type: "GDL",
            trx_no: data.delivery_no,
            parent_trx_no: item.line_so_no,
            unit_price: unitPrice,
            total_price: totalPrice,
            quantity: altQty, // CONSOLIDATED quantity
            item_id: item.material_id,
            uom_id: altUOM,
            base_qty: baseQty, // CONSOLIDATED base quantity
            base_uom_id: baseUOM,
            bin_location_id: group.location_id,
            batch_number_id: group.batch_id || null,
            costing_method_id: item.item_costing_method,
            plant_id: plantId,
            organization_id: organizationId,
            is_deleted: 0,
          };

          let totalGroupUnrestricted = 0;
          let totalGroupReserved = 0;
          let serialBalances = [];

          // Handle balance logic for serialized vs non-serialized items
          if (isSerializedItem) {
            // For serialized items, we need to calculate group totals instead of using first serial's balance
            console.log(
              `Processing serialized item group with ${group.items.length} serials individually for balance calculations`
            );

            for (const temp of group.items) {
              if (temp.serial_number) {
                const serialBalanceParams = {
                  material_id: item.material_id,
                  serial_number: temp.serial_number,
                  plant_id: plantId,
                  organization_id: organizationId,
                  location_id: temp.location_id,
                };

                if (isBatchManagedItem && temp.batch_id) {
                  serialBalanceParams.batch_id = temp.batch_id;
                }

                try {
                  const serialBalanceQuery = await db
                    .collection("item_serial_balance")
                    .where(serialBalanceParams)
                    .get();

                  if (
                    serialBalanceQuery.data &&
                    serialBalanceQuery.data.length > 0
                  ) {
                    const balance = serialBalanceQuery.data[0];
                    const unrestrictedQty = roundQty(
                      parseFloat(balance.unrestricted_qty || 0)
                    );
                    const reservedQty = roundQty(
                      parseFloat(balance.reserved_qty || 0)
                    );

                    totalGroupUnrestricted += unrestrictedQty;
                    totalGroupReserved += reservedQty;

                    serialBalances.push({
                      serial: temp.serial_number,
                      balance: balance,
                      unrestricted: unrestrictedQty,
                      reserved: reservedQty,
                      individualQty: roundQty(temp.gd_quantity),
                      individualBaseQty: uomConversion
                        ? roundQty(temp.gd_quantity * uomConversion.base_qty)
                        : roundQty(temp.gd_quantity),
                    });

                    console.log(
                      `Serial ${temp.serial_number}: Unrestricted=${unrestrictedQty}, Reserved=${reservedQty}`
                    );
                  } else {
                    console.warn(
                      `No balance found for serial: ${temp.serial_number}`
                    );
                  }
                } catch (balanceError) {
                  console.error(
                    `Error fetching balance for serial ${temp.serial_number}:`,
                    balanceError
                  );
                  throw balanceError;
                }
              }
            }

            console.log(
              `Group ${groupKey} totals: Unrestricted=${totalGroupUnrestricted}, Reserved=${totalGroupReserved}, Required=${baseQty}`
            );

            // Use group totals for movement logic decisions instead of single serial balance
            hasExistingBalance = serialBalances.length > 0;
            existingDoc = hasExistingBalance
              ? {
                  unrestricted_qty: totalGroupUnrestricted,
                  reserved_qty: totalGroupReserved,
                  id: "group_total", // Dummy ID for group processing
                }
              : null;
          } else {
            // Keep your existing non-serialized logic unchanged
            itemBalanceParams.location_id = group.location_id;

            if (group.batch_id) {
              itemBalanceParams.batch_id = group.batch_id;
              balanceCollection = "item_batch_balance";
            } else {
              balanceCollection = "item_balance";
            }

            const balanceQuery = await db
              .collection(balanceCollection)
              .where(itemBalanceParams)
              .get();

            hasExistingBalance =
              balanceQuery.data &&
              Array.isArray(balanceQuery.data) &&
              balanceQuery.data.length > 0;
            existingDoc = hasExistingBalance ? balanceQuery.data[0] : null;
          }

          if (existingDoc && existingDoc.id) {
            // Get current balance quantities (from representative document)
            let currentUnrestrictedQty = roundQty(
              parseFloat(existingDoc.unrestricted_qty || 0)
            );
            let currentReservedQty = roundQty(
              parseFloat(existingDoc.reserved_qty || 0)
            );
            let currentBalanceQty = isSerializedItem
              ? roundQty(currentUnrestrictedQty + currentReservedQty)
              : roundQty(parseFloat(existingDoc.balance_quantity || 0));

            console.log(
              `Current inventory for group ${groupKey}${
                isSerializedItem
                  ? ` (Reference Serial: ${group.items[0].serial_number})`
                  : ""
              }:`
            );
            console.log(`  Unrestricted: ${currentUnrestrictedQty}`);
            console.log(`  Reserved: ${currentReservedQty}`);
            console.log(`  Total Balance: ${currentBalanceQty}`);

            // Smart movement logic based on status and available quantities
            if (gdStatus === "Created") {
              // For Created status, we need to move OUT from Reserved
              console.log(
                `Processing Created status - moving ${baseQty} OUT from Reserved for group ${groupKey}`
              );

              // For edit mode, we can only use the reserved quantity that this GD previously created
              let availableReservedForThisGD = currentReservedQty;
              if (isUpdate && prevBaseQty > 0) {
                // In edit mode, we can only take up to what this GD previously reserved
                availableReservedForThisGD = Math.min(
                  currentReservedQty,
                  prevBaseQty
                );
                console.log(
                  `This GD previously reserved for group ${groupKey}: ${prevBaseQty}`
                );
                console.log(
                  `Available reserved for this GD: ${availableReservedForThisGD}`
                );
              }

              if (availableReservedForThisGD >= baseQty) {
                // Sufficient reserved quantity from this GD - create single OUT movement from Reserved
                console.log(
                  `Sufficient reserved quantity for this GD (${availableReservedForThisGD}) for ${baseQty}`
                );

                const inventoryMovementData = {
                  ...baseInventoryMovement,
                  movement: "OUT",
                  inventory_category: "Reserved",
                };

                await db
                  .collection("inventory_movement")
                  .add(inventoryMovementData);

                // Wait and fetch the created movement ID
                await new Promise((resolve) => setTimeout(resolve, 100));

                const movementQuery = await db
                  .collection("inventory_movement")
                  .where({
                    transaction_type: "GDL",
                    trx_no: data.delivery_no,
                    parent_trx_no: item.line_so_no,
                    movement: "OUT",
                    inventory_category: "Reserved",
                    item_id: item.material_id,
                    bin_location_id: group.location_id,
                    base_qty: baseQty,
                    plant_id: plantId,
                    organization_id: organizationId,
                  })
                  .get();

                if (movementQuery.data && movementQuery.data.length > 0) {
                  const movementId = movementQuery.data.sort(
                    (a, b) => new Date(b.create_time) - new Date(a.create_time)
                  )[0].id;

                  createdDocs.push({
                    collection: "inventory_movement",
                    docId: movementId,
                    groupKey: groupKey,
                  });

                  console.log(
                    `Created consolidated OUT movement from Reserved for group ${groupKey}: ${baseQty}, ID: ${movementId}`
                  );
                }
              } else {
                // Insufficient reserved quantity for this GD - split between Reserved and Unrestricted
                const reservedQtyToMove = availableReservedForThisGD;
                const unrestrictedQtyToMove = roundQty(
                  baseQty - reservedQtyToMove
                );

                console.log(
                  `Insufficient reserved quantity for this GD. Splitting group ${groupKey}:`
                );
                console.log(
                  `  OUT ${reservedQtyToMove} from Reserved (from this GD's allocation)`
                );
                console.log(
                  `  OUT ${unrestrictedQtyToMove} from Unrestricted (additional quantity)`
                );

                if (reservedQtyToMove > 0) {
                  // Create movement for Reserved portion
                  const reservedAltQty = roundQty(
                    (reservedQtyToMove / baseQty) * altQty
                  );
                  const reservedTotalPrice = roundPrice(
                    unitPrice * reservedAltQty
                  );

                  const reservedMovementData = {
                    ...baseInventoryMovement,
                    movement: "OUT",
                    inventory_category: "Reserved",
                    quantity: reservedAltQty,
                    total_price: reservedTotalPrice,
                    base_qty: reservedQtyToMove,
                  };

                  await db
                    .collection("inventory_movement")
                    .add(reservedMovementData);

                  // Wait and fetch the reserved movement ID
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const reservedMovementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: data.delivery_no,
                      parent_trx_no: item.line_so_no,
                      movement: "OUT",
                      inventory_category: "Reserved",
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      base_qty: reservedQtyToMove,
                      plant_id: plantId,
                      organization_id: organizationId,
                    })
                    .get();

                  if (
                    reservedMovementQuery.data &&
                    reservedMovementQuery.data.length > 0
                  ) {
                    const reservedMovementId = reservedMovementQuery.data.sort(
                      (a, b) =>
                        new Date(b.create_time) - new Date(a.create_time)
                    )[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: reservedMovementId,
                      groupKey: groupKey,
                    });

                    console.log(
                      `Created consolidated OUT movement from Reserved for group ${groupKey}: ${reservedQtyToMove}, ID: ${reservedMovementId}`
                    );
                  }
                }

                if (unrestrictedQtyToMove > 0) {
                  // Create movement for Unrestricted portion
                  const unrestrictedAltQty = roundQty(
                    (unrestrictedQtyToMove / baseQty) * altQty
                  );
                  const unrestrictedTotalPrice = roundPrice(
                    unitPrice * unrestrictedAltQty
                  );

                  const unrestrictedMovementData = {
                    ...baseInventoryMovement,
                    movement: "OUT",
                    inventory_category: "Unrestricted",
                    quantity: unrestrictedAltQty,
                    total_price: unrestrictedTotalPrice,
                    base_qty: unrestrictedQtyToMove,
                  };

                  await db
                    .collection("inventory_movement")
                    .add(unrestrictedMovementData);

                  // Wait and fetch the unrestricted movement ID
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const unrestrictedMovementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: data.delivery_no,
                      parent_trx_no: item.line_so_no,
                      movement: "OUT",
                      inventory_category: "Unrestricted",
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      base_qty: unrestrictedQtyToMove,
                      plant_id: plantId,
                      organization_id: organizationId,
                    })
                    .get();

                  if (
                    unrestrictedMovementQuery.data &&
                    unrestrictedMovementQuery.data.length > 0
                  ) {
                    const unrestrictedMovementId =
                      unrestrictedMovementQuery.data.sort(
                        (a, b) =>
                          new Date(b.create_time) - new Date(a.create_time)
                      )[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: unrestrictedMovementId,
                      groupKey: groupKey,
                    });

                    console.log(
                      `Created consolidated OUT movement from Unrestricted for group ${groupKey}: ${unrestrictedQtyToMove}, ID: ${unrestrictedMovementId}`
                    );
                  }
                }
              }

              // ADDED: Handle unused reserved quantities for the group
              if (isUpdate && prevBaseQty > 0) {
                const deliveredQty = baseQty;
                const originalReservedQty = prevBaseQty;
                const unusedReservedQty = roundQty(
                  originalReservedQty - deliveredQty
                );

                console.log(
                  `Checking for unused reservations for group ${groupKey}:`
                );
                console.log(`  Originally reserved: ${originalReservedQty}`);
                console.log(`  Actually delivered: ${deliveredQty}`);
                console.log(`  Unused reserved: ${unusedReservedQty}`);

                if (unusedReservedQty > 0) {
                  console.log(
                    `Releasing ${unusedReservedQty} unused reserved quantity back to unrestricted for group ${groupKey}`
                  );

                  // Calculate alternative UOM for unused quantity
                  const unusedAltQty = uomConversion
                    ? roundQty(unusedReservedQty / uomConversion.base_qty)
                    : unusedReservedQty;

                  // Create movement to release unused reserved back to unrestricted
                  const releaseReservedMovementData = {
                    ...baseInventoryMovement,
                    movement: "OUT",
                    inventory_category: "Reserved",
                    quantity: unusedAltQty,
                    total_price: roundPrice(unitPrice * unusedAltQty),
                    base_qty: unusedReservedQty,
                  };

                  const returnUnrestrictedMovementData = {
                    ...baseInventoryMovement,
                    movement: "IN",
                    inventory_category: "Unrestricted",
                    quantity: unusedAltQty,
                    total_price: roundPrice(unitPrice * unusedAltQty),
                    base_qty: unusedReservedQty,
                  };

                  // Add the release movements
                  await db
                    .collection("inventory_movement")
                    .add(releaseReservedMovementData);
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const releaseMovementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: data.delivery_no,
                      parent_trx_no: item.line_so_no,
                      movement: "OUT",
                      inventory_category: "Reserved",
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      base_qty: unusedReservedQty,
                      plant_id: plantId,
                      organization_id: organizationId,
                    })
                    .get();

                  if (
                    releaseMovementQuery.data &&
                    releaseMovementQuery.data.length > 0
                  ) {
                    const movementId = releaseMovementQuery.data.sort(
                      (a, b) =>
                        new Date(b.create_time) - new Date(a.create_time)
                    )[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: movementId,
                      groupKey: groupKey,
                    });
                  }

                  await db
                    .collection("inventory_movement")
                    .add(returnUnrestrictedMovementData);
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const returnMovementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: data.delivery_no,
                      parent_trx_no: item.line_so_no,
                      movement: "IN",
                      inventory_category: "Unrestricted",
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      base_qty: unusedReservedQty,
                      plant_id: plantId,
                      organization_id: organizationId,
                    })
                    .get();

                  if (
                    returnMovementQuery.data &&
                    returnMovementQuery.data.length > 0
                  ) {
                    const movementId = returnMovementQuery.data.sort(
                      (a, b) =>
                        new Date(b.create_time) - new Date(a.create_time)
                    )[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: movementId,
                      groupKey: groupKey,
                    });
                  }

                  console.log(
                    `Created unused reserved release movements for group ${groupKey}: ${unusedReservedQty}`
                  );
                }
              }
            } else {
              // For non-Created status (Unrestricted movement)
              console.log(
                `Processing ${gdStatus} status - moving ${baseQty} OUT from Unrestricted for group ${groupKey}`
              );

              const inventoryMovementData = {
                ...baseInventoryMovement,
                movement: "OUT",
                inventory_category: "Unrestricted",
              };

              await db
                .collection("inventory_movement")
                .add(inventoryMovementData);

              // Wait and fetch the created movement ID
              await new Promise((resolve) => setTimeout(resolve, 100));

              const movementQuery = await db
                .collection("inventory_movement")
                .where({
                  transaction_type: "GDL",
                  trx_no: data.delivery_no,
                  parent_trx_no: item.line_so_no,
                  movement: "OUT",
                  inventory_category: "Unrestricted",
                  item_id: item.material_id,
                  bin_location_id: group.location_id,
                  base_qty: baseQty,
                  plant_id: plantId,
                  organization_id: organizationId,
                })
                .get();

              if (movementQuery.data && movementQuery.data.length > 0) {
                const movementId = movementQuery.data.sort(
                  (a, b) => new Date(b.create_time) - new Date(a.create_time)
                )[0].id;

                createdDocs.push({
                  collection: "inventory_movement",
                  docId: movementId,
                  groupKey: groupKey,
                });

                console.log(
                  `Created consolidated OUT movement from Unrestricted for group ${groupKey}: ${baseQty}, ID: ${movementId}`
                );
              }
            }

            // Create INDIVIDUAL inv_serial_movement records for each serial in the group
            if (isSerializedItem) {
              console.log(
                `Creating inv_serial_movement records for ${group.items.length} serialized items`
              );

              // Use movements created specifically for this group during the above processing
              // Filter movements by exact group key to ensure we only get movements for this specific group
              const currentGroupMovements = createdDocs.filter(
                (doc) =>
                  doc.collection === "inventory_movement" &&
                  doc.groupKey === groupKey // Add groupKey during movement creation
              );

              const outMovements = currentGroupMovements;

              console.log(
                `Found ${outMovements.length} OUT movements to process for serial records`
              );

              // For each movement, create individual inv_serial_movement records for EACH serial number
              for (const movement of outMovements) {
                console.log(`Processing movement ID: ${movement.docId}`);

                // Get the movement details using WHERE query instead of doc()
                const movementQuery = await db
                  .collection("inventory_movement")
                  .where({ id: movement.docId })
                  .get();

                if (
                  movementQuery.data &&
                  movementQuery.data.length > 0 &&
                  movementQuery.data[0].movement === "OUT"
                ) {
                  const movementData = movementQuery.data[0];
                  console.log(
                    `Movement ${movement.docId} confirmed as OUT movement with category: ${movementData.inventory_category}`
                  );

                  // Create one inv_serial_movement record for EACH serial number
                  for (
                    let serialIndex = 0;
                    serialIndex < group.items.length;
                    serialIndex++
                  ) {
                    const temp = group.items[serialIndex];

                    if (temp.serial_number) {
                      console.log(
                        `Processing serial ${serialIndex + 1}/${
                          group.items.length
                        }: ${temp.serial_number}`
                      );

                      // Calculate individual base qty for this serial
                      let individualBaseQty = roundQty(temp.gd_quantity);
                      if (uomConversion) {
                        individualBaseQty = roundQty(
                          individualBaseQty * uomConversion.base_qty
                        );
                      }

                      console.log(
                        `Creating inv_serial_movement for serial ${temp.serial_number}, individual qty: ${individualBaseQty}, movement: ${movement.docId}`
                      );

                      try {
                        await db.collection("inv_serial_movement").add({
                          inventory_movement_id: movement.docId,
                          serial_number: temp.serial_number,
                          batch_id: temp.batch_id || null,
                          base_qty: individualBaseQty,
                          base_uom: baseUOM,
                          plant_id: plantId,
                          organization_id: organizationId,
                        });

                        console.log(
                          `✓ Successfully added inv_serial_movement for serial ${temp.serial_number}`
                        );

                        // Wait and get the created ID for tracking
                        await new Promise((resolve) =>
                          setTimeout(resolve, 100)
                        );

                        const serialMovementQuery = await db
                          .collection("inv_serial_movement")
                          .where({
                            inventory_movement_id: movement.docId,
                            serial_number: temp.serial_number,
                            plant_id: plantId,
                            organization_id: organizationId,
                          })
                          .get();

                        if (
                          serialMovementQuery.data &&
                          serialMovementQuery.data.length > 0
                        ) {
                          const serialMovementId =
                            serialMovementQuery.data.sort(
                              (a, b) =>
                                new Date(b.create_time) -
                                new Date(a.create_time)
                            )[0].id;

                          createdDocs.push({
                            collection: "inv_serial_movement",
                            docId: serialMovementId,
                          });

                          console.log(
                            `✓ Successfully tracked inv_serial_movement record for serial ${temp.serial_number}, ID: ${serialMovementId}`
                          );
                        } else {
                          console.error(
                            `✗ Failed to find created inv_serial_movement record for serial ${temp.serial_number}`
                          );
                        }
                      } catch (serialError) {
                        console.error(
                          `✗ Error creating inv_serial_movement for serial ${temp.serial_number}:`,
                          serialError
                        );
                      }
                    } else {
                      console.warn(
                        `Serial number missing for item at index ${serialIndex}`
                      );
                    }
                  }
                } else {
                  console.error(
                    `Movement ${movement.docId} not found or not an OUT movement using WHERE query`
                  );
                  if (movementQuery.data) {
                    console.error(`Movement query result:`, movementQuery.data);
                  }
                }
              }
              console.log(
                `Completed processing serial movement records for ${group.items.length} serials in group ${groupKey}`
              );
            }

            // Update balances
            if (isSerializedItem) {
              // For serialized items, we need to distribute the deduction proportionally across each serial
              let remainingToDeduct = baseQty;
              let remainingReservedToDeduct = 0;
              let remainingUnrestrictedToDeduct = 0;

              if (gdStatus === "Created") {
                // Determine how much comes from reserved vs unrestricted based on our movement logic
                let availableReservedForThisGD = totalGroupReserved;
                if (isUpdate && prevBaseQty > 0) {
                  availableReservedForThisGD = Math.min(
                    totalGroupReserved,
                    prevBaseQty
                  );
                }

                if (availableReservedForThisGD >= baseQty) {
                  // All from reserved
                  remainingReservedToDeduct = baseQty;
                  remainingUnrestrictedToDeduct = 0;
                } else {
                  // Split between reserved and unrestricted
                  remainingReservedToDeduct = availableReservedForThisGD;
                  remainingUnrestrictedToDeduct = roundQty(
                    baseQty - availableReservedForThisGD
                  );
                }
              } else {
                // For Completed status, deduct from unrestricted first, then reserved if needed
                if (totalGroupUnrestricted >= baseQty) {
                  remainingUnrestrictedToDeduct = baseQty;
                  remainingReservedToDeduct = 0;
                } else {
                  remainingUnrestrictedToDeduct = totalGroupUnrestricted;
                  remainingReservedToDeduct = roundQty(
                    baseQty - totalGroupUnrestricted
                  );
                }
              }

              console.log(
                `Distributing deduction across serials: Reserved=${remainingReservedToDeduct}, Unrestricted=${remainingUnrestrictedToDeduct}`
              );

              // Process each serial balance individually with proper distribution
              for (const serialBalance of serialBalances) {
                if (remainingToDeduct <= 0) break;

                const serialDoc = serialBalance.balance;
                const currentSerialUnrestricted = serialBalance.unrestricted;
                const currentSerialReserved = serialBalance.reserved;
                const individualBaseQty = serialBalance.individualBaseQty;

                // Calculate how much to deduct from this serial (proportional to its individual quantity)
                const serialDeductionRatio = individualBaseQty / baseQty;
                const serialReservedDeduction = roundQty(
                  remainingReservedToDeduct * serialDeductionRatio
                );
                const serialUnrestrictedDeduction = roundQty(
                  remainingUnrestrictedToDeduct * serialDeductionRatio
                );

                let finalSerialUnrestricted = roundQty(
                  currentSerialUnrestricted - serialUnrestrictedDeduction
                );
                let finalSerialReserved = roundQty(
                  currentSerialReserved - serialReservedDeduction
                );

                // Safety checks to prevent negative values
                if (finalSerialUnrestricted < 0) {
                  console.warn(
                    `Serial ${serialBalance.serial}: Unrestricted would be negative (${finalSerialUnrestricted}), setting to 0`
                  );
                  finalSerialUnrestricted = 0;
                }
                if (finalSerialReserved < 0) {
                  console.warn(
                    `Serial ${serialBalance.serial}: Reserved would be negative (${finalSerialReserved}), setting to 0`
                  );
                  finalSerialReserved = 0;
                }

                const originalData = {
                  unrestricted_qty: currentSerialUnrestricted,
                  reserved_qty: currentSerialReserved,
                };

                const updateData = {
                  unrestricted_qty: finalSerialUnrestricted,
                  reserved_qty: finalSerialReserved,
                };

                if (serialDoc.hasOwnProperty("balance_quantity")) {
                  originalData.balance_quantity = roundQty(
                    currentSerialUnrestricted + currentSerialReserved
                  );
                  updateData.balance_quantity = roundQty(
                    finalSerialUnrestricted + finalSerialReserved
                  );
                }

                updatedDocs.push({
                  collection: "item_serial_balance",
                  docId: serialDoc.id,
                  originalData: originalData,
                });

                try {
                  await db
                    .collection("item_serial_balance")
                    .doc(serialDoc.id)
                    .update(updateData);

                  console.log(
                    `Updated serial balance for ${serialBalance.serial}: ` +
                      `Unrestricted=${finalSerialUnrestricted}, Reserved=${finalSerialReserved}` +
                      (updateData.balance_quantity
                        ? `, Balance=${updateData.balance_quantity}`
                        : "")
                  );

                  remainingToDeduct = roundQty(
                    remainingToDeduct - individualBaseQty
                  );
                } catch (serialBalanceError) {
                  console.error(
                    `Error updating serial balance for ${serialBalance.serial}:`,
                    serialBalanceError
                  );
                  throw serialBalanceError;
                }
              }

              // ADDED: Also update item_balance for serialized items (aggregated quantities)
              const generalItemBalanceParams = {
                material_id: item.material_id,
                location_id: group.location_id,
                plant_id: plantId,
                organization_id: organizationId,
              };

              // Don't include batch_id in item_balance query for serialized items (aggregated balance)
              const generalBalanceQuery = await db
                .collection("item_balance")
                .where(generalItemBalanceParams)
                .get();

              if (
                generalBalanceQuery.data &&
                generalBalanceQuery.data.length > 0
              ) {
                const generalBalance = generalBalanceQuery.data[0];
                let currentGeneralUnrestrictedQty = roundQty(
                  parseFloat(generalBalance.unrestricted_qty || 0)
                );
                let currentGeneralReservedQty = roundQty(
                  parseFloat(generalBalance.reserved_qty || 0)
                );
                let currentGeneralBalanceQty = roundQty(
                  parseFloat(generalBalance.balance_quantity || 0)
                );

                // Apply the same deduction logic to item_balance
                let finalGeneralUnrestrictedQty = currentGeneralUnrestrictedQty;
                let finalGeneralReservedQty = currentGeneralReservedQty;

                if (gdStatus === "Created") {
                  // Apply the smart deduction logic
                  let availableReservedForThisGD = currentGeneralReservedQty;
                  if (isUpdate && prevBaseQty > 0) {
                    availableReservedForThisGD = Math.min(
                      currentGeneralReservedQty,
                      prevBaseQty
                    );
                  }

                  if (availableReservedForThisGD >= baseQty) {
                    // All quantity can come from Reserved
                    finalGeneralReservedQty = roundQty(
                      finalGeneralReservedQty - baseQty
                    );

                    // Handle unused reservations
                    if (isUpdate && prevBaseQty > 0) {
                      const unusedReservedQty = roundQty(prevBaseQty - baseQty);
                      if (unusedReservedQty > 0) {
                        finalGeneralReservedQty = roundQty(
                          finalGeneralReservedQty - unusedReservedQty
                        );
                        finalGeneralUnrestrictedQty = roundQty(
                          finalGeneralUnrestrictedQty + unusedReservedQty
                        );
                      }
                    }
                  } else {
                    // Split between Reserved and Unrestricted
                    const reservedDeduction = availableReservedForThisGD;
                    const unrestrictedDeduction = roundQty(
                      baseQty - reservedDeduction
                    );

                    finalGeneralReservedQty = roundQty(
                      finalGeneralReservedQty - reservedDeduction
                    );
                    finalGeneralUnrestrictedQty = roundQty(
                      finalGeneralUnrestrictedQty - unrestrictedDeduction
                    );
                  }
                } else {
                  // For non-Created status, decrease unrestricted
                  finalGeneralUnrestrictedQty = roundQty(
                    finalGeneralUnrestrictedQty - baseQty
                  );
                }

                const finalGeneralBalanceQty = roundQty(
                  currentGeneralBalanceQty - baseQty
                );

                const generalOriginalData = {
                  unrestricted_qty: currentGeneralUnrestrictedQty,
                  reserved_qty: currentGeneralReservedQty,
                  balance_quantity: currentGeneralBalanceQty,
                };

                updatedDocs.push({
                  collection: "item_balance",
                  docId: generalBalance.id,
                  originalData: generalOriginalData,
                });

                await db
                  .collection("item_balance")
                  .doc(generalBalance.id)
                  .update({
                    unrestricted_qty: finalGeneralUnrestrictedQty,
                    reserved_qty: finalGeneralReservedQty,
                    balance_quantity: finalGeneralBalanceQty,
                  });

                console.log(
                  `Updated item_balance for serialized item ${item.material_id} at ${group.location_id}: ` +
                    `Unrestricted=${finalGeneralUnrestrictedQty}, Reserved=${finalGeneralReservedQty}, Balance=${finalGeneralBalanceQty}`
                );
              } else {
                console.warn(
                  `No item_balance record found for serialized item ${item.material_id} at location ${group.location_id}`
                );
              }
            } else if (existingDoc && existingDoc.id) {
              // For non-serialized items, update the consolidated balance
              let currentUnrestrictedQty = roundQty(
                parseFloat(existingDoc.unrestricted_qty || 0)
              );
              let currentReservedQty = roundQty(
                parseFloat(existingDoc.reserved_qty || 0)
              );
              let currentBalanceQty = roundQty(
                parseFloat(existingDoc.balance_quantity || 0)
              );

              // Update balance quantities based on GD status
              let finalUnrestrictedQty = currentUnrestrictedQty;
              let finalReservedQty = currentReservedQty;
              let finalBalanceQty = currentBalanceQty;

              if (gdStatus === "Created") {
                // Apply the smart deduction logic
                let availableReservedForThisGD = currentReservedQty;
                if (isUpdate && prevBaseQty > 0) {
                  availableReservedForThisGD = Math.min(
                    currentReservedQty,
                    prevBaseQty
                  );
                }

                if (availableReservedForThisGD >= baseQty) {
                  // All quantity can come from Reserved
                  finalReservedQty = roundQty(finalReservedQty - baseQty);

                  // Handle unused reservations
                  if (isUpdate && prevBaseQty > 0) {
                    const unusedReservedQty = roundQty(prevBaseQty - baseQty);
                    if (unusedReservedQty > 0) {
                      finalReservedQty = roundQty(
                        finalReservedQty - unusedReservedQty
                      );
                      finalUnrestrictedQty = roundQty(
                        finalUnrestrictedQty + unusedReservedQty
                      );
                    }
                  }
                } else {
                  // Split between Reserved and Unrestricted
                  const reservedDeduction = availableReservedForThisGD;
                  const unrestrictedDeduction = roundQty(
                    baseQty - reservedDeduction
                  );

                  finalReservedQty = roundQty(
                    finalReservedQty - reservedDeduction
                  );
                  finalUnrestrictedQty = roundQty(
                    finalUnrestrictedQty - unrestrictedDeduction
                  );
                }
              } else {
                // For non-Created status, decrease unrestricted
                finalUnrestrictedQty = roundQty(finalUnrestrictedQty - baseQty);
              }

              finalBalanceQty = roundQty(finalBalanceQty - baseQty);

              console.log(
                `Final quantities after ${gdStatus} processing for group ${groupKey}:`
              );
              console.log(`  Unrestricted: ${finalUnrestrictedQty}`);
              console.log(`  Reserved: ${finalReservedQty}`);
              console.log(`  Total Balance: ${finalBalanceQty}`);

              updatedDocs.push({
                collection: balanceCollection,
                docId: existingDoc.id,
                originalData: {
                  unrestricted_qty: currentUnrestrictedQty,
                  reserved_qty: currentReservedQty,
                  balance_quantity: currentBalanceQty,
                },
              });

              await db
                .collection(balanceCollection)
                .doc(existingDoc.id)
                .update({
                  unrestricted_qty: finalUnrestrictedQty,
                  reserved_qty: finalReservedQty,
                  balance_quantity: finalBalanceQty,
                });

              console.log(`Updated ${balanceCollection} for group ${groupKey}`);

              // ADDED: For batch items, also update item_balance (aggregated balance)
              if (
                balanceCollection === "item_batch_balance" &&
                group.batch_id
              ) {
                const generalItemBalanceParams = {
                  material_id: item.material_id,
                  location_id: group.location_id,
                  plant_id: plantId,
                  organization_id: organizationId,
                };

                // Don't include batch_id in item_balance query (aggregated balance across all batches)
                const generalBalanceQuery = await db
                  .collection("item_balance")
                  .where(generalItemBalanceParams)
                  .get();

                if (
                  generalBalanceQuery.data &&
                  generalBalanceQuery.data.length > 0
                ) {
                  const generalBalance = generalBalanceQuery.data[0];
                  let currentGeneralUnrestrictedQty = roundQty(
                    parseFloat(generalBalance.unrestricted_qty || 0)
                  );
                  let currentGeneralReservedQty = roundQty(
                    parseFloat(generalBalance.reserved_qty || 0)
                  );
                  let currentGeneralBalanceQty = roundQty(
                    parseFloat(generalBalance.balance_quantity || 0)
                  );

                  // Apply the same deduction logic to item_balance
                  let finalGeneralUnrestrictedQty =
                    currentGeneralUnrestrictedQty;
                  let finalGeneralReservedQty = currentGeneralReservedQty;

                  if (gdStatus === "Created") {
                    // Apply the smart deduction logic
                    let availableReservedForThisGD = currentGeneralReservedQty;
                    if (isUpdate && prevBaseQty > 0) {
                      availableReservedForThisGD = Math.min(
                        currentGeneralReservedQty,
                        prevBaseQty
                      );
                    }

                    if (availableReservedForThisGD >= baseQty) {
                      // All quantity can come from Reserved
                      finalGeneralReservedQty = roundQty(
                        finalGeneralReservedQty - baseQty
                      );

                      // Handle unused reservations
                      if (isUpdate && prevBaseQty > 0) {
                        const unusedReservedQty = roundQty(
                          prevBaseQty - baseQty
                        );
                        if (unusedReservedQty > 0) {
                          finalGeneralReservedQty = roundQty(
                            finalGeneralReservedQty - unusedReservedQty
                          );
                          finalGeneralUnrestrictedQty = roundQty(
                            finalGeneralUnrestrictedQty + unusedReservedQty
                          );
                        }
                      }
                    } else {
                      // Split between Reserved and Unrestricted
                      const reservedDeduction = availableReservedForThisGD;
                      const unrestrictedDeduction = roundQty(
                        baseQty - reservedDeduction
                      );

                      finalGeneralReservedQty = roundQty(
                        finalGeneralReservedQty - reservedDeduction
                      );
                      finalGeneralUnrestrictedQty = roundQty(
                        finalGeneralUnrestrictedQty - unrestrictedDeduction
                      );
                    }
                  } else {
                    // For non-Created status, decrease unrestricted
                    finalGeneralUnrestrictedQty = roundQty(
                      finalGeneralUnrestrictedQty - baseQty
                    );
                  }

                  const finalGeneralBalanceQty = roundQty(
                    currentGeneralBalanceQty - baseQty
                  );

                  const generalOriginalData = {
                    unrestricted_qty: currentGeneralUnrestrictedQty,
                    reserved_qty: currentGeneralReservedQty,
                    balance_quantity: currentGeneralBalanceQty,
                  };

                  updatedDocs.push({
                    collection: "item_balance",
                    docId: generalBalance.id,
                    originalData: generalOriginalData,
                  });

                  await db
                    .collection("item_balance")
                    .doc(generalBalance.id)
                    .update({
                      unrestricted_qty: finalGeneralUnrestrictedQty,
                      reserved_qty: finalGeneralReservedQty,
                      balance_quantity: finalGeneralBalanceQty,
                    });

                  console.log(
                    `Updated item_balance for batch item ${item.material_id} at ${group.location_id}: ` +
                      `Unrestricted=${finalGeneralUnrestrictedQty}, Reserved=${finalGeneralReservedQty}, Balance=${finalGeneralBalanceQty}`
                  );
                } else {
                  console.warn(
                    `No item_balance record found for batch item ${item.material_id} at location ${group.location_id}`
                  );
                }
              }
            }
          }

          // Update costing method inventories (use total group quantity)
          if (costingMethod === "First In First Out") {
            await updateFIFOInventory(
              item.material_id,
              baseQty,
              group.batch_id,
              plantId
            );
          } else if (costingMethod === "Weighted Average") {
            await updateWeightedAverage(
              item,
              group.batch_id,
              baseWAQty,
              plantId
            );
          }
        }

        console.log(
          `Successfully processed ${groupedTempData.size} consolidated movement groups for item ${item.material_id}`
        );
      }
    } catch (error) {
      console.error(`Error processing item ${item.material_id}:`, error);

      // Rollback changes if any operation fails
      for (const doc of updatedDocs.reverse()) {
        try {
          await db
            .collection(doc.collection)
            .doc(doc.docId)
            .update(doc.originalData);
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }

      for (const doc of createdDocs.reverse()) {
        try {
          await db.collection(doc.collection).doc(doc.docId).update({
            is_deleted: 1,
          });
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }

      throw error; // Re-throw to stop processing
    }
  }

  return Promise.resolve();
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

const addEntry = async (organizationId, toData) => {
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

    if (!createdRecord.data || createdRecord.data.length === 0) {
      throw new Error("Failed to retrieve created transfer order record");
    }

    const toId = createdRecord.data[0].id;
    console.log("Transfer order created successfully with ID:", toId);
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, toData, toId, originalToStatus) => {
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

const updateGoodsDelivery = async (
  gdId,
  isAutoCompleteGD = 0,
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

    const isAllLineItemCompleted = gdData.table_gd.every(
      (lineItem) => lineItem.picking_status === "Completed"
    );

    if (isAllLineItemCompleted) {
      newPickingStatus = "Completed";
    } else {
      newPickingStatus = "In Progress";
    }

    await db.collection("goods_delivery").doc(gdId).update({
      picking_status: newPickingStatus,
    });

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
      await processBalanceTable(
        gdData,
        false,
        gdData.plant_id,
        organizationId,
        "Created"
      );

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
      await addEntry(organizationId, toData);
      for (const gdId of data.gd_no) {
        await updateGoodsDelivery(
          gdId,
          isAutoCompleteGD,
          organizationId,
          toData
        );
      }
    } else if (page_status === "Edit") {
      toId = data.id;
      await updateEntry(organizationId, toData, toId, originalToStatus);
      for (const gdId of data.gd_no) {
        await updateGoodsDelivery(
          gdId,
          isAutoCompleteGD,
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
