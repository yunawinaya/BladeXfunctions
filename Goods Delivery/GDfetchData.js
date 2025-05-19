const data = this.getValues();
const salesOrderId = data.so_id;

const savedTableGd = data.table_gd || [];

// Normalize salesOrderId to always be an array
const salesOrderIds = Array.isArray(salesOrderId)
  ? salesOrderId
  : [salesOrderId];

// Function to convert base quantity to alternative quantity
const convertBaseToAlt = (baseQty, itemData, altUOM) => {
  if (
    !Array.isArray(itemData.table_uom_conversion) ||
    itemData.table_uom_conversion.length === 0 ||
    !altUOM
  ) {
    // No conversion needed or possible
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

    // Combine all results
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
          // Add the SO ID to each item for reference
          return response.data[0].table_so.map((item) => ({
            ...item,
            original_so_id: soId,
            so_no: response.data[0].so_no,
          }));
        }
        return [];
      })
  );

  try {
    const itemArrays = await Promise.all(promises);

    // Flatten the array of arrays
    return itemArrays.flat();
  } catch (error) {
    console.error("Error fetching source items:", error);
    return [];
  }
};

// Main processing logic - modified to handle multiple SO IDs
(async () => {
  try {
    // Handle fieldModel as array
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

    // Fetch goods deliveries for all SO IDs
    const GDData = await fetchGoodsDeliveries(salesOrderIds);
    console.log("GDData extracted for all SOs:", GDData);

    // Check if we have valid salesOrderIds
    if (salesOrderIds.length > 0 && salesOrderIds[0]) {
      this.disabled(["plant_id"], false);

      // Set SO numbers in so_no field
      if (salesOrderIds.length > 1) {
        // Multiple SOs - fetch and join numbers
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
        // Single SO - fetch and set number
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

    // Fetch source items from all SO IDs
    const sourceItems = await fetchSourceItems(salesOrderIds);
    console.log("sourceItems from all SOs:", sourceItems);

    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
      console.log("No source items found in sales orders");
      return;
    }

    // Store the highest delivered quantities for each item
    let deliveredQty = {};

    GDData.forEach((gdRecord) => {
      if (Array.isArray(gdRecord.table_gd)) {
        gdRecord.table_gd.forEach((gdItem) => {
          const itemId = gdItem.material_id;
          if (itemId) {
            const currentQty = parseFloat(gdItem.gd_delivered_qty || 0);

            // Track delivered quantities by item ID
            if (!deliveredQty[itemId]) {
              deliveredQty[itemId] = 0;
            }
            deliveredQty[itemId] += currentQty;
          }
        });
      }
    });

    if (!isSOUnchanged) {
      // Reset table data - this first setData is necessary to clear existing data
      this.setData({
        table_gd: [],
        gd_item_balance: {
          table_item_balance: [],
        },
      });

      // Create a better delay to ensure the clearing is complete
      setTimeout(() => {
        // DO NOT group items from different SOs - keep them separate with their source SO
        // Each line in table_gd should represent exactly one line from a SO
        const allItems = [];

        sourceItems.forEach((sourceItem) => {
          const itemId = sourceItem.item_name || "";
          if (!itemId) return;

          const orderedQty = parseFloat(sourceItem.so_quantity || 0);
          const altUOM = sourceItem.so_item_uom || "";

          // Create one line item for each source item
          allItems.push({
            itemId,
            orderedQty,
            altUOM,
            sourceItem,
            original_so_id: sourceItem.original_so_id,
            so_no: sourceItem.so_no,
          });
        });

        // Create new table_gd structure with each item preserving its SO origin
        const newTableGd = allItems.map((item) => ({
          material_id: item.itemId,
          gd_material_desc: item.sourceItem.so_desc || "",
          gd_order_quantity: item.orderedQty,
          gd_delivered_qty: deliveredQty[item.itemId] || 0,
          gd_undelivered_qty:
            item.orderedQty - (deliveredQty[item.itemId] || 0),
          gd_order_uom_id: item.altUOM,
          unit_price: item.sourceItem.so_item_price || 0,
          total_price: item.sourceItem.so_amount || 0,
          line_so_no: item.so_no, // Store just the line's own SO number
          line_so_id: item.original_so_id, // Store just the line's own SO ID
          fm_key:
            Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        }));

        console.log(
          "New table_gd structure (keeping items separate by SO):",
          newTableGd
        );

        this.setData({
          table_gd: newTableGd,
        });

        // Create insufficient items table structure
        const newTableInsufficient = allItems.map((item) => ({
          material_id: item.itemId,
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
        setTimeout(() => {
          // Process each item
          allItems.forEach((item, index) => {
            const itemId = item.itemId;
            const orderedQty = item.orderedQty;
            const altUOM = item.altUOM;
            const deliveredSoFar = deliveredQty[itemId] || 0;

            console.log(`Processing item ${index}:`, item);

            // Update each field with correct values
            db.collection("Item")
              .where({ id: itemId })
              .get()
              .then((res) => {
                if (!res.data || !res.data.length) {
                  console.error(`Item not found: ${itemId}`);
                  return;
                }

                const itemData = res.data[0];
                if (
                  itemData &&
                  itemData.stock_control !== 0 &&
                  (itemData.show_delivery !== 0 || !itemData.show_delivery)
                ) {
                  this.setData({
                    [`table_gd.${index}.material_id`]: itemId,
                    [`table_gd.${index}.gd_material_desc`]:
                      item.sourceItem.so_desc || "",
                    [`table_gd.${index}.gd_order_quantity`]: orderedQty,
                    [`table_gd.${index}.gd_delivered_qty`]: deliveredSoFar,
                    [`table_gd.${index}.gd_initial_delivered_qty`]:
                      deliveredSoFar,
                    [`table_gd.${index}.gd_order_uom_id`]: altUOM,
                    [`table_gd.${index}.good_delivery_uom_id`]: altUOM,
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

                  const baseUOM = itemData.based_uom || "";

                  // Check inventory based on batch management flag
                  if (
                    itemData.item_batch_management === 1 &&
                    itemData.stock_control !== 0
                  ) {
                    // Batch managed items
                    db.collection("item_batch_balance")
                      .where({ material_id: itemId })
                      .get()
                      .then((response) => {
                        const itemBatchBalanceData = response.data || [];

                        // Sum unrestricted quantities in base UOM
                        let totalUnrestrictedQtyBase =
                          itemBatchBalanceData.reduce(
                            (sum, balance) =>
                              sum + (balance.unrestricted_qty || 0),
                            0
                          );

                        // Convert to alt UOM if needed
                        let totalUnrestrictedQty = totalUnrestrictedQtyBase;
                        if (altUOM !== baseUOM) {
                          totalUnrestrictedQty = convertBaseToAlt(
                            totalUnrestrictedQtyBase,
                            itemData,
                            altUOM
                          );
                        }

                        const shortfallQty = orderedQty - totalUnrestrictedQty;

                        this.setData({
                          [`dialog_insufficient.table_insufficient.${index}.available_qty`]:
                            totalUnrestrictedQty,
                          [`dialog_insufficient.table_insufficient.${index}.shortfall_qty`]:
                            shortfallQty,
                        });

                        if (shortfallQty > 0) {
                          this.openDialog("dialog_insufficient");
                        }
                      })
                      .catch((error) => {
                        console.error(
                          "Error fetching item_batch_balance:",
                          error
                        );
                      });
                  } else if (
                    itemData.item_batch_management === 0 &&
                    itemData.stock_control !== 0
                  ) {
                    // Non-batch managed items
                    db.collection("item_balance")
                      .where({ material_id: itemId })
                      .get()
                      .then((response) => {
                        const itemBalanceData = response.data || [];

                        // Sum unrestricted quantities in base UOM
                        let totalUnrestrictedQtyBase = itemBalanceData.reduce(
                          (sum, balance) =>
                            sum + (balance.unrestricted_qty || 0),
                          0
                        );

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
                        const shortfallQty =
                          undeliveredQty - totalUnrestrictedQty;

                        this.setData({
                          [`dialog_insufficient.table_insufficient.${index}.undelivered_qty`]:
                            undeliveredQty,
                          [`dialog_insufficient.table_insufficient.${index}.available_qty`]:
                            totalUnrestrictedQty,
                          [`dialog_insufficient.table_insufficient.${index}.shortfall_qty`]:
                            shortfallQty,
                        });

                        if (shortfallQty > 0) {
                          this.openDialog("dialog_insufficient");
                        }
                      })
                      .catch((error) => {
                        console.error("Error fetching item_balance:", error);
                      });
                  }
                } else {
                  console.log(
                    `Skipping item ${itemId} due to stock_control or show_delivery settings`
                  );
                }
              })
              .catch((error) => {
                console.error(`Error fetching item ${itemId}:`, error);
              });
          });

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
