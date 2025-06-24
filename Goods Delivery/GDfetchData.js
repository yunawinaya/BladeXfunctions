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

// Helper function to fetch all GD records for multiple SO IDs
const fetchGoodsDeliveries = async (soIds) => {
  const promises = soIds.map((soId) =>
    db
      .collection("goods_delivery")
      .where({ so_id: soId, gd_status: "Completed" })
      .get()
  );

  try {
    const results = await Promise.all(promises);
    let allGDData = [];
    results.forEach((response) => {
      if (response.data && response.data.length > 0) {
        allGDData = [...allGDData, ...response.data];
      }
    });
    return allGDData;
  } catch (error) {
    console.error("Error fetching goods deliveries:", error);
    return [];
  }
};

// Helper function to fetch source items from multiple SO IDs
const fetchSourceItems = async (soIds) => {
  const promises = soIds.map((soId) =>
    db
      .collection("sales_order")
      .where({ id: soId })
      .get()
      .then((response) => {
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
      })
  );

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

// Enhanced function to check inventory using form's plantId
const checkInventoryForItem = async (item, itemData, index, deliveredSoFar) => {
  const itemId = item.itemId;
  const itemName = item.itemName;
  const orderedQty = item.orderedQty;
  const altUOM = item.altUOM;

  console.log(`Checking inventory for item ${itemId} in plant ${plantId}`);

  const baseUOM = itemData.based_uom || "";

  try {
    let totalUnrestrictedQtyBase = 0;

    if (itemData.item_batch_management === 1 && itemData.stock_control !== 0) {
      // Batch managed items
      const response = await db
        .collection("item_batch_balance")
        .where({ material_id: itemId, plant_id: plantId })
        .get();

      const itemBatchBalanceData = response.data || [];
      totalUnrestrictedQtyBase = itemBatchBalanceData.reduce(
        (sum, balance) => sum + (balance.unrestricted_qty || 0),
        0
      );
    } else if (
      itemData.item_batch_management === 0 &&
      itemData.stock_control !== 0
    ) {
      // Non-batch managed items
      const response = await db
        .collection("item_balance")
        .where({ material_id: itemId, plant_id: plantId })
        .get();

      const itemBalanceData = response.data || [];
      totalUnrestrictedQtyBase = itemBalanceData.reduce(
        (sum, balance) => sum + (balance.unrestricted_qty || 0),
        0
      );
    }

    // Convert to alt UOM if needed
    let totalUnrestrictedQty = totalUnrestrictedQtyBase;
    if (altUOM !== baseUOM) {
      totalUnrestrictedQty = convertBaseToAlt(
        totalUnrestrictedQtyBase,
        itemData,
        altUOM
      );
    }

    const undeliveredQty = orderedQty - deliveredSoFar;
    const shortfallQty = undeliveredQty - totalUnrestrictedQty;

    // Update insufficient dialog data
    this.setData({
      [`dialog_insufficient.table_insufficient.${index}.undelivered_qty`]:
        undeliveredQty,
      [`dialog_insufficient.table_insufficient.${index}.available_qty`]:
        totalUnrestrictedQty,
      [`dialog_insufficient.table_insufficient.${index}.shortfall_qty`]:
        shortfallQty,
    });

    return {
      hasShortfall: shortfallQty > 0,
      shortfallQty: shortfallQty,
    };
  } catch (error) {
    console.error(`Error checking inventory for item ${itemId}:`, error);
    return false;
  }
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

    // Fetch goods deliveries for all SO IDs
    const GDData = await fetchGoodsDeliveries(salesOrderIds);
    console.log("GDData extracted for all SOs:", GDData);

    // Check if we have valid salesOrderIds
    if (salesOrderIds.length > 0 && salesOrderIds[0]) {
      this.disabled(["plant_id"], false);

      // Set SO numbers in so_no field
      if (salesOrderIds.length > 1) {
        Promise.all(
          salesOrderIds.map((soId) =>
            db
              .collection("sales_order")
              .where({ id: soId })
              .get()
              .then((response) => {
                if (response.data && response.data.length > 0) {
                  return response.data[0].so_no;
                }
                return "";
              })
          )
        )
          .then((soNumbers) => {
            const validSoNumbers = soNumbers.filter(Boolean);
            this.setData({
              so_no: validSoNumbers.join(", "),
            });
          })
          .catch((error) => {
            console.error("Error fetching SO numbers:", error);
          });
      } else {
        db.collection("sales_order")
          .where({ id: salesOrderIds[0] })
          .get()
          .then((response) => {
            if (response.data && response.data.length > 0) {
              this.setData({
                so_no: response.data[0].so_no,
              });
            }
          })
          .catch((error) => {
            console.error("Error fetching SO number:", error);
          });
      }
    }

    // Fetch source items from all SO IDs (addresses will be populated here)
    const sourceItems = await fetchSourceItems(salesOrderIds);
    console.log("sourceItems from all SOs:", sourceItems);

    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
      console.log("No source items found in sales orders");
      return;
    }

    // Store the highest delivered quantities for each item
    // let deliveredQty = {};

    // GDData.forEach((gdRecord) => {
    //   if (Array.isArray(gdRecord.table_gd)) {
    //     gdRecord.table_gd.forEach((gdItem) => {
    //       const itemId = gdItem.material_id;
    //       if (itemId) {
    //         const currentQty = parseFloat(gdItem.gd_delivered_qty || 0);
    //         if (!deliveredQty[itemId]) {
    //           deliveredQty[itemId] = 0;
    //         }
    //         deliveredQty[itemId] += currentQty;
    //       }
    //     });
    //   }
    // });

    if (!isSOUnchanged) {
      // Reset table data
      this.setData({
        table_gd: [],
        gd_item_balance: {
          table_item_balance: [],
        },
      });

      setTimeout(async () => {
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

        setTimeout(async () => {
          newTableGd.forEach(async (item, index) => {
            if (item.material_id === "" && item.gd_material_desc !== "") {
              if (item.gd_undelivered_qty <= 0) {
                this.disabled(
                  [
                    `table_gd.${index}.gd_qty`,
                    `table_gd.${index}.gd_delivery_qty`,
                  ],
                  true
                );
              } else {
                this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
                this.disabled([`table_gd.${index}.gd_qty`], false);
                this.setData({
                  [`table_gd.${index}.gd_initial_delivered_qty`]:
                    item.gd_delivered_qty,
                  [`table_gd.${index}.gd_qty`]: item.gd_undelivered_qty,
                });
              }
            } else if (item.material_id && item.material_id !== "") {
              if (item.gd_undelivered_qty <= 0) {
                this.disabled(
                  [
                    `table_gd.${index}.gd_qty`,
                    `table_gd.${index}.gd_delivery_qty`,
                  ],
                  true
                );
              } else {
                const resItem = await db
                  .collection("item")
                  .where({ id: item.material_id, is_deleted: 0 })
                  .get();
                if (resItem && resItem.data.length > 0) {
                  const plant = this.getValue("plant_id");
                  const itemData = resItem.data[0];

                  if (itemData.item_batch_management === 0) {
                    if (plant) {
                      const resItemBalance = await db
                        .collection("item_balance")
                        .where({
                          plant_id: plant,
                          material_id: item.material_id,
                          is_deleted: 0,
                        })
                        .get();

                      if (resItemBalance && resItemBalance.data.length === 1) {
                        this.disabled(
                          [`table_gd.${index}.gd_delivery_qty`],
                          true
                        );
                        this.disabled([`table_gd.${index}.gd_qty`], false);
                        this.setData({
                          [`table_gd.${index}.gd_initial_delivered_qty`]:
                            item.gd_delivered_qty,
                          [`table_gd.${index}.gd_qty`]: item.gd_undelivered_qty,
                        });
                      }
                    }
                  } else {
                    console.error("Item batch management is not found.");
                  }
                }
              }
            }
          });
        }, 100);

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

        console.log("New table_insufficient structure:", newTableInsufficient);

        this.setData({
          dialog_insufficient: {
            table_insufficient: newTableInsufficient,
          },
        });

        // Use a longer delay to ensure the arrays are created
        setTimeout(async () => {
          // Process each item with enhanced inventory checking
          const insufficientItems = [];

          for (let index = 0; index < allItems.length; index++) {
            const item = allItems[index];
            const itemId = item.itemId;
            const itemName = item.itemName;
            const itemDesc = item.itemDesc;
            const orderedQty = item.orderedQty;
            const altUOM = item.altUOM;
            const deliveredSoFar = item.deliveredQtyFromSource;

            console.log(`Processing item ${index}:`, item);

            try {
              // Fetch item data
              const res = await db
                .collection("Item")
                .where({ id: itemId })
                .get();

              if (!res.data || !res.data.length) {
                console.error(`Item not found: ${itemId}`);
                continue;
              }

              const itemData = res.data[0];

              if (
                itemData &&
                itemData.stock_control !== 0 &&
                (itemData.show_delivery !== 0 || !itemData.show_delivery)
              ) {
                // Set basic item data
                this.setData({
                  [`table_gd.${index}.material_id`]: itemId,
                  [`table_gd.${index}.material_name`]: itemName,
                  [`table_gd.${index}.gd_material_desc`]:
                    item.sourceItem.so_desc || "",
                  [`table_gd.${index}.gd_order_quantity`]: orderedQty,
                  [`table_gd.${index}.gd_delivered_qty`]: deliveredSoFar,
                  [`table_gd.${index}.gd_initial_delivered_qty`]:
                    deliveredSoFar,
                  [`table_gd.${index}.gd_order_uom_id`]: altUOM,
                  [`table_gd.${index}.good_delivery_uom_id`]: altUOM,

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
                  [`dialog_insufficient.table_insufficient.${index}.material_id`]:
                    itemId,
                  [`dialog_insufficient.table_insufficient.${index}.order_quantity`]:
                    orderedQty,
                });

                if (itemId === "" && itemDesc !== "") {
                  this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
                  this.disabled([`table_gd.${index}.gd_qty`], false);
                }

                // Check inventory
                const { hasShortfall, shortfallQty } =
                  await checkInventoryForItem(
                    item,
                    itemData,
                    index,
                    deliveredSoFar
                  );

                if (hasShortfall) {
                  this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
                  const availableQty =
                    orderedQty - deliveredSoFar - shortfallQty;
                  if (availableQty > 0) {
                    this.disabled([`table_gd.${index}.gd_qty`], false);
                    this.setData({
                      [`table_gd.${index}.gd_qty`]: availableQty,
                    });
                  } else {
                    this.disabled([`table_gd.${index}.gd_qty`], true);
                    this.setData({ [`table_gd.${index}.gd_qty`]: 0 });
                  }
                  insufficientItems.push({
                    itemId,
                    itemName,
                    soNo: item.so_no,
                  });
                }
              } else {
                console.log(
                  `Skipping item ${itemId} due to stock_control or show_delivery settings`
                );
              }
            } catch (error) {
              console.error(`Error processing item ${itemId}:`, error);
            }
          }

          // Show insufficient dialog if there are any shortfalls
          if (insufficientItems.length > 0) {
            console.log(
              "Items with insufficient inventory:",
              insufficientItems
            );
            this.openDialog("dialog_insufficient");
          }

          console.log("Finished populating table_gd items");
        }, 200);
      }, 100);
    } else {
      console.log("Preserving existing table_gd data during edit");
    }
  } catch (e) {
    console.error("Error in main processing:", e);
  }
})();
