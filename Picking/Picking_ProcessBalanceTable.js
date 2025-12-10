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

(async () => {
  console.log(
    "Processing balance table with grouped movements (including serialized items)"
  );
  const data = arguments[0].gdData;
  const isUpdate = false;
  const plantId = data.plant_id;
  const organizationId = data.organization_id;
  const gdStatus = "Created";
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
})();
