// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

// Safe JSON parsing
const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parsing error:", error);
    return defaultValue;
  }
};

// Get Fixed Cost price from Item master
const getFixedCostPrice = async (materialId) => {
  try {
    const query = db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;

    if (result && result.length > 0) {
      const fixedPrice = roundPrice(result[0].purchase_unit_price || 0);
      console.log(`Fixed Cost for ${materialId}: ${fixedPrice}`);
      return fixedPrice;
    } else {
      console.warn(`Item not found for Fixed Cost: ${materialId}`);
      return 0;
    }
  } catch (error) {
    console.error(`Error retrieving Fixed Cost for ${materialId}:`, error);
    return 0;
  }
};

// Get Weighted Average cost price
const getWeightedAverageCostPrice = async (materialId, batchId, plantId) => {
  try {
    const query = batchId
      ? db.collection("wa_costing_method").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db.collection("wa_costing_method").where({
          material_id: materialId,
          plant_id: plantId,
        });

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

      const waPrice = roundPrice(waData[0].wa_cost_price || 0);
      console.log(`WA Cost for ${materialId}: ${waPrice}`);
      return waPrice;
    } else {
      console.warn(
        `No weighted average records found for material ${materialId}`
      );
      return 0;
    }
  } catch (error) {
    console.error(`Error retrieving WA cost price for ${materialId}:`, error);
    return 0;
  }
};

// Enhanced FIFO cost price calculation with consumed quantity tracking
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

// Update FIFO Inventory and calculate average cost
const updateFIFOInventory = async (
  materialId,
  quantityToConsume,
  batchId,
  plantId
) => {
  try {
    // Get all FIFO records for the material sorted by sequence (oldest first)
    const query = batchId
      ? db.collection("fifo_costing_history").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db.collection("fifo_costing_history").where({
          material_id: materialId,
          plant_id: plantId,
        });

    const fifoResult = await query.get();

    if (!fifoResult.data || fifoResult.data.length === 0) {
      return {
        success: false,
        message: "No FIFO records found",
        averageCost: 0,
      };
    }

    // Sort by FIFO sequence (oldest first)
    const fifoRecords = fifoResult.data.sort(
      (a, b) => a.fifo_sequence - b.fifo_sequence
    );

    let remainingQty = roundQty(quantityToConsume);
    let totalCost = 0;
    let consumedQty = 0;
    const updatePromises = [];

    // Process each FIFO record in sequence
    for (const record of fifoRecords) {
      if (remainingQty <= 0) break;

      const availableQty = roundQty(
        parseFloat(record.fifo_available_quantity || 0)
      );

      if (availableQty <= 0) continue;

      const qtyToTake = Math.min(remainingQty, availableQty);
      const costPrice = roundPrice(parseFloat(record.fifo_cost_price || 0));

      // Add to total cost calculation
      totalCost += qtyToTake * costPrice;
      consumedQty += qtyToTake;

      // Update the FIFO record's available quantity
      const newAvailableQty = roundQty(availableQty - qtyToTake);

      updatePromises.push(
        db.collection("fifo_costing_history").doc(record.id).update({
          fifo_available_quantity: newAvailableQty,
          updated_at: new Date(),
        })
      );

      remainingQty = roundQty(remainingQty - qtyToTake);

      console.log(
        `FIFO Update: Sequence ${record.fifo_sequence}, took ${qtyToTake} at ${costPrice}, remaining available: ${newAvailableQty}`
      );
    }

    // Execute all updates
    await Promise.all(updatePromises);

    // Calculate average cost
    const averageCost =
      consumedQty > 0 ? roundPrice(totalCost / consumedQty) : 0;

    if (remainingQty > 0) {
      console.warn(
        `FIFO Warning: ${remainingQty} units could not be consumed due to insufficient FIFO inventory`
      );
      return {
        success: false,
        message: `Insufficient FIFO inventory. Missing: ${remainingQty} units`,
        averageCost: averageCost,
        consumedQuantity: consumedQty,
      };
    }

    return {
      success: true,
      message: "FIFO inventory updated successfully",
      averageCost: averageCost,
      consumedQuantity: consumedQty,
    };
  } catch (error) {
    console.error(`Error updating FIFO inventory for ${materialId}:`, error);
    return {
      success: false,
      message: error.message,
      averageCost: 0,
    };
  }
};

// Update Weighted Average Costing
const updateWeightedAverageCosting = async (
  materialId,
  quantityToConsume,
  batchId,
  plantId
) => {
  try {
    // Get the latest WA costing record for the material
    const query = batchId
      ? db.collection("wa_costing_method").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db.collection("wa_costing_method").where({
          material_id: materialId,
          plant_id: plantId,
        });

    const waResult = await query.get();

    if (!waResult.data || waResult.data.length === 0) {
      return {
        success: false,
        message: "No weighted average records found",
        averageCost: 0,
      };
    }

    // Sort by date (newest first) to get the latest record
    const waRecords = waResult.data.sort((a, b) => {
      if (a.created_at && b.created_at) {
        return new Date(b.created_at) - new Date(a.created_at);
      }
      return 0;
    });

    const latestRecord = waRecords[0];
    const availableQty = roundQty(
      parseFloat(latestRecord.wa_available_quantity || 0)
    );
    const costPrice = roundPrice(parseFloat(latestRecord.wa_cost_price || 0));

    // Check if enough quantity is available
    if (availableQty < quantityToConsume) {
      console.warn(
        `WA Warning: Available ${availableQty}, requested ${quantityToConsume}`
      );
      return {
        success: false,
        message: `Insufficient WA inventory. Available: ${availableQty}, Required: ${quantityToConsume}`,
        averageCost: costPrice,
        availableQuantity: availableQty,
      };
    }

    // Update the WA record's available quantity
    const newAvailableQty = roundQty(availableQty - quantityToConsume);

    await db.collection("wa_costing_method").doc(latestRecord.id).update({
      wa_available_quantity: newAvailableQty,
      updated_at: new Date(),
    });

    console.log(
      `WA Update: Material ${materialId}, consumed ${quantityToConsume} at ${costPrice}, remaining: ${newAvailableQty}`
    );

    return {
      success: true,
      message: "Weighted average costing updated successfully",
      averageCost: costPrice,
      consumedQuantity: quantityToConsume,
      remainingQuantity: newAvailableQty,
    };
  } catch (error) {
    console.error(`Error updating WA costing for ${materialId}:`, error);
    return {
      success: false,
      message: error.message,
      averageCost: 0,
    };
  }
};

// Update Item Balance with Enhanced Reserved Goods Management for Created Status
const updateItemBalance = async (
  materialId,
  quantity,
  locationId,
  batchId,
  salesOrderNo,
  plantId,
  organizationId,
  isSerializedItem = false,
  serialNumber = null
) => {
  try {
    if (isSerializedItem) {
      // Handle serialized item balance updates
      const serialBalanceParams = {
        material_id: materialId,
        serial_number: serialNumber,
        plant_id: plantId,
        organization_id: organizationId,
        location_id: locationId,
      };

      if (batchId) {
        serialBalanceParams.batch_id = batchId;
      }

      const serialBalanceQuery = await db
        .collection("item_serial_balance")
        .where(serialBalanceParams)
        .get();

      if (!serialBalanceQuery.data || serialBalanceQuery.data.length === 0) {
        return {
          success: false,
          message: `Serial balance not found for ${serialNumber}`,
        };
      }

      const serialBalance = serialBalanceQuery.data[0];
      const currentUnrestricted = parseFloat(
        serialBalance.unrestricted_qty || 0
      );
      const currentReserved = parseFloat(serialBalance.reserved_qty || 0);

      // For serialized items from Created status, prioritize using reserved quantity first
      let fromReserved = Math.min(quantity, currentReserved);
      let fromUnrestricted = quantity - fromReserved;

      // Validate sufficient quantities
      if (fromUnrestricted > currentUnrestricted) {
        return {
          success: false,
          message: `Insufficient quantity for serial ${serialNumber}. Available: unrestricted ${currentUnrestricted}, reserved ${currentReserved}, Required: ${quantity}`,
        };
      }

      // Update serial balance
      const newUnrestricted = roundQty(
        Math.max(0, currentUnrestricted - fromUnrestricted)
      );
      const newReserved = roundQty(Math.max(0, currentReserved - fromReserved));

      await db.collection("item_serial_balance").doc(serialBalance.id).update({
        unrestricted_qty: newUnrestricted,
        reserved_qty: newReserved,
        updated_at: new Date(),
      });

      return {
        success: true,
        message: `Serial ${serialNumber}: consumed ${quantity} (${fromReserved} from reserved, ${fromUnrestricted} from unrestricted)`,
        fromReserved,
        fromUnrestricted,
      };
    } else {
      // Handle non-serialized item balance updates
      const balanceCollection = batchId ? "item_batch_balance" : "item_balance";
      const itemBalanceParams = {
        material_id: materialId,
        location_id: locationId,
        plant_id: plantId,
        organization_id: organizationId,
      };

      if (batchId) {
        itemBalanceParams.batch_id = batchId;
      }

      const balanceQuery = await db
        .collection(balanceCollection)
        .where(itemBalanceParams)
        .get();

      if (!balanceQuery.data || balanceQuery.data.length === 0) {
        return {
          success: false,
          message: `Balance record missing for ${materialId} at location ${locationId}`,
        };
      }

      const existingDoc = balanceQuery.data[0];
      const currentUnrestricted = parseFloat(existingDoc.unrestricted_qty || 0);
      const currentReserved = parseFloat(existingDoc.reserved_qty || 0);

      // For Created status GDs, prioritize using reserved quantity first (it was reserved for this SO)
      // Check for reserved goods specific to this sales order
      const reservedQuery = await db
        .collection("reserved_goods")
        .where({
          material_id: materialId,
          location_id: locationId,
          sales_order_no: salesOrderNo,
          plant_id: plantId,
          organization_id: organizationId,
          ...(batchId && { batch_id: batchId }),
        })
        .get();

      let fromReserved = 0;
      let fromUnrestricted = quantity;

      // Process reserved goods for this specific sales order
      if (reservedQuery.data && reservedQuery.data.length > 0) {
        for (const reservedRecord of reservedQuery.data) {
          const reservedQty = parseFloat(reservedRecord.reserved_quantity || 0);
          const qtyFromThisReserved = Math.min(fromUnrestricted, reservedQty);

          if (qtyFromThisReserved > 0) {
            fromReserved += qtyFromThisReserved;
            fromUnrestricted -= qtyFromThisReserved;

            // Update or delete reserved record
            const newReservedQty = roundQty(reservedQty - qtyFromThisReserved);

            if (newReservedQty <= 0) {
              await db
                .collection("reserved_goods")
                .doc(reservedRecord.id)
                .update({
                  is_deleted: 1,
                  updated_at: new Date(),
                });
              console.log(
                `Reserved goods record deleted: ${qtyFromThisReserved} from reserved for SO ${salesOrderNo}`
              );
            } else {
              await db
                .collection("reserved_goods")
                .doc(reservedRecord.id)
                .update({
                  reserved_quantity: newReservedQty,
                  updated_at: new Date(),
                });
              console.log(
                `Reserved goods updated: ${qtyFromThisReserved} consumed, ${newReservedQty} remaining for SO ${salesOrderNo}`
              );
            }
          }
        }
      }

      // If no specific reserved goods found, try to use general reserved quantity
      if (fromReserved === 0 && currentReserved > 0) {
        fromReserved = Math.min(fromUnrestricted, currentReserved);
        fromUnrestricted -= fromReserved;
      }

      // Validate sufficient quantities
      if (fromUnrestricted > currentUnrestricted) {
        return {
          success: false,
          message: `Insufficient unrestricted quantity for ${materialId}. Available: ${currentUnrestricted}, Required: ${fromUnrestricted}, Reserved Used: ${fromReserved}`,
        };
      }

      if (fromReserved > currentReserved) {
        return {
          success: false,
          message: `Insufficient reserved quantity for ${materialId}. Available: ${currentReserved}, Required: ${fromReserved}`,
        };
      }

      // Update balance quantities
      const newUnrestricted = roundQty(
        Math.max(0, currentUnrestricted - fromUnrestricted)
      );
      const newReserved = roundQty(Math.max(0, currentReserved - fromReserved));

      await db.collection(balanceCollection).doc(existingDoc.id).update({
        unrestricted_qty: newUnrestricted,
        reserved_qty: newReserved,
        updated_at: new Date(),
      });

      return {
        success: true,
        message: `consumed ${quantity} (${fromReserved} from reserved, ${fromUnrestricted} from unrestricted), remaining: ${newUnrestricted} unrestricted, ${newReserved} reserved`,
        fromReserved,
        fromUnrestricted,
      };
    }
  } catch (error) {
    console.error(`Error updating item balance for ${materialId}:`, error);
    return {
      success: false,
      message: error.message,
    };
  }
};

// Comprehensive bulk inventory validation for all selected GDs
const validateBulkInventoryAvailability = async (goodsDeliveryData) => {
  console.log("Starting bulk inventory validation for all selected GDs");

  const allValidationErrors = [];

  for (const gdItem of goodsDeliveryData) {
    console.log(`Validating inventory for GD: ${gdItem.delivery_no}`);

    const items = gdItem.table_gd;
    if (!Array.isArray(items) || items.length === 0) {
      continue;
    }

    // Create a map to track total required quantities using pipe separator for keys
    const requiredQuantities = new Map();

    // First pass: Calculate total required quantities for this GD
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
          allValidationErrors.push({
            gdNo: gdItem.delivery_no,
            error: `Item not found: ${item.material_id}`,
          });
          continue;
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
        allValidationErrors.push({
          gdNo: gdItem.delivery_no,
          error: `Error processing item ${item.material_id}: ${error.message}`,
        });
        continue;
      }
    }

    // Second pass: Check availability against current balances for this GD
    for (const [key, requiredQty] of requiredQuantities.entries()) {
      const keyParts = key.split("|");
      const materialId = keyParts[0];
      const locationId = keyParts[1] !== "no-location" ? keyParts[1] : null;

      let batchId, serialNumber;

      // Determine if this is a serialized item key
      const itemRes = await db
        .collection("Item")
        .where({ id: materialId })
        .get();
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
            plant_id: gdItem.plant_id.id,
            organization_id: gdItem.organization_id,
          };

          if (locationId) {
            itemBalanceParams.location_id = locationId;
          }

          if (batchId && batchId !== "undefined") {
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
            plant_id: gdItem.plant_id.id,
            organization_id: gdItem.organization_id,
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

          allValidationErrors.push({
            gdNo: gdItem.delivery_no,
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
          });
        }
      } catch (error) {
        console.error(`Error checking balance for ${key}:`, error);
        allValidationErrors.push({
          gdNo: gdItem.delivery_no,
          error: `Error checking inventory balance: ${error.message}`,
        });
      }
    }
  }

  if (allValidationErrors.length > 0) {
    console.log(
      "Bulk inventory validation failed with errors:",
      allValidationErrors
    );
    return {
      isValid: false,
      errors: allValidationErrors,
      summary: `Found ${
        allValidationErrors.length
      } inventory validation error(s) across ${
        new Set(allValidationErrors.map((e) => e.gdNo)).size
      } goods delivery(s).`,
    };
  }

  console.log("Bulk inventory validation passed for all selected GDs");
  return { isValid: true };
};

// Comprehensive bulk credit limit validation for all selected GDs
const validateBulkCreditLimits = async (goodsDeliveryData) => {
  console.log("Starting bulk credit limit validation for all selected GDs");

  const allCreditLimitErrors = [];

  for (const gdItem of goodsDeliveryData) {
    console.log(`Validating credit limits for GD: ${gdItem.delivery_no}`);

    // Skip if no accounting integration
    if (!gdItem.acc_integration_type || gdItem.acc_integration_type === null) {
      console.log(
        `Skipping credit limit check for GD ${gdItem.delivery_no} - no accounting integration`
      );
      continue;
    }

    try {
      // Get customer data
      const customerId = gdItem.customer_name?.id || gdItem.customer_name;
      if (!customerId) {
        console.warn(`No customer ID found for GD ${gdItem.delivery_no}`);
        continue;
      }

      const fetchCustomer = await db
        .collection("Customer")
        .where({ id: customerId, is_deleted: 0 })
        .get();

      const customerData = fetchCustomer.data?.[0];
      if (!customerData) {
        allCreditLimitErrors.push({
          gdNo: gdItem.delivery_no,
          customerName: gdItem.customer_name?.customer_com_name || customerId,
          error: `Customer not found`,
          type: "customer_not_found",
        });
        continue;
      }

      const controlTypes = customerData.control_type_list;
      const outstandingAmount =
        parseFloat(customerData.outstanding_balance || 0) || 0;
      const overdueAmount =
        parseFloat(customerData.overdue_inv_total_amount || 0) || 0;
      const overdueLimit = parseFloat(customerData.overdue_limit || 0) || 0;
      const creditLimit =
        parseFloat(customerData.customer_credit_limit || 0) || 0;
      const gdTotal = parseFloat(gdItem.gd_total || 0) || 0;
      const revisedOutstandingAmount = outstandingAmount + gdTotal;

      console.log(
        `Credit limit check for ${customerData.customer_com_name}: Outstanding=${outstandingAmount}, GD Total=${gdTotal}, Revised=${revisedOutstandingAmount}, Credit Limit=${creditLimit}, Overdue=${overdueAmount}, Overdue Limit=${overdueLimit}`
      );

      // Check if control types are defined
      if (
        !controlTypes ||
        !Array.isArray(controlTypes) ||
        controlTypes.length === 0
      ) {
        console.log(
          `No control types defined for customer ${customerData.customer_com_name}, allowing to proceed`
        );
        continue;
      }

      // Define control type behaviors
      const controlTypeChecks = {
        0: () => ({ result: true, priority: "unblock", status: "Passed" }),
        1: () => {
          if (overdueAmount > overdueLimit) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Overdue limit exceeded",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        2: () => {
          if (overdueAmount > overdueLimit) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Overdue limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        3: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Credit limit exceeded",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        4: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;
          if (creditExceeded && overdueExceeded) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Both credit and overdue limits exceeded",
            };
          } else if (creditExceeded) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Credit limit exceeded",
            };
          } else if (overdueExceeded) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Overdue limit exceeded",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        5: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;
          if (creditExceeded) {
            if (overdueExceeded) {
              return {
                result: false,
                priority: "block",
                status: "Blocked",
                reason: "Both credit and overdue limits exceeded",
              };
            } else {
              return {
                result: false,
                priority: "block",
                status: "Blocked",
                reason: "Credit limit exceeded",
              };
            }
          } else if (overdueExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Overdue limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        6: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Credit limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        7: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;
          if (overdueExceeded) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Overdue limit exceeded",
            };
          } else if (creditExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Credit limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        8: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;
          if (creditExceeded && overdueExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason:
                "Both credit and overdue limits exceeded (override required)",
            };
          } else if (creditExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Credit limit exceeded (override required)",
            };
          } else if (overdueExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Overdue limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        9: () => {
          return {
            result: false,
            priority: "block",
            status: "Blocked",
            reason: "Customer account suspended",
          };
        },
      };

      // Process control types according to priority: unblock > block > override
      const results = [];
      for (const controlType of controlTypes) {
        const checkFunction = controlTypeChecks[controlType];
        if (checkFunction) {
          const result = checkFunction();
          results.push({ controlType, ...result });
        }
      }

      // Sort by priority: unblock first, then block, then override
      const priorityOrder = { unblock: 1, block: 2, override: 3 };
      results.sort(
        (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
      );

      // Use the highest priority result
      const finalResult = results[0];

      if (!finalResult.result) {
        // Credit limit check failed
        let errorMsg = `Customer "${customerData.customer_com_name}" failed credit limit validation: ${finalResult.reason}`;
        errorMsg += ` (Control Type: ${finalResult.controlType})`;

        // Add financial details
        if (finalResult.reason.includes("credit")) {
          errorMsg += `. Outstanding: ${outstandingAmount.toFixed(
            2
          )}, GD Total: ${gdTotal.toFixed(
            2
          )}, Total: ${revisedOutstandingAmount.toFixed(
            2
          )}, Credit Limit: ${creditLimit.toFixed(2)}`;
        }
        if (finalResult.reason.includes("overdue")) {
          errorMsg += `. Overdue Amount: ${overdueAmount.toFixed(
            2
          )}, Overdue Limit: ${overdueLimit.toFixed(2)}`;
        }

        allCreditLimitErrors.push({
          gdNo: gdItem.delivery_no,
          customerName: customerData.customer_com_name,
          error: errorMsg,
          type: finalResult.priority,
          status: finalResult.status,
          details: {
            controlType: finalResult.controlType,
            outstandingAmount,
            gdTotal,
            revisedOutstandingAmount,
            creditLimit,
            overdueAmount,
            overdueLimit,
            reason: finalResult.reason,
          },
        });
      } else {
        console.log(
          `Credit limit check passed for GD ${gdItem.delivery_no} - ${customerData.customer_com_name}`
        );
      }
    } catch (error) {
      console.error(
        `Error checking credit limits for GD ${gdItem.delivery_no}:`,
        error
      );
      allCreditLimitErrors.push({
        gdNo: gdItem.delivery_no,
        error: `Error checking credit limits: ${error.message}`,
        type: "system_error",
      });
    }
  }

  if (allCreditLimitErrors.length > 0) {
    console.log(
      "Bulk credit limit validation failed with errors:",
      allCreditLimitErrors
    );
    return {
      isValid: false,
      errors: allCreditLimitErrors,
      summary: `Found ${
        allCreditLimitErrors.length
      } credit limit validation error(s) across ${
        new Set(allCreditLimitErrors.map((e) => e.gdNo)).size
      } goods delivery(s).`,
    };
  }

  console.log("Bulk credit limit validation passed for all selected GDs");
  return { isValid: true };
};

// Update on_reserved_gd records for Completed status with serialized item support
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
    return { success: true, message: "Reserved goods updated successfully" };
  } catch (error) {
    console.error(
      "Error updating reserved goods delivery (serialized items):",
      error
    );
    return { success: false, message: error.message };
  }
};

// Check picking status requirements for bulk goods deliveries
const checkBulkPickingStatus = async (goodsDeliveryData) => {
  try {
    console.log("Checking picking status requirements for bulk GDs...");

    const pickingIssues = [];

    for (const gdData of goodsDeliveryData) {
      if (!gdData.plant_id) {
        pickingIssues.push({
          gdNo: gdData.delivery_no,
          issue: "Plant ID is required for picking setup validation",
        });
        continue;
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
          `No picking setup found for plant ${gdData.plant_id} in GD ${gdData.delivery_no}, proceeding normally`
        );
        continue;
      }

      console.log(
        `Picking setup found for plant ${gdData.plant_id} in GD ${gdData.delivery_no}. Checking requirements...`
      );

      // For bulk action (Edit mode with Created status), check if picking is completed
      if (gdData.gd_status === "Created") {
        if (gdData.picking_status !== "Completed") {
          pickingIssues.push({
            gdNo: gdData.delivery_no,
            plantId: gdData.plant_id,
            currentStatus: gdData.picking_status || "Not Started",
            issue:
              "Picking process must be completed before goods delivery completion",
          });
        } else {
          console.log(
            `Picking completed for GD ${gdData.delivery_no}, allowing completion`
          );
        }
      }
    }

    if (pickingIssues.length > 0) {
      console.log(`Found ${pickingIssues.length} picking validation issues`);
      return {
        allPassed: false,
        failedGDs: pickingIssues,
        summary: `${pickingIssues.length} goods delivery(s) require completed picking process`,
      };
    }

    console.log("Bulk picking validation passed for all selected GDs");
    return {
      allPassed: true,
      failedGDs: [],
      summary: "All picking requirements met",
    };
  } catch (error) {
    console.error("Error in bulk picking validation:", error);
    return {
      allPassed: false,
      failedGDs: [],
      summary: `Picking validation error: ${error.message}`,
    };
  }
};

// Check for existing reserved goods conflicts for bulk goods deliveries
const checkBulkExistingReservedGoods = async (
  goodsDeliveryData,
  organizationId
) => {
  try {
    console.log("Checking existing reserved goods conflicts for bulk GDs...");

    const conflictIssues = [];

    for (const gdData of goodsDeliveryData) {
      // Collect all SO numbers from this GD
      const soNumbers = [];

      // From header
      if (gdData.so_no) {
        if (typeof gdData.so_no === "string") {
          gdData.so_no.split(",").forEach((so) => soNumbers.push(so.trim()));
        } else {
          soNumbers.push(gdData.so_no.toString());
        }
      }

      // From line items
      if (Array.isArray(gdData.table_gd)) {
        gdData.table_gd.forEach((item) => {
          if (item.line_so_no) {
            soNumbers.push(item.line_so_no.toString().trim());
          }
        });
      }

      // Remove duplicates and empty values
      const uniqueSONumbers = [...new Set(soNumbers)].filter(
        (so) => so.length > 0
      );

      if (uniqueSONumbers.length === 0) {
        console.log(
          `No SO numbers found for GD ${gdData.delivery_no}, skipping conflict check`
        );
        continue;
      }

      console.log(
        `Checking reserved goods conflicts for GD ${
          gdData.delivery_no
        } with SOs: ${uniqueSONumbers.join(", ")}`
      );

      // Check each SO number for conflicts
      for (const soNo of uniqueSONumbers) {
        const query = {
          parent_no: soNo,
          organization_id: organizationId,
          doc_type: "Good Delivery",
          is_deleted: 0,
        };

        // Get current GD's delivery_no to exclude it
        const currentGdNo = gdData.delivery_no;
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

            conflictIssues.push({
              gdNo: gdData.delivery_no,
              conflictingSoNo: soNo,
              conflictingGdNo: conflictingRecord.doc_no,
              openQty: conflictingRecord.open_qty,
              issue: `SO ${soNo} has open quantities reserved by another GD (${conflictingRecord.doc_no})`,
            });

            console.log(
              `Conflict found: GD ${gdData.delivery_no} conflicts with ${conflictingRecord.doc_no} for SO ${soNo}`
            );
            break; // Found conflict for this GD, no need to check other SOs
          }
        }
      }
    }

    if (conflictIssues.length > 0) {
      console.log(
        `Found ${conflictIssues.length} reserved goods conflict issues`
      );
      return {
        allPassed: false,
        failedGDs: conflictIssues,
        summary: `${conflictIssues.length} goods delivery(s) have reserved goods conflicts`,
      };
    }

    console.log(
      "Bulk reserved goods conflict check passed for all selected GDs"
    );
    return {
      allPassed: true,
      failedGDs: [],
      summary: "No reserved goods conflicts found",
    };
  } catch (error) {
    console.error("Error in bulk reserved goods conflict check:", error);
    return {
      allPassed: false,
      failedGDs: [],
      summary: `Reserved goods conflict check error: ${error.message}`,
    };
  }
};

// Check delivery quantities against SO limits with over-delivery tolerance
const checkBulkDeliveryQuantities = async (goodsDeliveryData) => {
  try {
    console.log("Checking delivery quantities with tolerance for bulk GDs...");

    const quantityIssues = [];

    for (const gdData of goodsDeliveryData) {
      const tableGD = gdData.table_gd || [];

      if (tableGD.length === 0) {
        continue;
      }

      console.log(
        `Checking delivery quantities for GD ${gdData.delivery_no}...`
      );

      // Get all unique SO line item IDs for batch fetching
      const soLineItemIds = tableGD
        .filter((item) => item.so_line_item_id && item.material_id)
        .map((item) => item.so_line_item_id);

      if (soLineItemIds.length === 0) {
        continue;
      }

      // Batch fetch SO line data
      const resSOLineData = await Promise.all(
        soLineItemIds.map(async (soLineItemId) => {
          try {
            const response = await db
              .collection("sales_order_axszx8cj_sub")
              .doc(soLineItemId)
              .get();
            return response.data ? response.data[0] : null;
          } catch (error) {
            console.warn(
              `Failed to fetch SO line item ${soLineItemId}:`,
              error
            );
            return null;
          }
        })
      );

      // Get all unique material IDs for batch fetching
      const materialIds = [
        ...new Set(
          tableGD
            .filter((item) => item.material_id)
            .map((item) => item.material_id)
        ),
      ];

      // Batch fetch item data
      const resItem = await Promise.all(
        materialIds.map(async (materialId) => {
          try {
            const response = await db
              .collection("Item")
              .where({ id: materialId })
              .get();
            return response.data && response.data.length > 0
              ? response.data[0]
              : null;
          } catch (error) {
            console.warn(`Failed to fetch item ${materialId}:`, error);
            return null;
          }
        })
      );

      // Create lookup maps for efficiency
      const soLineDataMap = new Map();
      resSOLineData.forEach((data, index) => {
        if (data) {
          soLineDataMap.set(soLineItemIds[index], data);
        }
      });

      const itemDataMap = new Map();
      resItem.forEach((data) => {
        if (data) {
          itemDataMap.set(data.id, data);
        }
      });

      // Check each GD line item
      for (const [index, item] of tableGD.entries()) {
        if (!item.material_id || item.material_id === "") {
          continue;
        }

        const soLine = soLineDataMap.get(item.so_line_item_id);
        const itemInfo = itemDataMap.get(item.material_id);

        if (!soLine) {
          console.warn(
            `SO line not found for item ${index + 1} in GD ${
              gdData.delivery_no
            }`
          );
          continue;
        }

        const tolerance = itemInfo ? itemInfo.over_delivery_tolerance || 0 : 0;
        const orderedQty = parseFloat(soLine.so_quantity || 0);
        const previouslyDeliveredQty = parseFloat(soLine.delivered_qty || 0);
        const currentDeliveryQty = parseFloat(item.gd_qty || 0);

        // Calculate maximum deliverable quantity considering tolerance
        const remainingQty = orderedQty - previouslyDeliveredQty;
        const maxDeliverableQty = remainingQty * ((100 + tolerance) / 100);

        console.log(
          `GD ${gdData.delivery_no}, Item ${index + 1}: ` +
            `Ordered: ${orderedQty}, Previously Delivered: ${previouslyDeliveredQty}, ` +
            `Current Delivery: ${currentDeliveryQty}, Max Allowed: ${maxDeliverableQty.toFixed(
              3
            )}, ` +
            `Tolerance: ${tolerance}%`
        );

        if (currentDeliveryQty > maxDeliverableQty) {
          quantityIssues.push({
            gdNo: gdData.delivery_no,
            lineNumber: index + 1,
            materialId: item.material_id,
            materialName:
              item.material_name || item.gd_material_desc || "Unknown Item",
            orderedQty: orderedQty,
            previouslyDeliveredQty: previouslyDeliveredQty,
            currentDeliveryQty: currentDeliveryQty,
            maxDeliverableQty: maxDeliverableQty,
            tolerance: tolerance,
            issue: `Delivery quantity ${currentDeliveryQty} exceeds maximum deliverable quantity ${maxDeliverableQty.toFixed(
              3
            )} (tolerance: ${tolerance}%)`,
          });

          console.log(
            `Quantity violation found in GD ${gdData.delivery_no}, line ${
              index + 1
            }: ` + `${currentDeliveryQty} > ${maxDeliverableQty.toFixed(3)}`
          );
        }
      }
    }

    if (quantityIssues.length > 0) {
      console.log(
        `Found ${quantityIssues.length} delivery quantity validation issues`
      );
      return {
        allPassed: false,
        failedGDs: quantityIssues,
        summary: `${quantityIssues.length} delivery line(s) exceed maximum deliverable quantities`,
      };
    }

    console.log(
      "Bulk delivery quantity validation passed for all selected GDs"
    );
    return {
      allPassed: true,
      failedGDs: [],
      summary: "All delivery quantities within tolerance",
    };
  } catch (error) {
    console.error("Error in bulk delivery quantity validation:", error);
    return {
      allPassed: false,
      failedGDs: [],
      summary: `Delivery quantity validation error: ${error.message}`,
    };
  }
};

// Update Sales Order Status with delivery progress tracking
const updateSalesOrderStatus = async (salesOrderId, deliveryNo) => {
  try {
    // Get current sales order data
    const soQuery = await db.collection("sales_order").doc(salesOrderId).get();

    if (!soQuery.data) {
      return {
        success: false,
        message: `Sales order not found: ${salesOrderId}`,
      };
    }

    const soData = soQuery.data;

    // Get all goods deliveries for this sales order
    const allGDQuery = await db
      .collection("goods_delivery")
      .filter([
        {
          prop: "so_id",
          operator: "in",
          value: salesOrderId,
        },
      ])
      .get();

    let overallGDStatus = "Not Delivered";
    let completedGDs = 0;
    let totalGDs = 0;

    if (allGDQuery.data && allGDQuery.data.length > 0) {
      totalGDs = allGDQuery.data.length;

      for (const gd of allGDQuery.data) {
        if (gd.gd_status === "Completed") {
          completedGDs++;
        }
      }

      // Determine overall delivery status
      if (completedGDs === 0) {
        overallGDStatus = "Not Delivered";
      } else if (completedGDs === totalGDs) {
        overallGDStatus = "Fully Delivered";
      } else {
        overallGDStatus = "Partially Delivered";
      }
    }

    // Calculate delivery completion percentage
    const deliveryCompletionPercentage =
      totalGDs > 0 ? Math.round((completedGDs / totalGDs) * 100) : 0;

    // Determine sales order status based on delivery progress
    let newSOStatus = soData.so_status;

    if (overallGDStatus === "Fully Delivered") {
      // Check if all other processes are complete (invoicing, etc.)
      const isFullyInvoiced = soData.si_status === "Fully Invoiced";

      if (isFullyInvoiced) {
        newSOStatus = "Completed";
      } else {
        newSOStatus = "Delivered"; // Delivered but not fully invoiced
      }
    } else if (overallGDStatus === "Partially Delivered") {
      newSOStatus = "In Progress";
    }

    // Update sales order with enhanced status tracking
    const updateData = {
      gd_status: overallGDStatus,
      delivery_completion_percentage: deliveryCompletionPercentage,
      last_delivery_no: deliveryNo,
      last_delivery_date: new Date(),
      updated_at: new Date(),
    };

    // Only update SO status if it should change
    if (newSOStatus !== soData.so_status) {
      updateData.so_status = newSOStatus;
    }

    await db.collection("sales_order").doc(salesOrderId).update(updateData);

    return {
      success: true,
      message: `gd_status: ${overallGDStatus}, so_status: ${newSOStatus}, completion: ${deliveryCompletionPercentage}% (${completedGDs}/${totalGDs} GDs)`,
    };
  } catch (error) {
    console.error(
      `Error updating sales order status for ${salesOrderId}:`,
      error
    );
    return {
      success: false,
      message: error.message,
    };
  }
};

(async () => {
  try {
    const allListID = "custom_ezwb0qqp";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      let goodsDeliveryData = selectedRecords.filter(
        (item) => item.gd_status === "Created"
      );

      if (goodsDeliveryData.length === 0) {
        this.$message.error(
          "Please select at least one created goods delivery."
        );
        return;
      }

      // PRE-VALIDATION: Check inventory availability before showing confirmation
      console.log("Starting bulk inventory validation before confirmation...");
      const bulkValidationResult = await validateBulkInventoryAvailability(
        goodsDeliveryData
      );

      let validGoodsDeliveryData = goodsDeliveryData;
      let removedGDs = [];

      if (!bulkValidationResult.isValid) {
        // Get list of GD numbers with validation errors
        const failedGDNumbers = new Set(
          bulkValidationResult.errors.map((error) => error.gdNo)
        );

        // Filter out failed GDs and keep only passing ones
        validGoodsDeliveryData = goodsDeliveryData.filter(
          (gdItem) => !failedGDNumbers.has(gdItem.delivery_no)
        );

        // Track removed GDs for user notification
        removedGDs = goodsDeliveryData.filter((gdItem) =>
          failedGDNumbers.has(gdItem.delivery_no)
        );

        console.log(
          `Found ${removedGDs.length} GDs with validation errors, ${validGoodsDeliveryData.length} GDs passed validation`
        );

        // Format error message for display - ALWAYS show this alert for failed GDs
        const errorsByGD = {};
        bulkValidationResult.errors.forEach((error) => {
          if (!errorsByGD[error.gdNo]) {
            errorsByGD[error.gdNo] = [];
          }
          errorsByGD[error.gdNo].push(error.error);
        });

        let detailedErrorMsg = `<strong>${bulkValidationResult.summary}</strong><br><br>`;
        detailedErrorMsg += `<strong>The following goods deliveries cannot be processed:</strong><br>`;

        for (const [gdNo, errors] of Object.entries(errorsByGD)) {
          detailedErrorMsg += `<br><strong>GD ${gdNo}:</strong><br>`;
          errors.forEach((error) => {
            detailedErrorMsg += `• ${error}<br>`;
          });
        }

        if (validGoodsDeliveryData.length > 0) {
          detailedErrorMsg += `<br><strong>Remaining ${validGoodsDeliveryData.length} GD(s) will continue to confirmation.</strong>`;
        } else {
          detailedErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for failed GDs
        await this.$alert(detailedErrorMsg, "Inventory Validation Issues", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });

        // If no valid GDs remain, exit after showing the alert
        if (validGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Bulk inventory validation completed - proceeding to delivery quantity validation with ${validGoodsDeliveryData.length} valid GDs`
      );

      // Run delivery quantity validation on remaining valid GDs
      const deliveryQuantityValidationResult =
        await checkBulkDeliveryQuantities(validGoodsDeliveryData);

      // Filter GDs that passed inventory and delivery quantity validation
      let quantityValidGoodsDeliveryData = validGoodsDeliveryData;

      if (!deliveryQuantityValidationResult.allPassed) {
        // Group failed line items by GD number
        const failedGDMap = new Map();
        deliveryQuantityValidationResult.failedGDs.forEach((issue) => {
          if (!failedGDMap.has(issue.gdNo)) {
            failedGDMap.set(issue.gdNo, []);
          }
          failedGDMap.get(issue.gdNo).push(issue);
        });

        // Filter out GDs that have any failed line items
        const quantityFailedGDNumbers = Array.from(failedGDMap.keys());
        quantityValidGoodsDeliveryData = validGoodsDeliveryData.filter(
          (gd) => !quantityFailedGDNumbers.includes(gd.delivery_no)
        );

        // Prepare delivery quantity error message
        let quantityErrorMsg = `<strong>Delivery Quantity Validation Issues</strong><br><br>`;
        quantityErrorMsg += `<strong>The following goods deliveries have items exceeding maximum deliverable quantities:</strong><br>`;

        for (const [gdNo, issues] of failedGDMap) {
          quantityErrorMsg += `<br><strong>GD ${gdNo}:</strong><br>`;
          issues.forEach((issue) => {
            quantityErrorMsg += `• Line ${issue.lineNumber} - ${issue.materialName}: `;
            quantityErrorMsg += `Delivery Qty ${
              issue.currentDeliveryQty
            } > Max ${issue.maxDeliverableQty.toFixed(3)} `;
            quantityErrorMsg += `(Tolerance: ${issue.tolerance}%)<br>`;
          });
        }

        if (quantityValidGoodsDeliveryData.length > 0) {
          quantityErrorMsg += `<br><strong>Remaining ${quantityValidGoodsDeliveryData.length} GD(s) will continue to picking validation.</strong>`;
        } else {
          quantityErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for delivery quantity failed GDs
        await this.$alert(
          quantityErrorMsg,
          "Delivery Quantity Validation Issues",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        );

        // If no valid GDs remain after delivery quantity validation, exit
        if (quantityValidGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Delivery quantity validation completed - proceeding to picking validation with ${quantityValidGoodsDeliveryData.length} valid GDs`
      );

      // Run picking status validation on remaining valid GDs
      const pickingValidationResult = await checkBulkPickingStatus(
        quantityValidGoodsDeliveryData
      );

      // Filter GDs that passed inventory, delivery quantity, and picking validation
      let pickingValidGoodsDeliveryData = quantityValidGoodsDeliveryData;

      if (!pickingValidationResult.allPassed) {
        // Filter out GDs that failed picking validation
        const pickingFailedGDNumbers = pickingValidationResult.failedGDs.map(
          (gd) => gd.gdNo
        );
        pickingValidGoodsDeliveryData = validGoodsDeliveryData.filter(
          (gd) => !pickingFailedGDNumbers.includes(gd.delivery_no)
        );

        // Prepare picking error message
        let pickingErrorMsg = `<strong>Picking Validation Issues</strong><br><br>`;
        pickingErrorMsg += `<strong>The following goods deliveries require completed picking process:</strong><br>`;

        for (const failedGD of pickingValidationResult.failedGDs) {
          pickingErrorMsg += `<br><strong>GD ${failedGD.gdNo}:</strong><br>`;
          if (failedGD.plantId) {
            pickingErrorMsg += `• Plant: ${failedGD.plantId}<br>`;
          }
          if (failedGD.currentStatus) {
            pickingErrorMsg += `• Current Picking Status: ${failedGD.currentStatus}<br>`;
          }
          pickingErrorMsg += `• ${failedGD.issue}<br>`;
        }

        if (pickingValidGoodsDeliveryData.length > 0) {
          pickingErrorMsg += `<br><strong>Remaining ${pickingValidGoodsDeliveryData.length} GD(s) will continue to credit limit validation.</strong>`;
        } else {
          pickingErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for picking failed GDs
        await this.$alert(pickingErrorMsg, "Picking Validation Issues", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });

        // If no valid GDs remain after picking validation, exit
        if (pickingValidGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Picking validation completed - proceeding to reserved goods conflict check with ${pickingValidGoodsDeliveryData.length} valid GDs`
      );

      // Run reserved goods conflict check on remaining valid GDs
      const reservedGoodsValidationResult =
        await checkBulkExistingReservedGoods(
          pickingValidGoodsDeliveryData,
          pickingValidGoodsDeliveryData[0]?.organization_id
        );

      // Filter GDs that passed inventory, picking, and reserved goods validation
      let reservedGoodsValidGoodsDeliveryData = pickingValidGoodsDeliveryData;

      if (!reservedGoodsValidationResult.allPassed) {
        // Filter out GDs that failed reserved goods conflict check
        const reservedFailedGDNumbers =
          reservedGoodsValidationResult.failedGDs.map((gd) => gd.gdNo);
        reservedGoodsValidGoodsDeliveryData =
          pickingValidGoodsDeliveryData.filter(
            (gd) => !reservedFailedGDNumbers.includes(gd.delivery_no)
          );

        // Prepare reserved goods conflict error message
        let reservedErrorMsg = `<strong>Reserved Goods Conflict Issues</strong><br><br>`;
        reservedErrorMsg += `<strong>The following goods deliveries have conflicts with other GDs:</strong><br>`;

        for (const failedGD of reservedGoodsValidationResult.failedGDs) {
          reservedErrorMsg += `<br><strong>GD ${failedGD.gdNo}:</strong><br>`;
          reservedErrorMsg += `• Conflicting SO: ${failedGD.conflictingSoNo}<br>`;
          reservedErrorMsg += `• Conflicting GD: ${failedGD.conflictingGdNo}<br>`;
          if (failedGD.openQty) {
            reservedErrorMsg += `• Open Quantity: ${failedGD.openQty}<br>`;
          }
          reservedErrorMsg += `• ${failedGD.issue}<br>`;
        }

        if (reservedGoodsValidGoodsDeliveryData.length > 0) {
          reservedErrorMsg += `<br><strong>Remaining ${reservedGoodsValidGoodsDeliveryData.length} GD(s) will continue to credit limit validation.</strong>`;
        } else {
          reservedErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for reserved goods conflict failed GDs
        await this.$alert(reservedErrorMsg, "Reserved Goods Conflict Issues", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });

        // If no valid GDs remain after reserved goods validation, exit
        if (reservedGoodsValidGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Reserved goods conflict check completed - proceeding to credit limit validation with ${reservedGoodsValidGoodsDeliveryData.length} valid GDs`
      );

      // Run credit limit validation on remaining valid GDs
      const creditLimitValidationResult = await validateBulkCreditLimits(
        reservedGoodsValidGoodsDeliveryData
      );

      // Filter GDs that passed inventory, picking, reserved goods, and credit limit validation
      let finalValidGoodsDeliveryData = reservedGoodsValidGoodsDeliveryData;

      if (!creditLimitValidationResult.allPassed) {
        // Filter out GDs that failed credit limit validation
        const creditFailedGDNumbers = creditLimitValidationResult.failedGDs.map(
          (gd) => gd.delivery_no
        );
        finalValidGoodsDeliveryData = validGoodsDeliveryData.filter(
          (gd) => !creditFailedGDNumbers.includes(gd.delivery_no)
        );

        // Prepare credit limit error message
        let creditErrorMsg = `<strong>Credit Limit Validation Issues</strong><br><br>`;
        creditErrorMsg += `<strong>The following goods deliveries failed credit limit validation:</strong><br>`;

        for (const failedGD of creditLimitValidationResult.failedGDs) {
          creditErrorMsg += `<br><strong>GD ${failedGD.delivery_no}:</strong><br>`;
          creditErrorMsg += `• Customer: ${failedGD.customer_name}<br>`;
          creditErrorMsg += `• ${failedGD.error_message}<br>`;
        }

        if (finalValidGoodsDeliveryData.length > 0) {
          creditErrorMsg += `<br><strong>Remaining ${finalValidGoodsDeliveryData.length} GD(s) will continue to confirmation.</strong>`;
        } else {
          creditErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for credit limit failed GDs
        await this.$alert(creditErrorMsg, "Credit Limit Validation Issues", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });

        // If no valid GDs remain after credit limit validation, exit
        if (finalValidGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Credit limit validation completed - proceeding to confirmation with ${finalValidGoodsDeliveryData.length} valid GDs`
      );

      // Update goods delivery numbers list for confirmation
      const validGoodsDeliveryNumbers = finalValidGoodsDeliveryData.map(
        (item) => item.delivery_no
      );

      // Prepare confirmation message
      let confirmationMessage = `You've selected ${validGoodsDeliveryNumbers.length} goods delivery(s) to complete.<br><br>`;
      confirmationMessage += `<strong>Goods Delivery Numbers:</strong><br>${validGoodsDeliveryNumbers.join(
        ", "
      )}`;
      confirmationMessage += `<br><br><strong>✓ Inventory validation passed</strong><br><strong>✓ Delivery quantity validation passed</strong><br><strong>✓ Picking validation passed</strong><br><strong>✓ Reserved goods conflict check passed</strong><br><strong>✓ Credit limit validation passed</strong><br>Do you want to proceed?`;

      await this.$confirm(confirmationMessage, "Goods Delivery Completion", {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      }).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      // Create a map to track consumed FIFO quantities during this transaction
      const consumedFIFOQty = new Map();

      // Process each goods delivery with full inventory flow
      for (const gdItem of finalValidGoodsDeliveryData) {
        // Initialize rollback tracking arrays for this GD
        const updatedDocs = [];
        const createdDocs = [];

        // Rollback function for this GD
        const rollbackChanges = async () => {
          console.log(`Rolling back changes for GD ${gdItem.delivery_no}...`);

          // Rollback updated documents to their original state
          for (const doc of updatedDocs.reverse()) {
            try {
              await db
                .collection(doc.collection)
                .doc(doc.docId)
                .update(doc.originalData);
              console.log(`Rolled back ${doc.collection}/${doc.docId}`);
            } catch (rollbackError) {
              console.error(
                `Rollback error for ${doc.collection}/${doc.docId}:`,
                rollbackError
              );
            }
          }

          // Mark created documents as deleted
          for (const doc of createdDocs.reverse()) {
            try {
              await db.collection(doc.collection).doc(doc.docId).update({
                is_deleted: 1,
              });
              console.log(`Marked as deleted ${doc.collection}/${doc.docId}`);
            } catch (rollbackError) {
              console.error(
                `Rollback error for ${doc.collection}/${doc.docId}:`,
                rollbackError
              );
            }
          }

          console.log(`Rollback completed for GD ${gdItem.delivery_no}`);
        };

        try {
          console.log(`Processing GD ${gdItem.delivery_no} for completion...`);

          const items = gdItem.table_gd;

          // Process inventory movements for each item
          for (const item of items) {
            if (!item.material_id || !item.temp_qty_data) {
              console.warn(`Skipping item with missing data:`, item);
              continue;
            }

            const itemRes = await db
              .collection("Item")
              .where({ id: item.material_id })
              .get();

            if (!itemRes.data || !itemRes.data.length) {
              console.warn(`Item not found, skipping: ${item.material_id}`);
              continue;
            }

            const itemData = itemRes.data[0];
            if (itemData.stock_control === 0) {
              console.log(
                `Skipping non-stock controlled item: ${item.material_id}`
              );
              continue;
            }

            const temporaryData = parseJsonSafely(item.temp_qty_data, []);

            // Check if item is serialized and batch managed for grouping logic
            const isSerializedItem = itemData.serial_number_management === 1;
            const isBatchManagedItem = itemData.item_batch_management === 1;

            console.log(
              `Item ${item.material_id}: Serialized=${isSerializedItem}, Batch=${isBatchManagedItem}`
            );

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
              `Grouped ${temporaryData.length} items into ${groupedTempData.size} movement groups for item ${item.material_id}`
            );

            // Process each group to create consolidated movements
            for (const [groupKey, group] of groupedTempData) {
              console.log(
                `Processing group: ${groupKey} with ${group.items.length} items, total qty: ${group.totalQty}`
              );

              // Use group total quantity instead of individual temp quantity
              // Enhanced UOM Conversion with proper rounding for consolidated group
              let altQty = roundQty(group.totalQty);
              let baseQty = altQty;
              let altUOM = item.gd_order_uom_id;
              let baseUOM = itemData.based_uom;

              // Skip if quantity is zero or negative
              if (altQty <= 0) {
                console.warn(
                  `Skipping item with zero/negative quantity: ${altQty}`
                );
                continue;
              }

              if (
                Array.isArray(itemData.table_uom_conversion) &&
                itemData.table_uom_conversion.length > 0
              ) {
                const uomConversion = itemData.table_uom_conversion.find(
                  (conv) => conv.alt_uom_id === altUOM
                );

                if (uomConversion && uomConversion.base_qty > 0) {
                  baseQty = roundQty(altQty * uomConversion.base_qty);
                  console.log(
                    `UOM Conversion: ${altQty} ${altUOM} → ${baseQty} ${baseUOM} (factor: ${uomConversion.base_qty})`
                  );
                } else if (altUOM !== baseUOM) {
                  console.warn(
                    `No UOM conversion found for ${altUOM} → ${baseUOM}, using 1:1 ratio`
                  );
                }
              }

              const costingMethod = itemData.material_costing_method;
              const isSerializedItem = itemData.serial_number_management === 1;

              let unitPrice = roundPrice(item.unit_price || 0);
              let totalPrice = roundPrice(unitPrice * baseQty);

              // Get cost price based on costing method
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
                  gdItem.plant_id.id
                );

                // Update the consumed quantity for this material/batch
                consumedFIFOQty.set(
                  materialBatchKey,
                  previouslyConsumedQty + baseQty
                );

                unitPrice = roundPrice(fifoCostPrice);
                totalPrice = roundPrice(fifoCostPrice * baseQty);

                console.log(
                  `Enhanced FIFO Cost: ${unitPrice} (consumed: ${baseQty}, previously consumed: ${previouslyConsumedQty})`
                );
              } else if (costingMethod === "Weighted Average") {
                // Get WA cost price and update weighted average costing
                const waResult = await updateWeightedAverageCosting(
                  item.material_id,
                  baseQty,
                  group.batch_id,
                  gdItem.plant_id.id
                );

                if (waResult.success) {
                  unitPrice = roundPrice(waResult.averageCost);
                  totalPrice = roundPrice(unitPrice * baseQty);
                  console.log(
                    `Enhanced WA Cost: ${unitPrice} (consumed: ${baseQty}, average: ${waResult.averageCost})`
                  );
                } else {
                  console.warn(
                    `WA update failed for material ${item.material_id}: ${waResult.message}`
                  );
                  // Fallback to reading latest WA cost without updating
                  unitPrice = await getWeightedAverageCostPrice(
                    item.material_id,
                    group.batch_id,
                    gdItem.plant_id.id
                  );
                  totalPrice = roundPrice(unitPrice * baseQty);
                }
              } else if (costingMethod === "Fixed Cost") {
                // Get Fixed Cost price
                unitPrice = await getFixedCostPrice(item.material_id);
                totalPrice = roundPrice(unitPrice * baseQty);
              } else {
                console.warn(
                  `Unsupported costing method: ${costingMethod}. Using item price.`
                );
                // Keep original unit price
              }

              // For grouped processing, we skip individual validation since we already validated in bulk
              // The group consolidates multiple items, so validation is done at a higher level

              console.log(
                `Processing consolidated group for ${item.material_id} at ${group.location_id}: ${baseQty} total quantity`
              );

              // Enhanced inventory movement with proper category handling for Created status
              const inventoryMovementData = {
                transaction_type: "GDL",
                trx_no: gdItem.delivery_no,
                parent_trx_no: gdItem.so_no,
                movement: "OUT",
                unit_price: roundPrice(unitPrice),
                total_price: roundPrice(totalPrice),
                quantity: roundQty(altQty),
                item_id: item.material_id,
                inventory_category: "Reserved", // Start with Reserved for Created status
                uom_id: altUOM,
                base_qty: roundQty(baseQty),
                base_uom_id: baseUOM,
                bin_location_id: group.location_id,
                batch_number_id: group.batch_id || null,
                costing_method_id: item.item_costing_method,
                plant_id: gdItem.plant_id.id,
                organization_id: gdItem.organization_id,
                created_at: new Date(),
                updated_at: new Date(),
              };

              const movementResult = await db
                .collection("inventory_movement")
                .add(inventoryMovementData);

              // Track created movement for rollback
              createdDocs.push({
                collection: "inventory_movement",
                docId: movementResult.id,
              });

              console.log(
                `Created inventory movement: ${baseQty} ${baseUOM} of ${item.material_id} (${movementResult.id})`
              );

              // Handle serialized items
              if (isSerializedItem) {
                console.log(
                  `Processing serialized item completion for ${item.material_id}, serial: ${group.serial_number}`
                );

                if (!group.serial_number) {
                  console.error(
                    `Serial number missing for serialized item ${item.material_id}`
                  );
                  continue;
                }

                // Handle serialized item balance with enhanced reserved/unrestricted logic
                const serialBalanceResult = await updateItemBalance(
                  item.material_id,
                  1, // For serialized items, quantity is always 1
                  group.location_id,
                  group.batch_id,
                  gdItem.so_no,
                  gdItem.plant_id.id,
                  gdItem.organization_id,
                  true, // is serialized
                  group.serial_number
                );

                if (!serialBalanceResult.success) {
                  console.error(
                    `CRITICAL: Serial balance update failed for ${group.serial_number}: ${serialBalanceResult.message}`
                  );
                  throw new Error(serialBalanceResult.message);
                }

                console.log(
                  `Serial balance updated: ${group.serial_number} - ${serialBalanceResult.message}`
                );

                // Create inventory movements for serialized items with proper categories
                const movements = [];

                if (serialBalanceResult.fromReserved > 0) {
                  movements.push({
                    ...inventoryMovementData,
                    inventory_category: "Reserved",
                    quantity: roundQty(serialBalanceResult.fromReserved),
                    base_qty: roundQty(serialBalanceResult.fromReserved),
                    total_price: roundPrice(
                      unitPrice * serialBalanceResult.fromReserved
                    ),
                  });
                }

                if (serialBalanceResult.fromUnrestricted > 0) {
                  movements.push({
                    ...inventoryMovementData,
                    inventory_category: "Unrestricted",
                    quantity: roundQty(serialBalanceResult.fromUnrestricted),
                    base_qty: roundQty(serialBalanceResult.fromUnrestricted),
                    total_price: roundPrice(
                      unitPrice * serialBalanceResult.fromUnrestricted
                    ),
                  });
                }

                // Create movements and collect their IDs for serial movement records
                for (const movementData of movements) {
                  const serialMovementResult = await db
                    .collection("inventory_movement")
                    .add(movementData);

                  // Track created serial movement for rollback
                  createdDocs.push({
                    collection: "inventory_movement",
                    docId: serialMovementResult.id,
                  });

                  console.log(
                    `Created ${movementData.inventory_category} movement for serial ${group.serial_number}: ${movementData.base_qty}`
                  );

                  // Wait and get the movement ID for serial movement record
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const movementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: gdItem.delivery_no,
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      inventory_category: movementData.inventory_category,
                      base_qty: movementData.base_qty,
                      plant_id: gdItem.plant_id.id,
                      organization_id: gdItem.organization_id,
                    })
                    .get();

                  if (movementQuery.data && movementQuery.data.length > 0) {
                    const latestMovement = movementQuery.data.sort(
                      (a, b) =>
                        new Date(b.create_time) - new Date(a.create_time)
                    )[0];

                    const serialMoveResult = await db
                      .collection("inv_serial_movement")
                      .add({
                        inventory_movement_id: latestMovement.id,
                        serial_number: group.serial_number,
                        batch_id: group.batch_id || null,
                        base_qty: movementData.base_qty,
                        base_uom: baseUOM,
                        plant_id: gdItem.plant_id.id,
                        organization_id: gdItem.organization_id,
                        created_at: new Date(),
                      });

                    // Track created serial movement record for rollback
                    createdDocs.push({
                      collection: "inv_serial_movement",
                      docId: serialMoveResult.id,
                    });

                    console.log(
                      `Created serial movement record for ${group.serial_number} (${movementData.inventory_category})`
                    );
                  }
                }

                // Skip regular balance processing for serialized items
                continue;
              }

              // Handle regular (non-serialized) item balance with enhanced reserved goods management
              const balanceResult = await updateItemBalance(
                item.material_id,
                baseQty,
                group.location_id,
                group.batch_id,
                gdItem.so_no,
                gdItem.plant_id.id,
                gdItem.organization_id,
                false, // not serialized
                null // no serial number
              );

              // Create additional movement for unrestricted portion if needed
              if (balanceResult.success && balanceResult.fromUnrestricted > 0) {
                const unrestrictedMovementData = {
                  ...inventoryMovementData,
                  inventory_category: "Unrestricted",
                  quantity: roundQty(
                    (balanceResult.fromUnrestricted / baseQty) * altQty
                  ),
                  base_qty: roundQty(balanceResult.fromUnrestricted),
                  total_price: roundPrice(
                    unitPrice *
                      (balanceResult.fromUnrestricted / baseQty) *
                      altQty
                  ),
                };

                const unrestrictedMoveResult = await db
                  .collection("inventory_movement")
                  .add(unrestrictedMovementData);

                // Track created unrestricted movement for rollback
                createdDocs.push({
                  collection: "inventory_movement",
                  docId: unrestrictedMoveResult.id,
                });

                console.log(
                  `Created additional unrestricted movement: ${balanceResult.fromUnrestricted} ${baseUOM}`
                );

                // Update original movement to reflect only reserved portion
                if (balanceResult.fromReserved > 0) {
                  inventoryMovementData.quantity = roundQty(
                    (balanceResult.fromReserved / baseQty) * altQty
                  );
                  inventoryMovementData.base_qty = roundQty(
                    balanceResult.fromReserved
                  );
                  inventoryMovementData.total_price = roundPrice(
                    unitPrice * (balanceResult.fromReserved / baseQty) * altQty
                  );
                }
              }

              if (!balanceResult.success) {
                console.error(
                  `CRITICAL: Balance update failed for ${item.material_id}: ${balanceResult.message}`
                );
                throw new Error(balanceResult.message);
              }

              console.log(
                `Balance updated: ${item.material_id} at ${group.location_id} - ${balanceResult.message}`
              );
            }
          }

          // Update reserved goods records before marking as Completed
          const reservedGoodsResult = await updateOnReserveGoodsDelivery(
            gdItem.organization_id,
            gdItem
          );

          if (!reservedGoodsResult.success) {
            console.warn(
              `Reserved goods update warning for ${gdItem.delivery_no}: ${reservedGoodsResult.message}`
            );
          } else {
            console.log(
              `Reserved goods updated: ${gdItem.delivery_no} - ${reservedGoodsResult.message}`
            );
          }

          // Update goods delivery status to Completed
          await db.collection("goods_delivery").doc(gdItem.id).update({
            gd_status: "Completed",
          });

          // Update related sales orders with enhanced delivery status tracking
          for (const soItem of gdItem.so_id) {
            const soUpdateResult = await updateSalesOrderStatus(
              soItem.id,
              gdItem.delivery_no
            );

            if (!soUpdateResult.success) {
              console.warn(
                `SO status update warning for ${soItem.id}: ${soUpdateResult.message}`
              );
            } else {
              console.log(
                `SO status updated: ${soItem.id} - ${soUpdateResult.message}`
              );
            }
          }

          console.log(
            `Goods Delivery ${gdItem.delivery_no} successfully completed`
          );
        } catch (error) {
          console.error(`Error completing ${gdItem.delivery_no}:`, error);

          // Perform rollback of all changes made for this GD
          await rollbackChanges();

          this.$message.error(
            `Error completing ${gdItem.delivery_no}: ${error.message}. All changes have been rolled back.`
          );
        } finally {
          // Reset processing flag for this GD
          window.isProcessing = false;
        }
      }

      let successMessage = `Successfully completed ${validGoodsDeliveryData.length} goods delivery(s).`;

      if (removedGDs.length > 0) {
        successMessage += ` (${removedGDs.length} GD(s) were skipped due to insufficient inventory)`;
      }

      this.$message.success(successMessage);
      this.refresh();
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error("Bulk completion error:", error);
    this.$message.error("An error occurred during bulk completion.");
  }
})();
