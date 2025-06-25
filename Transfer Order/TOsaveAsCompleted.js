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
    if (pickedQty === 0) {
      lineStatus = null;
    } else if (pickedQty === pendingProcessQty) {
      lineStatus = "Completed";
    } else if (pickedQty < pendingProcessQty) {
      lineStatus = "In Progress";
    }

    // Calculate pending process quantity
    const pending_process_qty = pendingProcessQty - pickedQty;

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

const processBalanceTable = async (
  data,
  isUpdate,
  plantId,
  organizationId,
  gdStatus
) => {
  console.log("Processing balance table");
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
    try {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      // Input validation
      if (!item.material_id || !item.temp_qty_data) {
        console.error(`Invalid item data for index ${itemIndex}:`, item);
        continue;
      }

      // Track created or updated documents for potential rollback
      const createdDocs = [];

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

      const temporaryData = JSON.parse(item.temp_qty_data);
      const prevTempData = isUpdate
        ? JSON.parse(item.prev_temp_qty_data)
        : null;

      if (
        temporaryData.length > 0 &&
        (!isUpdate || (prevTempData && prevTempData.length > 0))
      ) {
        for (let i = 0; i < temporaryData.length; i++) {
          const temp = temporaryData[i];
          const prevTemp = isUpdate ? prevTempData[i] : null;

          console.log("gdStatus", gdStatus);

          // UOM Conversion
          let altQty = roundQty(temp.gd_quantity);
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

              baseQty = roundQty(altQty * uomConversion.base_qty);
              baseWAQty = roundQty(altWAQty * uomConversion.base_qty);

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

          // Calculate previous quantities for this specific GD
          let prevBaseQty = 0;
          if (isUpdate && prevTemp) {
            let prevAltQty = roundQty(prevTemp.gd_quantity);
            prevBaseQty = prevAltQty;

            if (uomConversion) {
              prevBaseQty = roundQty(prevAltQty * uomConversion.base_qty);
            }
            console.log(`Previous quantity for this GD: ${prevBaseQty}`);
          }

          const costingMethod = itemData.material_costing_method;

          let unitPrice = roundPrice(item.unit_price);
          let totalPrice = roundPrice(unitPrice * altQty);

          if (costingMethod === "First In First Out") {
            // Define a key for tracking consumed FIFO quantities
            const materialBatchKey = temp.batch_id
              ? `${item.material_id}-${temp.batch_id}`
              : item.material_id;

            // Get previously consumed quantity (default to 0 if none)
            const previouslyConsumedQty =
              consumedFIFOQty.get(materialBatchKey) || 0;

            // Get unit price from latest FIFO sequence with awareness of consumed quantities
            const fifoCostPrice = await getLatestFIFOCostPrice(
              item.material_id,
              temp.batch_id,
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
              temp.batch_id,
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
          const itemBalanceParams = {
            material_id: item.material_id,
            location_id: temp.location_id,
          };

          if (temp.batch_id) {
            itemBalanceParams.batch_id = temp.batch_id;
          }

          const balanceCollection = temp.batch_id
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

            console.log(`Current inventory for ${item.material_id}:`);
            console.log(`  Unrestricted: ${currentUnrestrictedQty}`);
            console.log(`  Reserved: ${currentReservedQty}`);
            console.log(`  Total Balance: ${currentBalanceQty}`);

            // Smart movement logic based on status and available quantities
            if (gdStatus === "Created") {
              // For Created status, we need to move OUT from Reserved
              console.log(
                `Processing Created status - moving ${baseQty} OUT from Reserved`
              );

              // For edit mode, we can only use the reserved quantity that this GD previously created
              let availableReservedForThisGD = currentReservedQty;
              if (isUpdate && prevBaseQty > 0) {
                // In edit mode, we can only take up to what this GD previously reserved
                availableReservedForThisGD = Math.min(
                  currentReservedQty,
                  prevBaseQty
                );
                console.log(`This GD previously reserved: ${prevBaseQty}`);
                console.log(
                  `Available reserved for this GD: ${availableReservedForThisGD}`
                );
              }

              if (availableReservedForThisGD >= baseQty) {
                // Sufficient reserved quantity from this GD - move all from Reserved
                console.log(
                  `Sufficient reserved quantity for this GD (${availableReservedForThisGD}) for ${baseQty}`
                );

                const inventoryMovementData = {
                  transaction_type: "GDL",
                  trx_no: data.delivery_no,
                  parent_trx_no: item.line_so_no,
                  movement: "OUT",
                  unit_price: unitPrice,
                  total_price: totalPrice,
                  quantity: altQty,
                  item_id: item.material_id,
                  inventory_category: "Reserved",
                  uom_id: altUOM,
                  base_qty: baseQty,
                  base_uom_id: baseUOM,
                  bin_location_id: temp.location_id,
                  batch_number_id: temp.batch_id,
                  costing_method_id: item.item_costing_method,
                  plant_id: plantId,
                  organization_id: organizationId,
                };

                const invMovementResult = await db
                  .collection("inventory_movement")
                  .add(inventoryMovementData);

                createdDocs.push({
                  collection: "inventory_movement",
                  docId: invMovementResult.id,
                });
              } else {
                // Insufficient reserved quantity for this GD - split between Reserved and Unrestricted
                const reservedQtyToMove = availableReservedForThisGD;
                const unrestrictedQtyToMove = roundQty(
                  baseQty - reservedQtyToMove
                );

                console.log(
                  `Insufficient reserved quantity for this GD. Splitting:`
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
                    transaction_type: "GDL",
                    trx_no: data.delivery_no,
                    parent_trx_no: item.line_so_no,
                    movement: "OUT",
                    unit_price: unitPrice,
                    total_price: reservedTotalPrice,
                    quantity: reservedAltQty,
                    item_id: item.material_id,
                    inventory_category: "Reserved",
                    uom_id: altUOM,
                    base_qty: reservedQtyToMove,
                    base_uom_id: baseUOM,
                    bin_location_id: temp.location_id,
                    batch_number_id: temp.batch_id,
                    costing_method_id: item.item_costing_method,
                    plant_id: plantId,
                    organization_id: organizationId,
                  };

                  const reservedMovementResult = await db
                    .collection("inventory_movement")
                    .add(reservedMovementData);

                  createdDocs.push({
                    collection: "inventory_movement",
                    docId: reservedMovementResult.id,
                  });
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
                    transaction_type: "GDL",
                    trx_no: data.delivery_no,
                    parent_trx_no: item.line_so_no,
                    movement: "OUT",
                    unit_price: unitPrice,
                    total_price: unrestrictedTotalPrice,
                    quantity: unrestrictedAltQty,
                    item_id: item.material_id,
                    inventory_category: "Unrestricted",
                    uom_id: altUOM,
                    base_qty: unrestrictedQtyToMove,
                    base_uom_id: baseUOM,
                    bin_location_id: temp.location_id,
                    batch_number_id: temp.batch_id,
                    costing_method_id: item.item_costing_method,
                    plant_id: plantId,
                    organization_id: organizationId,
                  };

                  const unrestrictedMovementResult = await db
                    .collection("inventory_movement")
                    .add(unrestrictedMovementData);

                  createdDocs.push({
                    collection: "inventory_movement",
                    docId: unrestrictedMovementResult.id,
                  });
                }
              }

              // ADDED: Handle unused reserved quantities
              if (isUpdate && prevBaseQty > 0) {
                const deliveredQty = baseQty;
                const originalReservedQty = prevBaseQty;
                const unusedReservedQty = roundQty(
                  originalReservedQty - deliveredQty
                );

                console.log(`Checking for unused reservations:`);
                console.log(`  Originally reserved: ${originalReservedQty}`);
                console.log(`  Actually delivered: ${deliveredQty}`);
                console.log(`  Unused reserved: ${unusedReservedQty}`);

                if (unusedReservedQty > 0) {
                  console.log(
                    `Releasing ${unusedReservedQty} unused reserved quantity back to unrestricted`
                  );

                  // Calculate alternative UOM for unused quantity
                  const unusedAltQty = uomConversion
                    ? roundQty(unusedReservedQty / uomConversion.base_qty)
                    : unusedReservedQty;

                  // Create movement to release unused reserved back to unrestricted
                  const releaseReservedMovementData = {
                    transaction_type: "GDL",
                    trx_no: data.delivery_no,
                    parent_trx_no: item.line_so_no,
                    movement: "OUT",
                    unit_price: unitPrice,
                    total_price: roundPrice(unitPrice * unusedAltQty),
                    quantity: unusedAltQty,
                    item_id: item.material_id,
                    inventory_category: "Reserved",
                    uom_id: altUOM,
                    base_qty: unusedReservedQty,
                    base_uom_id: baseUOM,
                    bin_location_id: temp.location_id,
                    batch_number_id: temp.batch_id,
                    costing_method_id: item.item_costing_method,
                    plant_id: plantId,
                    organization_id: organizationId,
                  };

                  const returnUnrestrictedMovementData = {
                    transaction_type: "GDL",
                    trx_no: data.delivery_no,
                    parent_trx_no: item.line_so_no,
                    movement: "IN",
                    unit_price: unitPrice,
                    total_price: roundPrice(unitPrice * unusedAltQty),
                    quantity: unusedAltQty,
                    item_id: item.material_id,
                    inventory_category: "Unrestricted",
                    uom_id: altUOM,
                    base_qty: unusedReservedQty,
                    base_uom_id: baseUOM,
                    bin_location_id: temp.location_id,
                    batch_number_id: temp.batch_id,
                    costing_method_id: item.item_costing_method,
                    plant_id: plantId,
                    organization_id: organizationId,
                  };

                  // Add the release movements
                  const releaseMovementResult = await db
                    .collection("inventory_movement")
                    .add(releaseReservedMovementData);

                  createdDocs.push({
                    collection: "inventory_movement",
                    docId: releaseMovementResult.id,
                  });

                  const returnMovementResult = await db
                    .collection("inventory_movement")
                    .add(returnUnrestrictedMovementData);

                  createdDocs.push({
                    collection: "inventory_movement",
                    docId: returnMovementResult.id,
                  });
                }
              }

              // Update balance quantities for Completed status
              let finalUnrestrictedQty = currentUnrestrictedQty;
              let finalReservedQty = currentReservedQty;
              let finalBalanceQty = currentBalanceQty;

              // Calculate how much was reserved by this GD and how much can be used
              let thisGDReservedQty = prevBaseQty; // What this GD previously reserved
              if (!isUpdate) {
                thisGDReservedQty = 0; // New GD, no previous reservation
              }

              console.log(`This GD previously reserved: ${thisGDReservedQty}`);
              console.log(`Current total reserved: ${currentReservedQty}`);
              console.log(`Need to deliver: ${baseQty}`);

              // Apply the smart deduction logic - use the same logic as movement creation
              if (availableReservedForThisGD >= baseQty) {
                // All quantity can come from Reserved
                console.log(`All ${baseQty} coming from Reserved`);
                finalReservedQty = roundQty(finalReservedQty - baseQty);

                // ADDED: If there are unused reservations, release them to unrestricted
                if (isUpdate && prevBaseQty > 0) {
                  const unusedReservedQty = roundQty(prevBaseQty - baseQty);
                  if (unusedReservedQty > 0) {
                    console.log(
                      `Releasing ${unusedReservedQty} unused reserved to unrestricted`
                    );
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

                console.log(
                  `Splitting: ${reservedDeduction} from Reserved, ${unrestrictedDeduction} from Unrestricted`
                );

                finalReservedQty = roundQty(
                  finalReservedQty - reservedDeduction
                );
                finalUnrestrictedQty = roundQty(
                  finalUnrestrictedQty - unrestrictedDeduction
                );
              }

              finalBalanceQty = roundQty(finalBalanceQty - baseQty);

              console.log(`Final quantities after Completed processing:`);
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
            } else {
              // For non-Created status (Unrestricted movement)
              console.log(
                `Processing ${gdStatus} status - moving ${baseQty} OUT from Unrestricted`
              );

              const inventoryMovementData = {
                transaction_type: "GDL",
                trx_no: data.delivery_no,
                parent_trx_no: item.line_so_no,
                movement: "OUT",
                unit_price: unitPrice,
                total_price: totalPrice,
                quantity: altQty,
                item_id: item.material_id,
                inventory_category: "Unrestricted",
                uom_id: altUOM,
                base_qty: baseQty,
                base_uom_id: baseUOM,
                bin_location_id: temp.location_id,
                batch_number_id: temp.batch_id,
                costing_method_id: item.item_costing_method,
                plant_id: plantId,
                organization_id: organizationId,
              };

              const invMovementResult = await db
                .collection("inventory_movement")
                .add(inventoryMovementData);

              createdDocs.push({
                collection: "inventory_movement",
                docId: invMovementResult.id,
              });

              // Update balance quantities for non-Created status
              let finalUnrestrictedQty = currentUnrestrictedQty;
              let finalReservedQty = currentReservedQty;
              let finalBalanceQty = currentBalanceQty;

              finalUnrestrictedQty = roundQty(finalUnrestrictedQty - baseQty);
              finalBalanceQty = roundQty(finalBalanceQty - baseQty);

              console.log(`Final quantities after ${gdStatus} processing:`);
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
            }
          }

          // Update costing method inventories
          if (costingMethod === "First In First Out") {
            await updateFIFOInventory(
              item.material_id,
              baseQty,
              temp.batch_id,
              plantId
            );
          } else if (costingMethod === "Weighted Average") {
            await updateWeightedAverage(
              item,
              temp.batch_id,
              baseWAQty,
              plantId
            );
          }
        }
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
        .filter((item) => item.item_name !== "" || item.so_desc !== "");

      // Create a map to sum delivered quantities for each item
      let totalItems = soItems.length;
      let partiallyDeliveredItems = 0;
      let fullyDeliveredItems = 0;

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

        // Add ratio for tracking purposes
        updatedSoItems[originalIndex].delivery_ratio =
          orderedQty > 0 ? totalDeliveredQty / orderedQty : 0;

        // Count items with ANY delivered quantity as "partially delivered"
        if (totalDeliveredQty > 0) {
          partiallyDeliveredItems++;

          // Count fully delivered items separately
          if (totalDeliveredQty >= orderedQty) {
            fullyDeliveredItems++;
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

const updateGoodsDelivery = async (
  gdId,
  isAutoCompleteGD = 0,
  organizationId
) => {
  try {
    const gd = await db.collection("goods_delivery").doc(gdId).get();
    const gdData = gd.data[0];
    const pickingStatus = gdData.picking_status;

    if (pickingStatus === "Completed") {
      this.$message.error("Goods Delivery is already completed");
      return;
    }

    const newPickingStatus = "Completed";
    await db.collection("goods_delivery").doc(gdId).update({
      picking_status: newPickingStatus,
    });

    if (isAutoCompleteGD === 1) {
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

      const { so_data_array } = await updateSalesOrderStatus(
        gdData.so_id,
        gdData.table_gd
      );

      await this.runWorkflow(
        "1918140858502557698",
        { delivery_no: gdData.delivery_no, so_data: so_data_array },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          alert();
          console.error("失败结果：", err);
          closeDialog();
        }
      );

      await updateOnReserveGoodsDelivery(organizationId, gdData);
    }

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
      item_code: item.item_code,
      item_name: item.item_name,
      item_desc: item.item_desc,
      batch_no: item.batch_no,
      store_out_qty: item.picked_qty,
      item_uom: item.item_uom,
      source_bin: item.source_bin,
      remark: item.remark,
      confirmed_by: this.getVarGlobal("nickname"),
      confirmed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    };
    pickingRecords.push(pickingRecord);
  }

  toData.table_picking_records =
    toData.table_picking_records.concat(pickingRecords);
};

const updateOnReserveGoodsDelivery = async (organizationId, gdData) => {
  try {
    console.log(
      "Updating on_reserved_gd records for delivery:",
      gdData.delivery_no
    );

    // Get existing records for this GD
    const existingReserved = await db
      .collection("on_reserved_gd")
      .where({
        gd_no: gdData.delivery_no,
        organization_id: organizationId,
      })
      .get();

    // Prepare new data from current GD
    const newReservedData = [];
    for (let i = 0; i < gdData.table_gd.length; i++) {
      const gdLineItem = gdData.table_gd[i];
      const temp_qty_data = JSON.parse(gdLineItem.temp_qty_data);
      for (let j = 0; j < temp_qty_data.length; j++) {
        const tempItem = temp_qty_data[j];
        newReservedData.push({
          so_no: gdLineItem.line_so_no,
          gd_no: gdData.delivery_no,
          material_id: gdLineItem.material_id,
          item_name: gdLineItem.material_name,
          item_desc: gdLineItem.gd_material_desc || "",
          batch_id: tempItem.batch_id,
          bin_location: tempItem.location_id,
          item_uom: gdLineItem.gd_order_uom_id,
          gd_line_no: i + 1,
          reserved_qty: tempItem.gd_quantity,
          delivered_qty: tempItem.gd_quantity,
          open_qty: 0,
          gd_reserved_date: new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
          plant_id: gdData.plant_id,
          organization_id: organizationId,
          updated_by: this.getVarGlobal("nickname"),
          updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        });
      }
    }

    if (existingReserved.data && existingReserved.data.length > 0) {
      console.log(
        `Found ${existingReserved.data.length} existing reserved records to update`
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
            db.collection("on_reserved_gd").doc(extraRecord.id).delete()
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
      console.log("Successfully updated existing reserved records");
    } else {
      // No existing records, create new ones
      console.log("No existing records found, creating new ones");
      await createOnReserveGoodsDelivery(organizationId, gdData);
    }

    console.log("Updated reserved goods records successfully");
  } catch (error) {
    console.error("Error updating reserved goods delivery:", error);
    throw error;
  }
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
      .where({ plant_id: toData.plant_id, organization_id: organizationId })
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
      await updateGoodsDelivery(data.gd_no, isAutoCompleteGD, organizationId);
    } else if (page_status === "Edit") {
      toId = data.id;
      await updateEntry(organizationId, toData, toId, originalToStatus);
      await updateGoodsDelivery(data.gd_no, isAutoCompleteGD, organizationId);
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
