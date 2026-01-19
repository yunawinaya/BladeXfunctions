// ============================================================================
// GLOBAL_SUBTRACT_INVENTORY.js
// Generic inventory subtraction function for all modules
// ============================================================================

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

// Function to get Fixed cost price
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

// Update Weighted Average inventory
const updateWeightedAverage = (materialId, batchId, baseWAQty, plantId) => {
  // Input validation
  if (!materialId || isNaN(parseFloat(baseWAQty)) || parseFloat(baseWAQty) <= 0) {
    console.error("Invalid data for weighted average update:", { materialId, baseWAQty });
    return Promise.resolve();
  }

  const deliveredQty = parseFloat(baseWAQty);
  const query = batchId
    ? db.collection("wa_costing_method").where({
        material_id: materialId,
        batch_id: batchId,
        plant_id: plantId,
      })
    : db
        .collection("wa_costing_method")
        .where({ material_id: materialId, plant_id: plantId });

  return query
    .get()
    .then((waResponse) => {
      const waData = waResponse.data;
      if (!waData || !Array.isArray(waData) || waData.length === 0) {
        console.warn(
          `No weighted average records found for material ${materialId}`
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
          `Warning: Cannot fully update weighted average for ${materialId} - ` +
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
              `Updated Weighted Average for item ${materialId} to zero quantity`
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
            `Successfully processed Weighted Average for item ${materialId}, ` +
              `new quantity: ${newWaQuantity}, cost price: ${waCostPrice}`
          );
          return Promise.resolve();
        });
    })
    .catch((error) => {
      console.error(
        `Error processing Weighted Average for item ${materialId}:`,
        error
      );
      return Promise.reject(error);
    });
};

// ============================================================================
// MAIN FUNCTION: processBalanceTable
// ============================================================================
/**
 * Process inventory balance table for a single item
 *
 * @param {Object} config - Configuration object
 * @param {Object} config.item - Single item to process (normalized to universal field names)
 * @param {string} config.item.material_id - Item/material ID
 * @param {number} config.item.quantity - Line item total quantity
 * @param {string} config.item.alt_uom_id - Alternative UOM ID
 * @param {number} config.item.unit_price - Unit price
 * @param {string} config.item.temp_qty_data - JSON string of location/batch/qty breakdown
 * @param {string} [config.item.prev_temp_qty_data] - Previous temp data for updates
 * @param {string} [config.item.parent_trx_no] - Parent transaction number
 * @param {string} [config.item.costing_method_id] - Costing method reference
 * @param {string} config.plantId - Plant ID
 * @param {string} config.organizationId - Organization ID
 * @param {string} config.transactionType - Transaction type (e.g., "GDL", "SML")
 * @param {string} config.transactionNo - Transaction number
 * @param {boolean} config.useReservedFirst - true = deduct Reserved first, false = Unrestricted first
 * @param {boolean} [config.isUpdate=false] - Whether this is an update operation
 * @param {boolean} [config.isSpecialMode=false] - Special mode (GDPP, SRPP) - keeps unused reserved
 * @param {Object} [config.consumedFIFOQty] - Shared object to track consumed FIFO quantities (plain object, not Map)
 * @param {Array} [config.updatedDocs] - Array to track updated docs for rollback
 * @param {Array} [config.createdDocs] - Array to track created docs for rollback
 *
 * @returns {Promise<Object>} Result object with success, itemId, processedGroups, error
 */
const processBalanceTable = async (config) => {
  const {
    item,
    plantId,
    organizationId,
    transactionType,
    transactionNo,
    useReservedFirst,
    isUpdate = false,
    isSpecialMode = false,
    consumedFIFOQty = {},  // Use plain object instead of Map
    updatedDocs = [],
    createdDocs = [],
  } = config;

  console.log(`Processing balance table for item ${item.material_id}`);

  // Input validation
  if (!item.material_id || !item.temp_qty_data) {
    console.error(`Invalid item data:`, item);
    return {
      success: false,
      itemId: item.material_id,
      processedGroups: 0,
      error: new Error("Invalid item data: missing material_id or temp_qty_data"),
    };
  }

  try {
    // Fetch item master data
    const itemRes = await db
      .collection("Item")
      .where({ id: item.material_id })
      .get();

    if (!itemRes.data || !itemRes.data.length) {
      console.error(`Item not found: ${item.material_id}`);
      return {
        success: false,
        itemId: item.material_id,
        processedGroups: 0,
        error: new Error(`Item not found: ${item.material_id}`),
      };
    }

    const itemData = itemRes.data[0];

    // Check if item should be processed based on stock_control
    if (itemData.stock_control === 0) {
      console.log(
        `Skipping inventory update for item ${item.material_id} (stock_control=0)`
      );
      return {
        success: true,
        itemId: item.material_id,
        processedGroups: 0,
        error: null,
      };
    }

    const isBatchManagedItem = itemData.item_batch_management === 1;

    const temporaryData = parseJsonSafely(item.temp_qty_data);
    const prevTempData = isUpdate
      ? parseJsonSafely(item.prev_temp_qty_data)
      : null;

    if (temporaryData.length === 0 && !(isUpdate && prevTempData && prevTempData.length > 0)) {
      console.log(`No temp_qty_data to process for item ${item.material_id}`);
      return {
        success: true,
        itemId: item.material_id,
        processedGroups: 0,
        error: null,
      };
    }

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
      group.totalQty += parseFloat(temp.quantity || 0);
    }

    // For update mode, also create groups from prevTempData if they don't exist in current data
    if (isUpdate && prevTempData && prevTempData.length > 0) {
      for (const prevTemp of prevTempData) {
        let prevGroupKey;
        if (isBatchManagedItem && prevTemp.batch_id) {
          prevGroupKey = `${prevTemp.location_id}|${prevTemp.batch_id}`;
        } else {
          prevGroupKey = prevTemp.location_id;
        }

        // Only add if this group doesn't exist in current data
        if (!groupedTempData.has(prevGroupKey)) {
          groupedTempData.set(prevGroupKey, {
            location_id: prevTemp.location_id,
            batch_id: prevTemp.batch_id,
            items: [],
            totalQty: 0, // Current quantity is 0 for this group
          });
        }
      }
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
      let altUOM = item.alt_uom_id;
      let baseUOM = itemData.based_uom;
      let altWAQty = roundQty(item.quantity);
      let baseWAQty = altWAQty;
      let uomConversion = null;

      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        console.log(`Checking UOM conversions for item ${item.material_id}`);

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
          `No UOM conversion table for item ${item.material_id}, using received quantity as-is`
        );
      }

      // Calculate previous quantities for this specific group
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
            let prevAltQty = roundQty(prevTemp.quantity);
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
          `Previous quantity for group ${groupKey}: ${prevBaseQty}`
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
        // Use plain object syntax instead of Map
        const previouslyConsumedQty = consumedFIFOQty[materialBatchKey] || 0;

        // Get unit price from latest FIFO sequence with awareness of consumed quantities
        const fifoCostPrice = await getLatestFIFOCostPrice(
          item.material_id,
          group.batch_id,
          baseQty,
          previouslyConsumedQty,
          plantId
        );

        // Update the consumed quantity for this material/batch
        // Use plain object syntax instead of Map
        consumedFIFOQty[materialBatchKey] = previouslyConsumedQty + baseQty;

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
        console.log(`Unknown costing method: ${costingMethod}, skipping`);
        continue;
      }

      // Get current balance to determine smart movement logic
      let itemBalanceParams = {
        material_id: item.material_id,
        plant_id: plantId,
        organization_id: organizationId,
        location_id: group.location_id,
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

      const hasExistingBalance =
        balanceQuery.data &&
        Array.isArray(balanceQuery.data) &&
        balanceQuery.data.length > 0;
      const existingDoc = hasExistingBalance ? balanceQuery.data[0] : null;

      // Create base inventory movement data (CONSOLIDATED)
      const baseInventoryMovement = {
        transaction_type: transactionType,
        trx_no: transactionNo,
        parent_trx_no: item.parent_trx_no || null,
        unit_price: unitPrice,
        total_price: totalPrice,
        quantity: altQty, // CONSOLIDATED quantity
        item_id: item.material_id,
        uom_id: altUOM,
        base_qty: baseQty, // CONSOLIDATED base quantity
        base_uom_id: baseUOM,
        bin_location_id: group.location_id,
        batch_number_id: group.batch_id || null,
        costing_method_id: item.costing_method_id,
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
      };

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

        console.log(`Current inventory for group ${groupKey}:`);
        console.log(`  Unrestricted: ${currentUnrestrictedQty}`);
        console.log(`  Reserved: ${currentReservedQty}`);
        console.log(`  Total Balance: ${currentBalanceQty}`);

        // Smart movement logic based on useReservedFirst flag
        if (useReservedFirst) {
          // Deduct from Reserved first
          console.log(
            `Processing Reserved-first - moving ${baseQty} OUT from Reserved for group ${groupKey}`
          );

          // For edit mode, we can only use the reserved quantity that this transaction previously created
          let availableReservedForThis = currentReservedQty;
          if (isUpdate && prevBaseQty > 0) {
            availableReservedForThis = Math.min(
              currentReservedQty,
              prevBaseQty
            );
            console.log(
              `This transaction previously reserved for group ${groupKey}: ${prevBaseQty}`
            );
            console.log(
              `Available reserved for this transaction: ${availableReservedForThis}`
            );
          }

          // Only create movements if baseQty > 0
          if (baseQty > 0 && availableReservedForThis >= baseQty) {
            // Sufficient reserved quantity - create single OUT movement from Reserved
            console.log(
              `Sufficient reserved quantity (${availableReservedForThis}) for ${baseQty}`
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
                transaction_type: transactionType,
                trx_no: transactionNo,
                parent_trx_no: item.parent_trx_no || null,
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
          } else if (baseQty > 0) {
            // Insufficient reserved quantity - split between Reserved and Unrestricted
            const reservedQtyToMove = availableReservedForThis;
            const unrestrictedQtyToMove = roundQty(
              baseQty - reservedQtyToMove
            );

            console.log(
              `Insufficient reserved quantity. Splitting group ${groupKey}:`
            );
            console.log(
              `  OUT ${reservedQtyToMove} from Reserved`
            );
            console.log(
              `  OUT ${unrestrictedQtyToMove} from Unrestricted`
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

              await new Promise((resolve) => setTimeout(resolve, 100));

              const reservedMovementQuery = await db
                .collection("inventory_movement")
                .where({
                  transaction_type: transactionType,
                  trx_no: transactionNo,
                  parent_trx_no: item.parent_trx_no || null,
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

              await new Promise((resolve) => setTimeout(resolve, 100));

              const unrestrictedMovementQuery = await db
                .collection("inventory_movement")
                .where({
                  transaction_type: transactionType,
                  trx_no: transactionNo,
                  parent_trx_no: item.parent_trx_no || null,
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

          // Handle unused reserved quantities for the group
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
              // For special mode (GDPP), keep unused reserved (do NOT return to Unrestricted)
              // For regular mode, return unused reserved to Unrestricted
              if (!isSpecialMode) {
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
                    transaction_type: transactionType,
                    trx_no: transactionNo,
                    parent_trx_no: item.parent_trx_no || null,
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
                    transaction_type: transactionType,
                    trx_no: transactionNo,
                    parent_trx_no: item.parent_trx_no || null,
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
              } else {
                console.log(
                  `Special Mode: Keeping ${unusedReservedQty} unused reserved (not returning to Unrestricted) for group ${groupKey}`
                );
              }
            }
          }
        } else if (baseQty > 0) {
          // Deduct from Unrestricted first
          console.log(
            `Processing Unrestricted-first - moving ${baseQty} OUT from Unrestricted for group ${groupKey}`
          );

          const inventoryMovementData = {
            ...baseInventoryMovement,
            movement: "OUT",
            inventory_category: "Unrestricted",
          };

          await db
            .collection("inventory_movement")
            .add(inventoryMovementData);

          await new Promise((resolve) => setTimeout(resolve, 100));

          const movementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: transactionType,
              trx_no: transactionNo,
              parent_trx_no: item.parent_trx_no || null,
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

        // Update balance quantities
        if (existingDoc && existingDoc.id) {
          let finalUnrestrictedQty = currentUnrestrictedQty;
          let finalReservedQty = currentReservedQty;
          let finalBalanceQty = currentBalanceQty;

          if (useReservedFirst) {
            // Apply the smart deduction logic
            let availableReservedForThis = currentReservedQty;
            if (isUpdate && prevBaseQty > 0) {
              availableReservedForThis = Math.min(
                currentReservedQty,
                prevBaseQty
              );
            }

            if (availableReservedForThis >= baseQty) {
              // All quantity can come from Reserved
              finalReservedQty = roundQty(finalReservedQty - baseQty);

              // Handle unused reservations - but NOT for special mode
              if (!isSpecialMode && isUpdate && prevBaseQty > 0) {
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
              const reservedDeduction = availableReservedForThis;
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
            // Deduct from unrestricted
            finalUnrestrictedQty = roundQty(finalUnrestrictedQty - baseQty);
          }

          finalBalanceQty = roundQty(finalBalanceQty - baseQty);

          console.log(
            `Final quantities after processing for group ${groupKey}:`
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

          // For batch items, also update item_balance (aggregated balance)
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

              if (useReservedFirst) {
                let availableReservedForThis = currentGeneralReservedQty;
                if (isUpdate && prevBaseQty > 0) {
                  availableReservedForThis = Math.min(
                    currentGeneralReservedQty,
                    prevBaseQty
                  );
                }

                if (availableReservedForThis >= baseQty) {
                  finalGeneralReservedQty = roundQty(
                    finalGeneralReservedQty - baseQty
                  );

                  if (!isSpecialMode && isUpdate && prevBaseQty > 0) {
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
                  const reservedDeduction = availableReservedForThis;
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
      // Skip if baseQty is 0 (item removed)
      if (baseQty > 0) {
        if (costingMethod === "First In First Out") {
          await updateFIFOInventory(
            item.material_id,
            baseQty,
            group.batch_id,
            plantId
          );
        } else if (costingMethod === "Weighted Average") {
          await updateWeightedAverage(
            item.material_id,
            group.batch_id,
            baseWAQty,
            plantId
          );
        }
      }
    }

    console.log(
      `Successfully processed ${groupedTempData.size} consolidated movement groups for item ${item.material_id}`
    );

    return {
      success: true,
      itemId: item.material_id,
      processedGroups: groupedTempData.size,
      error: null,
    };
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

    return {
      success: false,
      itemId: item.material_id,
      processedGroups: 0,
      error: error,
    };
  }
};
