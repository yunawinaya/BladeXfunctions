(async () => {
  // Extract input parameters
  const data = this.getValues();
  const { rowIndex } = arguments[0];
  const quantity = data.table_gd[rowIndex].gd_qty;

  // Initialize processing queue and global state
  if (!window.pickingProcessingQueue) {
    window.pickingProcessingQueue = [];
    window.isProcessing = false;
    window.globalAllocationTracker = new Map();
  }

  // Queue this processing request
  return new Promise((resolve, reject) => {
    window.pickingProcessingQueue.push({
      rowIndex,
      quantity,
      data,
      resolve,
      reject,
      context: this, // Store 'this' context for setData
    });

    // Start processing if not already running
    processQueue();
  });

  async function processQueue() {
    if (window.isProcessing) return;

    window.isProcessing = true;

    while (window.pickingProcessingQueue.length > 0) {
      const request = window.pickingProcessingQueue.shift();

      try {
        console.log(`Processing row ${request.rowIndex} from queue`);
        await processRowSequentially(request);
        request.resolve();
      } catch (error) {
        console.error(`Error processing row ${request.rowIndex}:`, error);
        request.reject(error);
      }
    }

    window.isProcessing = false;
  }

  async function processRowSequentially(request) {
    const { rowIndex, quantity, data, context } = request;

    // Retrieve values from context
    const orderedQty = data.table_gd[rowIndex].gd_order_quantity;
    const initialDeliveredQty =
      data.table_gd[rowIndex].gd_initial_delivered_qty;
    const uomId = data.table_gd[rowIndex].gd_order_uom_id;
    const itemCode = data.table_gd[rowIndex].material_id;
    const itemDesc = data.table_gd[rowIndex].gd_material_desc;
    const plantId = data.plant_id;

    // Calculate undelivered quantity
    const undeliveredQty = orderedQty - initialDeliveredQty;
    const totalDeliveredQty = quantity + initialDeliveredQty;

    // Helper function to get current allocations for a material
    const getCurrentAllocations = (materialId, currentRowIndex) => {
      const materialAllocations =
        window.globalAllocationTracker.get(materialId) || new Map();
      const allocatedQuantities = new Map();

      console.log(
        `Row ${currentRowIndex}: Getting current allocations for material ${materialId}`
      );

      // Get allocations from global tracker (excluding current row)
      materialAllocations.forEach((rowAllocations, rIdx) => {
        if (rIdx !== currentRowIndex) {
          rowAllocations.forEach((quantity, locationKey) => {
            const currentAllocated = allocatedQuantities.get(locationKey) || 0;
            allocatedQuantities.set(locationKey, currentAllocated + quantity);
            console.log(
              `Row ${currentRowIndex}: Found allocation from row ${rIdx} for ${locationKey} = ${quantity}`
            );
          });
        }
      });

      const totalAllocated = Array.from(allocatedQuantities.values()).reduce(
        (sum, qty) => sum + qty,
        0
      );
      console.log(
        `Row ${currentRowIndex}: Total allocated quantities:`,
        Object.fromEntries(allocatedQuantities)
      );
      console.log(
        `Row ${currentRowIndex}: Total quantity allocated by others: ${totalAllocated}`
      );

      return allocatedQuantities;
    };

    // Helper function to update global allocations
    const updateGlobalAllocations = (materialId, rowIndex, allocations) => {
      if (!window.globalAllocationTracker.has(materialId)) {
        window.globalAllocationTracker.set(materialId, new Map());
      }

      const materialAllocations =
        window.globalAllocationTracker.get(materialId);
      const rowAllocations = new Map();

      allocations.forEach((allocation) => {
        const key = allocation.batchData
          ? `${allocation.balance.location_id}-${allocation.batchData.id}`
          : `${allocation.balance.location_id}`;
        rowAllocations.set(key, allocation.quantity);
      });

      materialAllocations.set(rowIndex, rowAllocations);

      console.log(
        `Row ${rowIndex}: Updated global allocations for material ${materialId}:`,
        Object.fromEntries(rowAllocations)
      );
    };

    // Apply cross-row allocations to balance data
    const applyAllocationsToBalances = (
      balances,
      allocatedQuantities,
      isBatchManaged
    ) => {
      return balances.map((balance) => {
        const key = isBatchManaged
          ? `${balance.location_id}-${balance.batch_id || "no_batch"}`
          : `${balance.location_id}`;

        const allocatedFromOthers = allocatedQuantities.get(key) || 0;
        const originalUnrestrictedQty = balance.unrestricted_qty || 0;
        const adjustedUnrestrictedQty = Math.max(
          0,
          originalUnrestrictedQty - allocatedFromOthers
        );

        console.log(
          `Row ${rowIndex}: Location ${key}: Original=${originalUnrestrictedQty}, Allocated by others=${allocatedFromOthers}, Available=${adjustedUnrestrictedQty}`
        );

        return {
          ...balance,
          unrestricted_qty: adjustedUnrestrictedQty,
          original_unrestricted_qty: originalUnrestrictedQty,
        };
      });
    };

    // Get UOM data
    const getUOMData = async (uomId) => {
      if (!uomId) return "";
      try {
        const uomResult = await db
          .collection("unit_of_measurement")
          .where({ id: uomId })
          .get();
        return uomResult?.data?.[0]?.uom_name || "";
      } catch (error) {
        console.error("Error fetching UOM data:", error);
        return "";
      }
    };

    // Get picking setup configuration
    const getPickingSetup = async (plantId) => {
      try {
        const pickingSetupResponse = await db
          .collection("picking_setup")
          .where({ plant_id: plantId, movement_type: "Good Delivery" })
          .get();

        if (!pickingSetupResponse?.data?.length) {
          console.error("Picking setup not found for plant:", plantId);
          return null;
        }

        return pickingSetupResponse.data[0];
      } catch (error) {
        console.error("Error fetching picking setup:", error);
        return null;
      }
    };

    // Get default bin for item
    const getDefaultBin = (itemData, plantId) => {
      if (!itemData.table_default_bin?.length) return null;

      const defaultBinEntry = itemData.table_default_bin.find(
        (bin) => bin.plant_id === plantId
      );

      return defaultBinEntry?.bin_location || null;
    };

    // Get bin location details
    const getBinLocationDetails = async (locationId) => {
      try {
        const binLocationResult = await db
          .collection("bin_location")
          .where({
            id: locationId,
            is_deleted: 0,
          })
          .get();

        if (!binLocationResult?.data?.length) {
          console.error("Bin location not found for ID:", locationId);
          return null;
        }

        return binLocationResult.data[0];
      } catch (error) {
        console.error("Error fetching bin location:", error);
        return null;
      }
    };

    // Fixed Bin Strategy
    const processFixedBinStrategy = async (
      balances,
      defaultBin,
      requiredQty,
      isBatchManaged = false,
      batchData = null
    ) => {
      const allocations = [];
      let remainingQty = requiredQty;

      const defaultBinBalance = balances.find(
        (balance) => balance.location_id === defaultBin
      );

      if (defaultBinBalance) {
        const availableQty = defaultBinBalance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, availableQty);

        if (allocatedQty > 0) {
          const binDetails = await getBinLocationDetails(
            defaultBinBalance.location_id
          );
          if (binDetails) {
            allocations.push({
              balance: defaultBinBalance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: isBatchManaged ? batchData : null,
            });
            remainingQty -= allocatedQty;
            console.log(
              `Row ${rowIndex}: Fixed bin allocation: ${allocatedQty} from ${binDetails.bin_location_combine} (available: ${availableQty})`
            );
          }
        } else {
          console.log(
            `Row ${rowIndex}: Default bin ${defaultBin} has no available quantity (${availableQty})`
          );
        }
      } else {
        console.log(
          `Row ${rowIndex}: Default bin not found in available balances`
        );
      }

      return { allocations, remainingQty };
    };

    // Random Strategy
    const processRandomStrategy = async (
      balances,
      excludeLocationId,
      requiredQty,
      isBatchManaged = false,
      batchData = null
    ) => {
      const allocations = [];
      let remainingQty = requiredQty;

      const availableBalances = balances.filter(
        (balance) =>
          balance.location_id !== excludeLocationId &&
          (balance.unrestricted_qty || 0) > 0
      );

      availableBalances.sort(
        (a, b) => balances.indexOf(a) - balances.indexOf(b)
      );

      console.log(
        `Row ${rowIndex}: Random strategy: ${availableBalances.length} locations available for ${requiredQty} qty`
      );

      for (const balance of availableBalances) {
        if (remainingQty <= 0) break;

        const availableQty = balance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, availableQty);

        if (allocatedQty > 0) {
          const binDetails = await getBinLocationDetails(balance.location_id);
          if (binDetails) {
            allocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: isBatchManaged ? batchData : null,
            });
            remainingQty -= allocatedQty;
            console.log(
              `Row ${rowIndex}: Random allocation: ${allocatedQty} from ${binDetails.bin_location_combine} (available: ${availableQty})`
            );
          }
        }
      }

      if (remainingQty > 0) {
        console.warn(
          `Row ${rowIndex}: Could not fully allocate ${requiredQty} qty. Remaining: ${remainingQty}`
        );
      }

      return { allocations, remainingQty };
    };

    // Manual Strategy
    const processManualStrategy = async (
      balances,
      requiredQty,
      isBatchManaged = false,
      batchData = null
    ) => {
      const allocations = [];

      if (balances.length !== 1) {
        console.error(
          `Row ${rowIndex}: Manual picking requires exactly one balance entry, found:`,
          balances.length
        );
        return { allocations: [], remainingQty: requiredQty };
      }

      const balance = balances[0];
      const binDetails = await getBinLocationDetails(balance.location_id);

      if (binDetails) {
        allocations.push({
          balance: balance,
          quantity: requiredQty,
          binLocation: binDetails.bin_location_combine,
          batchData: isBatchManaged ? batchData : null,
        });
        console.log(
          `Row ${rowIndex}: Manual allocation: ${requiredQty} from ${binDetails.bin_location_combine} (available: ${balance.unrestricted_qty})`
        );
      }

      return { allocations, remainingQty: 0 };
    };

    // Create temporary data and summary from allocations
    const createAllocationResults = (allocations, uomName) => {
      const tempQtyData = [];
      let summaryDetails = [];
      let totalAllocated = 0;

      allocations.forEach((allocation, index) => {
        const temporaryData = {
          material_id: itemCode,
          location_id: allocation.balance.location_id,
          block_qty: allocation.balance.block_qty,
          reserved_qty: allocation.balance.reserved_qty,
          unrestricted_qty:
            allocation.balance.original_unrestricted_qty ||
            allocation.balance.unrestricted_qty,
          qualityinsp_qty: allocation.balance.qualityinsp_qty,
          intransit_qty: allocation.balance.intransit_qty,
          balance_quantity: allocation.balance.balance_quantity,
          plant_id: plantId,
          organization_id: allocation.balance.organization_id,
          is_deleted: 0,
          gd_quantity: allocation.quantity,
        };

        if (allocation.batchData) {
          temporaryData.batch_id = allocation.batchData.id;
        }

        tempQtyData.push(temporaryData);

        let summaryLine = `${index + 1}. ${allocation.binLocation}: ${
          allocation.quantity
        } ${uomName}`;
        if (allocation.batchData) {
          summaryLine += `\n[${allocation.batchData.batch_number}]`;
        }
        summaryDetails.push(summaryLine);
        totalAllocated += allocation.quantity;
      });

      const summary = `Total: ${totalAllocated} ${uomName}\n\nDETAILS:\n${summaryDetails.join(
        "\n"
      )}`;

      return { tempQtyData, summary };
    };

    // Process non-item code case
    if (!itemCode && itemDesc) {
      if (quantity < 0 || quantity > undeliveredQty) {
        context.setData({
          [`table_gd.${rowIndex}.gd_undelivered_qty`]: 0,
        });
        return;
      }

      const uomName = await getUOMData(uomId);
      context.setData({
        [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
        [`table_gd.${rowIndex}.gd_undelivered_qty`]:
          orderedQty - totalDeliveredQty,
        [`table_gd.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}`,
      });
      return;
    }

    // Process item with batch management
    try {
      // Fetch item data
      const itemResult = await db
        .collection("item")
        .where({ id: itemCode, is_deleted: 0 })
        .get();

      if (!itemResult?.data?.length) {
        console.error("Item not found or deleted");
        return;
      }

      const itemData = itemResult.data[0];
      const uomName = await getUOMData(uomId);

      // Get current allocations for this material
      const allocatedFromOtherRows = getCurrentAllocations(itemCode, rowIndex);

      // Get picking setup
      const pickingSetup = await getPickingSetup(plantId);
      if (!pickingSetup) {
        console.error("Cannot proceed without picking setup");
        return;
      }

      const {
        picking_mode: pickingMode,
        default_strategy_id: defaultStrategy,
        fallback_strategy_id: fallbackStrategy,
      } = pickingSetup;
      const defaultBin = getDefaultBin(itemData, plantId);

      console.log(`Row ${rowIndex}: Picking configuration:`, {
        pickingMode,
        defaultStrategy,
        fallbackStrategy,
        defaultBin,
      });

      let allAllocations = [];

      // Handle batch-managed items
      if (itemData.item_batch_management === 1) {
        const batchResult = await db
          .collection("batch")
          .where({
            material_id: itemData.id,
            is_deleted: 0,
            plant_id: plantId,
          })
          .get();

        if (!batchResult?.data?.length) {
          console.error("No batches found for item");
          return;
        }

        if (pickingMode === "Manual" && batchResult.data.length !== 1) {
          console.error(
            "Manual picking requires exactly one batch, found:",
            batchResult.data.length
          );
          return;
        }

        const batchData = batchResult.data[0];

        let batchBalanceQuery = {
          material_id: itemData.id,
          is_deleted: 0,
        };

        if (pickingMode === "Manual") {
          batchBalanceQuery.batch_id = batchData.id;
        }

        const batchBalanceResult = await db
          .collection("item_batch_balance")
          .where(batchBalanceQuery)
          .get();

        if (!batchBalanceResult?.data?.length) {
          console.error("No batch balance found");
          return;
        }

        const adjustedBalances = applyAllocationsToBalances(
          batchBalanceResult.data,
          allocatedFromOtherRows,
          true
        );

        if (pickingMode === "Manual") {
          const result = await processManualStrategy(
            adjustedBalances,
            quantity,
            true,
            batchData
          );
          allAllocations = result.allocations;
        } else if (pickingMode === "Auto") {
          let remainingQty = quantity;

          if (defaultStrategy === "FIXED BIN") {
            if (defaultBin) {
              const fixedResult = await processFixedBinStrategy(
                adjustedBalances,
                defaultBin,
                remainingQty,
                true,
                batchData
              );
              allAllocations.push(...fixedResult.allocations);
              remainingQty = fixedResult.remainingQty;
            } else {
              console.log(
                `Row ${rowIndex}: No default bin found, using fallback strategy`
              );
              remainingQty = quantity;
            }

            if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
              const randomResult = await processRandomStrategy(
                adjustedBalances,
                defaultBin,
                remainingQty,
                true,
                batchData
              );
              allAllocations.push(...randomResult.allocations);
            }
          } else if (defaultStrategy === "RANDOM") {
            const randomResult = await processRandomStrategy(
              adjustedBalances,
              null,
              remainingQty,
              true,
              batchData
            );
            allAllocations.push(...randomResult.allocations);
          }
        }
      } else if (itemData.item_batch_management === 0) {
        const itemBalanceResult = await db
          .collection("item_balance")
          .where({
            plant_id: plantId,
            material_id: itemCode,
            is_deleted: 0,
          })
          .get();

        if (!itemBalanceResult?.data?.length) {
          console.error("No item balance found");
          return;
        }

        const adjustedBalances = applyAllocationsToBalances(
          itemBalanceResult.data,
          allocatedFromOtherRows,
          false
        );

        if (pickingMode === "Manual") {
          const result = await processManualStrategy(
            adjustedBalances,
            quantity,
            false
          );
          allAllocations = result.allocations;
        } else if (pickingMode === "Auto") {
          let remainingQty = quantity;

          if (defaultStrategy === "FIXED BIN") {
            if (defaultBin) {
              const fixedResult = await processFixedBinStrategy(
                adjustedBalances,
                defaultBin,
                remainingQty,
                false
              );
              allAllocations.push(...fixedResult.allocations);
              remainingQty = fixedResult.remainingQty;
            } else {
              console.log(
                `Row ${rowIndex}: No default bin found, using fallback strategy`
              );
              remainingQty = quantity;
            }

            if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
              const randomResult = await processRandomStrategy(
                adjustedBalances,
                defaultBin,
                remainingQty,
                false
              );
              allAllocations.push(...randomResult.allocations);
            }
          } else if (defaultStrategy === "RANDOM") {
            const randomResult = await processRandomStrategy(
              adjustedBalances,
              null,
              remainingQty,
              false
            );
            allAllocations.push(...randomResult.allocations);
          }
        }
      } else {
        console.error(
          "Invalid item batch management value:",
          itemData.item_batch_management
        );
        return;
      }

      // Update global allocations FIRST
      updateGlobalAllocations(itemCode, rowIndex, allAllocations);

      // Create results from allocations
      const { tempQtyData, summary } = createAllocationResults(
        allAllocations,
        uomName
      );

      console.log(`Row ${rowIndex}: Generated summary:`, summary);
      console.log(`Row ${rowIndex}: Total allocations:`, allAllocations.length);

      // Calculate order limits and undelivered quantity
      let orderLimit = undeliveredQty;
      if (itemData.over_delivery_tolerance > 0) {
        orderLimit =
          undeliveredQty +
          undeliveredQty * (itemData.over_delivery_tolerance / 100);
      }

      let gdUndeliveredQty = 0;
      if (quantity > undeliveredQty) {
        gdUndeliveredQty = 0;
        console.log(
          `Row ${rowIndex}: Quantity ${quantity} exceeds undelivered quantity ${undeliveredQty}`
        );
      } else {
        gdUndeliveredQty = orderedQty - totalDeliveredQty;
      }

      // Update data
      context.setData({
        [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
        [`table_gd.${rowIndex}.gd_undelivered_qty`]: gdUndeliveredQty,
        [`table_gd.${rowIndex}.view_stock`]: summary,
        [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify(tempQtyData),
      });

      console.log(`Row ${rowIndex}: Processing completed successfully`);
    } catch (error) {
      console.error(`Row ${rowIndex}: Error processing item:`, error);
      throw error;
    }
  }
})();
