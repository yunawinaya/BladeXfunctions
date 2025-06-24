const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
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

// Helper function to collect all SO numbers from data
const collectAllSoNumbers = (data) => {
  const soNumbers = new Set();

  // From header
  if (data.so_no) {
    if (typeof data.so_no === "string") {
      data.so_no.split(",").forEach((so) => soNumbers.add(so.trim()));
    } else {
      soNumbers.add(data.so_no.toString());
    }
  }

  // From line items
  if (Array.isArray(data.table_gd)) {
    data.table_gd.forEach((item) => {
      if (item.line_so_no) {
        soNumbers.add(item.line_so_no.toString().trim());
      }
    });
  }

  return Array.from(soNumbers).filter((so) => so.length > 0);
};

// Update FIFO inventory
const updateFIFOInventory = async (
  materialId,
  deliveryQty,
  batchId,
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
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      let remainingQtyToDeduct = parseFloat(deliveryQty);
      console.log(
        `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory`
      );

      const updatePromises = [];

      for (const record of sortedRecords) {
        if (remainingQtyToDeduct <= 0) {
          break;
        }

        const availableQty = roundQty(record.fifo_available_quantity || 0);
        console.log(
          `FIFO record ${record.fifo_sequence} has ${availableQty} available`
        );

        const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
        const newAvailableQty = roundQty(availableQty - qtyToDeduct);

        console.log(
          `Deducting ${qtyToDeduct} from FIFO record ${record.fifo_sequence}, new available: ${newAvailableQty}`
        );

        // Collect update promises
        updatePromises.push(
          db.collection("fifo_costing_history").doc(record.id).update({
            fifo_available_quantity: newAvailableQty,
          })
        );

        remainingQtyToDeduct -= qtyToDeduct;
      }

      // Wait for all updates to complete
      await Promise.all(updatePromises);

      if (remainingQtyToDeduct > 0) {
        console.warn(
          `Warning: Couldn't fully satisfy FIFO deduction. Remaining qty: ${remainingQtyToDeduct}`
        );
      }
    } else {
      console.warn(`No FIFO records found for material ${materialId}`);
    }
  } catch (error) {
    console.error(`Error in FIFO update for material ${materialId}:`, error);
    throw error;
  }
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

const getPrefixData = async (
  organizationId,
  documentType = "Goods Delivery"
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
  documentType = "Goods Delivery"
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
  collection = "goods_delivery",
  prefix = "delivery_no"
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
  collection = "goods_delivery",
  prefix = "delivery_no"
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
      "Could not generate a unique Goods Delivery number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

// NEW FUNCTION: Handle existing inventory movements for updates
const handleExistingInventoryMovements = async (
  deliveryNo,
  isUpdate = false
) => {
  if (!isUpdate) {
    console.log(
      "Not an update operation, skipping existing inventory movement handling"
    );
    return;
  }

  try {
    console.log(
      `Handling existing inventory movements for delivery: ${deliveryNo}`
    );

    // Find all existing inventory movements for this GD
    const existingMovements = await db
      .collection("inventory_movement")
      .where({
        transaction_type: "GDL",
        trx_no: deliveryNo,
        is_deleted: 0,
      })
      .get();

    if (existingMovements.data && existingMovements.data.length > 0) {
      console.log(
        `Found ${existingMovements.data.length} existing inventory movements to mark as deleted`
      );

      // Mark all existing movements as deleted
      const updatePromises = existingMovements.data.map((movement) =>
        db.collection("inventory_movement").doc(movement.id).update({
          is_deleted: 1,
        })
      );

      await Promise.all(updatePromises);
      console.log(
        "Successfully marked existing inventory movements as deleted"
      );
    } else {
      console.log("No existing inventory movements found for this delivery");
    }
  } catch (error) {
    console.error("Error handling existing inventory movements:", error);
    throw error;
  }
};

// NEW FUNCTION: Reverse balance changes for updates
const reverseBalanceChanges = async (data, isUpdate = false) => {
  if (!isUpdate) {
    console.log("Not an update operation, skipping balance reversal");
    return;
  }

  console.log("Reversing previous balance changes");
  const items = data.table_gd;

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to reverse");
    return;
  }

  for (const item of items) {
    try {
      // Only process if item has previous temp data and stock control is enabled
      if (!item.prev_temp_qty_data || !item.material_id) {
        continue;
      }

      // Check if this item should be processed based on stock_control
      const itemRes = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.material_id}`);
        continue;
      }

      const itemData = itemRes.data[0];
      if (itemData.stock_control === 0) {
        console.log(
          `Skipping balance reversal for item ${item.material_id} (stock_control=0)`
        );
        continue;
      }

      const prevTempData = parseJsonSafely(item.prev_temp_qty_data);

      for (const prevTemp of prevTempData) {
        const itemBalanceParams = {
          material_id: item.material_id,
          location_id: prevTemp.location_id,
        };

        if (prevTemp.batch_id) {
          itemBalanceParams.batch_id = prevTemp.batch_id;
        }

        const balanceCollection = prevTemp.batch_id
          ? "item_batch_balance"
          : "item_balance";

        const balanceQuery = await db
          .collection(balanceCollection)
          .where(itemBalanceParams)
          .get();

        if (balanceQuery.data && balanceQuery.data.length > 0) {
          const existingDoc = balanceQuery.data[0];

          // UOM Conversion for previous quantity
          let prevBaseQty = roundQty(prevTemp.gd_quantity);

          if (
            Array.isArray(itemData.table_uom_conversion) &&
            itemData.table_uom_conversion.length > 0
          ) {
            const uomConversion = itemData.table_uom_conversion.find(
              (conv) => conv.alt_uom_id === item.gd_order_uom_id
            );

            if (uomConversion) {
              prevBaseQty = roundQty(prevBaseQty * uomConversion.base_qty);
            }
          }

          // Reverse the previous changes: add back to unrestricted, subtract from reserved
          await db
            .collection(balanceCollection)
            .doc(existingDoc.id)
            .update({
              unrestricted_qty: roundQty(
                parseFloat(existingDoc.unrestricted_qty || 0) + prevBaseQty
              ),
              reserved_qty: roundQty(
                parseFloat(existingDoc.reserved_qty || 0) - prevBaseQty
              ),
            });

          console.log(
            `Reversed balance for item ${item.material_id}, location ${prevTemp.location_id}`
          );
        }
      }
    } catch (error) {
      console.error(
        `Error reversing balance for item ${item.material_id}:`,
        error
      );
      throw error;
    }
  }
};

const processBalanceTable = async (
  data,
  isUpdate = false,
  oldDeliveryNo = null,
  gdStatus = null
) => {
  console.log("Processing balance table");

  // STEP 1: Handle existing inventory movements and reverse balance changes for updates
  if (isUpdate && gdStatus === "Created") {
    await handleExistingInventoryMovements(oldDeliveryNo, isUpdate);
    await reverseBalanceChanges(data, isUpdate);
  }

  const items = data.table_gd;

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to process");
    return;
  }

  // Create a map to track consumed FIFO quantities during this transaction
  const consumedFIFOQty = new Map();

  // Separate FIFO items from others for sequential processing
  const fifoItems = [];
  const otherItems = [];

  // Pre-process items to determine costing method
  for (const item of items) {
    if (!item.material_id || !item.temp_qty_data) {
      console.error(`Invalid item data:`, item);
      continue;
    }

    try {
      const itemRes = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();

      if (itemRes.data && itemRes.data.length > 0) {
        const itemData = itemRes.data[0];
        if (itemData.stock_control === 0) {
          console.log(`Skipping item ${item.material_id} (stock_control=0)`);
          continue;
        }

        if (itemData.material_costing_method === "First In First Out") {
          fifoItems.push({ item, itemData });
        } else {
          otherItems.push({ item, itemData });
        }
      }
    } catch (error) {
      console.error(`Error checking item ${item.material_id}:`, error);
    }
  }

  // Process FIFO items sequentially to avoid race conditions
  for (const { item, itemData } of fifoItems) {
    await processItemBalance(item, itemData, data, consumedFIFOQty);
  }

  // Process non-FIFO items in parallel
  await Promise.all(
    otherItems.map(({ item, itemData }) =>
      processItemBalance(item, itemData, data, consumedFIFOQty)
    )
  );

  // Clear the FIFO tracking map
  consumedFIFOQty.clear();
};

// Extracted item processing logic for better organization
const processItemBalance = async (item, itemData, data, consumedFIFOQty) => {
  const temporaryData = parseJsonSafely(item.temp_qty_data);

  if (temporaryData.length === 0) {
    console.log(`No temporary data for item ${item.material_id}`);
    return;
  }

  // Track created documents for potential rollback
  const createdDocs = [];
  const updatedDocs = [];

  try {
    for (let i = 0; i < temporaryData.length; i++) {
      const temp = temporaryData[i];

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

      // UOM Conversion
      let altQty = roundQty(temp.gd_quantity);
      let baseQty = altQty;
      let altUOM = item.gd_order_uom_id;
      let baseUOM = itemData.based_uom;
      let altWAQty = roundQty(item.gd_qty);
      let baseWAQty = altWAQty;

      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        const uomConversion = itemData.table_uom_conversion.find(
          (conv) => conv.alt_uom_id === altUOM
        );

        if (uomConversion) {
          baseQty = roundQty(altQty * uomConversion.base_qty);
          baseWAQty = roundQty(altWAQty * uomConversion.base_qty);
        }
      }

      const costingMethod = itemData.material_costing_method;
      let unitPrice = roundPrice(item.unit_price || 0);
      let totalPrice = roundPrice(unitPrice * altQty);

      if (costingMethod === "First In First Out") {
        const materialBatchKey = temp.batch_id
          ? `${item.material_id}-${temp.batch_id}`
          : item.material_id;

        const previouslyConsumedQty =
          consumedFIFOQty.get(materialBatchKey) || 0;

        const fifoCostPrice = await getLatestFIFOCostPrice(
          item.material_id,
          temp.batch_id,
          baseQty,
          previouslyConsumedQty,
          data.plant_id
        );

        consumedFIFOQty.set(materialBatchKey, previouslyConsumedQty + baseQty);

        unitPrice = roundPrice(fifoCostPrice);
        totalPrice = roundPrice(fifoCostPrice * baseQty);
      } else if (costingMethod === "Weighted Average") {
        const waCostPrice = await getWeightedAverageCostPrice(
          item.material_id,
          temp.batch_id,
          data.plant_id
        );
        unitPrice = roundPrice(waCostPrice);
        totalPrice = roundPrice(waCostPrice * baseQty);
      } else if (costingMethod === "Fixed Cost") {
        const fixedCostPrice = await getFixedCostPrice(item.material_id);
        unitPrice = roundPrice(fixedCostPrice);
        totalPrice = roundPrice(fixedCostPrice * baseQty);
      }

      // Create inventory movements
      const baseInventoryMovement = {
        transaction_type: "GDL",
        trx_no: data.delivery_no,
        parent_trx_no: item.line_so_no || data.so_no,
        unit_price: unitPrice,
        total_price: totalPrice,
        quantity: altQty,
        item_id: item.material_id,
        uom_id: altUOM,
        base_qty: baseQty,
        base_uom_id: baseUOM,
        bin_location_id: temp.location_id,
        batch_number_id: temp.batch_id || null,
        costing_method_id: item.item_costing_method,
        plant_id: data.plant_id,
        organization_id: data.organization_id,
        is_deleted: 0,
      };

      // Create OUT movement (from Unrestricted)
      const invMovementResultUNR = await db
        .collection("inventory_movement")
        .add({
          ...baseInventoryMovement,
          movement: "OUT",
          inventory_category: "Unrestricted",
        });

      createdDocs.push({
        collection: "inventory_movement",
        docId: invMovementResultUNR.id,
      });

      // Create IN movement (to Reserved)
      const invMovementResultRES = await db
        .collection("inventory_movement")
        .add({
          ...baseInventoryMovement,
          movement: "IN",
          inventory_category: "Reserved",
        });

      createdDocs.push({
        collection: "inventory_movement",
        docId: invMovementResultRES.id,
      });

      // Update balances
      if (existingDoc && existingDoc.id) {
        const gdQuantity = roundQty(parseFloat(baseQty));

        updatedDocs.push({
          collection: balanceCollection,
          docId: existingDoc.id,
          originalData: {
            unrestricted_qty: roundQty(existingDoc.unrestricted_qty || 0),
            reserved_qty: roundQty(existingDoc.reserved_qty || 0),
          },
        });

        await db
          .collection(balanceCollection)
          .doc(existingDoc.id)
          .update({
            unrestricted_qty: roundQty(
              parseFloat(existingDoc.unrestricted_qty || 0) - gdQuantity
            ),
            reserved_qty: roundQty(
              parseFloat(existingDoc.reserved_qty || 0) + gdQuantity
            ),
          });
      }

      // Update costing method inventories
      if (costingMethod === "First In First Out") {
        await updateFIFOInventory(
          item.material_id,
          baseQty,
          temp.batch_id,
          data.plant_id
        );
      } else if (costingMethod === "Weighted Average") {
        await updateWeightedAverage(
          item,
          temp.batch_id,
          baseWAQty,
          data.plant_id
        );
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

const addEntry = async (organizationId, gd) => {
  try {
    const prefixData = await getPrefixData(organizationId, "Goods Delivery");

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "goods_delivery",
        "delivery_no"
      );

      await updatePrefix(organizationId, runningNumber, "Goods Delivery");
      gd.delivery_no = prefixToShow;
    }

    // Add the record
    await db.collection("goods_delivery").add(gd);

    // Fetch the created record to get its ID
    const createdRecord = await db
      .collection("goods_delivery")
      .where({
        delivery_no: gd.delivery_no,
        organization_id: organizationId,
      })
      .get();

    if (!createdRecord.data || createdRecord.data.length === 0) {
      throw new Error("Failed to retrieve created goods delivery record");
    }

    const gdId = createdRecord.data[0].id;
    console.log("Goods delivery created successfully with ID:", gdId);

    // Process balance table with the created record
    await processBalanceTable(gd, false);

    return gdId; // Return the created ID
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, gd, goodsDeliveryId, gdStatus) => {
  try {
    let oldDeliveryNo = gd.delivery_no;

    if (gdStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId, "Goods Delivery");

      if (prefixData) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
          "goods_delivery",
          "delivery_no"
        );

        await updatePrefix(organizationId, runningNumber, "Goods Delivery");
        gd.delivery_no = prefixToShow;
      }
    }

    await db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);
    await processBalanceTable(gd, true, oldDeliveryNo, gdStatus);

    console.log("Goods delivery updated successfully");
    return goodsDeliveryId;
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

const createOrUpdatePicking = async (
  gdData,
  gdId,
  organizationId,
  isUpdate = false
) => {
  try {
    let pickingSetupData;

    try {
      if (!gdData.plant_id) {
        throw new Error("Plant ID is required for picking setup");
      }

      const pickingSetupResponse = await db
        .collection("picking_setup")
        .where({
          plant_id: gdData.plant_id,
          movement_type: "Good Delivery",
          picking_required: 1,
        })
        .get();

      if (!pickingSetupResponse || !pickingSetupResponse.data) {
        throw new Error("Invalid response from picking setup query");
      }

      if (pickingSetupResponse.data.length === 0) {
        console.log(
          `No picking required for plant ${gdData.plant_id} - continuing without Transfer Order`
        );
        return { pickingStatus: null };
      } else if (pickingSetupResponse.data.length > 1) {
        console.warn(
          `Multiple picking setups found for plant ${gdData.plant_id}, using first active one`
        );
        pickingSetupData = pickingSetupResponse.data[0];
      } else {
        pickingSetupData = pickingSetupResponse.data[0];
      }
    } catch (error) {
      console.error("Error retrieving picking setup:", error.message);
      return { pickingStatus: null };
    }

    // Initialize picking status
    let pickingStatus = null;

    if (pickingSetupData) {
      if (pickingSetupData.auto_trigger_to === 1) {
        pickingStatus = "Created";
      } else {
        pickingStatus = "Not Created";
      }

      if (
        pickingSetupData.picking_mode === "Manual" &&
        pickingSetupData.auto_trigger_to === 1
      ) {
        // Check if we need to update existing Transfer Order
        if (isUpdate) {
          try {
            // Find existing Transfer Order for this GD
            const existingTOResponse = await db
              .collection("transfer_order")
              .where({
                ref_doc_type: "Good Delivery",
                gd_no: gdId,
                movement_type: "Picking",
                is_deleted: 0,
              })
              .get();

            if (existingTOResponse.data && existingTOResponse.data.length > 0) {
              const existingTO = existingTOResponse.data[0];
              console.log(`Found existing Transfer Order: ${existingTO.to_no}`);

              // Prepare updated picking items
              const updatedPickingItems = [];
              gdData.table_gd.forEach((item) => {
                if (item.temp_qty_data) {
                  try {
                    const tempData = parseJsonSafely(item.temp_qty_data);
                    tempData.forEach((tempItem) => {
                      const materialId =
                        tempItem.material_id || item.material_id;

                      updatedPickingItems.push({
                        item_code: String(materialId),
                        item_name: item.material_name,
                        item_desc: item.gd_material_desc || "",
                        batch_no: tempItem.batch_id
                          ? String(tempItem.batch_id)
                          : null,
                        qty_to_pick: parseFloat(tempItem.gd_quantity),
                        item_uom: String(item.gd_order_uom_id),
                        source_bin: String(tempItem.location_id),
                        pending_process_qty: parseFloat(tempItem.gd_quantity),
                        line_status: "Open",
                      });
                    });
                  } catch (error) {
                    console.error(
                      `Error parsing temp_qty_data for picking: ${error.message}`
                    );
                  }
                }
              });

              // Update the existing Transfer Order
              await db
                .collection("transfer_order")
                .doc(existingTO.id)
                .update({
                  table_picking_items: updatedPickingItems,
                  updated_by: this.getVarGlobal("nickname"),
                  updated_at: new Date().toISOString(),
                  ref_doc: gdData.gd_ref_doc,
                })
                .then(() => {
                  console.log(
                    `Transfer order ${existingTO.to_no} updated successfully`
                  );
                })
                .catch((error) => {
                  console.error("Error updating transfer order:", error);
                  throw error;
                });

              return { pickingStatus };
            } else {
              console.log(
                "No existing Transfer Order found for update, creating new one"
              );
            }
          } catch (error) {
            console.error(
              "Error checking/updating existing Transfer Order:",
              error
            );
            throw error;
          }
        }

        const transferOrder = {
          to_status: "Created",
          plant_id: gdData.plant_id,
          organization_id: organizationId,
          movement_type: "Picking",
          ref_doc_type: "Good Delivery",
          gd_no: gdId,
          delivery_no: gdData.delivery_no,
          customer_id: gdData.customer_name,
          created_by: this.getVarGlobal("nickname"),
          created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          ref_doc: gdData.gd_ref_doc,
          table_picking_items: [],
          is_deleted: 0,
        };

        // Process table items
        gdData.table_gd.forEach((item) => {
          if (item.temp_qty_data) {
            try {
              const tempData = parseJsonSafely(item.temp_qty_data);
              tempData.forEach((tempItem) => {
                transferOrder.table_picking_items.push({
                  item_code: item.material_id,
                  item_name: item.material_name,
                  item_desc: item.gd_material_desc || "",
                  batch_no: tempItem.batch_id
                    ? String(tempItem.batch_id)
                    : null,
                  item_batch_id: tempItem.batch_id
                    ? String(tempItem.batch_id)
                    : null,
                  qty_to_pick: parseFloat(tempItem.gd_quantity),
                  item_uom: String(item.gd_order_uom_id),
                  pending_process_qty: parseFloat(tempItem.gd_quantity),
                  source_bin: String(tempItem.location_id),
                  line_status: "Open",
                  so_no: item.line_so_no,
                });
              });
            } catch (error) {
              console.error(
                `Error parsing temp_qty_data for new TO: ${error.message}`
              );
            }
          }
        });

        const prefixData = await getPrefixData(
          organizationId,
          "Transfer Order"
        );

        if (prefixData) {
          const { prefixToShow, runningNumber } = await findUniquePrefix(
            prefixData,
            organizationId,
            "transfer_order",
            "to_id"
          );

          await updatePrefix(organizationId, runningNumber, "Transfer Order");
          transferOrder.to_id = prefixToShow;
        }

        await db
          .collection("transfer_order")
          .add(transferOrder)
          .then((res) => {
            console.log("Transfer order created:", res.id);
          })
          .catch((error) => {
            console.error("Error creating transfer order:", error);
            throw error;
          });
      }
    }

    return { pickingStatus };
  } catch (error) {
    console.error("Error in createOrUpdatePicking:", error);
    throw error;
  }
};

const checkExistingReservedGoods = async (soNumbers, currentGdId = null) => {
  try {
    // Handle multiple SO numbers - convert to array if it's a string
    let soArray = [];

    if (typeof soNumbers === "string") {
      // Split by comma and clean up whitespace
      soArray = soNumbers
        .split(",")
        .map((so) => so.trim())
        .filter((so) => so.length > 0);
    } else if (Array.isArray(soNumbers)) {
      soArray = soNumbers.filter((so) => so && so.toString().trim().length > 0);
    } else if (soNumbers) {
      // Single SO number
      soArray = [soNumbers.toString().trim()];
    }

    if (soArray.length === 0) {
      console.log("No valid SO numbers provided for reserved goods check");
      return { hasConflict: false };
    }

    console.log(
      `Checking existing reserved goods for SOs: ${soArray.join(", ")}`
    );

    // Check each SO number for conflicts
    for (const soNo of soArray) {
      const query = {
        so_no: soNo,
      };

      // If updating an existing GD, exclude its records from the check
      if (currentGdId) {
        // Get the current GD's delivery_no to exclude it
        const currentGdResponse = await db
          .collection("goods_delivery")
          .where({ id: currentGdId })
          .get();

        if (currentGdResponse.data && currentGdResponse.data.length > 0) {
          const currentGdNo = currentGdResponse.data[0].delivery_no;
          console.log(
            `Excluding current GD ${currentGdNo} from validation check for SO ${soNo}`
          );

          // Get all reserved goods for this specific SO
          const allReservedResponse = await db
            .collection("on_reserved_gd")
            .where(query)
            .get();

          if (allReservedResponse.data && allReservedResponse.data.length > 0) {
            // Filter out records belonging to the current GD
            const otherReservedRecords = allReservedResponse.data.filter(
              (record) => record.gd_no !== currentGdNo
            );

            // Check if any other GD has open quantities for this SO
            const hasOpenQty = otherReservedRecords.some(
              (record) => parseFloat(record.open_qty || 0) > 0
            );

            if (hasOpenQty) {
              // Get the GD number that has open quantities
              const conflictingRecord = otherReservedRecords.find(
                (record) => parseFloat(record.open_qty || 0) > 0
              );
              return {
                hasConflict: true,
                conflictingGdNo: conflictingRecord.gd_no,
                conflictingSoNo: soNo,
              };
            }
          }
        }
      } else {
        // For new GD creation, check all reserved goods for this specific SO
        const reservedResponse = await db
          .collection("on_reserved_gd")
          .where(query)
          .get();

        if (reservedResponse.data && reservedResponse.data.length > 0) {
          // Check if any record has open_qty > 0 for this SO
          const hasOpenQty = reservedResponse.data.some(
            (record) => parseFloat(record.open_qty || 0) > 0
          );

          if (hasOpenQty) {
            // Get the GD number that has open quantities
            const conflictingRecord = reservedResponse.data.find(
              (record) => parseFloat(record.open_qty || 0) > 0
            );
            return {
              hasConflict: true,
              conflictingGdNo: conflictingRecord.gd_no,
              conflictingSoNo: soNo,
            };
          }
        }
      }
    }

    // No conflicts found for any SO
    return { hasConflict: false };
  } catch (error) {
    console.error("Error checking existing reserved goods:", error);
    // Return no conflict on error to allow process to continue
    return { hasConflict: false };
  }
};

const createOnReserveGoodsDelivery = async (organizationId, gdData) => {
  try {
    const reservedDataBatch = [];

    for (let i = 0; i < gdData.table_gd.length; i++) {
      const gdLineItem = gdData.table_gd[i];
      const temp_qty_data = parseJsonSafely(gdLineItem.temp_qty_data);

      for (let j = 0; j < temp_qty_data.length; j++) {
        const tempItem = temp_qty_data[j];

        // Use line-level SO number, fallback to header SO
        const soNumber = gdLineItem.line_so_no || gdData.so_no;

        reservedDataBatch.push({
          so_no: soNumber,
          gd_no: gdData.delivery_no,
          material_id: gdLineItem.material_id,
          item_name: gdLineItem.material_name,
          item_desc: gdLineItem.gd_material_desc || "",
          batch_id: tempItem.batch_id || null,
          bin_location: tempItem.location_id,
          item_uom: gdLineItem.gd_order_uom_id,
          gd_line_no: i + 1,
          reserved_qty: tempItem.gd_quantity,
          delivered_qty: 0,
          open_qty: tempItem.gd_quantity,
          gd_reserved_date: new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
          plant_id: gdData.plant_id,
          organization_id: organizationId,
          created_by: this.getVarGlobal("nickname"),
          created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        });
      }
    }

    // Batch create all reserved records
    const createPromises = reservedDataBatch.map((data) =>
      db.collection("on_reserved_gd").add(data)
    );

    await Promise.all(createPromises);
    console.log(`Created ${reservedDataBatch.length} reserved goods records`);
  } catch (error) {
    console.error("Error in createOnReserveGoodsDelivery:", error);
    throw error;
  }
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
      const temp_qty_data = parseJsonSafely(gdLineItem.temp_qty_data);
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
          delivered_qty: 0,
          open_qty: tempItem.gd_quantity,
          gd_reserved_date: new Date().toISOString().split("T")[0],
          plant_id: gdData.plant_id,
          organization_id: organizationId,
          updated_by: this.getVarGlobal("nickname"),
          updated_at: new Date().toISOString(),
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
            created_at: new Date().toISOString(),
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

    // Define required fields
    const requiredFields = [
      { name: "customer_name", label: "Customer" },
      { name: "plant_id", label: "Plant" },
      { name: "so_id", label: "Sales Order" },
      {
        name: "table_gd",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate items
    for (const [index, item] of data.table_gd.entries()) {
      await this.validate(`table_gd.${index}.gd_qty`);
    }

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      let needsReservedGoodsCheck = false;
      let currentGdId = null;

      if (page_status === "Add") {
        needsReservedGoodsCheck = true;
      } else if (page_status === "Edit" && data.gd_status === "Draft") {
        needsReservedGoodsCheck = true;
        currentGdId = data.id;
      }

      // Improved SO number collection and reserved goods check
      if (needsReservedGoodsCheck) {
        const allSoNumbers = collectAllSoNumbers(data);

        if (allSoNumbers.length > 0) {
          const reservedCheck = await checkExistingReservedGoods(
            allSoNumbers,
            currentGdId
          );

          if (reservedCheck.hasConflict) {
            const conflictMessage = reservedCheck.conflictingSoNo
              ? `A Goods Delivery (No: ${reservedCheck.conflictingGdNo}) is already in Created status for Sales Order ${reservedCheck.conflictingSoNo}. To proceed, either: Edit that Goods Delivery to update the quantity or details, or Cancel it to create a new Goods Delivery.`
              : `A Goods Delivery (No: ${reservedCheck.conflictingGdNo}) is already in Created status for the Sales Orders. To proceed, either: Edit that Goods Delivery to update the quantity or details, or Cancel it to create a new Goods Delivery.`;

            this.parentGenerateForm.$alert(
              conflictMessage,
              "Existing Goods Delivery Found",
              {
                confirmButtonText: "OK",
                type: "warning",
              }
            );
            this.hideLoading();
            return;
          }
        }
      }

      // Handle previous quantities for updates (existing logic)
      if (page_status === "Edit" && data.id && Array.isArray(data.table_gd)) {
        try {
          const originalRecord = await db
            .collection("goods_delivery")
            .where({ id: data.id })
            .get();
          if (originalRecord.data && originalRecord.data.length > 0) {
            const originalGD = originalRecord.data[0];
            data.table_gd.forEach((item, index) => {
              if (originalGD.table_gd && originalGD.table_gd[index]) {
                item.prev_temp_qty_data =
                  originalGD.table_gd[index].temp_qty_data;
              }
            });
          }
        } catch (error) {
          console.error("Error retrieving original GD record:", error);
          data.table_gd.forEach((item) => {
            item.prev_temp_qty_data = item.temp_qty_data;
          });
        }
      }

      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      // Prepare goods delivery object
      const gd = {
        gd_status: "Created",
        picking_status: data.picking_status,
        fake_so_id: data.fake_so_id,
        so_id: data.so_id,
        so_no: data.so_no,
        gd_billing_address: data.gd_billing_address,
        gd_shipping_address: data.gd_shipping_address,
        delivery_no: data.delivery_no,
        plant_id: data.plant_id,
        organization_id: organizationId,
        gd_ref_doc: data.gd_ref_doc,
        customer_name: data.customer_name,
        gd_contact_name: data.gd_contact_name,
        contact_number: data.contact_number,
        email_address: data.email_address,
        document_description: data.document_description,
        gd_delivery_method: data.gd_delivery_method,
        delivery_date: data.delivery_date,
        driver_name: data.driver_name,
        driver_contact_no: data.driver_contact_no,
        ic_no: data.ic_no,
        validity_of_collection: data.validity_of_collection,
        vehicle_no: data.vehicle_no,
        pickup_date: data.pickup_date,
        courier_company: data.courier_company,
        shipping_date: data.shipping_date,
        freight_charges: data.freight_charges,
        tracking_number: data.tracking_number,
        est_arrival_date: data.est_arrival_date,
        driver_cost: data.driver_cost,
        est_delivery_date: data.est_delivery_date,
        shipping_company: data.shipping_company,
        shipping_method: data.shipping_method,
        tpt_vehicle_number: data.tpt_vehicle_number,
        tpt_transport_name: data.tpt_transport_name,
        tpt_ic_no: data.tpt_ic_no,
        tpt_driver_contact_no: data.tpt_driver_contact_no,
        table_gd: data.table_gd,
        order_remark: data.order_remark,
        billing_address_line_1: data.billing_address_line_1,
        billing_address_line_2: data.billing_address_line_2,
        billing_address_line_3: data.billing_address_line_3,
        billing_address_line_4: data.billing_address_line_4,
        billing_address_city: data.billing_address_city,
        billing_address_state: data.billing_address_state,
        billing_address_country: data.billing_address_country,
        billing_postal_code: data.billing_postal_code,
        billing_address_name: data.billing_address_name,
        billing_address_phone: data.billing_address_phone,
        billing_attention: data.billing_attention,
        shipping_address_line_1: data.shipping_address_line_1,
        shipping_address_line_2: data.shipping_address_line_2,
        shipping_address_line_3: data.shipping_address_line_3,
        shipping_address_line_4: data.shipping_address_line_4,
        shipping_address_city: data.shipping_address_city,
        shipping_address_state: data.shipping_address_state,
        shipping_address_country: data.shipping_address_country,
        shipping_postal_code: data.shipping_postal_code,
        shipping_address_name: data.shipping_address_name,
        shipping_address_phone: data.shipping_address_phone,
        shipping_attention: data.shipping_attention,
        acc_integration_type: data.acc_integration_type,
        last_sync_date: data.last_sync_date,
        customer_credit_limit: data.customer_credit_limit,
        overdue_limit: data.overdue_limit,
        outstanding_balance: data.outstanding_balance,
        overdue_inv_total_amount: data.overdue_inv_total_amount,
        is_accurate: data.is_accurate,
        gd_total: data.gd_total,
      };

      // Clean up undefined/null values
      Object.keys(gd).forEach((key) => {
        if (gd[key] === undefined || gd[key] === null) {
          delete gd[key];
        }
      });

      let gdId;
      let shouldHandlePicking = false;
      let isPickingUpdate = false;

      // Perform action based on page status
      if (page_status === "Add") {
        gdId = await addEntry(organizationId, gd);
        await createOnReserveGoodsDelivery(organizationId, gd);
        shouldHandlePicking = true;
        isPickingUpdate = false;
      } else if (page_status === "Edit") {
        gdId = data.id;

        // Check if we need to handle picking
        if (data.gd_status === "Draft" && gd.gd_status === "Created") {
          // Draft to Created - create new picking
          shouldHandlePicking = true;
          isPickingUpdate = false;
          await createOnReserveGoodsDelivery(organizationId, gd);
        } else if (data.gd_status === "Created" && gd.gd_status === "Created") {
          // Created to Created - update existing picking
          shouldHandlePicking = true;
          isPickingUpdate = true;
          await updateOnReserveGoodsDelivery(organizationId, gd);
        }

        await updateEntry(organizationId, gd, gdId, data.gd_status);
      }

      // Create or update picking if needed
      if (shouldHandlePicking && gdId) {
        try {
          const { pickingStatus } = await createOrUpdatePicking(
            gd,
            gdId,
            organizationId,
            isPickingUpdate
          );

          // Update GD with picking status if applicable
          if (pickingStatus) {
            await db.collection("goods_delivery").doc(gdId).update({
              picking_status: pickingStatus,
            });
          }
        } catch (pickingError) {
          console.error("Error handling picking:", pickingError);
          // Don't fail the entire operation if picking handling fails
          this.$message.warning(
            isPickingUpdate
              ? "Goods Delivery updated but picking update failed"
              : "Goods Delivery created but picking creation failed"
          );
        }
      }

      this.$message.success(
        page_status === "Add" ? "Added successfully" : "Updated successfully"
      );
      this.hideLoading();
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
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
