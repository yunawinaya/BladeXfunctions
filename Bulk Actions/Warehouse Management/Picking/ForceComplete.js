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

// Function to get FIFO cost price for loading bay inventory movement
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

// NEW FUNCTION: Handle existing inventory movements for updates
const handleExistingInventoryMovements = async (
  plantId,
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
        plant_id: plantId,
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
        console.log("No existing serial movements found for this delivery");
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

      const isSerializedItem = itemData.serial_number_management === 1;
      const prevTempData = parseJsonSafely(item.prev_temp_qty_data);

      for (const prevTemp of prevTempData) {
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

// Modified processBalanceTable function with inventory validation
const processBalanceTableWithValidation = async (
  data,
  isUpdate = false,
  oldDeliveryNo = null,
  gdStatus = null,
  organizationId
) => {
  console.log("Processing balance table");

  // STEP 1: Handle existing inventory movements and reverse balance changes for updates
  if (isUpdate && gdStatus === "Created") {
    await handleExistingInventoryMovements(
      data.plant_id,
      oldDeliveryNo,
      isUpdate
    );
    await reverseBalanceChanges(data, isUpdate, organizationId);
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
      let uomConversion = null;

      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        uomConversion = itemData.table_uom_conversion.find(
          (conv) => conv.alt_uom_id === altUOM
        );

        if (uomConversion) {
          baseQty = roundQty(altQty * uomConversion.base_qty);
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
        transaction_type: "GDL",
        trx_no: data.delivery_no,
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
          transaction_type: "GDL",
          trx_no: data.delivery_no,
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
          transaction_type: "GDL",
          trx_no: data.delivery_no,
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
            let individualBaseQty = roundQty(temp.gd_quantity);
            if (uomConversion) {
              individualBaseQty = roundQty(
                individualBaseQty * uomConversion.base_qty
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
              let individualBaseQty = roundQty(temp.gd_quantity);
              if (uomConversion) {
                individualBaseQty = roundQty(
                  individualBaseQty * uomConversion.base_qty
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
        doc_type: "Good Delivery",
        doc_no: gdData.delivery_no,
        organization_id: organizationId,
      })
      .get();

    // Prepare new data from current GD (including serialized items)
    const newReservedData = [];
    for (let i = 0; i < gdData.table_gd.length; i++) {
      const gdLineItem = gdData.table_gd[i];
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
          batch_id: tempItem.batch_id,
          bin_location: tempItem.location_id,
          item_uom: gdLineItem.gd_order_uom_id,
          line_no: i + 1,
          reserved_qty: tempItem.gd_quantity,
          delivered_qty: 0,
          open_qty: tempItem.gd_quantity,
          reserved_date: new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
          plant_id: gdData.plant_id,
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
      await createOnReserveGoodsDelivery(organizationId, gdData);
    }

    console.log("Updated reserved goods records successfully");
  } catch (error) {
    console.error("Error updating reserved goods delivery:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, gd, goodsDeliveryId, gdStatus) => {
  try {
    let oldDeliveryNo = gd.delivery_no;

    await processBalanceTableWithValidation(
      gd,
      true,
      oldDeliveryNo,
      gdStatus,
      organizationId
    );

    await db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);

    await updateOnReserveGoodsDelivery(organizationId, gd);

    console.log("Goods delivery updated successfully");
    return gd;
  } catch (error) {
    console.error("Error in updateEntry:", error);
    throw error;
  }
};

const createTempQtyDataSummary = async (
  updatedTempQtyData,
  gdLineItem,
  materialId
) => {
  // Get item data to check if it's serialized/batch managed
  let isSerializedItem = false;
  let gdUOM = "";

  if (materialId) {
    const resItem = await db.collection("Item").where({ id: materialId }).get();
    if (resItem.data && resItem.data[0]) {
      isSerializedItem = resItem.data[0].serial_number_management === 1;
      isBatchManagedItem = resItem.data[0].item_batch_management === 1;
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

// Handle loading bay inventory movement - moving Reserved inventory between locations
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

      // Get item data to check if serialized
      const itemQuery = await db
        .collection("Item")
        .where({ id: gdLineItem.material_id })
        .get();

      if (!itemQuery.data || itemQuery.data.length === 0) {
        console.log(
          `Item data not found for material ${gdLineItem.material_id}, skipping`
        );
        continue;
      }

      const itemData = itemQuery.data[0];
      const isSerializedItem = itemData.serial_number_management === 1;
      const isBatchManagedItem = itemData.item_batch_management === 1;
      const costingMethod = itemData.material_costing_method;

      console.log(
        `Costing method for item ${gdLineItem.material_id}: ${costingMethod}`
      );

      const updatedTempQtyData = [];

      // Process each temp item and move inventory
      for (const tempItem of tempQtyData) {
        const sourceLocation = tempItem.location_id;
        const batchId = tempItem.batch_id || null;
        const baseQty = roundQty(parseFloat(tempItem.gd_quantity || 0));

        console.log(
          `Moving ${baseQty} base qty from location ${sourceLocation} to ${targetLocation}`
        );

        // Get cost price based on costing method
        let costPrice = 0;
        if (costingMethod === "First In First Out") {
          costPrice = await getFIFOCostPrice(
            gdLineItem.material_id,
            baseQty,
            plantId,
            sourceLocation,
            organizationId,
            batchId
          );
        } else if (costingMethod === "Weighted Average") {
          costPrice = await getWeightedAverageCostPrice(
            gdLineItem.material_id,
            batchId,
            plantId
          );
        } else if (costingMethod === "Fixed Cost") {
          costPrice = await getFixedCostPrice(gdLineItem.material_id);
        }

        console.log(`Cost price determined: ${costPrice}`);

        // Create OUT inventory movement (from source location)
        const outMovementData = {
          transaction_type: "TO - PICK",
          trx_no: gdNo,
          item_id: gdLineItem.material_id,
          batch_id: batchId,
          bin_location_id: sourceLocation,
          movement: "OUT",
          inventory_category: "Reserved",
          base_uom_id: gdLineItem.gd_base_uom_id,
          quantity_in_base_uom: baseQty,
          cost_price: costPrice,
          plant_id: plantId,
          organization_id: organizationId,
        };

        await db.collection("inventory_movement").add(outMovementData);
        console.log(
          `Created OUT movement from Reserved at ${sourceLocation}: ${baseQty} base qty`
        );

        // Create IN inventory movement (to target location)
        const inMovementData = {
          transaction_type: "TO - PICK",
          trx_no: gdNo,
          item_id: gdLineItem.material_id,
          batch_id: batchId,
          bin_location_id: targetLocation,
          movement: "IN",
          inventory_category: "Reserved",
          base_uom_id: gdLineItem.gd_base_uom_id,
          quantity_in_base_uom: baseQty,
          cost_price: costPrice,
          plant_id: plantId,
          organization_id: organizationId,
        };

        await db.collection("inventory_movement").add(inMovementData);
        console.log(
          `Created IN movement to Reserved at ${targetLocation}: ${baseQty} base qty`
        );

        // Update item balance at source location (decrement Reserved)
        const sourceBalanceParams = {
          material_id: gdLineItem.material_id,
          plant_id: plantId,
          organization_id: organizationId,
          location_id: sourceLocation,
        };

        if (isBatchManagedItem && batchId) {
          // Update item_batch_balance
          const sourceBatchQuery = await db
            .collection("item_batch_balance")
            .where({
              ...sourceBalanceParams,
              batch_id: batchId,
            })
            .get();

          if (sourceBatchQuery.data && sourceBatchQuery.data.length > 0) {
            const sourceBatchDoc = sourceBatchQuery.data[0];
            const currentReservedQty = roundQty(
              parseFloat(sourceBatchDoc.reserved_qty || 0)
            );
            const currentBalanceQty = roundQty(
              parseFloat(sourceBatchDoc.balance_quantity || 0)
            );

            const finalReservedQty = roundQty(currentReservedQty - baseQty);
            const finalBalanceQty = roundQty(currentBalanceQty - baseQty);

            await db
              .collection("item_batch_balance")
              .doc(sourceBatchDoc.id)
              .update({
                reserved_qty: finalReservedQty,
                balance_quantity: finalBalanceQty,
              });

            console.log(
              `Updated source item_batch_balance: Reserved ${currentReservedQty}→${finalReservedQty}, Balance ${currentBalanceQty}→${finalBalanceQty}`
            );
          }
        } else {
          // Update item_balance
          const sourceQuery = await db
            .collection("item_balance")
            .where(sourceBalanceParams)
            .get();

          if (sourceQuery.data && sourceQuery.data.length > 0) {
            const sourceDoc = sourceQuery.data[0];
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
        }

        // Update item balance at target location (increment Reserved)
        const targetBalanceParams = {
          material_id: gdLineItem.material_id,
          plant_id: plantId,
          organization_id: organizationId,
          location_id: targetLocation,
        };

        if (isBatchManagedItem && batchId) {
          // Update item_batch_balance
          const targetBatchQuery = await db
            .collection("item_batch_balance")
            .where({
              ...targetBalanceParams,
              batch_id: batchId,
            })
            .get();

          if (targetBatchQuery.data && targetBatchQuery.data.length > 0) {
            const targetBatchDoc = targetBatchQuery.data[0];
            const currentReservedQty = roundQty(
              parseFloat(targetBatchDoc.reserved_qty || 0)
            );
            const currentBalanceQty = roundQty(
              parseFloat(targetBatchDoc.balance_quantity || 0)
            );

            const finalReservedQty = roundQty(currentReservedQty + baseQty);
            const finalBalanceQty = roundQty(currentBalanceQty + baseQty);

            await db
              .collection("item_batch_balance")
              .doc(targetBatchDoc.id)
              .update({
                reserved_qty: finalReservedQty,
                balance_quantity: finalBalanceQty,
              });

            console.log(
              `Updated target item_batch_balance: Reserved ${currentReservedQty}→${finalReservedQty}, Balance ${currentBalanceQty}→${finalBalanceQty}`
            );
          } else {
            // Create new batch balance at target
            const newBatchBalance = {
              material_id: gdLineItem.material_id,
              batch_id: batchId,
              plant_id: plantId,
              organization_id: organizationId,
              location_id: targetLocation,
              reserved_qty: baseQty,
              balance_quantity: baseQty,
              unrestricted_qty: 0,
              material_uom: gdLineItem.gd_base_uom_id,
            };

            await db.collection("item_batch_balance").add(newBatchBalance);

            console.log(
              `Created new item_batch_balance at target with Reserved ${baseQty}`
            );
          }
        } else {
          // Update item_balance
          const targetQuery = await db
            .collection("item_balance")
            .where(targetBalanceParams)
            .get();

          if (targetQuery.data && targetQuery.data.length > 0) {
            const targetDoc = targetQuery.data[0];
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
            // Create new balance at target
            const newBalance = {
              material_id: gdLineItem.material_id,
              plant_id: plantId,
              organization_id: organizationId,
              location_id: targetLocation,
              reserved_qty: baseQty,
              balance_quantity: baseQty,
              unrestricted_qty: 0,
              material_uom: gdLineItem.gd_base_uom_id,
            };

            await db.collection("item_balance").add(newBalance);

            console.log(
              `Created new item_balance at target with Reserved ${baseQty}`
            );
          }
        }

        // Handle serialized items
        if (isSerializedItem && tempItem.serial_number) {
          console.log(
            `Processing serialized item with serial: ${tempItem.serial_number}`
          );

          // Query for OUT movement ID
          const outMovementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: "TO - PICK",
              trx_no: gdNo,
              item_id: gdLineItem.material_id,
              bin_location_id: sourceLocation,
              movement: "OUT",
              inventory_category: "Reserved",
            })
            .get();

          let outMovementId = null;
          if (outMovementQuery.data && outMovementQuery.data.length > 0) {
            outMovementId = outMovementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;
          }

          // Query for IN movement ID
          const inMovementQuery = await db
            .collection("inventory_movement")
            .where({
              transaction_type: "TO - PICK",
              trx_no: gdNo,
              item_id: gdLineItem.material_id,
              bin_location_id: targetLocation,
              movement: "IN",
              inventory_category: "Reserved",
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

(async () => {
  try {
    this.showLoading();
    const allListID = "custom_41s73hyl";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
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

      for (const selectedRecord of selectedRecords) {
        const pickingId = selectedRecord.id;

        const pickingData = await db
          .collection("transfer_order")
          .where({ id: pickingId })
          .get()
          .then((res) => res.data[0]);

        const tablePickingItems = pickingData.table_picking_items;
        const tablePickingRecords = pickingData.table_picking_records;
        const pickingNumber = selectedRecord.to_id;
        const plantId = pickingData.plant_id;
        const organizationId = pickingData.organization_id;

        const isLoadingBay = await db
          .collection("picking_setup")
          .where({
            plant_id: plantId,
            organization_id: organizationId,
            picking_after: "Goods Delivery",
          })
          .get()
          .then((res) => res.data[0].is_loading_bay);

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

        console.log("tablePickingRecords", tablePickingRecords);

        // Get unique material IDs to fetch item data
        const uniqueMaterialIds = [
          ...new Set(tablePickingRecords.map((item) => item.item_code)),
        ];

        // Fetch item data to check if items are serialized
        const itemDataMap = {};
        for (const materialId of uniqueMaterialIds) {
          const resItem = await db
            .collection("Item")
            .where({ id: materialId })
            .get();
          if (resItem.data && resItem.data[0]) {
            itemDataMap[materialId] = resItem.data[0];
          }
        }

        // Expand picking records - split serialized items by serial number
        const expandedPickingRecords = [];
        for (const record of tablePickingRecords) {
          const itemData = itemDataMap[record.item_code];
          const isSerializedItem =
            itemData && itemData.serial_number_management === 1;

          if (
            isSerializedItem &&
            Array.isArray(record.serial_numbers) &&
            record.serial_numbers.length > 0
          ) {
            // For serialized items, create one record per serial number
            console.log(
              `Expanding serialized item ${record.item_code} with ${record.serial_numbers.length} serial numbers`
            );

            for (const serialNumber of record.serial_numbers) {
              expandedPickingRecords.push({
                ...record,
                serial_numbers: serialNumber, // Convert array to single serial
                store_out_qty: 1, // Each serial is quantity 1
              });
            }
          } else {
            // For non-serialized items, keep as is
            expandedPickingRecords.push(record);
          }
        }

        console.log(
          `Expanded ${tablePickingRecords.length} records to ${expandedPickingRecords.length} records (including individual serials)`
        );

        //group expandedPickingRecords
        const groupedPickingRecords = Object.values(
          expandedPickingRecords.reduce((acc, item) => {
            const itemData = itemDataMap[item.item_code];
            const isSerializedItem =
              itemData && itemData.serial_number_management === 1;

            // For serialized items, include serial_number in the key to prevent grouping
            // For non-serialized items, group by location and batch
            let key;
            if (isSerializedItem && item.serial_numbers) {
              // Each serial number should be separate
              key = `${item.so_line_id}|${item.target_location}|${
                item.target_batch || "no-batch"
              }|${item.serial_numbers}`;
            } else {
              key = `${item.so_line_id}|${item.target_location}|${
                item.target_batch || "no-batch"
              }`;
            }

            if (acc[key]) {
              // Only group if not serialized
              if (!isSerializedItem) {
                acc[key].store_out_qty = roundQty(
                  parseFloat(acc[key].store_out_qty) +
                    parseFloat(item.store_out_qty)
                );
              }
            } else {
              acc[key] = {
                ...item,
                store_out_qty: parseFloat(item.store_out_qty),
              };
            }

            return acc;
          }, {})
        );

        const uniqueGdIds = [
          ...new Set(groupedPickingRecords.map((item) => item.gd_id)),
        ];

        for (const item of uniqueGdIds) {
          const gdId = item;

          let gdDataResult = await db
            .collection("goods_delivery")
            .doc(gdId)
            .get();

          if (!gdDataResult.data || gdDataResult.data.length === 0) {
            console.error(`GD not found for ID: ${gdId}`);
            continue;
          }

          const gdData = gdDataResult.data[0];

          // Skip cancelled GDs
          if (gdData.gd_status === "Cancelled") {
            console.warn(
              `Skipping GD ${gdData.delivery_no} - Status is Cancelled`
            );
            continue;
          }

          const originalGD = JSON.parse(JSON.stringify(gdData)); // Deep copy

          // Store the ORIGINAL quantities as previous
          gdData.table_gd.forEach((item, index) => {
            if (originalGD.table_gd && originalGD.table_gd[index]) {
              item.prev_temp_qty_data =
                originalGD.table_gd[index].temp_qty_data;
            }
          });

          let gdDataUpdated = false;

          for (const gdLineItem of gdData.table_gd) {
            if (
              groupedPickingRecords.some(
                (item) => item.so_line_id === gdLineItem.so_line_item_id
              )
            ) {
              const filteredData = groupedPickingRecords.filter(
                (item) => item.so_line_id === gdLineItem.so_line_item_id
              );

              console.log("filteredData", filteredData);

              // Create temp_qty_data without balance fields first
              const updatedTempQtyData = filteredData.map((item) => {
                const tempQtyItem = {
                  material_id: item.item_code,
                  location_id: item.target_location,
                  batch_id: item.target_batch || undefined,
                  gd_quantity: item.store_out_qty,
                };

                // Add serial_number if it exists (for serialized items)
                if (item.serial_numbers) {
                  tempQtyItem.serial_number = item.serial_numbers;
                }

                return tempQtyItem;
              });

              console.log(
                "updatedTempQtyData (before balance fetch)",
                updatedTempQtyData
              );

              const viewStockSummary = await createTempQtyDataSummary(
                updatedTempQtyData,
                gdLineItem,
                gdLineItem.material_id
              );

              console.log("viewStockSummary", viewStockSummary);

              gdLineItem.plan_qty = gdLineItem.gd_qty;
              gdLineItem.plan_temp_qty_data = gdLineItem.temp_qty_data;
              gdLineItem.plan_view_stock = gdLineItem.view_stock;
              gdLineItem.is_force_complete = 1;

              gdLineItem.temp_qty_data = JSON.stringify(updatedTempQtyData);
              gdLineItem.view_stock = viewStockSummary;
              //sum filteredData.store_out_qty
              gdLineItem.gd_qty = filteredData.reduce(
                (sum, item) => sum + parseFloat(item.store_out_qty),
                0
              );
              gdLineItem.base_qty = gdLineItem.gd_qty;
              gdLineItem.gd_delivered_qty =
                gdLineItem.gd_qty + gdLineItem.gd_initial_delivered_qty;
              gdLineItem.gd_undelivered_qty =
                gdLineItem.gd_order_quantity - gdLineItem.gd_delivered_qty;
              gdLineItem.picking_status = "Completed";
              gdDataUpdated = true;
            }
          }

          // check if all gdLineItem.picking_status is "Completed" if yes then gdData.picking_status = "Completed"
          let allPickingStatusCompleted = true;
          for (const gdLineItem of gdData.table_gd) {
            if (gdLineItem.picking_status !== "Completed") {
              allPickingStatusCompleted = false;
              break;
            }
          }

          if (allPickingStatusCompleted) {
            gdData.picking_status = "Completed";
          }

          // Save the updated gdData back to database
          if (gdDataUpdated) {
            console.log("gdData", gdData);

            await updateEntry(gdData.organization_id, gdData, gdId, "Created");

            // Handle loading bay inventory movement AFTER updateEntry completes
            // This ensures balance changes (unrestricted → reserved) happen first
            // Then loading bay moves reserved inventory between locations
            if (isLoadingBay === 1 && allPickingStatusCompleted) {
              console.log(
                "Loading bay is enabled and picking is completed, initiating inventory movement"
              );

              try {
                await handleLoadingBayInventoryMovement(
                  gdData,
                  gdData.delivery_no,
                  gdId,
                  tablePickingItems,
                  plantId,
                  organizationId
                );
              } catch (error) {
                console.error(
                  "Error in loading bay inventory movement:",
                  error
                );
                // Don't throw - allow the rest of the process to continue
              }
            }

            // After updateEntry completes, fetch fresh balance data and update temp_qty_data
            console.log("Fetching updated balance data after GD update...");

            for (const gdLineItem of gdData.table_gd) {
              if (gdLineItem.temp_qty_data) {
                try {
                  let tempQtyDataArray = JSON.parse(gdLineItem.temp_qty_data);

                  // Fetch balance for each temp_qty_data entry
                  const enrichedTempQtyData = await Promise.all(
                    tempQtyDataArray.map(async (tempItem) => {
                      const itemData = itemDataMap[tempItem.material_id];
                      const isSerializedItem =
                        itemData && itemData.serial_number_management === 1;
                      const isBatchManagedItem =
                        itemData && itemData.item_batch_management === 1;

                      let balanceData = null;

                      try {
                        if (isSerializedItem) {
                          // Fetch from item_serial_balance
                          const serialBalanceQuery = {
                            material_id: tempItem.material_id,
                            serial_number: tempItem.serial_number,
                            plant_id: gdData.plant_id,
                            organization_id: gdData.organization_id,
                            location_id: tempItem.location_id,
                          };

                          if (isBatchManagedItem && tempItem.batch_id) {
                            serialBalanceQuery.batch_id = tempItem.batch_id;
                          }

                          const serialBalanceRes = await db
                            .collection("item_serial_balance")
                            .where(serialBalanceQuery)
                            .get();

                          if (
                            serialBalanceRes.data &&
                            serialBalanceRes.data.length > 0
                          ) {
                            balanceData = serialBalanceRes.data[0];
                          }
                        } else if (isBatchManagedItem) {
                          // Fetch from item_batch_balance
                          const batchBalanceRes = await db
                            .collection("item_batch_balance")
                            .where({
                              material_id: tempItem.material_id,
                              batch_id: tempItem.batch_id,
                              plant_id: gdData.plant_id,
                              organization_id: gdData.organization_id,
                              location_id: tempItem.location_id,
                            })
                            .get();

                          if (
                            batchBalanceRes.data &&
                            batchBalanceRes.data.length > 0
                          ) {
                            balanceData = batchBalanceRes.data[0];
                          }
                        } else {
                          // Fetch from item_balance
                          const itemBalanceRes = await db
                            .collection("item_balance")
                            .where({
                              material_id: tempItem.material_id,
                              plant_id: gdData.plant_id,
                              organization_id: gdData.organization_id,
                              location_id: tempItem.location_id,
                            })
                            .get();

                          if (
                            itemBalanceRes.data &&
                            itemBalanceRes.data.length > 0
                          ) {
                            balanceData = itemBalanceRes.data[0];
                          }
                        }

                        // Merge balance data if found
                        if (balanceData) {
                          return {
                            ...tempItem,
                            unrestricted_qty: balanceData.unrestricted_qty || 0,
                            reserved_qty: balanceData.reserved_qty || 0,
                            block_qty: balanceData.block_qty || 0,
                            qualityinsp_qty: balanceData.qualityinsp_qty || 0,
                            intransit_qty: balanceData.intransit_qty || 0,
                            balance_quantity: balanceData.balance_quantity || 0,
                            plant_id: balanceData.plant_id,
                            organization_id: balanceData.organization_id,
                            tenant_id: balanceData.tenant_id,
                            is_deleted: balanceData.is_deleted || 0,
                          };
                        } else {
                          console.warn(
                            `No balance data found for item ${tempItem.material_id} at location ${tempItem.location_id}`
                          );
                          return tempItem;
                        }
                      } catch (error) {
                        console.error(
                          `Error fetching balance for ${tempItem.material_id}:`,
                          error
                        );
                        return tempItem;
                      }
                    })
                  );

                  console.log("enrichedTempQtyData", enrichedTempQtyData);

                  gdLineItem.temp_qty_data =
                    JSON.stringify(enrichedTempQtyData);
                } catch (error) {
                  console.error(
                    "Error enriching temp_qty_data with balance:",
                    error
                  );
                }
              }
            }

            await db
              .collection("goods_delivery")
              .doc(gdId)
              .update({ table_gd: gdData.table_gd })
              .then(() => {
                console.log(
                  "Enriched temp_qty_data with balance updated successfully"
                );
              })
              .catch((error) => {
                console.error(
                  "Error updating enriched temp_qty_data with balance:",
                  error
                );
              });
          }
        }
      }

      this.$message.success(
        `Successfully force complete ${selectedRecords.length} picking(s).`
      );
      this.refresh();
      this.hide("tabs_picking");
    } else {
      this.$message.error("Please select at least one record.");
      this.hideLoading();
    }
  } catch (error) {
    console.error(error);
  } finally {
    this.hideLoading();
  }
})();
