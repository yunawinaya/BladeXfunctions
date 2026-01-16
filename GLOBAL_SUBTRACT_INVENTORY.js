const processBalanceTable = async (
  data,
  isUpdate,
  plantId,
  organizationId,
  gdStatus,
  isGDPP
) => {
  console.log("Processing balance table with grouped movements");
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

      const isBatchManagedItem = itemData.item_batch_management === 1;

      const temporaryData = parseJsonSafely(item.temp_qty_data);
      const prevTempData = isUpdate
        ? parseJsonSafely(item.prev_temp_qty_data)
        : null;

      if (
        temporaryData.length > 0 ||
        (isUpdate && prevTempData && prevTempData.length > 0)
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

        // IMPORTANT: For update mode, also create groups from prevTempData if they don't exist in current data
        // This ensures we can release reserved quantities for items reduced to 0
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

          itemBalanceParams.location_id = group.location_id;

          if (group.batch_id) {
            itemBalanceParams.batch_id = group.batch_id;
            balanceCollection = "item_batch_balance";
          } else {
            balanceCollection = "item_balance";
          }

          if (existingDoc && existingDoc.id) {
            // Get current balance quantities (from representative document)
            let currentUnrestrictedQty = roundQty(
              parseFloat(existingDoc.unrestricted_qty || 0)
            );
            let currentReservedQty = roundQty(
              parseFloat(existingDoc.reserved_qty || 0)
            );
            let currentBalanceQty = roundQty(
              parseFloat(existingDoc.balance_quantity || 0)
            );

            console.log(`  Unrestricted: ${currentUnrestrictedQty}`);
            console.log(`  Reserved: ${currentReservedQty}`);
            console.log(`  Total Balance: ${currentBalanceQty}`);

            // Smart movement logic based on status and available quantities
            // For Created status OR GDPP Draft→Completed, we need to move OUT from Reserved
            if (gdStatus === "Created" || isGDPP) {
              // For Created status or GDPP, we need to move OUT from Reserved
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

              // Only create movements if baseQty > 0
              if (baseQty > 0 && availableReservedForThisGD >= baseQty) {
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
              } else if (baseQty > 0) {
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
                  // For GDPP, keep unused reserved in PP (do NOT return to Unrestricted)
                  // For regular GD, return unused reserved to Unrestricted
                  if (!isGDPP) {
                    console.log(
                      `Regular GD: Releasing ${unusedReservedQty} unused reserved quantity back to unrestricted for group ${groupKey}`
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
                  } else {
                    console.log(
                      `GDPP Mode: Keeping ${unusedReservedQty} unused reserved in Picking Plan (not returning to Unrestricted) for group ${groupKey}`
                    );
                  }
                }
              }
            } else if (baseQty > 0) {
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

            if (existingDoc && existingDoc.id) {
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

              // For Created status OR GDPP Draft→Completed, use Reserved deduction logic
              if (gdStatus === "Created" || isGDPP) {
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

                  // Handle unused reservations - but NOT for GDPP (keep in PP)
                  if (!isGDPP && isUpdate && prevBaseQty > 0) {
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

                  // For Created status OR GDPP Draft→Completed, use Reserved deduction logic
                  if (gdStatus === "Created" || isGDPP) {
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

                      // Handle unused reservations - but NOT for GDPP (keep in PP)
                      if (!isGDPP && isUpdate && prevBaseQty > 0) {
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
          // Skip if baseQty is 0 (item removed from GD)
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
                item,
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
