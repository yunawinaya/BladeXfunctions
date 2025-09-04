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

// Prevent duplicate processing
const preventDuplicateProcessing = () => {
  if (window.isProcessing) {
    console.log("Process already running, skipping...");
    return false;
  }

  const transactionId =
    Date.now().toString() + Math.random().toString(36).substring(2, 15);
  if (!window.processedTransactions) {
    window.processedTransactions = new Set();
  }

  if (window.processedTransactions.has(transactionId)) {
    console.log("This transaction already processed");
    return false;
  }

  window.processedTransactions.add(transactionId);

  if (window.processedTransactions.size > 50) {
    const transactions = Array.from(window.processedTransactions);
    window.processedTransactions = new Set(transactions.slice(-20));
  }

  window.isProcessing = true;
  return true;
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

// Updated validateInventoryAvailabilityForCompleted function with serialized item support
const validateInventoryAvailabilityForCompleted = async (
  data,
  plantId,
  organizationId
) => {
  console.log(
    "Validating inventory availability for Completed GD (including serialized items)"
  );

  const items = data.table_gd;
  if (!Array.isArray(items) || items.length === 0) {
    return { isValid: true };
  }

  // Helper function to safely parse JSON
  const parseJsonSafely = (jsonString, defaultValue = []) => {
    try {
      return jsonString ? JSON.parse(jsonString) : defaultValue;
    } catch (error) {
      console.error("JSON parse error:", error);
      return defaultValue;
    }
  };

  // Helper function for rounding quantities
  const roundQty = (value) => {
    return parseFloat(parseFloat(value || 0).toFixed(3));
  };

  // Create a map to track total required quantities using pipe separator for keys
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
        let baseQty = roundQty(temp.gd_quantity);

        if (
          Array.isArray(itemData.table_uom_conversion) &&
          itemData.table_uom_conversion.length > 0
        ) {
          const uomConversion = itemData.table_uom_conversion.find(
            (conv) => conv.alt_uom_id === item.gd_order_uom_id
          );

          if (uomConversion) {
            baseQty = roundQty(baseQty * uomConversion.base_qty);
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
      let totalAvailableQty = 0;

      if (isSerializedItem) {
        // FOR SERIALIZED ITEMS: Check item_serial_balance
        const itemBalanceParams = {
          material_id: materialId,
          serial_number: serialNumber,
          plant_id: plantId,
          organization_id: organizationId,
        };

        if (batchId) {
          itemBalanceParams.batch_id = batchId;
        }

        const balanceQuery = await db
          .collection("item_serial_balance")
          .where(itemBalanceParams)
          .get();

        if (balanceQuery.data && balanceQuery.data.length > 0) {
          const balance = balanceQuery.data[0];
          const unrestrictedQty = roundQty(
            parseFloat(balance.unrestricted_qty || 0)
          );
          const reservedQty = roundQty(parseFloat(balance.reserved_qty || 0));

          // For Completed status, both unrestricted and reserved can be used
          totalAvailableQty = roundQty(unrestrictedQty + reservedQty);

          console.log(
            `Serialized item ${materialId}, serial ${serialNumber}: Unrestricted=${unrestrictedQty}, Reserved=${reservedQty}, Total=${totalAvailableQty}`
          );
        }
      } else {
        // FOR NON-SERIALIZED ITEMS: Use existing logic
        const itemBalanceParams = {
          material_id: materialId,
          plant_id: plantId,
          organization_id: organizationId,
        };

        if (locationId) {
          itemBalanceParams.location_id = locationId;
        }

        if (batchId && batchId !== "undefined") {
          itemBalanceParams.batch_id = batchId;
        }

        const balanceCollection =
          batchId && batchId !== "undefined"
            ? "item_batch_balance"
            : "item_balance";

        const balanceQuery = await db
          .collection(balanceCollection)
          .where(itemBalanceParams)
          .get();

        if (balanceQuery.data && balanceQuery.data.length > 0) {
          const balance = balanceQuery.data[0];
          const unrestrictedQty = roundQty(
            parseFloat(balance.unrestricted_qty || 0)
          );
          const reservedQty = roundQty(parseFloat(balance.reserved_qty || 0));

          // For Completed status, both unrestricted and reserved can be used
          totalAvailableQty = roundQty(unrestrictedQty + reservedQty);

          console.log(
            `Item ${materialId} at ${locationId}: Unrestricted=${unrestrictedQty}, Reserved=${reservedQty}, Total=${totalAvailableQty}`
          );
        }
      }

      if (totalAvailableQty < requiredQty) {
        // Get item name for better error message
        const itemName = itemData.material_name || materialId;

        let errorMsg = `Insufficient total inventory for item "${itemName}". `;
        errorMsg += `Required: ${requiredQty}, Available: ${totalAvailableQty}`;

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

        if (batchId && batchId !== "undefined") {
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
            batchId: batchId !== "undefined" ? batchId : null,
            serialNumber: serialNumber || null,
            requiredQty,
            totalAvailableQty,
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

  console.log(
    "Inventory validation passed for Completed GD (including serialized items)"
  );
  return { isValid: true };
};

const addEntryWithValidation = async (organizationId, gd, gdStatus) => {
  try {
    // Step 1: Prepare prefix data but don't update counter yet
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow } = await findUniquePrefix(
        prefixData,
        organizationId
      );
      gd.delivery_no = prefixToShow;
    }

    // Step 2: VALIDATE INVENTORY AVAILABILITY FIRST
    console.log("Validating inventory availability");
    const validationResult = await validateInventoryAvailabilityForCompleted(
      gd,
      gd.plant_id,
      organizationId
    );

    if (!validationResult.isValid) {
      this.parentGenerateForm.$alert(
        validationResult.error,
        "Insufficient Total Inventory",
        {
          confirmButtonText: "OK",
          type: "error",
        }
      );
      throw new Error(`Inventory validation failed: ${validationResult.error}`);
    }

    // Step 3: Process balance table (inventory operations) AFTER validation passes
    await processBalanceTable(gd, false, gd.plant_id, organizationId, gdStatus);

    // Step 4: Add the record ONLY after inventory processing succeeds
    await db.collection("goods_delivery").add(gd);

    // Step 5: Update prefix counter ONLY after record is successfully added
    if (prefixData.length !== 0) {
      const { runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );
      await updatePrefix(organizationId, runningNumber);
    } else {
      const isUnique = await checkUniqueness(gd.delivery_no, organizationId);
      if (!isUnique) {
        throw new Error(
          `GD Number "${gd.delivery_no}" already exists. Please use a different number.`
        );
      }
    }

    // Step 6: Update related records
    const { so_data_array } = await updateSalesOrderStatus(
      gd.so_id,
      gd.table_gd
    );

    await this.runWorkflow(
      "1918140858502557698",
      { delivery_no: gd.delivery_no, so_data: so_data_array },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        alert();
        console.error("失败结果：", err);
        closeDialog();
      }
    );

    this.$message.success("Add successfully");
    await closeDialog();
  } catch (error) {
    // Handle inventory validation gracefully
    if (
      error.message &&
      error.message.includes("Inventory validation failed")
    ) {
      console.log(
        "Inventory validation failed - user notified via alert dialog"
      );
      return;
    }

    this.$message.error(error);
    throw error;
  }
};

const updateEntryWithValidation = async (
  organizationId,
  gd,
  gdStatus,
  goodsDeliveryId
) => {
  try {
    // Step 1: Prepare prefix data for Draft status but don't update counter yet
    if (gdStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId);

      if (prefixData.length !== 0) {
        const { prefixToShow } = await findUniquePrefix(
          prefixData,
          organizationId
        );
        gd.delivery_no = prefixToShow;
      } else {
        const isUnique = await checkUniqueness(gd.delivery_no, organizationId);
        if (!isUnique) {
          throw new Error(
            `GD Number "${gd.delivery_no}" already exists. Please use a different number.`
          );
        }
      }
    }

    // Step 2: VALIDATE INVENTORY AVAILABILITY FIRST
    console.log("Validating inventory availability");
    const validationResult = await validateInventoryAvailabilityForCompleted(
      gd,
      gd.plant_id,
      organizationId
    );

    if (!validationResult.isValid) {
      this.parentGenerateForm.$alert(
        validationResult.error,
        "Insufficient Total Inventory",
        {
          confirmButtonText: "OK",
          type: "error",
        }
      );
      throw new Error(`Inventory validation failed: ${validationResult.error}`);
    }

    // Step 3: Process balance table (inventory operations) AFTER validation passes
    await processBalanceTable(gd, true, gd.plant_id, organizationId, gdStatus);

    // Step 4: Update the record ONLY after inventory processing succeeds
    await db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);

    // Step 5: Update prefix counter ONLY after record is successfully updated
    if (gdStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId);
      if (prefixData.length !== 0) {
        const { runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId
        );
        await updatePrefix(organizationId, runningNumber);
      }
    }

    // Step 6: Update related records
    const { so_data_array } = await updateSalesOrderStatus(
      gd.so_id,
      gd.table_gd
    );

    await this.runWorkflow(
      "1918140858502557698",
      { delivery_no: gd.delivery_no, so_data: so_data_array },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        alert();
        console.error("失败结果：", err);
        closeDialog();
      }
    );

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    // Handle inventory validation gracefully
    if (
      error.message &&
      error.message.includes("Inventory validation failed")
    ) {
      console.log(
        "Inventory validation failed - user notified via alert dialog"
      );
      return;
    }

    this.$message.error(error);
    throw error;
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

  // Helper functions
  const roundQty = (value) => {
    return parseFloat(parseFloat(value || 0).toFixed(3));
  };

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
                  const movementId = movementQuery.data[0].id;

                  createdDocs.push({
                    collection: "inventory_movement",
                    docId: movementId,
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
                    const reservedMovementId = reservedMovementQuery.data[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: reservedMovementId,
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
                      unrestrictedMovementQuery.data[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: unrestrictedMovementId,
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
                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: releaseMovementQuery.data[0].id,
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
                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: returnMovementQuery.data[0].id,
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
                const movementId = movementQuery.data[0].id;

                createdDocs.push({
                  collection: "inventory_movement",
                  docId: movementId,
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

              // Find the inventory movement records we just created that are OUT movements
              const outMovements = createdDocs.filter(
                (doc) => doc.collection === "inventory_movement"
              );

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
                            serialMovementQuery.data[0].id;

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

              console.log(`Updated balance for group ${groupKey}`);
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

const getPrefixData = async (organizationId) => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Goods Delivery",
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

const updatePrefix = async (organizationId, runningNumber) => {
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
        document_types: "Goods Delivery",
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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("goods_delivery")
    .where({ delivery_no: generatedPrefix, organization_id: organizationId })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
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

  // Add GD quantity validation for Completed status
  if (data.table_gd) {
    if (!Array.isArray(data.table_gd) || data.table_gd.length === 0) {
      missingFields.push("No items found in the goods delivery");
    } else {
      // Check if all gd_qty values are 0 or empty
      const hasValidQuantity = data.table_gd.some((item) => {
        const gdQty = parseFloat(item.gd_qty || 0);
        return gdQty > 0;
      });

      if (!hasValidQuantity) {
        missingFields.push(
          "All delivery quantities are zero - please allocate stock or set delivery quantities"
        );
      }

      // Check for items with stock control enabled but no temp_qty_data
      const invalidItems = data.table_gd.filter((item) => {
        const gdQty = parseFloat(item.gd_qty || 0);
        const hasStockControl = item.material_id && item.material_id !== "";
        const hasAllocation =
          item.temp_qty_data &&
          item.temp_qty_data !== "[]" &&
          item.temp_qty_data !== "";

        return gdQty > 0 && hasStockControl && !hasAllocation;
      });

      if (invalidItems.length > 0) {
        const invalidItemNames = invalidItems
          .map(
            (item) =>
              item.material_name || item.gd_material_desc || "Unknown Item"
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

    return obj.toString();
  }
  return null;
};

const checkPickingStatus = async (gdData, pageStatus, currentGdStatus) => {
  try {
    if (!gdData.plant_id) {
      throw new Error("Plant ID is required for picking setup");
    }

    // Check if plant has picking setup for Good Delivery
    const pickingSetupData = await db
      .collection("picking_setup")
      .where({
        plant_id: gdData.plant_id,
        movement_type: "Good Delivery",
        picking_required: 1,
      })
      .get();

    // If no picking setup found, allow normal processing
    if (!pickingSetupData.data || pickingSetupData.data.length === 0) {
      console.log(
        `No picking setup found for plant ${gdData.plant_id}, proceeding normally`
      );
      return { canProceed: true, message: null };
    }

    // Log warning if multiple setups found (though we don't need the actual setup data)
    if (pickingSetupData.data.length > 1) {
      console.warn(
        `Multiple picking setups found for plant ${gdData.plant_id}, but only need to confirm picking is required`
      );
    }

    console.log(
      `Picking setup found for plant ${gdData.plant_id}. Checking requirements...`
    );

    // Scenario 1: Fresh Add (Draft -> Complete directly)
    // User cannot proceed directly to Complete, must create GD first for picking
    if (pageStatus === "Add") {
      return {
        canProceed: false,
        message: "Picking is Required",
        title: "Create Goods Delivery to start picking process",
      };
    }

    // Scenario 2: Edit mode with Created status
    // User can only proceed if picking_status is "Completed"
    if (pageStatus === "Edit" && currentGdStatus === "Created") {
      if (gdData.picking_status === "Completed") {
        console.log("Picking completed, allowing GD completion");
        return { canProceed: true, message: null };
      } else {
        return {
          canProceed: false,
          message: "Picking is Required",
          title:
            "Complete all picking process before completing Goods Delivery",
        };
      }
    }

    // Scenario 3: Edit mode with other statuses (shouldn't reach here in normal flow)
    if (pageStatus === "Edit") {
      console.log(
        `Edit mode with status: ${currentGdStatus}, checking picking status`
      );
      if (gdData.picking_status === "Completed") {
        return { canProceed: true, message: null };
      } else {
        return {
          canProceed: false,
          message: "Picking process must be completed first",
          title: "Complete picking before proceeding",
        };
      }
    }

    // Default: allow if no specific blocking condition
    return { canProceed: true, message: null };
  } catch (error) {
    console.error("Error checking picking status:", error);
    return {
      canProceed: false,
      message: "Error checking picking requirements. Please try again.",
      title: "System Error",
    };
  }
};

const checkExistingReservedGoods = async (
  soNumbers,
  currentGdId = null,
  organizationId
) => {
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
        parent_no: soNo,
        organization_id: organizationId,
        doc_type: "Good Delivery",
        is_deleted: 0,
      };

      // If updating an existing GD, exclude its records from the check
      if (currentGdId) {
        // Get the current GD's delivery_no to exclude it
        const currentGdResponse = await db
          .collection("goods_delivery")
          .where({
            id: currentGdId,
            organization_id: organizationId,
            is_deleted: 0,
          })
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
              (record) => record.doc_no !== currentGdNo
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
                conflictingGdNo: conflictingRecord.doc_no,
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
              conflictingGdNo: conflictingRecord.doc_no,
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

// Updated updateOnReserveGoodsDelivery function for Completed status with serial support
const updateOnReserveGoodsDelivery = async (organizationId, gdData) => {
  try {
    console.log(
      "Updating on_reserved_gd records for delivery (including serialized items):",
      gdData.delivery_no
    );

    // Helper function to safely parse JSON
    const parseJsonSafely = (jsonString, defaultValue = []) => {
      try {
        return jsonString ? JSON.parse(jsonString) : defaultValue;
      } catch (error) {
        console.error("JSON parse error:", error);
        return defaultValue;
      }
    };

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

const checkCompletedSO = async (so_id) => {
  const soIds = Array.isArray(so_id) ? so_id : [so_id];

  for (const sales_order_id of soIds) {
    const resSO = await db
      .collection("sales_order")
      .where({ id: sales_order_id })
      .get();

    if (!resSO.data || !resSO.data.length) {
      console.warn(`Sales order ${sales_order_id} not found`);
      continue;
    }

    const soData = resSO.data[0];

    const allItemsFullyDelivered = soData.table_so.every((item) => {
      const quantity = parseFloat(item.so_quantity || 0);
      const deliveredQty = parseFloat(item.delivered_qty || 0);

      if (quantity <= 0) return true;

      return deliveredQty >= quantity;
    });

    if (allItemsFullyDelivered) {
      throw new Error(
        `Sales Order ${soData.so_no} is already fully delivered and cannot be processed further.`
      );
    }
  }

  return true;
};

const fillbackHeaderFields = async (gd) => {
  try {
    for (const [index, gdLineItem] of gd.table_gd.entries()) {
      gdLineItem.customer_id = gd.customer_name || null;
      gdLineItem.organization_id = gd.organization_id;
      gdLineItem.plant_id = gd.plant_id || null;
      gdLineItem.billing_state_id = gd.billing_address_state || null;
      gdLineItem.billing_country_id = gd.billing_address_country || null;
      gdLineItem.shipping_state_id = gd.shipping_address_state || null;
      gdLineItem.shipping_country_id = gd.shipping_address_country || null;
      gdLineItem.assigned_to = gd.assigned_to || null;
      gdLineItem.line_index = index + 1;
    }
    return gd.table_gd;
  } catch {
    throw new Error("Error processing goods delivery.");
  }
};

const fetchDeliveredQuantity = async () => {
  const tableGD = this.getValue("table_gd") || [];

  const resSOLineData = await Promise.all(
    tableGD.map((item) =>
      db.collection("sales_order_axszx8cj_sub").doc(item.so_line_item_id).get()
    )
  );

  const soLineItemData = resSOLineData.map((response) => response.data[0]);

  const resItem = await Promise.all(
    tableGD
      .filter(
        (item) => item.material_id !== null && item.material_id !== undefined
      )
      .map((item) => db.collection("Item").doc(item.material_id).get())
  );

  const itemData = resItem.map((response) => response.data[0]);

  const inValidDeliverQty = [];

  for (const [index, item] of tableGD.entries()) {
    const soLine = soLineItemData.find((so) => so.id === item.so_line_item_id);
    const itemInfo = itemData.find((data) => data.id === item.material_id);
    if (soLine) {
      const tolerance = itemInfo ? itemInfo.over_delivery_tolerance || 0 : 0;
      const maxDeliverableQty =
        ((soLine.so_quantity || 0) - (soLine.delivered_qty || 0)) *
        ((100 + tolerance) / 100);
      if ((item.gd_qty || 0) > maxDeliverableQty) {
        inValidDeliverQty.push(`#${index + 1}`);
        this.setData({
          [`table_gd.${index}.gd_undelivered_qty`]:
            (soLine.so_quantity || 0) - (soLine.delivered_qty || 0),
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
      } an expected deliver quantity exceeding the maximum deliverable quantity.`,
      "Invalid Deliver Quantity",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );

    throw new Error("Invalid deliver quantity detected.");
  }
};

const processGDLineItem = async (entry) => {
  const totalQuantity = entry.table_gd.reduce((sum, item) => {
    const { gd_qty } = item;
    return sum + (gd_qty || 0); // Handle null/undefined received_qty
  }, 0);

  if (totalQuantity === 0) {
    throw new Error("Total deliver quantity is 0.");
  }

  const zeroQtyArray = [];
  for (const [index, gd] of entry.table_gd.entries()) {
    if (gd.gd_qty <= 0) {
      zeroQtyArray.push(`#${index + 1}`);
    }
  }

  if (zeroQtyArray.length > 0) {
    await this.$confirm(
      `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
        zeroQtyArray.length > 1 ? "ve" : "s"
      } a zero deliver quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 deliver quantity. \nWould you like to proceed?`,
      "Zero Deliver Quantity Detected",
      {
        confirmButtonText: "OK",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: false,
      }
    )
      .then(async () => {
        console.log("User clicked OK");
        entry.table_gd = entry.table_gd.filter((item) => item.gd_qty > 0);

        let soID = [];
        let salesOrderNumber = [];

        for (const gd of entry.table_gd) {
          soID.push(gd.line_so_id);
          salesOrderNumber.push(gd.line_so_no);
        }

        soID = [...new Set(soID)];
        salesOrderNumber = [...new Set(salesOrderNumber)];

        entry.so_id = soID;
        entry.so_no = salesOrderNumber.join(", ");

        return entry;
      })
      .catch(() => {
        // Function to execute when the user clicks "Cancel" or closes the dialog
        console.log("User clicked Cancel or closed the dialog");
        this.hideLoading();
        throw new Error("Saving goods delivery cancelled.");
        // Add your logic to stop or handle cancellation here
        // Example: this.stopFunction();
      });
  }

  return entry;
};

// Main execution wrapped in an async IIFE
(async () => {
  // Prevent duplicate processing
  if (!preventDuplicateProcessing()) {
    return;
  }

  try {
    this.showLoading();
    const data = await this.getValues();

    // Get page status and current GD status
    const page_status = data.page_status;
    const gdStatus = data.gd_status;
    const targetStatus = "Completed";

    console.log(
      `Page Status: ${page_status}, Current GD Status: ${gdStatus}, Target Status: ${targetStatus}`
    );

    // Define required fields
    const requiredFields = [
      { name: "customer_name", label: "Customer" },
      { name: "plant_id", label: "Plant" },
      { name: "so_id", label: "Sales Order" },
      { name: "delivery_date", label: "Delivery Date" },
      { name: "delivery_no", label: "Goods Delivery Number" },
      {
        name: "table_gd",
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

    // Validate form fields
    for (const [index] of data.table_gd.entries()) {
      await this.validate(`table_gd.${index}.gd_qty`);
    }

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length > 0) {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
      return;
    }

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
          currentGdId,
          organizationId
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

    // If this is an edit, store previous temporary quantities
    if (page_status === "Edit" && data.id && Array.isArray(data.table_gd)) {
      try {
        // Get the original record from database
        const originalRecord = await db
          .collection("goods_delivery")
          .where({ id: data.id, organization_id: organizationId })
          .get();
        if (originalRecord.data && originalRecord.data.length > 0) {
          const originalGD = originalRecord.data[0];

          // Store the ORIGINAL quantities as previous
          data.table_gd.forEach((item, index) => {
            if (originalGD.table_gd && originalGD.table_gd[index]) {
              item.prev_temp_qty_data =
                originalGD.table_gd[index].temp_qty_data;
            }
          });
        }
      } catch (error) {
        console.error("Error retrieving original GD record:", error);
        // Fallback to current behavior if database fetch fails
        data.table_gd.forEach((item) => {
          item.prev_temp_qty_data = item.temp_qty_data;
        });
      }
    }

    const {
      picking_status,
      credit_limit_status,
      so_id,
      so_no,
      gd_billing_address,
      gd_shipping_address,
      delivery_no,
      plant_id,
      organization_id,
      gd_ref_doc,
      customer_name,
      email_address,
      document_description,
      gd_delivery_method,
      delivery_date,
      assigned_to,

      driver_name,
      driver_contact_no,
      ic_no,
      validity_of_collection,
      vehicle_no,
      pickup_date,

      courier_company,
      shipping_date,
      freight_charges,
      tracking_number,
      est_arrival_date,

      driver_cost,
      est_delivery_date,

      shipping_company,
      shipping_method,

      tpt_vehicle_number,
      tpt_transport_name,
      tpt_ic_no,
      tpt_driver_contact_no,

      table_gd,
      order_remark,
      order_remark2,
      order_remark3,
      billing_address_line_1,
      billing_address_line_2,
      billing_address_line_3,
      billing_address_line_4,
      billing_address_city,
      billing_address_state,
      billing_address_country,
      billing_postal_code,
      billing_address_name,
      billing_address_phone,
      billing_attention,

      shipping_address_line_1,
      shipping_address_line_2,
      shipping_address_line_3,
      shipping_address_line_4,
      shipping_address_city,
      shipping_address_state,
      shipping_address_country,
      shipping_postal_code,
      shipping_address_name,
      shipping_address_phone,
      shipping_attention,

      acc_integration_type,
      last_sync_date,
      customer_credit_limit,
      overdue_limit,
      outstanding_balance,
      overdue_inv_total_amount,
      is_accurate,
      gd_total,
      reference_type,
      gd_created_by,
    } = data;

    // Prepare goods delivery object
    const gd = {
      gd_status: targetStatus,
      picking_status,
      credit_limit_status: "Overridden",
      so_id,
      so_no,
      gd_billing_address,
      gd_shipping_address,
      delivery_no,
      plant_id,
      organization_id,
      gd_ref_doc,
      customer_name,
      email_address,
      document_description,
      gd_delivery_method,
      delivery_date,
      assigned_to,

      driver_name,
      driver_contact_no,
      ic_no,
      validity_of_collection,
      vehicle_no,
      pickup_date,

      courier_company,
      shipping_date,
      freight_charges,
      tracking_number,
      est_arrival_date,

      driver_cost,
      est_delivery_date,

      shipping_company,
      shipping_method,

      tpt_vehicle_number,
      tpt_transport_name,
      tpt_ic_no,
      tpt_driver_contact_no,

      table_gd,
      order_remark,
      order_remark2,
      order_remark3,
      billing_address_line_1,
      billing_address_line_2,
      billing_address_line_3,
      billing_address_line_4,
      billing_address_city,
      billing_address_state,
      billing_address_country,
      billing_postal_code,
      billing_address_name,
      billing_address_phone,
      billing_attention,

      shipping_address_line_1,
      shipping_address_line_2,
      shipping_address_line_3,
      shipping_address_line_4,
      shipping_address_city,
      shipping_address_state,
      shipping_address_country,
      shipping_postal_code,
      shipping_address_name,
      shipping_address_phone,
      shipping_attention,

      acc_integration_type,
      last_sync_date,
      customer_credit_limit,
      overdue_limit,
      outstanding_balance,
      overdue_inv_total_amount,
      is_accurate,
      gd_total: parseFloat(gd_total.toFixed(3)),
      reference_type,
      gd_created_by,
    };

    // Clean up undefined/null values
    Object.keys(gd).forEach((key) => {
      if (gd[key] === undefined || gd[key] === null) {
        delete gd[key];
      }
    });

    const latestGD = await processGDLineItem(gd);

    if (latestGD.table_gd.length === 0) {
      throw new Error(
        "All Delivered Quantity must not be 0. Please add at lease one item with delivered quantity > 0."
      );
    }

    await fillbackHeaderFields(latestGD);

    // Check picking requirements with proper parameters
    const pickingCheck = await checkPickingStatus(
      latestGD,
      page_status,
      gdStatus
    );

    if (!pickingCheck.canProceed) {
      this.parentGenerateForm.$alert(pickingCheck.title, pickingCheck.message, {
        confirmButtonText: "OK",
        type: "warning",
      });
      this.hideLoading();
      return;
    }

    await fetchDeliveredQuantity();

    // Perform action based on page status
    if (page_status === "Add") {
      await addEntryWithValidation(organizationId, latestGD, gdStatus);
    } else if (page_status === "Edit") {
      const goodsDeliveryId = data.id;
      await updateEntryWithValidation(
        organizationId,
        latestGD,
        gdStatus,
        goodsDeliveryId
      );
      if (gdStatus === "Created") {
        await updateOnReserveGoodsDelivery(organizationId, latestGD);
      }
    }
  } catch (error) {
    this.hideLoading();

    if (error.message === "Inventory validation failed") {
      console.log(
        "Inventory validation failed - user notified via alert dialog"
      );
      return;
    }

    // Try to get message from standard locations first
    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage =
        findFieldMessage(error) ||
        error.message ||
        error.toString() ||
        JSON.stringify(error);
    } else {
      errorMessage = String(error);
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  } finally {
    window.isProcessing = false;
    this.hideLoading();
    console.log("Goods Delivery function execution completed");
  }
})();
