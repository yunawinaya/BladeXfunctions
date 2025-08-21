const checkInventoryWithDuplicates = async (allItems, plantId) => {
  // Group items by material_id to find duplicates
  const materialGroups = {};

  allItems.forEach((item, index) => {
    const materialId = item.itemId;
    if (!materialGroups[materialId]) {
      materialGroups[materialId] = [];
    }
    materialGroups[materialId].push({ ...item, originalIndex: index });
  });

  console.log("Material groups:", materialGroups);

  const insufficientItems = [];

  // Create a flat array of all items that need allocation, sorted by index
  const itemsForAllocation = [];

  // First pass: Set up all item data and determine which items need allocation
  for (const [materialId, items] of Object.entries(materialGroups)) {
    // Skip database call and enable gd_qty if materialId is null
    if (!materialId) {
      console.log(`Skipping item with null materialId`);
      items.forEach((item) => {
        const index = item.originalIndex;
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;
        const undeliveredQty = orderedQty - deliveredQty;

        this.setData({
          [`table_gd.${index}.material_id`]: materialId || "",
          [`table_gd.${index}.material_name`]: item.itemName || "",
          [`table_gd.${index}.gd_material_desc`]: item.sourceItem.so_desc || "",
          [`table_gd.${index}.gd_order_quantity`]: orderedQty,
          [`table_gd.${index}.gd_delivered_qty`]: deliveredQty,
          [`table_gd.${index}.gd_initial_delivered_qty`]: deliveredQty,
          [`table_gd.${index}.gd_order_uom_id`]: item.altUOM,
          [`table_gd.${index}.good_delivery_uom_id`]: item.altUOM,
          [`table_gd.${index}.more_desc`]: item.sourceItem.more_desc || "",
          [`table_gd.${index}.line_remark_1`]:
            item.sourceItem.line_remark_1 || "",
          [`table_gd.${index}.line_remark_2`]:
            item.sourceItem.line_remark_2 || "",
          [`table_gd.${index}.base_uom_id`]: "",
          [`table_gd.${index}.unit_price`]: item.sourceItem.so_item_price || 0,
          [`table_gd.${index}.total_price`]: item.sourceItem.so_amount || 0,
          [`table_gd.${index}.item_costing_method`]: "",
          [`table_gd.${index}.gd_qty`]: undeliveredQty,
        });

        this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
        this.disabled([`table_gd.${index}.gd_qty`], false);
      });
      continue;
    }

    try {
      // Fetch item data
      const res = await db.collection("Item").where({ id: materialId }).get();
      if (!res.data || !res.data.length) {
        console.error(`Item not found: ${materialId}`);
        continue;
      }

      const itemData = res.data[0];

      if (itemData.stock_control === 0 && itemData.show_delivery === 0) {
        console.log(
          `Skipping item ${materialId} due to stock_control or show_delivery settings`
        );
        items.forEach((item) => {
          const index = item.originalIndex;
          const orderedQty = item.orderedQty;
          const deliveredQty = item.deliveredQtyFromSource;
          const undeliveredQty = orderedQty - deliveredQty;

          this.setData({
            [`table_gd.${index}.material_id`]: materialId,
            [`table_gd.${index}.material_name`]: item.itemName,
            [`table_gd.${index}.gd_material_desc`]:
              item.sourceItem.so_desc || "",
            [`table_gd.${index}.gd_order_quantity`]: orderedQty,
            [`table_gd.${index}.gd_delivered_qty`]:
              deliveredQty + undeliveredQty,
            [`table_gd.${index}.gd_initial_delivered_qty`]: deliveredQty,
            [`table_gd.${index}.gd_order_uom_id`]: item.altUOM,
            [`table_gd.${index}.good_delivery_uom_id`]: item.altUOM,
            [`table_gd.${index}.more_desc`]: item.sourceItem.more_desc || "",
            [`table_gd.${index}.line_remark_1`]:
              item.sourceItem.line_remark_1 || "",
            [`table_gd.${index}.line_remark_2`]:
              item.sourceItem.line_remark_2 || "",
            [`table_gd.${index}.base_uom_id`]: itemData.based_uom || "",
            [`table_gd.${index}.unit_price`]:
              item.sourceItem.so_item_price || 0,
            [`table_gd.${index}.total_price`]: item.sourceItem.so_amount || 0,
            [`table_gd.${index}.item_costing_method`]:
              itemData.material_costing_method,
            [`table_gd.${index}.gd_qty`]: undeliveredQty,
            [`table_gd.${index}.gd_undelivered_qty`]: 0,
          });

          if (undeliveredQty <= 0) {
            this.disabled(
              [`table_gd.${index}.gd_qty`, `table_gd.${index}.gd_delivery_qty`],
              true
            );
          } else {
            this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
            this.disabled([`table_gd.${index}.gd_qty`], false);
          }
        });
        continue;
      }

      // Get total available stock for this material based on item type
      let totalUnrestrictedQtyBase = 0;
      let balanceData = [];
      let collectionUsed = "";

      // Determine which collection to use based on item management type
      // Serialized items take priority over batch management
      if (itemData.serial_number_management === 1) {
        // Use item_serial_balance for serialized items
        try {
          const response = await db
            .collection("item_serial_balance")
            .where({ material_id: materialId, plant_id: plantId })
            .get();
          balanceData = response.data || [];
          collectionUsed = "item_serial_balance";

          console.log(`DEBUG - Serial balance for material ${materialId}:`, {
            response: response,
            data: balanceData,
            dataLength: balanceData.length,
          });

          // For serialized items, count available serial numbers
          totalUnrestrictedQtyBase = balanceData.reduce(
            (sum, balance) => sum + (balance.unrestricted_qty || 0),
            0
          );
        } catch (error) {
          console.error(
            `Error fetching serial balance for ${materialId}:`,
            error
          );
          totalUnrestrictedQtyBase = 0;
        }
      } else if (itemData.item_batch_management === 1) {
        // Use item_batch_balance for batch-managed (non-serialized) items
        try {
          const response = await db
            .collection("item_batch_balance")
            .where({ material_id: materialId, plant_id: plantId })
            .get();
          balanceData = response.data || [];
          collectionUsed = "item_batch_balance";

          console.log(`DEBUG - Batch balance for material ${materialId}:`, {
            response: response,
            data: balanceData,
            dataLength: balanceData.length,
          });

          totalUnrestrictedQtyBase = balanceData.reduce(
            (sum, balance) => sum + (balance.unrestricted_qty || 0),
            0
          );
        } catch (error) {
          console.error(
            `Error fetching batch balance for ${materialId}:`,
            error
          );
          totalUnrestrictedQtyBase = 0;
        }
      } else {
        // Use item_balance for regular items
        try {
          const response = await db
            .collection("item_balance")
            .where({ material_id: materialId, plant_id: plantId })
            .get();
          balanceData = response.data || [];
          collectionUsed = "item_balance";

          console.log(`DEBUG - Item balance for material ${materialId}:`, {
            response: response,
            data: balanceData,
            dataLength: balanceData.length,
          });

          totalUnrestrictedQtyBase = balanceData.reduce(
            (sum, balance) => sum + (balance.unrestricted_qty || 0),
            0
          );
        } catch (error) {
          console.error(
            `Error fetching item balance for ${materialId}:`,
            error
          );
          totalUnrestrictedQtyBase = 0;
        }
      }

      console.log(
        `Material ${materialId} using collection: ${collectionUsed}, Available stock: ${totalUnrestrictedQtyBase}`
      );

      // Handle UI controls based on balance data length
      if (balanceData.length === 1) {
        items.forEach((item) => {
          const itemIndex = item.originalIndex;
          this.disabled([`table_gd.${itemIndex}.gd_delivery_qty`], true);
          this.disabled([`table_gd.${itemIndex}.gd_qty`], false);
        });
      }

      // Get picking setup
      const pickingSetupResponse = await db
        .collection("picking_setup")
        .where({ plant_id: plantId, movement_type: "Good Delivery" })
        .get();

      // Handle case where no picking setup exists for the plant
      let pickingMode, defaultStrategy, fallbackStrategy;
      if (!pickingSetupResponse?.data?.length) {
        console.log("No picking setup found for plant, using default values");
        pickingMode = "Manual";
        defaultStrategy = "RANDOM";
        fallbackStrategy = "RANDOM";
      } else {
        const pickingSetup = pickingSetupResponse.data[0];
        pickingMode = pickingSetup.picking_mode || "Manual";
        defaultStrategy = pickingSetup.default_strategy_id || "RANDOM";
        fallbackStrategy = pickingSetup.fallback_strategy_id || "RANDOM";
      }

      // DEBUG: Log picking setup information
      console.log(`DEBUG - Material ${materialId}:`, {
        pickingMode,
        defaultStrategy,
        fallbackStrategy,
        balanceDataLength: balanceData.length,
        balanceData: balanceData,
        isSerialManaged: itemData.serial_number_management === 1,
        isBatchManaged: itemData.item_batch_management === 1,
      });

      // Calculate total demand and set up basic item data
      let totalDemandBase = 0;
      items.forEach((item) => {
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;
        const undeliveredQty = orderedQty - deliveredQty;

        let undeliveredQtyBase = undeliveredQty;
        if (item.altUOM !== itemData.based_uom) {
          const uomConversion = itemData.table_uom_conversion?.find(
            (conv) => conv.alt_uom_id === item.altUOM
          );
          if (uomConversion && uomConversion.base_qty) {
            undeliveredQtyBase = undeliveredQty * uomConversion.base_qty;
          }
        }
        totalDemandBase += undeliveredQtyBase;

        // Set basic item data
        const index = item.originalIndex;
        this.setData({
          [`table_gd.${index}.material_id`]: materialId,
          [`table_gd.${index}.material_name`]: item.itemName,
          [`table_gd.${index}.gd_material_desc`]: item.sourceItem.so_desc || "",
          [`table_gd.${index}.gd_order_quantity`]: orderedQty,
          [`table_gd.${index}.gd_delivered_qty`]: deliveredQty,
          [`table_gd.${index}.gd_initial_delivered_qty`]: deliveredQty,
          [`table_gd.${index}.gd_order_uom_id`]: item.altUOM,
          [`table_gd.${index}.good_delivery_uom_id`]: item.altUOM,
          [`table_gd.${index}.more_desc`]: item.sourceItem.more_desc || "",
          [`table_gd.${index}.line_remark_1`]:
            item.sourceItem.line_remark_1 || "",
          [`table_gd.${index}.line_remark_2`]:
            item.sourceItem.line_remark_2 || "",
          [`table_gd.${index}.base_uom_id`]: itemData.based_uom || "",
          [`table_gd.${index}.unit_price`]: item.sourceItem.so_item_price || 0,
          [`table_gd.${index}.total_price`]: item.sourceItem.so_amount || 0,
          [`table_gd.${index}.item_costing_method`]:
            itemData.material_costing_method,
          [`dialog_insufficient.table_insufficient.${index}.material_id`]:
            materialId,
          [`dialog_insufficient.table_insufficient.${index}.order_quantity`]:
            orderedQty,
        });
      });

      console.log(
        `Material ${materialId}: Available=${totalUnrestrictedQtyBase}, Total Demand=${totalDemandBase}, Line Count=${items.length}, Collection=${collectionUsed}`
      );

      // Handle insufficient vs sufficient stock scenarios
      const totalShortfallBase = totalDemandBase - totalUnrestrictedQtyBase;

      if (totalShortfallBase > 0) {
        console.log(
          `❌ Insufficient stock for material ${materialId}: Shortfall=${totalShortfallBase}`
        );

        // For serialized items, special handling of insufficient stock
        if (itemData.serial_number_management === 1) {
          console.log(`Handling insufficient serialized item: ${materialId}`);

          // For serialized items, convert all quantities to base UOM
          let remainingSerialCount = balanceData.length; // Each serial balance record represents one unit in base UOM

          items.forEach((item) => {
            const index = item.originalIndex;
            const orderedQty = item.orderedQty;
            const deliveredQty = item.deliveredQtyFromSource;
            const undeliveredQty = orderedQty - deliveredQty;

            // Convert ALL quantities to base UOM for serialized items
            const orderedQtyBase = convertToBaseUOM(
              orderedQty,
              item.altUOM,
              itemData
            );
            const deliveredQtyBase = convertToBaseUOM(
              deliveredQty,
              item.altUOM,
              itemData
            );
            const undeliveredQtyBase = convertToBaseUOM(
              undeliveredQty,
              item.altUOM,
              itemData
            );

            let availableQtyBase = 0;
            if (remainingSerialCount > 0 && undeliveredQtyBase > 0) {
              // For serialized items, allocate whole units only in base UOM
              const requiredUnitsBase = Math.floor(undeliveredQtyBase);
              availableQtyBase = Math.min(
                remainingSerialCount,
                requiredUnitsBase
              );
              remainingSerialCount -= availableQtyBase;
            }

            // Update insufficient dialog data (ALL in base UOM for serialized items)
            this.setData({
              [`dialog_insufficient.table_insufficient.${index}.undelivered_qty`]:
                undeliveredQtyBase,
              [`dialog_insufficient.table_insufficient.${index}.available_qty`]:
                availableQtyBase,
              [`dialog_insufficient.table_insufficient.${index}.shortfall_qty`]:
                undeliveredQtyBase - availableQtyBase,
            });

            // Set basic item data with base UOM quantities and UOM
            this.setData({
              [`table_gd.${index}.material_id`]: materialId,
              [`table_gd.${index}.material_name`]: item.itemName,
              [`table_gd.${index}.gd_material_desc`]:
                item.sourceItem.so_desc || "",
              [`table_gd.${index}.gd_order_quantity`]: orderedQtyBase, // Base UOM
              [`table_gd.${index}.gd_delivered_qty`]: deliveredQtyBase, // Base UOM
              [`table_gd.${index}.gd_initial_delivered_qty`]: deliveredQtyBase, // Base UOM
              [`table_gd.${index}.gd_order_uom_id`]: itemData.based_uom, // Base UOM
              [`table_gd.${index}.good_delivery_uom_id`]: itemData.based_uom, // Base UOM
              [`table_gd.${index}.more_desc`]: item.sourceItem.more_desc || "",
              [`table_gd.${index}.line_remark_1`]:
                item.sourceItem.line_remark_1 || "",
              [`table_gd.${index}.line_remark_2`]:
                item.sourceItem.line_remark_2 || "",
              [`table_gd.${index}.base_uom_id`]: itemData.based_uom || "",
              [`table_gd.${index}.unit_price`]:
                item.sourceItem.so_item_price || 0,
              [`table_gd.${index}.total_price`]: item.sourceItem.so_amount || 0,
              [`table_gd.${index}.item_costing_method`]:
                itemData.material_costing_method,
              [`dialog_insufficient.table_insufficient.${index}.material_id`]:
                materialId,
              [`dialog_insufficient.table_insufficient.${index}.order_quantity`]:
                orderedQtyBase, // Base UOM
            });

            if (pickingMode === "Manual") {
              // Manual mode: Set available quantity in base UOM
              this.setData({
                [`table_gd.${index}.gd_qty`]:
                  balanceData.length === 1 ? availableQtyBase : 0,
              });
              console.log(
                `Manual picking mode (serialized): gd_qty set to ${availableQtyBase} ${itemData.based_uom} for row ${index}`
              );
            } else {
              // Auto mode: Check allocation eligibility for serialized items
              const allocationCondition1 = availableQtyBase > 0;
              const allocationCondition2 = balanceData.length === 1;
              const allocationCondition3 = ["FIXED BIN", "RANDOM"].includes(
                defaultStrategy
              );
              const allocationCondition4 = ["FIXED BIN", "RANDOM"].includes(
                fallbackStrategy
              );
              const allocationCondition5 = pickingMode === "Auto";
              const allocationCondition6 =
                allocationCondition3 && allocationCondition4;
              const isEligibleForAllocation =
                allocationCondition1 &&
                (allocationCondition2 ||
                  allocationCondition5 ||
                  allocationCondition6);

              if (isEligibleForAllocation) {
                // Set gd_qty in base UOM
                this.setData({
                  [`table_gd.${index}.gd_qty`]: availableQtyBase,
                });

                // Add to allocation queue with base UOM quantity
                if (materialId) {
                  itemsForAllocation.push({
                    materialId,
                    rowIndex: index,
                    quantity: availableQtyBase, // Base UOM quantity
                    plantId,
                    uomId: itemData.based_uom, // Base UOM
                    isSerializedItem: true,
                  });
                  console.log(
                    `Auto mode (serialized): Added to allocation queue: row ${index}, material ${materialId}, qty ${availableQtyBase} ${itemData.based_uom}`
                  );
                }
              } else {
                this.setData({
                  [`table_gd.${index}.gd_qty`]: 0,
                });
                console.log(
                  `Auto mode (serialized): NOT eligible for allocation: row ${index}, material ${materialId}`
                );
              }
            }
          });
        } else {
          // Handle non-serialized items (existing logic)
          // Distribute available stock proportionally
          let remainingStockBase = Math.max(0, totalUnrestrictedQtyBase);

          items.forEach((item) => {
            const index = item.originalIndex;
            const orderedQty = item.orderedQty;
            const deliveredQty = item.deliveredQtyFromSource;
            const undeliveredQty = orderedQty - deliveredQty;

            let availableQtyAlt = 0;
            if (remainingStockBase > 0 && undeliveredQty > 0) {
              let undeliveredQtyBase = undeliveredQty;
              if (item.altUOM !== itemData.based_uom) {
                const uomConversion = itemData.table_uom_conversion?.find(
                  (conv) => conv.alt_uom_id === item.altUOM
                );
                if (uomConversion && uomConversion.base_qty) {
                  undeliveredQtyBase = undeliveredQty * uomConversion.base_qty;
                }
              }

              const allocatedBase = Math.min(
                remainingStockBase,
                undeliveredQtyBase
              );
              const uomConversion = itemData.table_uom_conversion?.find(
                (conv) => conv.alt_uom_id === item.altUOM
              );
              availableQtyAlt =
                item.altUOM !== itemData.based_uom
                  ? allocatedBase / (uomConversion?.base_qty || 1)
                  : allocatedBase;

              remainingStockBase -= allocatedBase;
            }

            // Update insufficient dialog data
            this.setData({
              [`dialog_insufficient.table_insufficient.${index}.undelivered_qty`]:
                undeliveredQty,
              [`dialog_insufficient.table_insufficient.${index}.available_qty`]:
                availableQtyAlt,
              [`dialog_insufficient.table_insufficient.${index}.shortfall_qty`]:
                undeliveredQty - availableQtyAlt,
            });

            if (pickingMode === "Manual") {
              // Manual mode: Don't set gd_qty, let user manually select
              this.setData({
                [`table_gd.${index}.gd_qty`]:
                  balanceData.length === 1 ? availableQtyAlt : 0,
              });
              console.log(
                `Manual picking mode: gd_qty set to ${
                  availableQtyAlt > 0 ? availableQtyAlt : 0
                } for row ${index} - user must manually select stock`
              );
            } else {
              // Auto mode: Set gd_qty and perform allocation
              const allocationCondition1 = availableQtyAlt > 0;
              const allocationCondition2 = balanceData.length === 1;
              const allocationCondition3 = ["FIXED BIN", "RANDOM"].includes(
                defaultStrategy
              );
              const allocationCondition4 = ["FIXED BIN", "RANDOM"].includes(
                fallbackStrategy
              );
              const allocationCondition5 = pickingMode === "Auto";
              const allocationCondition6 =
                allocationCondition3 && allocationCondition4;
              const isEligibleForAllocation =
                allocationCondition1 &&
                (allocationCondition2 ||
                  allocationCondition5 ||
                  allocationCondition6);

              if (isEligibleForAllocation) {
                this.setData({
                  [`table_gd.${index}.gd_qty`]: availableQtyAlt,
                });

                // Add to allocation queue
                if (materialId) {
                  itemsForAllocation.push({
                    materialId,
                    rowIndex: index,
                    quantity: availableQtyAlt,
                    plantId,
                    uomId: item.altUOM,
                    isSerializedItem: false,
                  });
                  console.log(
                    `Auto mode: Added to allocation queue: row ${index}, material ${materialId}, qty ${availableQtyAlt}`
                  );
                }
              } else {
                this.setData({
                  [`table_gd.${index}.gd_qty`]: 0,
                });
                console.log(
                  `Auto mode: NOT eligible for allocation: row ${index}, material ${materialId}`
                );
              }
            }
          });
        }

        insufficientItems.push({
          itemId: materialId,
          itemName: items[0].itemName,
          soNo: items.map((item) => item.so_no).join(", "),
          lineCount: items.length,
        });
      } else {
        console.log(
          `✅ Sufficient stock for material ${materialId}: Available=${totalUnrestrictedQtyBase}, Demand=${totalDemandBase}`
        );

        items.forEach((item) => {
          const index = item.originalIndex;
          const orderedQty = item.orderedQty;
          const deliveredQty = item.deliveredQtyFromSource;
          const undeliveredQty = orderedQty - deliveredQty;

          if (undeliveredQty <= 0) {
            this.disabled(
              [`table_gd.${index}.gd_qty`, `table_gd.${index}.gd_delivery_qty`],
              true
            );
            this.setData({
              [`table_gd.${index}.gd_qty`]: 0,
            });
          } else {
            // For serialized items, convert all quantities to base UOM
            if (itemData.serial_number_management === 1) {
              const orderedQtyBase = convertToBaseUOM(
                orderedQty,
                item.altUOM,
                itemData
              );
              const deliveredQtyBase = convertToBaseUOM(
                deliveredQty,
                item.altUOM,
                itemData
              );
              const undeliveredQtyBase = convertToBaseUOM(
                undeliveredQty,
                item.altUOM,
                itemData
              );

              // Set basic item data with base UOM quantities and UOM
              this.setData({
                [`table_gd.${index}.material_id`]: materialId,
                [`table_gd.${index}.material_name`]: item.itemName,
                [`table_gd.${index}.gd_material_desc`]:
                  item.sourceItem.so_desc || "",
                [`table_gd.${index}.gd_order_quantity`]: orderedQtyBase, // Base UOM
                [`table_gd.${index}.gd_delivered_qty`]: deliveredQtyBase, // Base UOM
                [`table_gd.${index}.gd_initial_delivered_qty`]:
                  deliveredQtyBase, // Base UOM
                [`table_gd.${index}.gd_order_uom_id`]: itemData.based_uom, // Base UOM
                [`table_gd.${index}.good_delivery_uom_id`]: itemData.based_uom, // Base UOM
                [`table_gd.${index}.more_desc`]:
                  item.sourceItem.more_desc || "",
                [`table_gd.${index}.line_remark_1`]:
                  item.sourceItem.line_remark_1 || "",
                [`table_gd.${index}.line_remark_2`]:
                  item.sourceItem.line_remark_2 || "",
                [`table_gd.${index}.base_uom_id`]: itemData.based_uom || "",
                [`table_gd.${index}.unit_price`]:
                  item.sourceItem.so_item_price || 0,
                [`table_gd.${index}.total_price`]:
                  item.sourceItem.so_amount || 0,
                [`table_gd.${index}.item_costing_method`]:
                  itemData.material_costing_method,
              });

              if (pickingMode === "Manual") {
                // Manual mode: Set quantity in base UOM
                this.setData({
                  [`table_gd.${index}.gd_qty`]:
                    balanceData.length === 1 ? undeliveredQtyBase : 0,
                });
                console.log(
                  `Manual picking mode (serialized): gd_qty set to ${
                    balanceData.length === 1 ? undeliveredQtyBase : 0
                  } ${itemData.based_uom} for row ${index}`
                );
              } else {
                // Auto mode: Set gd_qty in base UOM and check for allocation eligibility
                this.setData({
                  [`table_gd.${index}.gd_qty`]: undeliveredQtyBase,
                });

                // Add to allocation queue if eligible
                const allocationCondition1 = materialId;
                const allocationCondition2 = balanceData.length === 1;
                const allocationCondition3 = ["FIXED BIN", "RANDOM"].includes(
                  defaultStrategy
                );
                const allocationCondition4 = ["FIXED BIN", "RANDOM"].includes(
                  fallbackStrategy
                );
                const allocationCondition5 = pickingMode === "Auto";
                const allocationCondition6 =
                  allocationCondition3 && allocationCondition4;
                const isEligibleForAllocation =
                  allocationCondition1 &&
                  (allocationCondition2 ||
                    allocationCondition5 ||
                    allocationCondition6);

                if (isEligibleForAllocation) {
                  itemsForAllocation.push({
                    materialId,
                    rowIndex: index,
                    quantity: undeliveredQtyBase, // Base UOM quantity
                    plantId,
                    uomId: itemData.based_uom, // Base UOM
                    isSerializedItem: true,
                  });
                  console.log(
                    `Auto mode (serialized): Added to allocation queue (sufficient): row ${index}, material ${materialId}, qty ${undeliveredQtyBase} ${itemData.based_uom}`
                  );
                }
              }
            } else {
              // Non-serialized items keep original logic
              if (pickingMode === "Manual") {
                this.setData({
                  [`table_gd.${index}.gd_qty`]:
                    balanceData.length === 1 ? undeliveredQty : 0,
                });
              } else {
                this.setData({
                  [`table_gd.${index}.gd_qty`]: undeliveredQty,
                });

                const allocationCondition1 = materialId;
                const allocationCondition2 = balanceData.length === 1;
                const allocationCondition3 = ["FIXED BIN", "RANDOM"].includes(
                  defaultStrategy
                );
                const allocationCondition4 = ["FIXED BIN", "RANDOM"].includes(
                  fallbackStrategy
                );
                const allocationCondition5 = pickingMode === "Auto";
                const allocationCondition6 =
                  allocationCondition3 && allocationCondition4;
                const isEligibleForAllocation =
                  allocationCondition1 &&
                  (allocationCondition2 ||
                    allocationCondition5 ||
                    allocationCondition6);

                if (isEligibleForAllocation) {
                  itemsForAllocation.push({
                    materialId,
                    rowIndex: index,
                    quantity: undeliveredQty,
                    plantId,
                    uomId: item.altUOM,
                    isSerializedItem: false,
                  });
                }
              }
            }
          }
        });
      }
    } catch (error) {
      console.error(`Error processing material ${materialId}:`, error);
    }
  }

  // Second pass: Process all allocations sequentially by row index
  console.log(
    `Processing ${itemsForAllocation.length} items for allocation sequentially...`
  );

  // DEBUG: Log detailed allocation queue information
  console.log(`DEBUG - Allocation queue details:`, {
    totalItems: itemsForAllocation.length,
    items: itemsForAllocation.map((item) => ({
      materialId: item.materialId,
      rowIndex: item.rowIndex,
      quantity: item.quantity,
      plantId: item.plantId,
      uomId: item.uomId,
      isSerializedItem: item.isSerializedItem,
    })),
  });

  // Sort by row index to ensure consistent processing order
  itemsForAllocation.sort((a, b) => a.rowIndex - b.rowIndex);

  for (const allocationItem of itemsForAllocation) {
    console.log(`Processing allocation for row ${allocationItem.rowIndex}`);
    await performAutomaticAllocation(
      allocationItem.materialId,
      allocationItem.rowIndex,
      allocationItem.quantity,
      allocationItem.plantId,
      allocationItem.uomId,
      allocationItem.isSerializedItem
    );
  }

  console.log("All allocations completed sequentially");
  return insufficientItems;
};

// Helper function to convert quantity from alt UOM to base UOM
const convertToBaseUOM = (quantity, altUOM, itemData) => {
  if (!altUOM || altUOM === itemData.based_uom) {
    return quantity;
  }

  const uomConversion = itemData.table_uom_conversion?.find(
    (conv) => conv.alt_uom_id === altUOM
  );

  if (uomConversion && uomConversion.base_qty) {
    return quantity * uomConversion.base_qty;
  }

  return quantity;
};

const performAutomaticAllocation = async (
  materialId,
  rowIndex,
  quantity,
  plantId,
  uomId,
  isSerializedItem = false
) => {
  try {
    console.log(
      `Auto-allocating for row ${rowIndex}, material ${materialId}, quantity ${quantity}, serialized=${isSerializedItem}`
    );

    // Get current allocations for this material from previous rows
    const getCurrentAllocations = (materialId, currentRowIndex) => {
      const materialAllocations =
        window.globalAllocationTracker.get(materialId) || new Map();
      const allocatedQuantities = new Map();

      // Get allocations from global tracker (excluding current row)
      materialAllocations.forEach((rowAllocations, rIdx) => {
        if (rIdx !== currentRowIndex) {
          rowAllocations.forEach((qty, locationKey) => {
            const currentAllocated = allocatedQuantities.get(locationKey) || 0;
            allocatedQuantities.set(locationKey, currentAllocated + qty);
          });
        }
      });

      return allocatedQuantities;
    };

    // Apply cross-row allocations to balance data
    const applyAllocationsToBalances = (
      balances,
      allocatedQuantities,
      isSerialManaged,
      isBatchManaged
    ) => {
      return balances.map((balance) => {
        let key;
        if (isSerialManaged) {
          // For serialized items, use serial number as key
          if (isBatchManaged) {
            key = `${balance.location_id || balance.bin_location_id}-${
              balance.serial_number || "no_serial"
            }-${balance.batch_id || "no_batch"}`;
          } else {
            key = `${balance.location_id || balance.bin_location_id}-${
              balance.serial_number || "no_serial"
            }`;
          }
        } else if (isBatchManaged) {
          key = `${balance.location_id}-${balance.batch_id || "no_batch"}`;
        } else {
          key = `${balance.location_id}`;
        }

        const allocatedFromOthers = allocatedQuantities.get(key) || 0;
        const originalUnrestrictedQty = balance.unrestricted_qty || 0;
        const adjustedUnrestrictedQty = Math.max(
          0,
          originalUnrestrictedQty - allocatedFromOthers
        );

        return {
          ...balance,
          unrestricted_qty: adjustedUnrestrictedQty,
          original_unrestricted_qty: originalUnrestrictedQty,
        };
      });
    };

    // Get picking setup
    const pickingSetupResponse = await db
      .collection("picking_setup")
      .where({ plant_id: plantId, movement_type: "Good Delivery" })
      .get();

    let pickingMode, defaultStrategy, fallbackStrategy;
    if (!pickingSetupResponse?.data?.length) {
      console.log("No picking setup found, using default values");
      pickingMode = "Manual";
      defaultStrategy = "RANDOM";
    } else {
      pickingMode = pickingSetupResponse.data[0].picking_mode;
      defaultStrategy = pickingSetupResponse.data[0].default_strategy_id;
      fallbackStrategy = pickingSetupResponse.data[0].fallback_strategy_id;
    }

    // Only proceed with auto-allocation for Auto picking mode
    if (pickingMode !== "Auto") {
      console.log(`Picking mode is ${pickingMode}, skipping auto-allocation`);
      return;
    }

    // Fetch item data
    const itemResult = await db
      .collection("Item")
      .where({ id: materialId, is_deleted: 0 })
      .get();

    if (!itemResult?.data?.length) {
      console.log("Item not found, skipping auto-allocation");
      return;
    }

    const itemData = itemResult.data[0];

    // Get default bin for item
    const getDefaultBin = (itemData, plantId) => {
      if (!itemData.table_default_bin?.length) return null;
      const defaultBinEntry = itemData.table_default_bin.find(
        (bin) => bin.plant_id === plantId
      );
      return defaultBinEntry?.bin_location || null;
    };

    const defaultBin = getDefaultBin(itemData, plantId);

    // Get current allocations for this material
    const allocatedFromOtherRows = getCurrentAllocations(materialId, rowIndex);

    let allAllocations = [];

    // Handle serialized items - takes priority over batch management
    if (itemData.serial_number_management === 1) {
      console.log(`Processing serialized item allocation for ${materialId}`);

      // Get serial balance data
      const serialBalanceResult = await db
        .collection("item_serial_balance")
        .where({
          material_id: itemData.id,
          plant_id: plantId,
          is_deleted: 0,
        })
        .get();

      if (!serialBalanceResult?.data?.length) {
        console.log("No serial balance found");
        return;
      }

      // Get batch data if item also has batch management
      let batchDataArray = null;
      if (itemData.item_batch_management === 1) {
        const batchResult = await db
          .collection("batch")
          .where({
            material_id: itemData.id,
            is_deleted: 0,
            plant_id: plantId,
          })
          .get();
        batchDataArray = batchResult?.data || [];
      }

      const adjustedBalances = applyAllocationsToBalances(
        serialBalanceResult.data,
        allocatedFromOtherRows,
        true, // isSerialManaged
        itemData.item_batch_management === 1 // isBatchManaged
      );

      // Process allocation for serialized items
      allAllocations = await processAutoAllocationForSerializedItems(
        adjustedBalances,
        defaultBin,
        quantity,
        defaultStrategy,
        fallbackStrategy,
        itemData.item_batch_management === 1,
        batchDataArray
      );
    }
    // Handle batch-managed items (non-serialized)
    else if (itemData.item_batch_management === 1) {
      console.log(`Processing batch item allocation for ${materialId}`);

      // Get ALL batches for this material
      const batchResult = await db
        .collection("batch")
        .where({
          material_id: itemData.id,
          is_deleted: 0,
          plant_id: plantId,
        })
        .get();

      if (!batchResult?.data?.length) {
        console.log("No batches found for item");
        return;
      }

      // Get all batch balances
      const batchBalanceResult = await db
        .collection("item_batch_balance")
        .where({
          material_id: itemData.id,
          plant_id: plantId,
          is_deleted: 0,
        })
        .get();

      if (!batchBalanceResult?.data?.length) {
        console.log("No batch balance found");
        return;
      }

      const adjustedBalances = applyAllocationsToBalances(
        batchBalanceResult.data,
        allocatedFromOtherRows,
        false, // isSerialManaged
        true // isBatchManaged
      );

      // Process allocation with ALL batch data
      allAllocations = await processAutoAllocation(
        adjustedBalances,
        defaultBin,
        quantity,
        defaultStrategy,
        fallbackStrategy,
        true,
        batchResult.data
      );
    }
    // Handle regular items (non-batch, non-serialized)
    else {
      console.log(`Processing regular item allocation for ${materialId}`);

      const itemBalanceResult = await db
        .collection("item_balance")
        .where({
          plant_id: plantId,
          material_id: materialId,
          is_deleted: 0,
        })
        .get();

      if (!itemBalanceResult?.data?.length) {
        console.log("No item balance found");
        return;
      }

      const adjustedBalances = applyAllocationsToBalances(
        itemBalanceResult.data,
        allocatedFromOtherRows,
        false, // isSerialManaged
        false // isBatchManaged
      );

      allAllocations = await processAutoAllocation(
        adjustedBalances,
        defaultBin,
        quantity,
        defaultStrategy,
        fallbackStrategy,
        false
      );
    }

    // Update global allocations
    if (!window.globalAllocationTracker.has(materialId)) {
      window.globalAllocationTracker.set(materialId, new Map());
    }

    const materialAllocations = window.globalAllocationTracker.get(materialId);
    const rowAllocations = new Map();

    allAllocations.forEach((allocation) => {
      let key;
      if (isSerializedItem) {
        // For serialized items
        if (itemData.item_batch_management === 1) {
          key = `${
            allocation.balance.location_id || allocation.balance.bin_location_id
          }-${allocation.serialNumber}-${
            allocation.batchData?.id || "no_batch"
          }`;
        } else {
          key = `${
            allocation.balance.location_id || allocation.balance.bin_location_id
          }-${allocation.serialNumber}`;
        }
      } else if (allocation.batchData) {
        // For batch items
        key = `${allocation.balance.location_id}-${allocation.batchData.id}`;
      } else {
        // For regular items
        key = `${allocation.balance.location_id}`;
      }
      rowAllocations.set(key, allocation.quantity);
    });

    materialAllocations.set(rowIndex, rowAllocations);

    // Create temp_qty_data and summary
    const tempQtyData = allAllocations.map((allocation) => {
      const baseData = {
        material_id: materialId,
        location_id:
          allocation.balance.location_id || allocation.balance.bin_location_id,
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

      // Add serial number for serialized items
      if (isSerializedItem && allocation.serialNumber) {
        baseData.serial_number = allocation.serialNumber;
      }

      // Add batch data if present
      if (allocation.batchData) {
        baseData.batch_id = allocation.batchData.id;
      }

      return baseData;
    });

    // Get UOM name for summary
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

    const uomName = await getUOMData(uomId);

    const summaryDetails = allAllocations.map((allocation, index) => {
      let summaryLine = `${index + 1}. ${allocation.binLocation}: ${
        allocation.quantity
      } ${uomName}`;

      // Add serial number to summary for serialized items
      if (isSerializedItem && allocation.serialNumber) {
        summaryLine += `\n[Serial: ${allocation.serialNumber}]`;
      }

      // Add batch information if present
      if (allocation.batchData) {
        summaryLine += `\n[Batch: ${allocation.batchData.batch_number}]`;
      }

      return summaryLine;
    });

    const totalAllocated = allAllocations.reduce(
      (sum, alloc) => sum + alloc.quantity,
      0
    );
    const summary = `Total: ${totalAllocated} ${uomName}\n\nDETAILS:\n${summaryDetails.join(
      "\n"
    )}`;

    const deliveredQty = this.getValue(
      `table_gd.${rowIndex}.gd_initial_delivered_qty`
    );
    const undeliveredQty = this.getValue(
      `table_gd.${rowIndex}.gd_undelivered_qty`
    );

    // Update the row data with allocation results
    this.setData({
      [`table_gd.${rowIndex}.view_stock`]: summary,
      [`table_gd.${rowIndex}.temp_qty_data`]: JSON.stringify(tempQtyData),
      [`table_gd.${rowIndex}.gd_delivered_qty`]: deliveredQty + totalAllocated,
      [`table_gd.${rowIndex}.gd_undelivered_qty`]:
        undeliveredQty - totalAllocated,
    });

    console.log(
      `Auto-allocation completed for row ${rowIndex}: ${allAllocations.length} allocations, serialized=${isSerializedItem}`
    );
  } catch (error) {
    console.error(`Error in auto-allocation for row ${rowIndex}:`, error);
  }
};

// New helper function for serialized item allocation
const processAutoAllocationForSerializedItems = async (
  balances,
  defaultBin,
  quantity,
  defaultStrategy,
  fallbackStrategy,
  isBatchManaged,
  batchDataArray = null
) => {
  let allAllocations = [];
  let remainingQty = Math.floor(quantity); // Serialized items are allocated in whole units

  // Get bin location details
  const getBinLocationDetails = async (locationId) => {
    try {
      const binLocationResult = await db
        .collection("bin_location")
        .where({ id: locationId, is_deleted: 0 })
        .get();
      return binLocationResult?.data?.[0] || null;
    } catch (error) {
      console.error("Error fetching bin location:", error);
      return null;
    }
  };

  // Helper function to find batch data by batch_id
  const findBatchData = (batchId) => {
    if (!isBatchManaged || !batchDataArray) return null;
    return batchDataArray.find((batch) => batch.id === batchId) || null;
  };

  // Filter available serial balances (only those with unrestricted_qty > 0)
  const availableBalances = balances.filter(
    (balance) =>
      (balance.unrestricted_qty || 0) > 0 &&
      balance.serial_number &&
      balance.serial_number.trim() !== ""
  );

  if (defaultStrategy === "FIXED BIN") {
    if (defaultBin) {
      // Try fixed bin first
      const defaultBinBalances = availableBalances.filter(
        (balance) =>
          (balance.location_id || balance.bin_location_id) === defaultBin
      );

      // Sort by batch expiry date or serial number for consistent allocation
      if (isBatchManaged && batchDataArray) {
        defaultBinBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          // Sort by expiry date first (FIFO), then by serial number
          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (a.serial_number || "").localeCompare(b.serial_number || "");
        });
      } else {
        // Sort by serial number for non-batch serialized items
        defaultBinBalances.sort((a, b) =>
          (a.serial_number || "").localeCompare(b.serial_number || "")
        );
      }

      // Allocate from fixed bin balances (each serial number represents 1 unit)
      for (const balance of defaultBinBalances) {
        if (remainingQty <= 0) break;

        const allocatedQty = Math.min(1, remainingQty); // Each serial is 1 unit

        if (allocatedQty > 0) {
          const binDetails = await getBinLocationDetails(
            balance.location_id || balance.bin_location_id
          );
          if (binDetails) {
            const batchData = isBatchManaged
              ? findBatchData(balance.batch_id)
              : null;

            allAllocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: batchData,
              serialNumber: balance.serial_number,
            });
            remainingQty -= allocatedQty;
          }
        }
      }
    }

    // Use fallback strategy for remaining quantity
    if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
      const otherBalances = availableBalances.filter(
        (balance) =>
          (balance.location_id || balance.bin_location_id) !== defaultBin
      );

      // Sort by batch expiry date or serial number
      if (isBatchManaged && batchDataArray) {
        otherBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (a.serial_number || "").localeCompare(b.serial_number || "");
        });
      } else {
        otherBalances.sort((a, b) =>
          (a.serial_number || "").localeCompare(b.serial_number || "")
        );
      }

      for (const balance of otherBalances) {
        if (remainingQty <= 0) break;

        const allocatedQty = Math.min(1, remainingQty);

        if (allocatedQty > 0) {
          const binDetails = await getBinLocationDetails(
            balance.location_id || balance.bin_location_id
          );
          if (binDetails) {
            const batchData = isBatchManaged
              ? findBatchData(balance.batch_id)
              : null;

            allAllocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: batchData,
              serialNumber: balance.serial_number,
            });
            remainingQty -= allocatedQty;
          }
        }
      }
    }
  } else if (defaultStrategy === "RANDOM") {
    // Direct random allocation for serialized items

    // Sort by batch expiry date or serial number
    if (isBatchManaged && batchDataArray) {
      availableBalances.sort((a, b) => {
        const batchA = findBatchData(a.batch_id);
        const batchB = findBatchData(b.batch_id);

        if (batchA?.expiry_date && batchB?.expiry_date) {
          return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
        }
        return (a.serial_number || "").localeCompare(b.serial_number || "");
      });
    } else {
      availableBalances.sort((a, b) =>
        (a.serial_number || "").localeCompare(b.serial_number || "")
      );
    }

    for (const balance of availableBalances) {
      if (remainingQty <= 0) break;

      const allocatedQty = Math.min(1, remainingQty);

      if (allocatedQty > 0) {
        const binDetails = await getBinLocationDetails(
          balance.location_id || balance.bin_location_id
        );
        if (binDetails) {
          const batchData = isBatchManaged
            ? findBatchData(balance.batch_id)
            : null;

          allAllocations.push({
            balance: balance,
            quantity: allocatedQty,
            binLocation: binDetails.bin_location_combine,
            batchData: batchData,
            serialNumber: balance.serial_number,
          });
          remainingQty -= allocatedQty;
        }
      }
    }
  }

  console.log(
    `Serialized item allocation completed: ${
      allAllocations.length
    } serial numbers allocated out of ${Math.floor(quantity)} requested`
  );
  return allAllocations;
};

// FIXED Helper function to process auto allocation strategies (existing function for batch/regular items)
const processAutoAllocation = async (
  balances,
  defaultBin,
  quantity,
  defaultStrategy,
  fallbackStrategy,
  isBatchManaged,
  batchDataArray = null
) => {
  let allAllocations = [];
  let remainingQty = quantity;

  // Get bin location details
  const getBinLocationDetails = async (locationId) => {
    try {
      const binLocationResult = await db
        .collection("bin_location")
        .where({ id: locationId, is_deleted: 0 })
        .get();
      return binLocationResult?.data?.[0] || null;
    } catch (error) {
      console.error("Error fetching bin location:", error);
      return null;
    }
  };

  // Helper function to find batch data by batch_id
  const findBatchData = (batchId) => {
    if (!isBatchManaged || !batchDataArray) return null;
    return batchDataArray.find((batch) => batch.id === batchId) || null;
  };

  if (defaultStrategy === "FIXED BIN") {
    if (defaultBin) {
      // Try fixed bin first - handle multiple batches in the same bin
      const defaultBinBalances = balances.filter(
        (balance) =>
          balance.location_id === defaultBin &&
          (balance.unrestricted_qty || 0) > 0
      );

      // Sort by batch expiry date or batch number for consistent allocation
      if (isBatchManaged) {
        defaultBinBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          // Sort by expiry date first (FIFO), then by batch number
          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (batchA?.batch_number || "").localeCompare(
            batchB?.batch_number || ""
          );
        });
      }

      // Allocate from fixed bin balances
      for (const balance of defaultBinBalances) {
        if (remainingQty <= 0) break;

        const availableQty = balance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, availableQty);

        if (allocatedQty > 0) {
          const binDetails = await getBinLocationDetails(balance.location_id);
          if (binDetails) {
            const batchData = isBatchManaged
              ? findBatchData(balance.batch_id)
              : null;

            allAllocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: batchData,
            });
            remainingQty -= allocatedQty;
          }
        }
      }
    }

    // Use fallback strategy for remaining quantity
    if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
      const availableBalances = balances.filter(
        (balance) =>
          balance.location_id !== defaultBin &&
          (balance.unrestricted_qty || 0) > 0
      );

      // Sort by batch expiry date for batch-managed items
      if (isBatchManaged) {
        availableBalances.sort((a, b) => {
          const batchA = findBatchData(a.batch_id);
          const batchB = findBatchData(b.batch_id);

          if (batchA?.expiry_date && batchB?.expiry_date) {
            return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
          }
          return (batchA?.batch_number || "").localeCompare(
            batchB?.batch_number || ""
          );
        });
      } else {
        // For non-batch items, maintain original order
        availableBalances.sort(
          (a, b) => balances.indexOf(a) - balances.indexOf(b)
        );
      }

      for (const balance of availableBalances) {
        if (remainingQty <= 0) break;

        const availableQty = balance.unrestricted_qty || 0;
        const allocatedQty = Math.min(remainingQty, availableQty);

        if (allocatedQty > 0) {
          const binDetails = await getBinLocationDetails(balance.location_id);
          if (binDetails) {
            const batchData = isBatchManaged
              ? findBatchData(balance.batch_id)
              : null;

            allAllocations.push({
              balance: balance,
              quantity: allocatedQty,
              binLocation: binDetails.bin_location_combine,
              batchData: batchData,
            });
            remainingQty -= allocatedQty;
          }
        }
      }
    }
  } else if (defaultStrategy === "RANDOM") {
    // Direct random allocation - handle multiple batches
    const availableBalances = balances.filter(
      (balance) => (balance.unrestricted_qty || 0) > 0
    );

    // Sort by batch expiry date for batch-managed items (FIFO)
    if (isBatchManaged) {
      availableBalances.sort((a, b) => {
        const batchA = findBatchData(a.batch_id);
        const batchB = findBatchData(b.batch_id);

        if (batchA?.expiry_date && batchB?.expiry_date) {
          return new Date(batchA.expiry_date) - new Date(batchB.expiry_date);
        }
        return (batchA?.batch_number || "").localeCompare(
          batchB?.batch_number || ""
        );
      });
    } else {
      // For non-batch items, maintain original order
      availableBalances.sort(
        (a, b) => balances.indexOf(a) - balances.indexOf(b)
      );
    }

    for (const balance of availableBalances) {
      if (remainingQty <= 0) break;

      const availableQty = balance.unrestricted_qty || 0;
      const allocatedQty = Math.min(remainingQty, availableQty);

      if (allocatedQty > 0) {
        const binDetails = await getBinLocationDetails(balance.location_id);
        if (binDetails) {
          const batchData = isBatchManaged
            ? findBatchData(balance.batch_id)
            : null;

          allAllocations.push({
            balance: balance,
            quantity: allocatedQty,
            binLocation: binDetails.bin_location_combine,
            batchData: batchData,
          });
          remainingQty -= allocatedQty;
        }
      }
    }
  }

  return allAllocations;
};

if (!window.globalAllocationTracker) {
  window.globalAllocationTracker = new Map();
}

const createTableGdWithBaseUOM = async (allItems) => {
  const processedItems = [];

  for (const item of allItems) {
    // Check if item is serialized
    let itemData = null;
    if (item.itemId) {
      try {
        const res = await db
          .collection("Item")
          .where({ id: item.itemId })
          .get();
        itemData = res.data?.[0];
      } catch (error) {
        console.error(`Error fetching item data for ${item.itemId}:`, error);
      }
    }

    // If serialized, convert to base UOM
    if (itemData?.serial_number_management === 1) {
      const orderedQtyBase = convertToBaseUOM(
        item.orderedQty,
        item.altUOM,
        itemData
      );
      const deliveredQtyBase = convertToBaseUOM(
        item.deliveredQtyFromSource,
        item.altUOM,
        itemData
      );

      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: orderedQtyBase, // Base UOM
        gd_delivered_qty: deliveredQtyBase, // Base UOM
        gd_undelivered_qty: orderedQtyBase - deliveredQtyBase, // Base UOM
        gd_order_uom_id: itemData.based_uom, // Base UOM
        good_delivery_uom_id: itemData.based_uom, // Base UOM
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        item_category_id: item.item_category_id,
        base_uom_id: itemData.based_uom,
      });
    } else {
      // Non-serialized items keep original UOM
      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: item.orderedQty,
        gd_delivered_qty: item.deliveredQtyFromSource,
        gd_undelivered_qty: item.orderedQty - item.sourceItem.delivered_qty,
        gd_order_uom_id: item.altUOM,
        good_delivery_uom_id: item.altUOM,
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        item_category_id: item.item_category_id,
      });
    }
  }

  return processedItems;
};

(async () => {
  const referenceType = this.getValue(`dialog_select_item.reference_type`);
  const previousReferenceType = this.getValue("reference_type");
  const currentItemArray = this.getValue(`dialog_select_item.item_array`);
  let existingGD = this.getValue("table_gd");

  let allItems = [];
  let salesOrderNumber = [];
  let soId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one sales order / item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  if (previousReferenceType && previousReferenceType !== referenceType) {
    await this.$confirm(
      `You've selected a different reference type than previously used. <br><br>Current Reference Type: ${referenceType} <br>Previous Reference Type: ${previousReferenceType} <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Reference Type Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      }
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingGD = [];
  }

  const uniqueCustomer = new Set(
    currentItemArray.map((so) =>
      referenceType === "Document"
        ? so.customer_id
        : so.sales_order.customer_name
    )
  );
  const allSameCustomer = uniqueCustomer.size === 1;

  if (!allSameCustomer) {
    this.$alert(
      "Deliver item(s) to more than two different customers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );
    return;
  }

  this.closeDialog("dialog_select_item");
  this.showLoading();

  switch (referenceType) {
    case "Document":
      for (const so of currentItemArray) {
        for (const soItem of so.table_so) {
          console.log("soItem", soItem);
          allItems.push({
            itemId: soItem.item_name,
            itemName: soItem.item_id,
            itemDesc: soItem.so_desc,
            orderedQty: parseFloat(soItem.so_quantity || 0),
            altUOM: soItem.so_item_uom || "",
            sourceItem: soItem,
            deliveredQtyFromSource: parseFloat(soItem.delivered_qty || 0),
            original_so_id: so.sales_order_id,
            so_no: so.sales_order_number,
            so_line_item_id: soItem.id,
            item_category_id: soItem.item_category_id,
          });
        }
      }

      break;

    case "Item":
      for (const soItem of currentItemArray) {
        allItems.push({
          itemId: soItem.item.id,
          itemName: soItem.item.material_name,
          itemDesc: soItem.so_desc,
          orderedQty: parseFloat(soItem.so_quantity || 0),
          altUOM: soItem.so_item_uom || "",
          sourceItem: soItem,
          deliveredQtyFromSource: parseFloat(soItem.delivered_qty || 0),
          original_so_id: soItem.sales_order.id,
          so_no: soItem.sales_order.so_no,
          so_line_item_id: soItem.sales_order_line_id,
          item_category_id: soItem.item.item_category,
        });
      }
      break;
  }

  let newTableGd = await createTableGdWithBaseUOM(allItems);

  newTableGd = newTableGd.filter(
    (gd) =>
      gd.gd_undelivered_qty !== 0 &&
      !existingGD.find(
        (gdItem) => gdItem.so_line_item_id === gd.so_line_item_id
      )
  );

  const latestTableGD = [...existingGD, ...newTableGd];

  const newTableInsufficient = allItems.map((item) => ({
    material_id: item.itemId,
    material_name: item.itemName,
    material_uom: item.altUOM,
    order_quantity: item.orderedQty,
    available_qty: "",
    shortfall_qty: "",
    fm_key: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
  }));

  soId = [...new Set(latestTableGD.map((gr) => gr.line_so_id))];
  salesOrderNumber = [...new Set(latestTableGD.map((gr) => gr.line_so_no))];

  await this.setData({
    currency_code:
      referenceType === "Document"
        ? currentItemArray[0].currency
        : currentItemArray[0].sales_order.so_currency,
    customer_name:
      referenceType === "Document"
        ? currentItemArray[0].customer_id
        : currentItemArray[0].customer_id.id,
    table_gd: latestTableGD,
    so_no: salesOrderNumber.join(", "),
    so_id: soId,
    reference_type: referenceType,
    dialog_insufficient: {
      table_insufficient: newTableInsufficient,
    },
  });

  setTimeout(async () => {
    try {
      const plantId = this.getValue("plant_id");
      // Use the enhanced inventory checking function with serialized item support
      const insufficientItems = await checkInventoryWithDuplicates(
        allItems,
        plantId
      );

      // Show insufficient dialog if there are any shortfalls
      if (insufficientItems.length > 0) {
        console.log(
          "Materials with insufficient inventory:",
          insufficientItems
        );
        this.openDialog("dialog_insufficient");
      }

      console.log(
        "Finished populating table_gd items with serialized item support"
      );
    } catch (error) {
      console.error("Error in inventory check:", error);
    }
  }, 200);

  this.hideLoading();
})();
