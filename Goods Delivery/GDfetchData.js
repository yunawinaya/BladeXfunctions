const data = this.getValues();
const salesOrderId = data.so_id;
const plantId = data.plant_id;

const savedTableGd = data.table_gd || [];

// Normalize salesOrderId to always be an array
const salesOrderIds = Array.isArray(salesOrderId)
  ? salesOrderId
  : [salesOrderId];

if (salesOrderIds.length > 1) {
  this.setData({ gd_delivery_method: "" });
  this.triggerEvent("func_reset_delivery_method");
}

// Function to convert base quantity to alternative quantity
const convertBaseToAlt = (baseQty, itemData, altUOM) => {
  if (
    !Array.isArray(itemData.table_uom_conversion) ||
    itemData.table_uom_conversion.length === 0 ||
    !altUOM
  ) {
    return baseQty;
  }

  const uomConversion = itemData.table_uom_conversion.find(
    (conv) => conv.alt_uom_id === altUOM
  );

  if (!uomConversion || !uomConversion.base_qty) {
    return baseQty;
  }

  return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
};

// Helper function to populate addresses from SO data
const populateAddressesFromSO = (soData) => {
  console.log("Populating addresses from SO:", soData);

  // Display address section
  this.display("address_grid");

  // Extract address data from SO
  const {
    cust_billing_address,
    cust_shipping_address,
    billing_address_line_1,
    billing_address_line_2,
    billing_address_line_3,
    billing_address_line_4,
    billing_address_city,
    billing_address_state,
    billing_address_country,
    billing_postal_code,
    billing_address_phone,
    billing_address_name,
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
  } = soData;

  // Set address fields from SO data
  this.setData({
    // Main address fields (formatted addresses)
    gd_billing_address: cust_billing_address || "",
    gd_shipping_address: cust_shipping_address || "",

    // Detailed billing address fields
    billing_address_line_1: billing_address_line_1 || "",
    billing_address_line_2: billing_address_line_2 || "",
    billing_address_line_3: billing_address_line_3 || "",
    billing_address_line_4: billing_address_line_4 || "",
    billing_address_city: billing_address_city || "",
    billing_address_state: billing_address_state || "",
    billing_address_country: billing_address_country || "",
    billing_postal_code: billing_postal_code || "",
    billing_address_phone: billing_address_phone || "",
    billing_address_name: billing_address_name || "",
    billing_attention: billing_attention || "",

    // Detailed shipping address fields
    shipping_address_line_1: shipping_address_line_1 || "",
    shipping_address_line_2: shipping_address_line_2 || "",
    shipping_address_line_3: shipping_address_line_3 || "",
    shipping_address_line_4: shipping_address_line_4 || "",
    shipping_address_city: shipping_address_city || "",
    shipping_address_state: shipping_address_state || "",
    shipping_address_country: shipping_address_country || "",
    shipping_postal_code: shipping_postal_code || "",
    shipping_address_name: shipping_address_name || "",
    shipping_address_phone: shipping_address_phone || "",
    shipping_attention: shipping_attention || "",
  });

  console.log("Addresses populated from SO successfully");
};

// Helper function to fetch source items from multiple SO IDs
const fetchSourceItems = async (soIds) => {
  const promises = soIds.map(async (soId) => {
    try {
      const response = await db
        .collection("sales_order")
        .where({ id: soId })
        .get();

      if (
        response.data &&
        response.data.length > 0 &&
        response.data[0].table_so
      ) {
        console.log("response.data[0]:", response.data[0]);

        // Add the SO ID to each item for reference
        return {
          soData: response.data[0],
          items: response.data[0].table_so.map((item) => ({
            ...item,
            original_so_id: soId,
            so_no: response.data[0].so_no,
          })),
        };
      }
      return { soData: null, items: [] };
    } catch (error) {
      console.error(`Error fetching SO ${soId}:`, error);
      return { soData: null, items: [] };
    }
  });

  try {
    const results = await Promise.all(promises);

    // POPULATE ADDRESSES FROM THE LATEST SELECTED SO (last in array)
    const latestSOResult = results[results.length - 1];
    if (latestSOResult.soData) {
      console.log(
        "Using latest selected SO for addresses:",
        latestSOResult.soData.so_no
      );
      populateAddressesFromSO(latestSOResult.soData);
    }

    // Flatten all items from all SOs
    const allItems = results.flatMap((result) => result.items);
    return allItems;
  } catch (error) {
    console.error("Error fetching source items:", error);
    return [];
  }
};

// Alternative approach: Handle address population for multiple SOs
const handleMultipleSOMAddresses = async (soIds) => {
  if (soIds.length >= 1) {
    // Use the LATEST selected SO (last in array) for addresses
    const latestSOId = soIds[soIds.length - 1];

    try {
      const response = await db
        .collection("sales_order")
        .where({ id: latestSOId })
        .get();
      if (response.data && response.data.length > 0) {
        console.log(
          `Using latest selected SO (${response.data[0].so_no}) for addresses`
        );
        populateAddressesFromSO(response.data[0]);
      }
    } catch (error) {
      console.error("Error fetching latest SO for address:", error);
    }
  }
};

// Enhanced function to check inventory with duplicate material handling
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

  // Process each material group
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
        // Still set up the items normally for non-stock items
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
            [`table_gd.${index}.unit_price`]:
              item.sourceItem.so_item_price || 0,
            [`table_gd.${index}.total_price`]: item.sourceItem.so_amount || 0,
            [`table_gd.${index}.item_costing_method`]:
              itemData.material_costing_method,
            [`table_gd.${index}.gd_qty`]: undeliveredQty,
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

      // Get total available stock for this material
      let totalUnrestrictedQtyBase = 0;

      if (itemData.item_batch_management === 1) {
        try {
          const response = await db
            .collection("item_batch_balance")
            .where({ material_id: materialId, plant_id: plantId })
            .get();
          const itemBatchBalanceData = response.data || [];

          if (itemBatchBalanceData.length === 1) {
            // Apply to all items in this material group
            items.forEach((item) => {
              const itemIndex = item.originalIndex;
              this.disabled([`table_gd.${itemIndex}.gd_delivery_qty`], true);
              this.disabled([`table_gd.${itemIndex}.gd_qty`], false);
            });
          }
          totalUnrestrictedQtyBase = itemBatchBalanceData.reduce(
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
        try {
          const response = await db
            .collection("item_balance")
            .where({ material_id: materialId, plant_id: plantId })
            .get();
          const itemBalanceData = response.data || [];

          if (itemBalanceData.length === 1) {
            // Apply to all items in this material group
            items.forEach((item) => {
              const itemIndex = item.originalIndex;
              this.disabled([`table_gd.${itemIndex}.gd_delivery_qty`], true);
              this.disabled([`table_gd.${itemIndex}.gd_qty`], false);
            });
          }

          totalUnrestrictedQtyBase = itemBalanceData.reduce(
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

      // Calculate total demand from ALL line items for this material
      let totalDemandBase = 0;

      const pickingSetupResponse = await db
        .collection("picking_setup")
        .where({ plant_id: plantId, movement_type: "Good Delivery" })
        .get();
      const pickingMode = pickingSetupResponse.data[0].picking_mode;
      const defaultStrategy = pickingSetupResponse.data[0].default_strategy_id;

      items.forEach((item) => {
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;
        const undeliveredQty = orderedQty - deliveredQty;

        // Convert to base UOM if needed
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
      });

      console.log(
        `Material ${materialId}: Available=${totalUnrestrictedQtyBase}, Total Demand=${totalDemandBase}, Line Count=${items.length}`
      );

      // Set basic item data for all items in this group
      items.forEach((item) => {
        const index = item.originalIndex;
        const orderedQty = item.orderedQty;
        const deliveredQty = item.deliveredQtyFromSource;

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

      // Check if total demand exceeds available stock
      const totalShortfallBase = totalDemandBase - totalUnrestrictedQtyBase;

      if (totalShortfallBase > 0) {
        console.log(
          `❌ Insufficient stock for material ${materialId}: Shortfall=${totalShortfallBase} (${items.length} line items)`
        );

        // Distribute available stock proportionally
        let remainingStockBase = Math.max(0, totalUnrestrictedQtyBase);

        items.forEach((item) => {
          const index = item.originalIndex;
          const orderedQty = item.orderedQty;
          const deliveredQty = item.deliveredQtyFromSource;
          const undeliveredQty = orderedQty - deliveredQty;

          // Convert available stock back to alt UOM
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

            // Allocate proportionally or take minimum
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

          // Set the actual deliverable quantity
          if (
            availableQtyAlt > 0 &&
            (itemBalanceData.length === 1 ||
              (["FIXED BIN", "RANDOM"].includes(defaultStrategy) &&
                pickingMode === "Auto"))
          ) {
            this.setData({
              [`table_gd.${index}.gd_qty`]: availableQtyAlt,
            });
          } else {
            this.setData({
              [`table_gd.${index}.gd_qty`]: 0,
            });
          }
        });

        // Add to insufficient items list
        insufficientItems.push({
          itemId: materialId,
          itemName: items[0].itemName,
          soNo: items.map((item) => item.so_no).join(", "),
          lineCount: items.length,
        });
      } else {
        // Sufficient stock available - set up items normally
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
            this.setData({
              [`table_gd.${index}.gd_qty`]: undeliveredQty,
            });
          }
        });
      }
    } catch (error) {
      console.error(`Error processing material ${materialId}:`, error);
    }
  }

  return insufficientItems;
};

// Main processing logic - modified to handle addresses from SO
(async () => {
  try {
    const fieldModelItem = Array.isArray(arguments[0]?.fieldModel)
      ? arguments[0]?.fieldModel[0]?.item
      : arguments[0]?.fieldModel?.item;

    if (!salesOrderIds.length || !salesOrderIds[0]) {
      console.log("No sales order IDs found");
      return;
    }

    // Define isSOUnchanged for edit mode
    const newSoId = fieldModelItem?.so_id || salesOrderIds[0];
    const isSOUnchanged =
      (data.page_status === "Edit" || data.page_status === "View") &&
      JSON.stringify(salesOrderIds) ===
        JSON.stringify(Array.isArray(newSoId) ? newSoId : [newSoId]) &&
      savedTableGd.length > 0;

    // Handle address population early in the process
    if (!isSOUnchanged) {
      await handleMultipleSOMAddresses(salesOrderIds);
    }

    // Check if we have valid salesOrderIds
    if (salesOrderIds.length > 0 && salesOrderIds[0]) {
      this.disabled(["plant_id"], false);

      // Set SO numbers in so_no field
      if (salesOrderIds.length > 1) {
        try {
          const soNumbers = await Promise.all(
            salesOrderIds.map(async (soId) => {
              try {
                const response = await db
                  .collection("sales_order")
                  .where({ id: soId })
                  .get();
                if (response.data && response.data.length > 0) {
                  return response.data[0].so_no;
                }
                return "";
              } catch (error) {
                console.error(`Error fetching SO number for ${soId}:`, error);
                return "";
              }
            })
          );

          const validSoNumbers = soNumbers.filter(Boolean);
          this.setData({
            so_no: validSoNumbers.join(", "),
          });
        } catch (error) {
          console.error("Error fetching SO numbers:", error);
        }
      } else {
        try {
          const response = await db
            .collection("sales_order")
            .where({ id: salesOrderIds[0] })
            .get();
          if (response.data && response.data.length > 0) {
            this.setData({
              so_no: response.data[0].so_no,
            });
          }
        } catch (error) {
          console.error("Error fetching SO number:", error);
        }
      }
    }

    // Fetch source items from all SO IDs (addresses will be populated here)
    const sourceItems = await fetchSourceItems(salesOrderIds);
    console.log("sourceItems from all SOs:", sourceItems);

    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
      console.log("No source items found in sales orders");
      return;
    }

    if (!isSOUnchanged) {
      // Reset table data
      this.setData({
        table_gd: [],
        gd_item_balance: {
          table_item_balance: [],
        },
      });

      setTimeout(async () => {
        try {
          // Create items array
          const allItems = [];

          sourceItems.forEach((sourceItem) => {
            const itemId = sourceItem.item_name || "";
            const itemDesc = sourceItem.so_desc || "";
            const itemName = sourceItem.item_id || "";

            if (itemId === "" && itemDesc === "") return;

            const orderedQty = parseFloat(sourceItem.so_quantity || 0);
            const deliveredQtyFromSource = parseFloat(
              sourceItem.delivered_qty || 0
            );

            const altUOM = sourceItem.so_item_uom || "";

            allItems.push({
              itemId,
              itemName,
              itemDesc,
              orderedQty,
              altUOM,
              sourceItem,
              deliveredQtyFromSource,
              original_so_id: sourceItem.original_so_id,
              so_no: sourceItem.so_no,
            });
          });

          // Create new table_gd structure
          const newTableGd = allItems.map((item) => ({
            material_id: item.itemId || "",
            material_name: item.itemName || "",
            gd_material_desc: item.itemDesc || "",
            gd_order_quantity: item.orderedQty,
            gd_delivered_qty: item.sourceItem.delivered_qty,
            gd_undelivered_qty: item.orderedQty - item.sourceItem.delivered_qty,
            gd_order_uom_id: item.altUOM,
            unit_price: item.sourceItem.so_item_price || 0,
            total_price: item.sourceItem.so_amount || 0,
            more_desc: item.sourceItem.more_desc || "",
            line_remark_1: item.sourceItem.line_remark_1 || "",
            line_remark_2: item.sourceItem.line_remark_2 || "",
            line_so_no: item.so_no,
            line_so_id: item.original_so_id,
            fm_key:
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          }));

          console.log("New table_gd structure:", newTableGd);

          await this.setData({
            table_gd: newTableGd,
          });

          // Create insufficient items table structure
          const newTableInsufficient = allItems.map((item) => ({
            material_id: item.itemId,
            material_name: item.itemName,
            material_uom: item.altUOM,
            order_quantity: item.orderedQty,
            available_qty: "",
            shortfall_qty: "",
            fm_key:
              Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          }));

          console.log(
            "New table_insufficient structure:",
            newTableInsufficient
          );

          this.setData({
            dialog_insufficient: {
              table_insufficient: newTableInsufficient,
            },
          });

          // Use a longer delay to ensure the arrays are created
          setTimeout(async () => {
            try {
              // Use the new enhanced inventory checking function
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

              console.log("Finished populating table_gd items");
            } catch (error) {
              console.error("Error in inventory check:", error);
            }
          }, 200);
        } catch (error) {
          console.error("Error in setTimeout processing:", error);
        }
      }, 100);
    } else {
      console.log("Preserving existing table_gd data during edit");
    }
  } catch (e) {
    console.error("Error in main processing:", e);
  }
})();
