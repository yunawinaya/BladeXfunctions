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

// Update Item Balance with Reserved Goods Management
const updateItemBalance = async (
  materialId,
  quantity,
  locationId,
  batchId,
  salesOrderNo,
  plantId
) => {
  try {
    // Determine balance collection and parameters
    const balanceCollection = batchId ? "item_batch_balance" : "item_balance";
    const itemBalanceParams = {
      material_id: materialId,
      location_id: locationId,
    };

    if (batchId) {
      itemBalanceParams.batch_id = batchId;
    }

    // Get current balance
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

    // Check if we have reserved goods for this sales order
    const reservedQuery = await db
      .collection("reserved_goods")
      .where({
        material_id: materialId,
        location_id: locationId,
        sales_order_no: salesOrderNo,
        plant_id: plantId,
        ...(batchId && { batch_id: batchId }),
      })
      .get();

    let fromReserved = 0;
    let fromUnrestricted = quantity;

    // If reserved goods exist, use them first
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
    };
  } catch (error) {
    console.error(`Error updating item balance for ${materialId}:`, error);
    return {
      success: false,
      message: error.message,
    };
  }
};

// Update Plant Stock Balance
const updatePlantStockBalance = async (
  materialId,
  quantity,
  plantId,
  batchId
) => {
  try {
    // Determine collection based on batch management
    const collection = batchId
      ? "plant_stock_balance_batch"
      : "plant_stock_balance";

    const plantBalanceParams = {
      material_id: materialId,
      plant_id: plantId,
    };

    if (batchId) {
      plantBalanceParams.batch_id = batchId;
    }

    // Get current plant balance
    const plantBalanceQuery = await db
      .collection(collection)
      .where(plantBalanceParams)
      .get();

    if (!plantBalanceQuery.data || plantBalanceQuery.data.length === 0) {
      // Create new plant balance record if doesn't exist
      const newPlantBalance = {
        material_id: materialId,
        plant_id: plantId,
        unrestricted_qty: 0,
        reserved_qty: 0,
        in_transit_qty: 0,
        total_qty: 0,
        created_at: new Date(),
        updated_at: new Date(),
        ...(batchId && { batch_id: batchId }),
      };

      await db.collection(collection).add(newPlantBalance);

      return {
        success: true,
        message: `created new plant balance record with 0 quantities`,
      };
    }

    const existingPlantDoc = plantBalanceQuery.data[0];
    const currentUnrestricted = parseFloat(
      existingPlantDoc.unrestricted_qty || 0
    );
    const currentReserved = parseFloat(existingPlantDoc.reserved_qty || 0);
    const currentInTransit = parseFloat(existingPlantDoc.in_transit_qty || 0);
    const currentTotal = parseFloat(existingPlantDoc.total_qty || 0);

    // Calculate new quantities (reduce from total and unrestricted)
    const newUnrestricted = roundQty(
      Math.max(0, currentUnrestricted - quantity)
    );
    const newTotal = roundQty(Math.max(0, currentTotal - quantity));

    // Validate sufficient quantity
    if (currentTotal < quantity) {
      return {
        success: false,
        message: `Insufficient total plant quantity. Available: ${currentTotal}, Required: ${quantity}`,
      };
    }

    // Update plant balance
    await db.collection(collection).doc(existingPlantDoc.id).update({
      unrestricted_qty: newUnrestricted,
      total_qty: newTotal,
      updated_at: new Date(),
    });

    return {
      success: true,
      message: `reduced by ${quantity}, remaining: unrestricted ${newUnrestricted}, reserved ${currentReserved}, in_transit ${currentInTransit}, total ${newTotal}`,
    };
  } catch (error) {
    console.error(
      `Error updating plant stock balance for ${materialId}:`,
      error
    );
    return {
      success: false,
      message: error.message,
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

      const goodsDeliveryNumbers = goodsDeliveryData.map(
        (item) => item.delivery_no
      );

      await this.$confirm(
        `You've selected ${
          goodsDeliveryNumbers.length
        } goods delivery(s) to complete. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Goods Delivery Completion",
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

      // Process each goods delivery with full inventory flow
      for (const gdItem of goodsDeliveryData) {
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

            for (const temp of temporaryData) {
              // Enhanced UOM Conversion with proper rounding
              let altQty = roundQty(temp.gd_quantity || 0);
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
                // Get FIFO cost price and update FIFO costing history
                const fifoResult = await updateFIFOInventory(
                  item.material_id,
                  baseQty,
                  temp.batch_id,
                  gdItem.plant_id.id
                );

                if (fifoResult.success) {
                  unitPrice = roundPrice(fifoResult.averageCost);
                  totalPrice = roundPrice(unitPrice * baseQty);
                  console.log(
                    `FIFO Cost: ${unitPrice} (consumed: ${baseQty}, average: ${fifoResult.averageCost})`
                  );
                } else {
                  console.warn(
                    `FIFO update failed for material ${item.material_id}: ${fifoResult.message}`
                  );
                  // Fallback to reading latest FIFO cost without updating
                  const query = temp.batch_id
                    ? db.collection("fifo_costing_history").where({
                        material_id: item.material_id,
                        batch_id: temp.batch_id,
                        plant_id: gdItem.plant_id.id,
                      })
                    : db.collection("fifo_costing_history").where({
                        material_id: item.material_id,
                        plant_id: gdItem.plant_id.id,
                      });

                  const fallbackResult = await query.get();
                  if (fallbackResult.data && fallbackResult.data.length > 0) {
                    const latestRecord = fallbackResult.data.sort(
                      (a, b) => b.fifo_sequence - a.fifo_sequence
                    )[0];
                    unitPrice = roundPrice(latestRecord.fifo_cost_price || 0);
                    totalPrice = roundPrice(unitPrice * baseQty);
                  }
                }
              } else if (costingMethod === "Weighted Average") {
                // Get WA cost price and update weighted average costing
                const waResult = await updateWeightedAverageCosting(
                  item.material_id,
                  baseQty,
                  temp.batch_id,
                  gdItem.plant_id.id
                );

                if (waResult.success) {
                  unitPrice = roundPrice(waResult.averageCost);
                  totalPrice = roundPrice(unitPrice * baseQty);
                  console.log(
                    `WA Cost: ${unitPrice} (consumed: ${baseQty}, average: ${waResult.averageCost})`
                  );
                } else {
                  console.warn(
                    `WA update failed for material ${item.material_id}: ${waResult.message}`
                  );
                  // Fallback to reading latest WA cost without updating
                  unitPrice = await getWeightedAverageCostPrice(
                    item.material_id,
                    temp.batch_id,
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

              // Create enhanced inventory movement record
              const inventoryMovementData = {
                transaction_type: "GD",
                trx_no: gdItem.delivery_no,
                parent_trx_no: gdItem.so_no,
                movement: "OUT",
                unit_price: roundPrice(unitPrice),
                total_price: roundPrice(totalPrice),
                quantity: roundQty(altQty),
                item_id: item.material_id,
                inventory_category: "Unrestricted",
                uom_id: altUOM,
                base_qty: roundQty(baseQty),
                base_uom_id: baseUOM,
                bin_location_id: temp.location_id,
                batch_number_id: temp.batch_id || null,
                costing_method_id: item.item_costing_method,
                plant_id: gdItem.plant_id.id,
                organization_id: gdItem.organization_id,
                created_at: new Date(),
                updated_at: new Date(),
              };

              const movementResult = await db
                .collection("inventory_movement")
                .add(inventoryMovementData);

              console.log(
                `Created inventory movement: ${baseQty} ${baseUOM} of ${item.material_id} (${movementResult.id})`
              );

              // Handle serialized items
              if (isSerializedItem) {
                console.log(
                  `Processing serialized item completion for ${item.material_id}, serial: ${temp.serial_number}`
                );

                if (!temp.serial_number) {
                  console.error(
                    `Serial number missing for serialized item ${item.material_id}`
                  );
                  continue;
                }

                // Update serial balance - move from unrestricted to out of stock
                const serialBalanceParams = {
                  material_id: item.material_id,
                  serial_number: temp.serial_number,
                  plant_id: gdItem.plant_id.id,
                  organization_id: gdItem.organization_id,
                  location_id: temp.location_id,
                };

                if (temp.batch_id) {
                  serialBalanceParams.batch_id = temp.batch_id;
                }

                const serialBalanceQuery = await db
                  .collection("item_serial_balance")
                  .where(serialBalanceParams)
                  .get();

                if (
                  serialBalanceQuery.data &&
                  serialBalanceQuery.data.length > 0
                ) {
                  const serialBalance = serialBalanceQuery.data[0];
                  const currentUnrestricted = parseFloat(
                    serialBalance.unrestricted_qty || 0
                  );

                  const deliveryQty = 1; // For serialized items, quantity is always 1

                  if (currentUnrestricted >= deliveryQty) {
                    await db
                      .collection("item_serial_balance")
                      .doc(serialBalance.id)
                      .update({
                        unrestricted_qty: roundQty(
                          Math.max(0, currentUnrestricted - deliveryQty)
                        ),
                        updated_at: new Date(),
                      });

                    console.log(
                      `Serial balance updated: ${
                        temp.serial_number
                      } - reduced unrestricted by ${deliveryQty} (remaining: ${
                        currentUnrestricted - deliveryQty
                      })`
                    );
                  } else {
                    console.error(
                      `CRITICAL: Insufficient unrestricted quantity for serial ${temp.serial_number}. Available: ${currentUnrestricted}, Required: ${deliveryQty}`
                    );
                    throw new Error(
                      `Insufficient serial quantity for ${temp.serial_number}`
                    );
                  }

                  // Create serial movement record
                  const movementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GD",
                      trx_no: gdItem.delivery_no,
                      item_id: item.material_id,
                      bin_location_id: temp.location_id,
                      base_qty: baseQty,
                      plant_id: gdItem.plant_id.id,
                      organization_id: gdItem.organization_id,
                    })
                    .get();

                  if (movementQuery.data && movementQuery.data.length > 0) {
                    const latestMovement = movementQuery.data.sort(
                      (a, b) =>
                        new Date(b.create_time) - new Date(a.create_time)
                    )[0];

                    await db.collection("inv_serial_movement").add({
                      inventory_movement_id: latestMovement.id,
                      serial_number: temp.serial_number,
                      batch_id: temp.batch_id || null,
                      base_qty: 1,
                      base_uom: baseUOM,
                      plant_id: gdItem.plant_id.id,
                      organization_id: gdItem.organization_id,
                      created_at: new Date(),
                    });

                    console.log(
                      `Created serial movement for ${temp.serial_number}`
                    );
                  }
                } else {
                  console.warn(
                    `Serial balance not found for ${temp.serial_number}`
                  );
                }

                // Skip regular balance processing for serialized items
                continue;
              }

              // Handle regular (non-serialized) item balance with reserved goods management
              const balanceResult = await updateItemBalance(
                item.material_id,
                baseQty,
                temp.location_id,
                temp.batch_id,
                gdItem.so_no,
                gdItem.plant_id.id
              );

              if (!balanceResult.success) {
                console.error(
                  `CRITICAL: Balance update failed for ${item.material_id}: ${balanceResult.message}`
                );
                throw new Error(balanceResult.message);
              }

              console.log(
                `Balance updated: ${item.material_id} at ${temp.location_id} - ${balanceResult.message}`
              );

              // Update plant stock balance
              const plantBalanceResult = await updatePlantStockBalance(
                item.material_id,
                baseQty,
                gdItem.plant_id.id,
                temp.batch_id
              );

              if (!plantBalanceResult.success) {
                console.warn(
                  `Plant balance update warning for ${item.material_id}: ${plantBalanceResult.message}`
                );
              } else {
                console.log(
                  `Plant balance updated: ${item.material_id} - ${plantBalanceResult.message}`
                );
              }
            }
          }

          // Update goods delivery status to Completed
          await db.collection("goods_delivery").doc(gdItem.id).update({
            gd_status: "Completed",
          });

          // Update related sales orders with enhanced delivery status tracking
          for (const soItem of gdItem.so_id) {
            const soUpdateResult = await updateSalesOrderStatus(
              soItem.id,
              gdItem.delivery_no,
              "Completed"
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
          this.$message.error(
            `Error completing ${gdItem.delivery_no}: ${error.message}. Please check inventory levels.`
          );
        } finally {
          // Reset processing flag for this GD
          window.isProcessing = false;
        }
      }

      this.$message.success(
        `Successfully completed ${goodsDeliveryData.length} goods delivery(s).`
      );
      this.refresh();
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error("Bulk completion error:", error);
    this.$message.error("An error occurred during bulk completion.");
  }
})();
