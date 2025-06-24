const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
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
    .where({ [prefix]: generatedPrefix, organization_id: organizationId })
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
      if (validateField(value, field)) {
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
          if (validateField(subValue, subField)) {
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

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

// Enhanced quantity validation and line status determination
const validateAndUpdateLineStatuses = (pickingItems) => {
  const errors = [];
  const updatedItems = JSON.parse(JSON.stringify(pickingItems));

  for (let index = 0; index < updatedItems.length; index++) {
    const item = updatedItems[index];

    // Safely parse quantities
    const qtyToPick = parseFloat(item.qty_to_pick) || 0;
    const pickedQty = parseFloat(item.picked_qty) || 0;

    console.log(
      `Item ${
        item.item_id || index
      }: qtyToPick=${qtyToPick}, pickedQty=${pickedQty}`
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

    if (pickedQty > qtyToPick) {
      errors.push(
        `Picked quantity (${pickedQty}) cannot be greater than quantity to pick (${qtyToPick}) for item ${
          item.item_id || `#${index + 1}`
        }`
      );
      continue;
    }

    // Determine line status based on quantities
    let lineStatus;
    if (pickedQty === 0) {
      lineStatus = null;
    } else if (pickedQty === qtyToPick) {
      lineStatus = "Completed";
    } else if (pickedQty < qtyToPick) {
      lineStatus = "In Progress";
    }

    // Calculate pending process quantity
    const pending_process_qty = qtyToPick - pickedQty;

    // Update line status
    updatedItems[index].line_status = lineStatus;
    updatedItems[index].pending_process_qty = pending_process_qty;
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
  const inProgressCount = lineStatuses.filter(
    (status) => status === "In Progress"
  ).length;
  const nullCount = lineStatuses.filter(
    (status) => status === null || status === undefined
  ).length;
  const totalItems = pickingItems.length;

  console.log(
    `Status counts - Completed: ${completedCount}, In Progress: ${inProgressCount}, Null: ${nullCount}, Total: ${totalItems}`
  );

  // Determine overall status
  if (completedCount === totalItems) {
    return "Completed";
  } else if (inProgressCount > 0 || completedCount > 0) {
    return "In Progress";
  } else if (nullCount === totalItems) {
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

const processBalanceTable = async (data, organizationId) => {
  console.log("Processing balance table for Transfer Order");
  const items = data.table_picking_items;

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to process");
    return Promise.resolve();
  }

  // Create a map to track consumed FIFO quantities during this transaction
  const consumedFIFOQty = new Map();

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    const updatedDocs = [];

    try {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      // Skip items with no picked quantity
      const pickedQty = parseFloat(item.picked_qty || 0);
      if (pickedQty <= 0) {
        console.log(`Skipping item ${item.item_code} - no picked quantity`);
        continue;
      }

      // Track created documents for potential rollback
      const createdDocs = [];

      // First check if this item should be processed based on stock_control
      const itemRes = await db
        .collection("Item")
        .where({ id: item.item_code })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_code}`);
        continue;
      }

      const itemData = itemRes.data[0];
      if (itemData.stock_control === 0) {
        console.log(
          `Skipping inventory update for item ${item.item_code} (stock_control=0)`
        );
        continue;
      }

      // UOM Conversion
      let altQty = roundQty(pickedQty);
      let baseQty = altQty;
      let altUOM = item.item_uom;
      let baseUOM = itemData.based_uom;
      let uomConversion = null;

      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        console.log(`Checking UOM conversions for item ${item.item_code}`);

        uomConversion = itemData.table_uom_conversion.find(
          (conv) => conv.alt_uom_id === altUOM
        );

        if (uomConversion) {
          console.log(
            `Found UOM conversion: 1 ${uomConversion.alt_uom_id} = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
          );

          baseQty = roundQty(altQty * uomConversion.base_qty);
          console.log(`Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`);
        } else {
          console.log(`No conversion found for UOM ${altUOM}, using as-is`);
        }
      } else {
        console.log(
          `No UOM conversion table for item ${item.item_code}, using received quantity as-is`
        );
      }

      const costingMethod = itemData.material_costing_method;
      let unitPrice = 0;
      let totalPrice = 0;

      // Get pricing based on costing method
      if (costingMethod === "First In First Out") {
        const materialBatchKey = item.batch_no
          ? `${item.item_code}-${item.batch_no}`
          : item.item_code;

        const previouslyConsumedQty =
          consumedFIFOQty.get(materialBatchKey) || 0;

        const fifoCostPrice = await getLatestFIFOCostPrice(
          item.item_code,
          item.batch_no,
          baseQty,
          previouslyConsumedQty,
          data.plant_id
        );

        consumedFIFOQty.set(materialBatchKey, previouslyConsumedQty + baseQty);

        unitPrice = roundPrice(fifoCostPrice);
        totalPrice = roundPrice(fifoCostPrice * baseQty);
      } else if (costingMethod === "Weighted Average") {
        const waCostPrice = await getWeightedAverageCostPrice(
          item.item_code,
          item.batch_no,
          data.plant_id
        );
        unitPrice = roundPrice(waCostPrice);
        totalPrice = roundPrice(waCostPrice * baseQty);
      } else if (costingMethod === "Fixed Cost") {
        const fixedCostPrice = await getFixedCostPrice(item.item_code);
        unitPrice = roundPrice(fixedCostPrice);
        totalPrice = roundPrice(fixedCostPrice * baseQty);
      }

      // Get current balance to determine inventory location
      const itemBalanceParams = {
        material_id: item.item_code,
        location_id: item.bin_location_id,
      };

      if (item.batch_no) {
        itemBalanceParams.batch_id = item.batch_no;
      }

      const balanceCollection = item.batch_no
        ? "item_batch_balance"
        : "item_balance";

      const balanceQuery = await db
        .collection(balanceCollection)
        .where(itemBalanceParams)
        .get();

      const hasExistingBalance =
        balanceQuery.data &&
        Array.isArray(balanceQuery.data) &&
        balanceQuery.data.length > 0;

      const existingDoc = hasExistingBalance ? balanceQuery.data[0] : null;

      if (existingDoc && existingDoc.id) {
        // Get current balance quantities
        let currentUnrestrictedQty = roundQty(
          parseFloat(existingDoc.unrestricted_qty || 0)
        );
        let currentReservedQty = roundQty(
          parseFloat(existingDoc.reserved_qty || 0)
        );
        let currentBalanceQty = roundQty(
          parseFloat(existingDoc.balance_quantity || 0)
        );

        console.log(`Current inventory for ${item.item_code}:`);
        console.log(`  Unrestricted: ${currentUnrestrictedQty}`);
        console.log(`  Reserved: ${currentReservedQty}`);
        console.log(`  Total Balance: ${currentBalanceQty}`);

        // For Transfer Order completion, take from Reserved inventory
        console.log(
          `Processing Transfer Order completion - moving ${baseQty} OUT from Reserved`
        );

        if (currentReservedQty >= baseQty) {
          // Sufficient reserved quantity - move all from Reserved
          console.log(
            `Sufficient reserved quantity (${currentReservedQty}) for ${baseQty}`
          );

          const inventoryMovementData = {
            transaction_type: "GDL",
            trx_no: data.gd_no,
            parent_trx_no: item.so_no,
            movement: "OUT",
            unit_price: unitPrice,
            total_price: totalPrice,
            quantity: altQty,
            item_id: item.item_code,
            inventory_category: "Reserved",
            uom_id: altUOM,
            base_qty: baseQty,
            base_uom_id: baseUOM,
            bin_location_id: item.bin_location_id,
            batch_number_id: item.batch_no || null,
            costing_method_id: costingMethod,
            plant_id: data.plant_id,
            organization_id: organizationId,
            is_deleted: 0,
          };

          const invMovementResult = await db
            .collection("inventory_movement")
            .add(inventoryMovementData);

          createdDocs.push({
            collection: "inventory_movement",
            docId: invMovementResult.id,
          });

          // Update balance quantities
          const finalUnrestrictedQty = currentUnrestrictedQty;
          const finalReservedQty = roundQty(currentReservedQty - baseQty);
          const finalBalanceQty = roundQty(currentBalanceQty - baseQty);

          console.log(`Final quantities after Transfer Order processing:`);
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

          await db.collection(balanceCollection).doc(existingDoc.id).update({
            unrestricted_qty: finalUnrestrictedQty,
            reserved_qty: finalReservedQty,
            balance_quantity: finalBalanceQty,
          });
        } else {
          // Insufficient reserved quantity - this shouldn't happen in normal flow
          console.warn(
            `Warning: Insufficient reserved quantity (${currentReservedQty}) for picked quantity (${baseQty})`
          );

          // Fall back to using whatever is available in Reserved, then Unrestricted
          const reservedQtyToUse = currentReservedQty;
          const unrestrictedQtyToUse = roundQty(baseQty - reservedQtyToUse);

          if (reservedQtyToUse > 0) {
            // Create movement for Reserved portion
            const reservedAltQty = roundQty(
              (reservedQtyToUse / baseQty) * altQty
            );
            const reservedTotalPrice = roundPrice(unitPrice * reservedAltQty);

            const reservedMovementData = {
              transaction_type: "GDL",
              trx_no: data.gd_no,
              parent_trx_no: item.so_no,
              movement: "OUT",
              unit_price: unitPrice,
              total_price: reservedTotalPrice,
              quantity: reservedAltQty,
              item_id: item.item_code,
              inventory_category: "Reserved",
              uom_id: altUOM,
              base_qty: reservedQtyToUse,
              base_uom_id: baseUOM,
              bin_location_id: item.bin_location_id,
              batch_number_id: item.batch_no || null,
              costing_method_id: costingMethod,
              plant_id: data.plant_id,
              organization_id: organizationId,
              is_deleted: 0,
            };

            const reservedMovementResult = await db
              .collection("inventory_movement")
              .add(reservedMovementData);

            createdDocs.push({
              collection: "inventory_movement",
              docId: reservedMovementResult.id,
            });
          }

          if (unrestrictedQtyToUse > 0) {
            // Create movement for Unrestricted portion
            const unrestrictedAltQty = roundQty(
              (unrestrictedQtyToUse / baseQty) * altQty
            );
            const unrestrictedTotalPrice = roundPrice(
              unitPrice * unrestrictedAltQty
            );

            const unrestrictedMovementData = {
              transaction_type: "GDL",
              trx_no: data.gd_no,
              parent_trx_no: item.so_no,
              movement: "OUT",
              unit_price: unitPrice,
              total_price: unrestrictedTotalPrice,
              quantity: unrestrictedAltQty,
              item_id: item.item_code,
              inventory_category: "Unrestricted",
              uom_id: altUOM,
              base_qty: unrestrictedQtyToUse,
              base_uom_id: baseUOM,
              bin_location_id: item.bin_location_id,
              batch_number_id: item.batch_no || null,
              costing_method_id: costingMethod,
              plant_id: data.plant_id,
              organization_id: organizationId,
              is_deleted: 0,
            };

            const unrestrictedMovementResult = await db
              .collection("inventory_movement")
              .add(unrestrictedMovementData);

            createdDocs.push({
              collection: "inventory_movement",
              docId: unrestrictedMovementResult.id,
            });
          }

          // Update balance quantities
          const finalUnrestrictedQty = roundQty(
            currentUnrestrictedQty - unrestrictedQtyToUse
          );
          const finalReservedQty = roundQty(
            currentReservedQty - reservedQtyToUse
          );
          const finalBalanceQty = roundQty(currentBalanceQty - baseQty);

          updatedDocs.push({
            collection: balanceCollection,
            docId: existingDoc.id,
            originalData: {
              unrestricted_qty: currentUnrestrictedQty,
              reserved_qty: currentReservedQty,
              balance_quantity: currentBalanceQty,
            },
          });

          await db.collection(balanceCollection).doc(existingDoc.id).update({
            unrestricted_qty: finalUnrestrictedQty,
            reserved_qty: finalReservedQty,
            balance_quantity: finalBalanceQty,
          });
        }
      }

      // Update costing method inventories
      if (costingMethod === "First In First Out") {
        await updateFIFOInventory(
          item.item_code,
          baseQty,
          item.batch_no,
          data.plant_id
        );
      } else if (costingMethod === "Weighted Average") {
        await updateWeightedAverage(
          { material_id: item.item_code },
          item.batch_no,
          baseQty,
          data.plant_id
        );
      }
    } catch (error) {
      console.error(`Error processing item ${item.item_code}:`, error);

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
          await db.collection(doc.collection).doc(doc.docId).delete();
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }

      throw error; // Re-throw to stop processing
    }
  }

  // Clear the FIFO tracking map
  consumedFIFOQty.clear();
  return Promise.resolve();
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
    }

    // Add the record
    await db.collection("transfer_order").add(toData);

    // Fetch the created record to get its ID
    const createdRecord = await db
      .collection("transfer_order")
      .where({
        to_id: toData.to_id,
        organization_id: organizationId,
      })
      .get();

    if (!createdRecord.data || createdRecord.data.length === 0) {
      throw new Error("Failed to retrieve created transfer order record");
    }

    const toId = createdRecord.data[0].id;
    console.log("Transfer order created successfully with ID:", toId);

    // Process balance table with the created record
    const isAutoCompleteGD = await db
      .collection("picking_setup")
      .where({ plant_id: toData.plant_id, organization_id: organizationId })
      .get()
      .then((res) => {
        if (res.data.length > 0) {
          return res.data[0].auto_completed_gd;
        }
      });

    if (isAutoCompleteGD === 1) {
      await processBalanceTable(toData, organizationId);
    }
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
      }
    }

    await db.collection("transfer_order").doc(toId).update(toData);

    // Process balance table with the created record
    const isAutoCompleteGD = await db
      .collection("picking_setup")
      .where({ plant_id: toData.plant_id, organization_id: organizationId })
      .get()
      .then((res) => {
        if (res.data.length > 0) {
          return res.data[0].auto_completed_gd;
        }
      });

    if (isAutoCompleteGD === 1) {
      await processBalanceTable(toData, organizationId);
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

const updateGoodsDeliveryPickingStatus = async (gdId) => {
  try {
    const gd = await db.collection("goods_delivery").doc(gdId).get();
    const gdData = gd.data();
    const pickingStatus = gdData.picking_status;

    if (pickingStatus === "Completed") {
      this.$message.error("Goods Delivery is already completed");
      return;
    }

    const newPickingStatus = "Completed";
    await db.collection("goods_delivery").doc(gdId).update({
      picking_status: newPickingStatus,
    });

    this.$message.success("Goods Delivery picking status updated successfully");
  } catch (error) {
    this.$message.error("Error updating Goods Delivery picking status");
    console.error("Error flipping Goods Delivery picking status:", error);
  }
};

const createPickingRecord = async (toData) => {
  const pickingRecords = [];
  for (const item of toData.table_picking_items) {
    const pickingRecord = {
      item_id: item.item_id,
      item_name: item.item_name,
      item_desc: item.item_desc,
      batch_no: item.batch_no,
      store_out_qty: item.picked_qty,
      source_bin: item.source_bin,
      remark: item.remark,
      confirmed_by: this.getVarGlobal("nickname"),
      confirmed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    };
    pickingRecords.push(pickingRecord);
  }

  toData.table_picking_records = pickingRecords;
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = await this.getValues();
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
    for (const [index, item] of data.table_picking_items.entries()) {
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

    // Validate quantities and update line statuses
    const { updatedItems, errors } = validateAndUpdateLineStatuses(
      data.table_picking_items
    );

    if (errors.length > 0) {
      this.hideLoading();
      this.$message.error(errors.join("; "));
      return;
    }

    // Determine the new transfer order status
    const newTransferOrderStatus = determineTransferOrderStatus(updatedItems);
    console.log(
      `Determined new transfer order status: ${newTransferOrderStatus}`
    );

    // Block process if status would be "In Progress"
    // Replace the detailed message section with this more concise version:

    // Block process if status would be "In Progress"
    if (newTransferOrderStatus === "In Progress") {
      console.log("Blocking process: Transfer Order status is In Progress");

      // Get incomplete items for better user feedback
      const incompleteItems = updatedItems
        .map((item, index) => ({
          ...item,
          itemName: item.item_name || `Item #${index + 1}`,
          qtyToPick: parseFloat(item.qty_to_pick) || 0,
          pickedQty: parseFloat(item.picked_qty) || 0,
        }))
        .filter((item) => {
          const pickedQty = item.pickedQty;
          const qtyToPick = item.qtyToPick;
          return pickedQty < qtyToPick && pickedQty > 0;
        });

      const unpickedItems = updatedItems
        .map((item, index) => ({
          ...item,
          itemName: item.item_name || `Item #${index + 1}`,
          qtyToPick: parseFloat(item.qty_to_pick) || 0,
          pickedQty: parseFloat(item.picked_qty) || 0,
        }))
        .filter((item) => item.pickedQty === 0);

      // Create concise message
      let detailMessage = "Incomplete picking detected. ";

      if (incompleteItems.length > 0) {
        detailMessage += `${incompleteItems.length} item(s) partially picked. `;
      }

      if (unpickedItems.length > 0) {
        detailMessage += `${unpickedItems.length} item(s) not started. `;
      }

      detailMessage +=
        "Please complete all picking or save as Draft to continue later.";

      this.hideLoading();

      this.parentGenerateForm.$alert(
        detailMessage,
        "Picking Items Incomplete",
        {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: false,
        }
      );

      console.log("Process blocked due to incomplete picking");
      return;
    }

    // Update the form data with the new line statuses (only if we proceed)
    for (let index = 0; index < updatedItems.length; index++) {
      this.setData({
        [`table_picking_items.${index}.line_status`]:
          updatedItems[index].line_status,
      });
    }

    // Prepare transfer order object
    const toData = {
      to_status: newTransferOrderStatus,
      plant_id: data.plant_id,
      to_id: data.to_id,
      movement_type: data.movement_type,
      ref_doc_type: data.ref_doc_type,
      gd_no: data.gd_no,
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

    let toId;

    // Perform action based on page status
    if (page_status === "Add") {
      await addEntry(organizationId, toData);
      await updateGoodsDeliveryPickingStatus(data.gd_no);
    } else if (page_status === "Edit") {
      toId = data.id;
      await updateEntry(organizationId, toData, toId, originalToStatus);
      await updateGoodsDeliveryPickingStatus(data.gd_no);
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
