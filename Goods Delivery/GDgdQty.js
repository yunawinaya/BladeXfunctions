(async () => {
  // Extract input parameters
  const data = this.getValues();
  const { rowIndex } = arguments[0];
  const quantity = data.table_gd[rowIndex].gd_qty;

  // Retrieve values from context
  const orderedQty = data.table_gd[rowIndex].gd_order_quantity;
  const initialDeliveredQty = data.table_gd[rowIndex].gd_initial_delivered_qty;
  const uomId = data.table_gd[rowIndex].gd_order_uom_id;
  const itemCode = data.table_gd[rowIndex].material_id;
  const itemDesc = data.table_gd[rowIndex].gd_material_desc;
  const plantId = data.plant_id;

  // Calculate undelivered quantity
  const undeliveredQty = orderedQty - initialDeliveredQty;

  // Calculate total delivered quantity
  const totalDeliveredQty = quantity + initialDeliveredQty;

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

    // Find the default bin balance
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
            `Fixed bin allocation: ${allocatedQty} from ${binDetails.bin_location_combine}`
          );
        }
      }
    } else {
      console.log("Default bin not found in available balances");
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

    // Filter out the excluded location (already used in fixed bin)
    const availableBalances = balances.filter(
      (balance) =>
        balance.location_id !== excludeLocationId &&
        (balance.unrestricted_qty || 0) > 0
    );

    // Sort by index to maintain consistent order
    availableBalances.sort((a, b) => balances.indexOf(a) - balances.indexOf(b));

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
            `Random allocation: ${allocatedQty} from ${binDetails.bin_location_combine}`
          );
        }
      }
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
        "Manual picking requires exactly one balance entry, found:",
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
        `Manual allocation: ${requiredQty} from ${binDetails.bin_location_combine}`
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
        unrestricted_qty: allocation.balance.unrestricted_qty,
        qualityinsp_qty: allocation.balance.qualityinsp_qty,
        intransit_qty: allocation.balance.intransit_qty,
        balance_quantity: allocation.balance.balance_quantity,
        plant_id: plantId,
        organization_id: allocation.balance.organization_id,
        is_deleted: 0,
        gd_quantity: allocation.quantity,
      };

      // Add batch information for batch-managed items
      if (allocation.batchData) {
        temporaryData.batch_id = allocation.batchData.id;
      }

      tempQtyData.push(temporaryData);

      // Create summary line
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
    // Validate quantity
    if (quantity < 0 || quantity > undeliveredQty) {
      this.setData({
        [`table_gd.${rowIndex}.gd_undelivered_qty`]: 0,
      });
      return;
    }

    const uomName = await getUOMData(uomId);
    this.setData({
      [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
      [`table_gd.${rowIndex}.gd_undelivered_qty`]:
        orderedQty - totalDeliveredQty,
      [`table_gd.${rowIndex}.view_stock`]: `Total: ${quantity} ${uomName}`,
    });
    return;
  }

  // Process item with batch management
  const processItem = async () => {
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

      console.log("Picking configuration:", {
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

        // For manual picking, expect exactly one batch
        if (pickingMode === "Manual" && batchResult.data.length !== 1) {
          console.error(
            "Manual picking requires exactly one batch, found:",
            batchResult.data.length
          );
          return;
        }

        const batchData = batchResult.data[0];

        // Get batch balance based on picking mode
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

        const balances = batchBalanceResult.data;

        // Process based on picking mode and strategy
        if (pickingMode === "Manual") {
          const result = await processManualStrategy(
            balances,
            quantity,
            true,
            batchData
          );
          allAllocations = result.allocations;
        } else if (pickingMode === "Auto") {
          let remainingQty = quantity;

          if (defaultStrategy === "FIXED BIN" && defaultBin) {
            const fixedResult = await processFixedBinStrategy(
              balances,
              defaultBin,
              remainingQty,
              true,
              batchData
            );
            allAllocations.push(...fixedResult.allocations);
            remainingQty = fixedResult.remainingQty;

            // Use fallback strategy for remaining quantity
            if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
              const randomResult = await processRandomStrategy(
                balances,
                defaultBin,
                remainingQty,
                true,
                batchData
              );
              allAllocations.push(...randomResult.allocations);
            }
          } else if (defaultStrategy === "RANDOM") {
            const randomResult = await processRandomStrategy(
              balances,
              null,
              remainingQty,
              true,
              batchData
            );
            allAllocations.push(...randomResult.allocations);
          }
        }
      } else if (itemData.item_batch_management === 0) {
        // Handle non-batch-managed items
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

        const balances = itemBalanceResult.data;

        // Process based on picking mode and strategy
        if (pickingMode === "Manual") {
          const result = await processManualStrategy(balances, quantity, false);
          allAllocations = result.allocations;
        } else if (pickingMode === "Auto") {
          let remainingQty = quantity;

          if (defaultStrategy === "FIXED BIN" && defaultBin) {
            const fixedResult = await processFixedBinStrategy(
              balances,
              defaultBin,
              remainingQty,
              false
            );
            allAllocations.push(...fixedResult.allocations);
            remainingQty = fixedResult.remainingQty;

            // Use fallback strategy for remaining quantity
            if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
              const randomResult = await processRandomStrategy(
                balances,
                defaultBin,
                remainingQty,
                false
              );
              allAllocations.push(...randomResult.allocations);
            }
          } else if (defaultStrategy === "RANDOM") {
            const randomResult = await processRandomStrategy(
              balances,
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

      // Create results from allocations
      const { tempQtyData, summary } = createAllocationResults(
        allAllocations,
        uomName
      );

      console.log("Generated summary:", summary);
      console.log("Total allocations:", allAllocations.length);

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
          `Quantity ${quantity} exceeds undelivered quantity ${undeliveredQty}`
        );
      } else {
        gdUndeliveredQty = orderedQty - totalDeliveredQty;
      }

      // Update data with a small delay to ensure UI synchronization
      setTimeout(() => {
        this.setData({
          [`table_gd.${rowIndex}.gd_delivered_qty`]: totalDeliveredQty,
          [`table_gd.${rowIndex}.gd_undelivered_qty`]: gdUndeliveredQty,
          [`table_gd.${rowIndex}.view_stock`]: summary,
          [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify(tempQtyData),
        });
      }, 100);
    } catch (error) {
      console.error("Error processing item:", error);
    }
  };

  // Execute item processing if plantId exists
  if (plantId) {
    await processItem();
  } else {
    console.error("Plant ID is required for item processing");
  }
})();
