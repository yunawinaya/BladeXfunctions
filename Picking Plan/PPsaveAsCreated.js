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
  collection = "picking_plan",
  prefix = "to_no"
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
  collection = "picking_plan",
  prefix = "to_no"
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
      "Could not generate a unique Picking Plan number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

// NEW FUNCTION: Handle existing inventory movements for updates
const handleExistingInventoryMovements = async (
  plantId,
  pickingPlanNo,
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
      `Handling existing inventory movements for picking plan: ${pickingPlanNo}`
    );

    // Find all existing inventory movements for this TO
    const existingMovements = await db
      .collection("inventory_movement")
      .where({
        plant_id: plantId,
        transaction_type: "PP",
        trx_no: pickingPlanNo,
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
      console.log(
        "No existing inventory movements found for this picking plan"
      );
    }

    // Also handle existing inv_serial_movement records
    // Use the existing movement IDs to directly query serial movements
    if (existingMovements.data && existingMovements.data.length > 0) {
      const inventoryMovementIds = existingMovements.data.map(
        (movement) => movement.id
      );

      console.log(
        `Querying serial movements for ${inventoryMovementIds.length} inventory movement IDs`
      );

      // Query serial movements for each inventory movement ID
      const serialMovementPromises = inventoryMovementIds.map(
        async (movementId) => {
          try {
            const result = await db
              .collection("inv_serial_movement")
              .where({
                inventory_movement_id: movementId,
                plant_id: plantId,
                is_deleted: 0,
              })
              .get();

            return result.data || [];
          } catch (error) {
            console.error(
              `Error fetching serial movements for movement ID ${movementId}:`,
              error
            );
            return [];
          }
        }
      );

      const serialMovementResults = await Promise.all(serialMovementPromises);

      // Flatten all serial movements from all queries
      const allSerialMovements = serialMovementResults.flat();

      if (allSerialMovements.length > 0) {
        console.log(
          `Found ${allSerialMovements.length} existing serial movements to mark as deleted`
        );

        const serialUpdatePromises = allSerialMovements.map((movement) =>
          db.collection("inv_serial_movement").doc(movement.id).update({
            is_deleted: 1,
          })
        );

        await Promise.all(serialUpdatePromises);
        console.log("Successfully marked existing serial movements as deleted");
      } else {
        console.log("No existing serial movements found for this picking plan");
      }
    }
  } catch (error) {
    console.error("Error handling existing inventory movements:", error);
    throw error;
  }
};

// NEW FUNCTION: Reverse balance changes for updates
const reverseBalanceChanges = async (
  data,
  isUpdate = false,
  organizationId
) => {
  if (!isUpdate) {
    console.log("Not an update operation, skipping balance reversal");
    return;
  }

  console.log(
    "Reversing previous balance changes (including serialized items)"
  );
  const items = data.table_to;

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

      const isSerializedItem = itemData.serial_number_management === 1;
      const prevTempData = parseJsonSafely(item.prev_temp_qty_data);

      for (const prevTemp of prevTempData) {
        // UOM Conversion for previous quantity
        let prevBaseQty = roundQty(prevTemp.to_quantity);

        if (
          Array.isArray(itemData.table_uom_conversion) &&
          itemData.table_uom_conversion.length > 0
        ) {
          const uomConversion = itemData.table_uom_conversion.find(
            (conv) => conv.alt_uom_id === item.to_order_uom_id
          );

          if (uomConversion) {
            prevBaseQty = roundQty(prevBaseQty / uomConversion.alt_qty);
          }
        }

        if (isSerializedItem) {
          // Handle serialized item balance reversal
          const serialBalanceParams = {
            material_id: item.material_id,
            serial_number: prevTemp.serial_number,
            plant_id: data.plant_id,
            organization_id: organizationId,
            location_id: prevTemp.location_id,
          };

          // Add batch_id if item has batch management
          if (itemData.item_batch_management === 1 && prevTemp.batch_id) {
            serialBalanceParams.batch_id = prevTemp.batch_id;
          }

          const serialBalanceQuery = await db
            .collection("item_serial_balance")
            .where(serialBalanceParams)
            .get();

          if (serialBalanceQuery.data && serialBalanceQuery.data.length > 0) {
            const existingSerialDoc = serialBalanceQuery.data[0];

            // Reverse the previous changes: add back to unrestricted, subtract from reserved
            await db
              .collection("item_serial_balance")
              .doc(existingSerialDoc.id)
              .update({
                unrestricted_qty: roundQty(
                  parseFloat(existingSerialDoc.unrestricted_qty || 0) +
                    prevBaseQty
                ),
                reserved_qty: roundQty(
                  parseFloat(existingSerialDoc.reserved_qty || 0) - prevBaseQty
                ),
              });

            console.log(
              `Reversed serial balance for item ${item.material_id}, serial ${prevTemp.serial_number}`
            );
          }
        } else {
          // Handle non-serialized item balance reversal (existing logic)
          const itemBalanceParams = {
            material_id: item.material_id,
            location_id: prevTemp.location_id,
            plant_id: data.plant_id,
            organization_id: organizationId,
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

// Validate inventory availability
const validateInventoryAvailability = async (data, organizationId) => {
  const items = data.table_to;
  if (!Array.isArray(items) || items.length === 0) {
    return { isValid: true };
  }

  // Create a map to track total required quantities by material/location/batch/serial
  const requiredQuantities = new Map();

  // First pass: Calculate total required quantities
  for (const item of items) {
    if (!item.material_id || !item.temp_qty_data) {
      continue;
    }

    try {
      // Get item data to check stock control, serialization, and UOM conversion
      const itemRes = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        return {
          isValid: false,
          error: `Item not found: ${item.material_id}`,
        };
      }

      const itemData = itemRes.data[0];

      // Skip if stock control is disabled
      if (itemData.stock_control === 0) {
        continue;
      }

      const isSerializedItem = itemData.serial_number_management === 1;
      const isBatchManagedItem = itemData.item_batch_management === 1;
      const temporaryData = parseJsonSafely(item.temp_qty_data);

      for (const temp of temporaryData) {
        // Calculate base quantity with UOM conversion
        let baseQty = roundQty(temp.to_quantity);

        if (
          Array.isArray(itemData.table_uom_conversion) &&
          itemData.table_uom_conversion.length > 0
        ) {
          const uomConversion = itemData.table_uom_conversion.find(
            (conv) => conv.alt_uom_id === item.to_order_uom_id
          );

          if (uomConversion) {
            baseQty = roundQty(baseQty / uomConversion.alt_qty);
          }
        }

        // Create unique key using pipe separator to avoid conflicts with hyphens in serial numbers
        let key;
        if (isSerializedItem) {
          if (isBatchManagedItem && temp.batch_id) {
            key = `${item.material_id}|${temp.location_id || "no-location"}|${
              temp.batch_id
            }|${temp.serial_number}`;
          } else {
            key = `${item.material_id}|${temp.location_id || "no-location"}|${
              temp.serial_number
            }`;
          }
        } else {
          key = temp.batch_id
            ? `${item.material_id}|${temp.location_id}|${temp.batch_id}`
            : `${item.material_id}|${temp.location_id}`;
        }

        // Add to required quantities
        const currentRequired = requiredQuantities.get(key) || 0;
        requiredQuantities.set(key, currentRequired + baseQty);
      }
    } catch (error) {
      console.error(`Error processing item ${item.material_id}:`, error);
      return {
        isValid: false,
        error: `Error processing item ${item.material_id}: ${error.message}`,
      };
    }
  }

  // Second pass: Check availability against current balances
  for (const [key, requiredQty] of requiredQuantities.entries()) {
    const keyParts = key.split("|");
    const materialId = keyParts[0];
    const locationId = keyParts[1] !== "no-location" ? keyParts[1] : null;

    let batchId, serialNumber;

    // Determine if this is a serialized item key
    const itemRes = await db.collection("Item").where({ id: materialId }).get();
    if (!itemRes.data || !itemRes.data.length) {
      continue;
    }

    const itemData = itemRes.data[0];
    const isSerializedItem = itemData.serial_number_management === 1;
    const isBatchManagedItem = itemData.item_batch_management === 1;

    if (isSerializedItem) {
      if (isBatchManagedItem) {
        // serialized + batch: materialId|locationId|batchId|serialNumber
        batchId = keyParts[2] !== "undefined" ? keyParts[2] : null;
        serialNumber = keyParts[3];
      } else {
        // serialized only: materialId|locationId|serialNumber
        serialNumber = keyParts[2];
        batchId = null;
      }
    } else {
      // non-serialized: materialId|locationId|batchId (or no batchId)
      batchId = keyParts[2] !== "undefined" ? keyParts[2] : null;
      serialNumber = null;
    }

    try {
      let itemBalanceParams = {
        material_id: materialId,
        plant_id: data.plant_id,
        organization_id: organizationId,
      };

      let balanceCollection;
      let availableQty = 0;

      if (isSerializedItem) {
        // FOR SERIALIZED ITEMS: Check item_serial_balance
        balanceCollection = "item_serial_balance";
        itemBalanceParams.serial_number = serialNumber;

        if (batchId) {
          itemBalanceParams.batch_id = batchId;
        }

        if (locationId) {
          itemBalanceParams.location_id = locationId;
        }

        const balanceQuery = await db
          .collection(balanceCollection)
          .where(itemBalanceParams)
          .get();

        if (balanceQuery.data && balanceQuery.data.length > 0) {
          const balance = balanceQuery.data[0];

          // For serialized items, use total available (unrestricted + reserved)
          // since during TO creation, we move from unrestricted to reserved
          const unrestrictedQty = parseFloat(balance.unrestricted_qty || 0);
          const reservedQty = parseFloat(balance.reserved_qty || 0);
          availableQty = roundQty(unrestrictedQty + reservedQty);
        }
      } else {
        // FOR NON-SERIALIZED ITEMS: Use existing logic
        if (locationId) {
          itemBalanceParams.location_id = locationId;
        }

        if (batchId) {
          itemBalanceParams.batch_id = batchId;
          balanceCollection = "item_batch_balance";
        } else {
          balanceCollection = "item_balance";
        }

        const balanceQuery = await db
          .collection(balanceCollection)
          .where(itemBalanceParams)
          .get();

        if (balanceQuery.data && balanceQuery.data.length > 0) {
          const balance = balanceQuery.data[0];
          availableQty = roundQty(parseFloat(balance.unrestricted_qty || 0));
        }
      }

      // VALIDATION: Check if we have enough quantity
      if (availableQty < requiredQty) {
        // Get item name for better error message
        const itemName = itemData.material_name || materialId;

        let errorMsg = `Insufficient inventory for item "${itemName}". `;
        errorMsg += `Required: ${requiredQty}, Available: ${availableQty}`;

        if (isSerializedItem && serialNumber) {
          errorMsg += `, Serial: "${serialNumber}"`;
        }

        if (locationId && !isSerializedItem) {
          try {
            const locationRes = await db
              .collection("bin_location")
              .where({ id: locationId })
              .get();

            const locationName =
              locationRes.data && locationRes.data.length > 0
                ? locationRes.data[0].bin_location_combine || locationId
                : locationId;

            errorMsg += `, Location: "${locationName}"`;
          } catch {
            errorMsg += `, Location: "${locationId}"`;
          }
        }

        if (batchId) {
          try {
            const batchRes = await db
              .collection("batch")
              .where({ id: batchId })
              .get();

            const batchName =
              batchRes.data && batchRes.data.length > 0
                ? batchRes.data[0].batch_number || batchId
                : batchId;

            errorMsg += `, Batch: "${batchName}"`;
          } catch {
            errorMsg += `, Batch: "${batchId}"`;
          }
        }

        return {
          isValid: false,
          error: errorMsg,
          details: {
            materialId,
            itemName,
            locationId: locationId || null,
            batchId: batchId || null,
            serialNumber: serialNumber || null,
            requiredQty,
            availableQty,
          },
        };
      }
    } catch (error) {
      console.error(`Error checking balance for ${key}:`, error);
      return {
        isValid: false,
        error: `Error checking inventory balance: ${error.message}`,
      };
    }
  }

  return { isValid: true };
};

// Modified processBalanceTable function with inventory validation
const processBalanceTableWithValidation = async (
  data,
  isUpdate = false,
  oldPickingPlanNo = null,
  toStatus = null,
  organizationId
) => {
  console.log("Processing balance table");

  // STEP 1: Handle existing inventory movements and reverse balance changes for updates
  if (isUpdate && toStatus === "Created") {
    await handleExistingInventoryMovements(
      data.plant_id,
      oldPickingPlanNo,
      isUpdate
    );
    await reverseBalanceChanges(data, isUpdate, organizationId);
  }

  const items = data.table_to;

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
    await processItemBalance(
      item,
      itemData,
      data,
      consumedFIFOQty,
      organizationId
    );
  }

  // Process non-FIFO items sequentially as well to maintain inventory consistency
  for (const { item, itemData } of otherItems) {
    await processItemBalance(
      item,
      itemData,
      data,
      consumedFIFOQty,
      organizationId
    );
  }

  // Clear the FIFO tracking map
  consumedFIFOQty.clear();
};

// Updated processItemBalance function with grouped movements for serialized items
const processItemBalance = async (
  item,
  itemData,
  data,
  consumedFIFOQty,
  organizationId
) => {
  const temporaryData = parseJsonSafely(item.temp_qty_data);

  if (temporaryData.length === 0) {
    console.log(`No temporary data for item ${item.material_id}`);
    return;
  }

  // Check if item is serialized
  const isSerializedItem = itemData.serial_number_management === 1;
  const isBatchManagedItem = itemData.item_batch_management === 1;
  console.log(
    `Processing item ${item.material_id}, serialized: ${isSerializedItem}, batch: ${isBatchManagedItem}`
  );

  // Track created documents for potential rollback
  const createdDocs = [];
  const updatedDocs = [];

  try {
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
      group.totalQty += parseFloat(temp.to_quantity || 0);
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
      let altUOM = item.to_order_uom_id;
      let baseUOM = itemData.based_uom;
      let uomConversion = null;

      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        uomConversion = itemData.table_uom_conversion.find(
          (conv) => conv.alt_uom_id === altUOM
        );

        if (uomConversion) {
          baseQty = roundQty(altQty / uomConversion.alt_qty);
          console.log(`Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`);
        }
      }

      const costingMethod = itemData.material_costing_method;
      let unitPrice = roundPrice(item.unit_price || 0);
      let totalPrice = roundPrice(unitPrice * altQty);

      // Calculate cost price based on costing method
      if (costingMethod === "First In First Out") {
        const materialBatchKey = group.batch_id
          ? `${item.material_id}-${group.batch_id}`
          : item.material_id;

        const previouslyConsumedQty =
          consumedFIFOQty.get(materialBatchKey) || 0;

        const fifoCostPrice = await getLatestFIFOCostPrice(
          item.material_id,
          group.batch_id,
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
          group.batch_id,
          data.plant_id
        );
        unitPrice = roundPrice(waCostPrice);
        totalPrice = roundPrice(waCostPrice * baseQty);
      } else if (costingMethod === "Fixed Cost") {
        const fixedCostPrice = await getFixedCostPrice(item.material_id);
        unitPrice = roundPrice(fixedCostPrice);
        totalPrice = roundPrice(fixedCostPrice * baseQty);
      }

      // Create base inventory movement data (CONSOLIDATED)
      const baseInventoryMovement = {
        transaction_type: "PP",
        trx_no: data.to_no,
        parent_trx_no: item.line_so_no || data.so_no,
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
        plant_id: data.plant_id,
        organization_id: data.organization_id,
        is_deleted: 0,
      };

      // Create CONSOLIDATED OUT movement (from Unrestricted)
      await db.collection("inventory_movement").add({
        ...baseInventoryMovement,
        movement: "OUT",
        inventory_category: "Unrestricted",
      });

      // Wait and fetch the OUT movement ID
      await new Promise((resolve) => setTimeout(resolve, 100));

      const outMovementQuery = await db
        .collection("inventory_movement")
        .where({
          transaction_type: "PP",
          trx_no: data.to_no,
          parent_trx_no: item.line_so_no || data.so_no,
          movement: "OUT",
          inventory_category: "Unrestricted",
          item_id: item.material_id,
          bin_location_id: group.location_id,
          base_qty: baseQty,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
        })
        .get();

      let outMovementId = null;
      if (outMovementQuery.data && outMovementQuery.data.length > 0) {
        outMovementId = outMovementQuery.data.sort(
          (a, b) => new Date(b.create_time) - new Date(a.create_time)
        )[0].id;
        createdDocs.push({
          collection: "inventory_movement",
          docId: outMovementId,
        });
        console.log(
          `Created consolidated OUT movement for group ${groupKey}: ${baseQty}, ID: ${outMovementId}`
        );
      }

      // Create CONSOLIDATED IN movement (to Reserved)
      await db.collection("inventory_movement").add({
        ...baseInventoryMovement,
        movement: "IN",
        inventory_category: "Reserved",
      });

      // Wait and fetch the IN movement ID
      await new Promise((resolve) => setTimeout(resolve, 100));

      const inMovementQuery = await db
        .collection("inventory_movement")
        .where({
          transaction_type: "PP",
          trx_no: data.to_no,
          parent_trx_no: item.line_so_no || data.so_no,
          movement: "IN",
          inventory_category: "Reserved",
          item_id: item.material_id,
          bin_location_id: group.location_id,
          base_qty: baseQty,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
        })
        .get();

      let inMovementId = null;
      if (inMovementQuery.data && inMovementQuery.data.length > 0) {
        inMovementId = inMovementQuery.data.sort(
          (a, b) => new Date(b.create_time) - new Date(a.create_time)
        )[0].id;
        createdDocs.push({
          collection: "inventory_movement",
          docId: inMovementId,
        });
        console.log(
          `Created consolidated IN movement for group ${groupKey}: ${baseQty}, ID: ${inMovementId}`
        );
      }

      console.log(
        `Created consolidated movements for group ${groupKey}: OUT ${baseQty}, IN ${baseQty}`
      );

      // Create INDIVIDUAL inv_serial_movement records for each serial in the group
      if (isSerializedItem && outMovementId && inMovementId) {
        console.log(
          `Creating inv_serial_movement records for ${group.items.length} serialized items`
        );

        for (const temp of group.items) {
          if (temp.serial_number) {
            // Calculate individual base qty for this serial
            let individualBaseQty = roundQty(temp.to_quantity);
            if (uomConversion) {
              individualBaseQty = roundQty(
                individualBaseQty / uomConversion.alt_qty
              );
            }

            console.log(
              `Creating OUT inv_serial_movement for serial ${temp.serial_number}, qty: ${individualBaseQty}`
            );

            // Create OUT serial movement
            await db.collection("inv_serial_movement").add({
              inventory_movement_id: outMovementId,
              serial_number: temp.serial_number,
              batch_id: temp.batch_id || null,
              base_qty: individualBaseQty,
              base_uom: baseUOM,
              plant_id: data.plant_id,
              organization_id: organizationId,
            });

            // Wait and get the created OUT serial movement ID
            await new Promise((resolve) => setTimeout(resolve, 50));

            const outSerialMovementQuery = await db
              .collection("inv_serial_movement")
              .where({
                inventory_movement_id: outMovementId,
                serial_number: temp.serial_number,
                plant_id: data.plant_id,
                organization_id: organizationId,
              })
              .get();

            if (
              outSerialMovementQuery.data &&
              outSerialMovementQuery.data.length > 0
            ) {
              const outSerialMovementId = outSerialMovementQuery.data.sort(
                (a, b) => new Date(b.create_time) - new Date(a.create_time)
              )[0].id;
              createdDocs.push({
                collection: "inv_serial_movement",
                docId: outSerialMovementId,
              });
              console.log(
                `✓ Created OUT inv_serial_movement for serial ${temp.serial_number}, ID: ${outSerialMovementId}`
              );
            }

            console.log(
              `Creating IN inv_serial_movement for serial ${temp.serial_number}, qty: ${individualBaseQty}`
            );

            // Create IN serial movement
            await db.collection("inv_serial_movement").add({
              inventory_movement_id: inMovementId,
              serial_number: temp.serial_number,
              batch_id: temp.batch_id || null,
              base_qty: individualBaseQty,
              base_uom: baseUOM,
              plant_id: data.plant_id,
              organization_id: organizationId,
            });

            // Wait and get the created IN serial movement ID
            await new Promise((resolve) => setTimeout(resolve, 50));

            const inSerialMovementQuery = await db
              .collection("inv_serial_movement")
              .where({
                inventory_movement_id: inMovementId,
                serial_number: temp.serial_number,
                plant_id: data.plant_id,
                organization_id: organizationId,
              })
              .get();

            if (
              inSerialMovementQuery.data &&
              inSerialMovementQuery.data.length > 0
            ) {
              const inSerialMovementId = inSerialMovementQuery.data.sort(
                (a, b) => new Date(b.create_time) - new Date(a.create_time)
              )[0].id;
              createdDocs.push({
                collection: "inv_serial_movement",
                docId: inSerialMovementId,
              });
              console.log(
                `✓ Created IN inv_serial_movement for serial ${temp.serial_number}, ID: ${inSerialMovementId}`
              );
            }
          }
        }
        console.log(
          `Created ${
            group.items.length * 2
          } individual serial movement records for group ${groupKey} (${
            group.items.length
          } OUT + ${group.items.length} IN)`
        );
      }

      // Update balances
      if (isSerializedItem) {
        // For serialized items, update each serial balance individually
        for (const temp of group.items) {
          if (temp.serial_number) {
            let serialBalanceParams = {
              material_id: item.material_id,
              serial_number: temp.serial_number,
              plant_id: data.plant_id,
              organization_id: organizationId,
              location_id: temp.location_id,
            };

            if (isBatchManagedItem && temp.batch_id) {
              serialBalanceParams.batch_id = temp.batch_id;
            }

            const serialBalanceQuery = await db
              .collection("item_serial_balance")
              .where(serialBalanceParams)
              .get();

            if (serialBalanceQuery.data && serialBalanceQuery.data.length > 0) {
              const serialDoc = serialBalanceQuery.data[0];

              // Calculate individual base qty for this serial
              let individualBaseQty = roundQty(temp.to_quantity);
              if (uomConversion) {
                individualBaseQty = roundQty(
                  individualBaseQty / uomConversion.alt_qty
                );
              }

              // Store original data for rollback
              const originalData = {
                unrestricted_qty: roundQty(serialDoc.unrestricted_qty || 0),
                reserved_qty: roundQty(serialDoc.reserved_qty || 0),
              };

              // Add balance_quantity if it exists in the table structure
              if (serialDoc.hasOwnProperty("balance_quantity")) {
                originalData.balance_quantity = roundQty(
                  parseFloat(serialDoc.balance_quantity || 0)
                );
              }

              updatedDocs.push({
                collection: "item_serial_balance",
                docId: serialDoc.id,
                originalData: originalData,
              });

              // Calculate final quantities: move from unrestricted to reserved
              const finalUnrestrictedQty = roundQty(
                parseFloat(serialDoc.unrestricted_qty || 0) - individualBaseQty
              );
              const finalReservedQty = roundQty(
                parseFloat(serialDoc.reserved_qty || 0) + individualBaseQty
              );

              // Prepare update data
              const updateData = {
                unrestricted_qty: finalUnrestrictedQty,
                reserved_qty: finalReservedQty,
              };

              // Add balance_quantity if it exists in the table structure
              if (serialDoc.hasOwnProperty("balance_quantity")) {
                updateData.balance_quantity = roundQty(
                  finalUnrestrictedQty + finalReservedQty
                );
              }

              await db
                .collection("item_serial_balance")
                .doc(serialDoc.id)
                .update(updateData);

              console.log(
                `Updated serial balance for ${temp.serial_number}: ` +
                  `Unrestricted=${finalUnrestrictedQty}, Reserved=${finalReservedQty}` +
                  (updateData.balance_quantity
                    ? `, Balance=${updateData.balance_quantity}`
                    : "")
              );
            }
          }
        }

        // ADDED: Also update item_balance for serialized items (aggregated quantities)
        const generalItemBalanceParams = {
          material_id: item.material_id,
          location_id: group.location_id,
          plant_id: data.plant_id,
          organization_id: organizationId,
        };

        // Don't include batch_id in item_balance query for serialized items (aggregated balance)
        const generalBalanceQuery = await db
          .collection("item_balance")
          .where(generalItemBalanceParams)
          .get();

        if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
          const generalBalance = generalBalanceQuery.data[0];
          const currentGeneralUnrestrictedQty = roundQty(
            parseFloat(generalBalance.unrestricted_qty || 0)
          );
          const currentGeneralReservedQty = roundQty(
            parseFloat(generalBalance.reserved_qty || 0)
          );
          const currentGeneralBalanceQty = roundQty(
            parseFloat(generalBalance.balance_quantity || 0)
          );

          // Apply the same logic: move from unrestricted to reserved
          const finalGeneralUnrestrictedQty = roundQty(
            currentGeneralUnrestrictedQty - baseQty
          );
          const finalGeneralReservedQty = roundQty(
            currentGeneralReservedQty + baseQty
          );
          const finalGeneralBalanceQty = roundQty(
            currentGeneralBalanceQty // Balance quantity stays the same
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

          await db.collection("item_balance").doc(generalBalance.id).update({
            unrestricted_qty: finalGeneralUnrestrictedQty,
            reserved_qty: finalGeneralReservedQty,
            balance_quantity: finalGeneralBalanceQty,
          });

          console.log(
            `Updated item_balance for serialized item ${item.material_id} at ${group.location_id}: ` +
              `moved ${baseQty} from unrestricted to reserved`
          );
        } else {
          console.warn(
            `No item_balance record found for serialized item ${item.material_id} at location ${group.location_id}`
          );
        }
      } else {
        // For non-serialized items, update the consolidated balance
        let itemBalanceParams = {
          material_id: item.material_id,
          location_id: group.location_id,
          plant_id: data.plant_id,
          organization_id: organizationId,
        };

        let balanceCollection;
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

        if (balanceQuery.data && balanceQuery.data.length > 0) {
          const existingDoc = balanceQuery.data[0];

          updatedDocs.push({
            collection: balanceCollection,
            docId: existingDoc.id,
            originalData: {
              unrestricted_qty: roundQty(existingDoc.unrestricted_qty || 0),
              reserved_qty: roundQty(existingDoc.reserved_qty || 0),
              balance_quantity: roundQty(existingDoc.balance_quantity || 0),
            },
          });

          // Calculate final quantities: move from unrestricted to reserved
          const finalUnrestrictedQty = roundQty(
            parseFloat(existingDoc.unrestricted_qty || 0) - baseQty
          );
          const finalReservedQty = roundQty(
            parseFloat(existingDoc.reserved_qty || 0) + baseQty
          );
          const finalBalanceQty = roundQty(
            parseFloat(existingDoc.balance_quantity || 0) // Balance quantity stays the same
          );

          await db.collection(balanceCollection).doc(existingDoc.id).update({
            unrestricted_qty: finalUnrestrictedQty,
            reserved_qty: finalReservedQty,
            balance_quantity: finalBalanceQty,
          });

          console.log(
            `Updated ${balanceCollection} for group ${groupKey}: moved ${baseQty} from unrestricted to reserved`
          );

          // ADDED: For batch items, also update item_balance (aggregated balance)
          if (balanceCollection === "item_batch_balance" && group.batch_id) {
            const generalItemBalanceParams = {
              material_id: item.material_id,
              location_id: group.location_id,
              plant_id: data.plant_id,
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
              const currentGeneralUnrestrictedQty = roundQty(
                parseFloat(generalBalance.unrestricted_qty || 0)
              );
              const currentGeneralReservedQty = roundQty(
                parseFloat(generalBalance.reserved_qty || 0)
              );
              const currentGeneralBalanceQty = roundQty(
                parseFloat(generalBalance.balance_quantity || 0)
              );

              // Apply the same logic: move from unrestricted to reserved
              const finalGeneralUnrestrictedQty = roundQty(
                currentGeneralUnrestrictedQty - baseQty
              );
              const finalGeneralReservedQty = roundQty(
                currentGeneralReservedQty + baseQty
              );
              const finalGeneralBalanceQty = roundQty(
                currentGeneralBalanceQty // Balance quantity stays the same
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
                  `moved ${baseQty} from unrestricted to reserved`
              );
            } else {
              console.warn(
                `No item_balance record found for batch item ${item.material_id} at location ${group.location_id}`
              );
            }
          }
        }
      }
    }

    console.log(
      `Successfully processed ${groupedTempData.size} consolidated movement groups for item ${item.material_id}`
    );
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

  // Add TO quantity validation for Completed status
  if (data.table_to) {
    if (!Array.isArray(data.table_to) || data.table_to.length === 0) {
      missingFields.push("No items found in the picking plan");
    } else {
      // Check if all to_qty values are 0 or empty
      const hasValidQuantity = data.table_to.some((item) => {
        const toQty = parseFloat(item.to_qty || 0);
        return toQty > 0;
      });

      if (!hasValidQuantity) {
        missingFields.push(
          "All picking plan quantities are zero - please allocate stock or set picking plan quantities"
        );
      }

      // Check for items with stock control enabled but no temp_qty_data
      const invalidItems = data.table_to.filter((item) => {
        const toQty = parseFloat(item.to_qty || 0);
        const hasStockControl = item.material_id && item.material_id !== "";
        const hasAllocation =
          item.temp_qty_data &&
          item.temp_qty_data !== "[]" &&
          item.temp_qty_data !== "";

        return toQty > 0 && hasStockControl && !hasAllocation;
      });

      if (invalidItems.length > 0) {
        const invalidItemNames = invalidItems
          .map(
            (item) =>
              item.material_name || item.to_material_desc || "Unknown Item"
          )
          .join(", ");

        missingFields.push(
          `Items with quantities but no stock allocation: ${invalidItemNames}`
        );
      }
    }
  }

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

const addEntry = async (organizationId, to) => {
  try {
    let prefixData = null;
    let runningNumber = null;

    // Step 1: Prepare prefix data but don't update counter yet
    prefixData = await getPrefixData(organizationId, "Transfer Order");

    if (prefixData) {
      const { prefixToShow, runningNumber: newRunningNumber } =
        await findUniquePrefix(
          prefixData,
          organizationId,
          "picking_plan",
          "to_no"
        );

      runningNumber = newRunningNumber;
      to.to_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(to.to_no, organizationId);
      if (!isUnique) {
        throw new Error(
          `TO Number "${to.to_no}" already exists. Please use a different number.`
        );
      }
    }

    // Step 2: VALIDATE INVENTORY AVAILABILITY FIRST
    console.log("Validating inventory availability in addEntry");
    const validationResult = await validateInventoryAvailability(
      to,
      organizationId
    );

    if (!validationResult.isValid) {
      throw new Error(`Inventory validation failed: ${validationResult.error}`);
    }

    // Step 3: Process balance table (inventory operations) AFTER validation passes
    await processBalanceTableWithValidation(
      to,
      false,
      null,
      null,
      organizationId
    );

    // Step 4: Add the record ONLY after inventory processing succeeds
    await db.collection("picking_plan").add(to);

    // Step 5: Update prefix counter ONLY after record is successfully added
    if (prefixData && runningNumber !== null) {
      await updatePrefix(organizationId, runningNumber, "Transfer Order");
    }

    // Step 6: Fetch the created record to get its ID
    const createdRecord = await db
      .collection("picking_plan")
      .where({
        to_no: to.to_no,
        organization_id: organizationId,
      })
      .get();

    if (!createdRecord.data || createdRecord.data.length === 0) {
      throw new Error("Failed to retrieve created picking plan record");
    }

    await createOnReservePickingPlan(organizationId, to);

    const toId = createdRecord.data[0].id;
    console.log("Picking plan created successfully with ID:", toId);

    return createdRecord.data[0];
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, to, pickingPlanId, toStatus) => {
  try {
    let oldPickingPlanNo = to.to_no;
    let prefixData = null;
    let runningNumber = null;

    // Step 1: Prepare prefix data for Draft status but don't update counter yet
    if (toStatus === "Draft") {
      prefixData = await getPrefixData(organizationId, "Transfer Order");

      if (prefixData) {
        const { prefixToShow, runningNumber: newRunningNumber } =
          await findUniquePrefix(
            prefixData,
            organizationId,
            "picking_plan",
            "to_no"
          );

        runningNumber = newRunningNumber;
        to.to_no = prefixToShow;
      } else {
        const isUnique = await checkUniqueness(to.to_no, organizationId);
        if (!isUnique) {
          throw new Error(
            `TO Number "${to.to_no}" already exists. Please use a different number.`
          );
        }
      }
    }

    // Step 2: VALIDATE INVENTORY AVAILABILITY FIRST (only for Draft to Created)
    if (toStatus === "Draft") {
      console.log(
        "Validating inventory availability in updateEntry for Draft to Created"
      );
      const validationResult = await validateInventoryAvailability(
        to,
        organizationId
      );

      if (!validationResult.isValid) {
        throw new Error(
          `Inventory validation failed: ${validationResult.error}`
        );
      }
    }

    // Step 3: Process balance table (inventory operations) AFTER validation passes
    await processBalanceTableWithValidation(
      to,
      true,
      oldPickingPlanNo,
      toStatus,
      organizationId
    );

    // Step 4: Update the record ONLY after inventory processing succeeds
    const toData = await db
      .collection("picking_plan")
      .doc(pickingPlanId)
      .update(to);

    // Step 5: Update prefix counter ONLY after record is successfully updated
    if (toStatus === "Draft" && prefixData && runningNumber !== null) {
      await updatePrefix(organizationId, runningNumber, "Transfer Order");
    }

    if (toStatus === "Draft" && to.to_status === "Created") {
      await createOnReservePickingPlan(organizationId, to);
    } else if (toStatus === "Created" && to.to_status === "Created") {
      await updateOnReservePickingPlan(organizationId, to);
    }

    console.log("Picking plan updated successfully");
    return toData.data.modifiedResults[0];
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

const sendNotification = async (notificationParam) => {
  await this.runWorkflow(
    "1945684747032735745",
    notificationParam,
    async (res) => {
      console.log("Notification sent successfully:", res);
    }
  ).catch((err) => {
    this.$message.error("Workflow execution failed");
    console.error("Workflow execution failed:", err);
  });
};

const createOrUpdatePicking = async (
  toData,
  toId,
  organizationId,
  isUpdate = false,
  pickingSetupResponse
) => {
  try {
    let pickingSetupData;

    try {
      if (!toData.plant_id) {
        throw new Error("Plant ID is required for picking setup");
      }

      if (!pickingSetupResponse || !pickingSetupResponse.data) {
        throw new Error("Invalid response from picking setup query");
      }

      if (pickingSetupResponse.data.length === 0) {
        console.log(
          `No picking required for plant ${toData.plant_id} - continuing without Transfer Order`
        );
        return { pickingStatus: null };
      } else if (pickingSetupResponse.data.length > 1) {
        console.warn(
          `Multiple picking setups found for plant ${toData.plant_id}, using first active one`
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
      // For Picking Plan, ALWAYS create picking (ignore auto_trigger_to setting)
      // This is different from Goods Delivery where auto_trigger_to is respected
      pickingStatus = "Created";

      // Always create/update picking for Picking Plan
      // Check if we need to update existing Transfer Order
      if (isUpdate) {
        try {
          // Find existing Transfer Order for this TO
          const existingTOResponse = await db
            .collection("transfer_order")
            .where({
              ref_doc_type: "Picking Plan",
              to_no: toId,
              movement_type: "Picking",
              is_deleted: 0,
            })
            .get();

          if (existingTOResponse.data && existingTOResponse.data.length > 0) {
            const existingTO = existingTOResponse.data[0];
            console.log(`Found existing Transfer Order: ${existingTO.to_id}`);

            // Prepare updated picking items with grouping for serialized items
            const updatedPickingItemGroups = new Map();

            toData.table_to.forEach((item, toLineIndex) => {
              if (item.temp_qty_data && item.material_id) {
                try {
                  const tempData = parseJsonSafely(item.temp_qty_data);

                  tempData.forEach((tempItem) => {
                    const materialId = tempItem.material_id || item.material_id;
                    // Create a grouping key based on item, batch, location, and TO line index to prevent merging separate lines
                    const groupKey = `${materialId}_${
                      tempItem.batch_id || "no-batch"
                    }_${tempItem.location_id}_line${toLineIndex}`;

                    if (!updatedPickingItemGroups.has(groupKey)) {
                      // Create new group
                      updatedPickingItemGroups.set(groupKey, {
                        item_code: String(materialId),
                        item_name: item.material_name,
                        item_desc: item.to_material_desc || "",
                        batch_no: tempItem.batch_id
                          ? String(tempItem.batch_id)
                          : null,
                        so_no: item.line_so_no,
                        so_id: item.line_so_id,
                        so_line_id: item.so_line_item_id,
                        to_id: toId,
                        to_line_id: item.id,
                        customer_id: item.customer_id,
                        qty_to_pick: 0,
                        item_uom: String(item.to_order_uom_id),
                        source_bin: String(tempItem.location_id),
                        pending_process_qty: 0,
                        line_status: "Open",
                        serial_numbers: [],
                      });
                    }

                    const group = updatedPickingItemGroups.get(groupKey);
                    group.qty_to_pick += parseFloat(tempItem.to_quantity);
                    group.pending_process_qty += parseFloat(
                      tempItem.to_quantity
                    );

                    // Add serial number if exists
                    if (tempItem.serial_number) {
                      group.serial_numbers.push(String(tempItem.serial_number));
                    }
                  });
                } catch (error) {
                  console.error(
                    `Error parsing temp_qty_data for picking: ${error.message}`
                  );
                }
              }
            });

            // Convert grouped items to picking items array
            const updatedPickingItems = [];
            updatedPickingItemGroups.forEach((group) => {
              // Format serial numbers with line breaks if any exist
              if (group.serial_numbers.length > 0) {
                group.serial_numbers = group.serial_numbers.join(", ");
                group.is_serialized_item = 1;
              } else {
                delete group.serial_numbers;
                group.is_serialized_item = 0;
              }

              updatedPickingItems.push(group);
            });

            let soNOs = [...new Set(updatedPickingItems.map((pi) => pi.so_no))];

            // Update the existing Transfer Order
            await db
              .collection("transfer_order")
              .doc(existingTO.id)
              .update({
                assigned_to: toData.assigned_to,
                table_picking_items: updatedPickingItems,
                updated_by: this.getVarGlobal("nickname"),
                updated_at: new Date().toISOString(),
                ref_doc: toData.to_ref_doc,
                so_no: soNOs.join(", "),
                customer_id: toData.customer_name,
              })
              .then(() => {
                console.log(
                  `Transfer order ${existingTO.to_id} updated successfully`
                );
              })
              .catch((error) => {
                console.error("Error updating transfer order:", error);
                throw error;
              });

            // Notification handling (existing code remains the same)
            if (existingTO.assigned_to && toData.assigned_to) {
              const oldAssigned = Array.isArray(existingTO.assigned_to)
                ? existingTO.assigned_to
                : [existingTO.assigned_to];

              const newAssigned = Array.isArray(toData.assigned_to)
                ? toData.assigned_to
                : [toData.assigned_to];

              // Users who were removed
              const removedUsers = oldAssigned.filter(
                (userId) => !newAssigned.includes(userId)
              );

              // Users who were added
              const addedUsers = newAssigned.filter(
                (userId) => !oldAssigned.includes(userId)
              );

              console.log(`Removed users: ${removedUsers.join(", ")}`);
              console.log(`Added users: ${addedUsers.join(", ")}`);

              // Send cancellation notifications to removed users
              const cancellationPromises = removedUsers.map(async (userId) => {
                const notificationParam = {
                  title: "Picking Assignment Cancelled",
                  body: `Your picking task for Transfer Order: ${existingTO.to_id} has been cancelled.`,
                  userId: [userId],
                  data: {
                    docId: existingTO.to_id,
                    deepLink: `sudumobileexpo://picking/batch/${existingTO.to_id}`,
                    action: "cancelled",
                  },
                };

                try {
                  await sendNotification(notificationParam);
                  console.log(
                    `Cancellation notification sent to user: ${userId}`
                  );
                } catch (error) {
                  console.error(
                    `Failed to send cancellation notification to ${userId}:`,
                    error
                  );
                }
              });

              // Send new assignment notifications to added users
              const assignmentPromises = addedUsers.map(async (userId) => {
                const notificationParam = {
                  title: "New Picking Assignment",
                  body: `You have been assigned a picking task for Picking Plan: ${toData.to_no}. Transfer Order: ${existingTO.to_id}`,
                  userId: [userId],
                  data: {
                    docId: existingTO.to_id,
                    deepLink: `sudumobileexpo://picking/batch/${existingTO.to_id}`,
                    action: "assigned",
                  },
                };

                try {
                  await sendNotification(notificationParam);
                  console.log(
                    `Assignment notification sent to user: ${userId}`
                  );
                } catch (error) {
                  console.error(
                    `Failed to send assignment notification to ${userId}:`,
                    error
                  );
                }
              });

              try {
                await Promise.all([
                  ...cancellationPromises,
                  ...assignmentPromises,
                ]);
                console.log("All notifications sent successfully");
              } catch (error) {
                console.error("Some notifications failed to send:", error);
              }
            }

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
        to_id: toData.to_no,
        plant_id: toData.plant_id,
        organization_id: organizationId,
        movement_type: "Picking",
        ref_doc_type: "Picking Plan",
        to_no: toData.to_no,
        so_no: toData.so_no,
        customer_id: toData.customer_name,
        created_by: this.getVarGlobal("nickname"),
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        ref_doc: toData.to_ref_doc,
        assigned_to: toData.assigned_to,
        table_picking_items: [],
        is_deleted: 0,
      };

      // Process table items with grouping for serialized items
      const pickingItemGroups = new Map();

      toData.table_to.forEach((item, toLineIndex) => {
        if (item.temp_qty_data && item.material_id) {
          try {
            const tempData = parseJsonSafely(item.temp_qty_data);

            tempData.forEach((tempItem) => {
              // Create a grouping key based on item, batch, location, and TO line index to prevent merging separate lines
              const groupKey = `${item.material_id}_${
                tempItem.batch_id || "no-batch"
              }_${tempItem.location_id}_line${toLineIndex}`;

              if (!pickingItemGroups.has(groupKey)) {
                // Create new group
                pickingItemGroups.set(groupKey, {
                  item_code: item.material_id,
                  item_name: item.material_name,
                  item_desc: item.to_material_desc || "",
                  batch_no: tempItem.batch_id
                    ? String(tempItem.batch_id)
                    : null,
                  item_batch_id: tempItem.batch_id
                    ? String(tempItem.batch_id)
                    : null,
                  qty_to_pick: 0,
                  item_uom: String(item.to_order_uom_id),
                  pending_process_qty: 0,
                  source_bin: String(tempItem.location_id),
                  line_status: "Open",
                  so_no: item.line_so_no,
                  so_id: item.line_so_id,
                  so_line_id: item.so_line_item_id,
                  to_id: toId,
                  to_line_id: item.id,
                  customer_id: item.customer_id,
                  serial_numbers: [],
                });
              }

              const group = pickingItemGroups.get(groupKey);
              group.qty_to_pick += parseFloat(tempItem.to_quantity);
              group.pending_process_qty += parseFloat(tempItem.to_quantity);

              // Add serial number if exists
              if (tempItem.serial_number) {
                group.serial_numbers.push(String(tempItem.serial_number));
              }
            });
          } catch (error) {
            console.error(
              `Error parsing temp_qty_data for new TO: ${error.message}`
            );
          }
        }
      });

      // Convert grouped items to picking items array
      pickingItemGroups.forEach((group) => {
        // Format serial numbers with line breaks if any exist
        if (group.serial_numbers.length > 0) {
          group.serial_numbers = group.serial_numbers.join(", ");
          group.is_serialized_item = 1;
        } else {
          delete group.serial_numbers;
          group.is_serialized_item = 0;
        }

        transferOrder.table_picking_items.push(group);
      });

      // Transfer Order uses the same to_no as Picking Plan - no separate prefix needed

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

      if (transferOrder.assigned_to && transferOrder.assigned_to.length > 0) {
        const notificationParam = {
          title: "New Picking Assignment",
          body: `You have been assigned a picking task for Picking Plan: ${toData.to_no}. Transfer Order: ${transferOrder.to_id}`,
          userId: transferOrder.assigned_to,
          data: {
            docId: transferOrder.to_id,
            deepLink: `sudumobileexpo://picking/batch/${transferOrder.to_id}`,
          },
        };

        await sendNotification(notificationParam);
      }
    }

    return { pickingStatus };
  } catch (error) {
    console.error("Error in createOrUpdatePicking:", error);
    throw error;
  }
};

const createOnReservePickingPlan = async (organizationId, toData) => {
  try {
    const reservedDataBatch = [];

    for (let i = 0; i < toData.table_to.length; i++) {
      const toLineItem = toData.table_to[i];
      const temp_qty_data = parseJsonSafely(toLineItem.temp_qty_data);

      if (!toLineItem.material_id || toLineItem.material_id === "") {
        console.log(
          `Skipping item ${toLineItem.material_id} due to no material_id`
        );
        continue;
      }

      for (let j = 0; j < temp_qty_data.length; j++) {
        const tempItem = temp_qty_data[j];

        // Use line-level SO number, fallback to header SO
        const soNumber = toLineItem.line_so_no || toData.so_no;

        const reservedRecord = {
          doc_type: "Picking Plan",
          parent_no: soNumber,
          doc_no: toData.to_no,
          material_id: toLineItem.material_id,
          item_name: toLineItem.material_name,
          item_desc: toLineItem.to_material_desc || "",
          batch_id: tempItem.batch_id || null,
          bin_location: tempItem.location_id,
          item_uom: toLineItem.to_order_uom_id,
          line_no: i + 1,
          reserved_qty: tempItem.to_quantity,
          delivered_qty: 0,
          open_qty: tempItem.to_quantity,
          reserved_date: new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
          plant_id: toData.plant_id,
          organization_id: organizationId,
          created_by: this.getVarGlobal("nickname"),
          created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        };

        // Add serial number for serialized items
        if (tempItem.serial_number) {
          reservedRecord.serial_number = tempItem.serial_number;
        }

        reservedDataBatch.push(reservedRecord);
      }
    }

    // Batch create all reserved records
    const createPromises = reservedDataBatch.map((data) =>
      db.collection("on_reserved_gd").add(data)
    );

    await Promise.all(createPromises);
    console.log(
      `Created ${reservedDataBatch.length} reserved picking plan records (including serialized items)`
    );
  } catch (error) {
    console.error("Error in createOnReservePickingPlan:", error);
    throw error;
  }
};

const updateOnReservePickingPlan = async (organizationId, toData) => {
  try {
    console.log(
      "Updating on_reserved_gd records for picking plan:",
      toData.to_no
    );

    // Get existing records for this TO
    const existingReserved = await db
      .collection("on_reserved_gd")
      .where({
        doc_type: "Picking Plan",
        doc_no: toData.to_no,
        organization_id: organizationId,
      })
      .get();

    // Prepare new data from current TO (including serialized items)
    const newReservedData = [];
    for (let i = 0; i < toData.table_to.length; i++) {
      const toLineItem = toData.table_to[i];
      const temp_qty_data = parseJsonSafely(toLineItem.temp_qty_data);
      for (let j = 0; j < temp_qty_data.length; j++) {
        const tempItem = temp_qty_data[j];

        const reservedRecord = {
          doc_type: "Picking Plan",
          parent_no: toLineItem.line_so_no,
          doc_no: toData.to_no,
          material_id: toLineItem.material_id,
          item_name: toLineItem.material_name,
          item_desc: toLineItem.to_material_desc || "",
          batch_id: tempItem.batch_id,
          bin_location: tempItem.location_id,
          item_uom: toLineItem.to_order_uom_id,
          line_no: i + 1,
          reserved_qty: tempItem.to_quantity,
          delivered_qty: 0,
          open_qty: tempItem.to_quantity,
          reserved_date: new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
          plant_id: toData.plant_id,
          organization_id: organizationId,
          updated_by: this.getVarGlobal("nickname"),
          updated_at: new Date().toISOString(),
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
      console.log(
        "Successfully updated existing reserved records (including serialized items)"
      );
    } else {
      // No existing records, create new ones
      console.log("No existing records found, creating new ones");
      await createOnReservePickingPlan(organizationId, toData);
    }

    console.log("Updated reserved picking plan records successfully");
  } catch (error) {
    console.error("Error updating reserved picking plan:", error);
    throw error;
  }
};

const updateSalesOrderStatus = async (salesOrderId, tableTO) => {
  try {
    // Group table_to items by SO ID
    const itemsBySoId = {};

    tableTO.forEach((item) => {
      if (!item.line_so_id || !item.so_line_item_id) return;

      if (!itemsBySoId[item.line_so_id]) {
        itemsBySoId[item.line_so_id] = [];
      }

      itemsBySoId[item.line_so_id].push({
        so_line_item_id: item.so_line_item_id,
        to_qty: parseFloat(item.to_qty || 0),
      });
    });

    // Process each Sales Order
    const updatePromises = salesOrderId.map(async (soId) => {
      const resSO = await db.collection("sales_order").doc(soId).get();

      if (!resSO || !resSO?.data || resSO.data.length === 0) {
        console.log(`Sales Order ${soId} not found`);
        return { soId, success: false };
      }

      const soDoc = resSO.data[0];
      const soItems = soDoc.table_so || [];

      // Create a copy of the SO items to update
      const updatedSoItems = JSON.parse(JSON.stringify(soItems));

      // Get items for this SO from table_to
      const toItemsForThisSo = itemsBySoId[soId] || [];

      // Update planned_qty for each line item
      toItemsForThisSo.forEach((toItem) => {
        const soLineIndex = updatedSoItems.findIndex(
          (soLine) => soLine.id === toItem.so_line_item_id
        );

        if (soLineIndex !== -1) {
          const currentPlannedQty = parseFloat(
            updatedSoItems[soLineIndex].planned_qty || 0
          );
          const newPlannedQty = currentPlannedQty + toItem.to_qty;

          // Update planned_qty
          updatedSoItems[soLineIndex].planned_qty = newPlannedQty;

          console.log(
            `SO ${soId} Line ${
              soLineIndex + 1
            }: Updated planned_qty from ${currentPlannedQty} to ${newPlannedQty} (added ${
              toItem.to_qty
            })`
          );
        }
      });

      // Prepare update data
      const updateData = {
        table_so: updatedSoItems,
      };

      // Set to_status if not already set
      if (!soDoc.to_status || soDoc.to_status === null) {
        updateData.to_status = "Created";
      }

      // Execute database update
      await db.collection("sales_order").doc(soId).update(updateData);

      console.log(`Updated Sales Order ${soId} with planned quantities`);

      return { soId, success: true };
    });

    const results = await Promise.all(updatePromises);
    const successCount = results.filter((r) => r && r.success).length;

    console.log(
      `Successfully updated ${successCount} of ${salesOrderId.length} Sales Orders with planned quantities`
    );

    return results;
  } catch (error) {
    console.error("Error updating sales order:", error);
    throw new Error("Error updating sales order: " + error.message);
  }
};

const fillbackHeaderFields = async (to) => {
  try {
    for (const [index, toLineItem] of to.table_to.entries()) {
      // Only set customer_id if it's not already set (preserve line-specific customer)
      // Each line item should have its own customer_id from the SO it came from
      if (!toLineItem.customer_id) {
        toLineItem.customer_id = null;
      }
      toLineItem.organization_id = to.organization_id;
      toLineItem.plant_id = to.plant_id || null;
      toLineItem.assigned_to = to.assigned_to || null;
      toLineItem.line_index = index + 1;
    }
    return to.table_to;
  } catch {
    throw new Error("Error processing picking plan.");
  }
};

const checkQuantitiesBySoId = async (tableTO) => {
  // Step 1: Group by so_id and sum quantities
  const totalsBySoId = tableTO.reduce((acc, item) => {
    const { line_so_no, to_qty } = item;
    acc[line_so_no] = (acc[line_so_no] || 0) + to_qty;
    return acc;
  }, {});

  // Step 2: Check for so_ids with total quantity of 0
  const errors = [];
  const results = Object.entries(totalsBySoId).map(
    ([line_so_no, totalQuantity]) => {
      if (totalQuantity === 0) {
        errors.push(line_so_no);
      }
      return { line_so_no, totalQuantity };
    }
  );

  // Step 3: Return results and errors
  return {
    totals: results,
    errors: errors.length > 0 ? errors : null,
  };
};

const fetchDeliveredQuantity = async () => {
  const tableTO = this.getValue("table_to") || [];

  const resSOLineData = await Promise.all(
    tableTO.map((item) =>
      db.collection("sales_order_axszx8cj_sub").doc(item.so_line_item_id).get()
    )
  );

  const soLineItemData = resSOLineData.map((response) => response.data[0]);

  const resItem = await Promise.all(
    tableTO
      .filter(
        (item) => item.material_id !== null && item.material_id !== undefined
      )
      .map((item) => db.collection("Item").doc(item.material_id).get())
  );

  const itemData = resItem.map((response) => response.data[0]);

  const inValidDeliverQty = [];

  for (const [index, item] of tableTO.entries()) {
    if (!item.material_id || item.material_id === "") {
      continue;
    }

    const soLine = soLineItemData.find((so) => so.id === item.so_line_item_id);
    const itemInfo = itemData.find((data) => data.id === item.material_id);
    if (soLine) {
      const tolerance = itemInfo ? itemInfo.over_delivery_tolerance || 0 : 0;
      const maxDeliverableQty =
        ((soLine.so_quantity || 0) - (soLine.planned_qty || 0)) *
        ((100 + tolerance) / 100);
      if ((item.to_qty || 0) > maxDeliverableQty) {
        inValidDeliverQty.push(`#${index + 1}`);
        this.setData({
          [`table_to.${index}.to_undelivered_qty`]:
            (soLine.so_quantity || 0) - (soLine.planned_qty || 0),
        });
      }
    }
  }

  if (inValidDeliverQty.length > 0) {
    await this.$alert(
      `Line${inValidDeliverQty.length > 1 ? "s" : ""} ${inValidDeliverQty.join(
        ", "
      )} ha${
        inValidDeliverQty.length > 1 ? "ve" : "s"
      } an expected plan quantity exceeding the maximum planable quantity.`,
      "Invalid Plan Quantity",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );

    throw new Error("Invalid plan quantity detected.");
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
      { name: "to_no", label: "Picking Plan Number" },
      {
        name: "table_to",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Validate items
    for (const [index] of data.table_to.entries()) {
      await this.validate(`table_to.${index}.to_qty`);
    }

    await fetchDeliveredQuantity();

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      // Get picking setup
      const pickingSetupResponse = await db
        .collection("picking_setup")
        .where({
          plant_id: data.plant_id,
          movement_type: "Good Delivery",
          picking_required: 1,
        })
        .get();

      if (pickingSetupResponse.data.length > 0) {
        if (data.assigned_to.length === 0) {
          await this.$confirm(
            `Assigned To field is empty.\nIf you proceed, assigned person in picking record will be empty. \nWould you like to proceed?`,
            "No Assigned Person Detected",
            {
              confirmButtonText: "OK",
              cancelButtonText: "Cancel",
              type: "warning",
              dangerouslyUseHTMLString: false,
            }
          ).catch(() => {
            console.log("User clicked Cancel or closed the dialog");
            this.hideLoading();
            throw new Error("Saving picking plan cancelled.");
          });
        }
      }

      // Handle previous quantities for updates
      if (page_status === "Edit" && data.id && Array.isArray(data.table_to)) {
        try {
          const originalRecord = await db
            .collection("picking_plan")
            .where({ id: data.id })
            .get();
          if (originalRecord.data && originalRecord.data.length > 0) {
            const originalTO = originalRecord.data[0];
            data.table_to.forEach((item, index) => {
              if (originalTO.table_to && originalTO.table_to[index]) {
                item.prev_temp_qty_data =
                  originalTO.table_to[index].temp_qty_data;
              }
            });
          }
        } catch (error) {
          console.error("Error retrieving original TO record:", error);
          data.table_to.forEach((item) => {
            item.prev_temp_qty_data = item.temp_qty_data;
          });
        }
      }

      // Prepare picking plan object
      const to = {
        to_status: "Created",
        picking_status: data.picking_status,
        so_id: data.so_id,
        so_no: data.so_no,
        to_no: data.to_no,
        plant_id: data.plant_id,
        organization_id: organizationId,
        to_ref_doc: data.to_ref_doc,
        customer_name: data.customer_name,
        document_description: data.document_description,
        to_delivery_method: data.to_delivery_method,
        to_date: data.to_date,
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
        table_to: data.table_to,
        order_remark: data.order_remark,
        to_total: parseFloat(data.to_total.toFixed(3)),
        assigned_to: data.assigned_to,
        reference_type: data.reference_type,
        to_created_by: data.to_created_by,
        from_convert: "",
      };

      // Clean up undefined/null values
      Object.keys(to).forEach((key) => {
        if (to[key] === undefined || to[key] === null) {
          delete to[key];
        }
      });

      const result = await checkQuantitiesBySoId(to.table_to);

      if (result.errors) {
        throw new Error(
          `Total quantity for SO Number ${result.errors.join(
            ", "
          )} is 0. Please delete the item with related SO or deliver at least one item with quantity > 0.`
        );
      }
      const latestTO = to.table_to.filter((item) => item.to_qty > 0);

      to.table_to = latestTO;

      if (to.table_to.length === 0) {
        throw new Error(
          "All Delivered Quantity must not be 0. Please add at lease one item with delivered quantity > 0."
        );
      }

      await fillbackHeaderFields(to);

      let toId;
      let shouldHandlePicking = false;
      let isPickingUpdate = false;
      let toData;

      // Perform action based on page status
      if (page_status === "Add") {
        toData = await addEntry(organizationId, to);
        toId = toData.id;
        shouldHandlePicking = true;
        isPickingUpdate = false;
      } else if (page_status === "Edit") {
        toId = data.id;

        // Check if we need to handle picking
        if (data.to_status === "Draft" && to.to_status === "Created") {
          // Draft to Created - create new picking
          shouldHandlePicking = true;
          isPickingUpdate = false;
        } else if (data.to_status === "Created" && to.to_status === "Created") {
          // Created to Created - update existing picking
          shouldHandlePicking = true;
          isPickingUpdate = true;
        }

        toData = await updateEntry(organizationId, to, toId, data.to_status);
      }

      // Create or update picking if needed
      if (shouldHandlePicking && toId) {
        try {
          const { pickingStatus } = await createOrUpdatePicking(
            toData,
            toId,
            organizationId,
            isPickingUpdate,
            pickingSetupResponse
          );

          // Update TO with picking status if applicable
          if (pickingStatus) {
            // Fetch current PP data to get table_to
            const currentPP = await db
              .collection("picking_plan")
              .doc(toId)
              .get();
            if (currentPP.data && currentPP.data.length > 0) {
              const ppData = currentPP.data[0];
              const tableTo = ppData.table_to || [];

              // Update picking_status for all line items
              tableTo.forEach((item) => {
                item.picking_status = pickingStatus;
              });

              // Update PP with modified table_to and header picking_status
              await db.collection("picking_plan").doc(toId).update({
                picking_status: pickingStatus,
                table_to: tableTo,
              });
            }
          }
        } catch (pickingError) {
          console.error("Error handling picking:", pickingError);
          // Don't fail the entire operation if picking handling fails
          this.$message.warning(
            isPickingUpdate
              ? "Picking Plan updated but picking update failed"
              : "Picking Plan created but picking creation failed"
          );
        }
      }

      this.$message.success(
        page_status === "Add" ? "Added successfully" : "Updated successfully"
      );
      await updateSalesOrderStatus(to.so_id, to.table_to);
      this.hideLoading();
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    // Handle inventory validation rejection gracefully
    if (
      error.message &&
      error.message.includes("Inventory validation failed")
    ) {
      // Extract the actual error message after the prefix
      const actualError = error.message.replace(
        "Inventory validation failed: ",
        ""
      );

      this.parentGenerateForm.$alert(actualError, "Insufficient Inventory", {
        confirmButtonText: "OK",
        type: "error",
      });
      console.log(
        "Inventory validation failed - user notified via alert dialog"
      );
      return;
    }

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
