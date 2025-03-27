const data = this.getValues();
console.log("Data", data);
console.log("arguments", arguments[0]?.fieldModel?.item);

// Check if so_id has a value
const salesOrderId = data.so_id;
if (!salesOrderId) {
  console.log("No sales order ID found");
  return;
}

db.collection("goods_delivery")
  .where({
    so_id: salesOrderId,
  })
  .get()
  .then((response) => {
    console.log("Response from goods_delivery query:", response);
    this.setData({
      so_no: arguments[0]?.fieldModel?.item?.so_no,
    });

    const GDData = response.data || [];
    console.log("GDData extracted:", GDData);

    // Get source items from the sales order
    const sourceItems = arguments[0]?.fieldModel?.item?.table_so;
    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
      return;
    }

    // Calculate accumulated delivered quantities for each item
    const accumulatedQty = {};
    GDData.forEach((gdRecord) => {
      if (Array.isArray(gdRecord.table_gd)) {
        gdRecord.table_gd.forEach((gdItem) => {
          const itemId = gdItem.material_id;
          if (itemId) {
            // Initialize if not exists
            if (!accumulatedQty[itemId]) {
              accumulatedQty[itemId] = 0;
            }
            // Add to accumulated quantity
            accumulatedQty[itemId] += parseFloat(gdItem.gd_delivered_qty || 0);
          }
        });
      }
    });

    try {
      // First, clear the existing array
      this.setData({
        table_gd: [],
        gd_item_balance: {
          table_item_balance: [],
        },
      });

      // Create a better delay to ensure the clearing is complete
      setTimeout(() => {
        // Create the new items with proper structure including fm_key
        const newTableGd = sourceItems.map(() => ({
          material_id: "",
          gd_material_desc: "",
          gd_order_quantity: "",
          gd_delivered_qty: "",
          gd_undelivered_qty: "",
          gd_order_uom_id: "",
          unit_price: 0,
          total_price: 0,
          fm_key:
            Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        }));

        console.log("New table_gd structure:", newTableGd);

        // Set the new array structure
        this.setData({
          table_gd: newTableGd,
        });

        const newTableInsufficient = sourceItems.map(() => ({
          material_id: "",
          order_quantity: "",
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

        // Use a longer delay to ensure the array is created
        setTimeout(() => {
          sourceItems.forEach((sourceItem, index) => {
            console.log(`Processing item ${index}:`, sourceItem);

            const itemId = sourceItem.item_name || "";
            const orderedQty = parseFloat(sourceItem.so_quantity || 0);

            // Calculate remaining quantity to deliver
            const deliveredSoFar = accumulatedQty[itemId] || 0;

            console.log("deliveredSoFar", deliveredSoFar);

            // Update each field with correct values
            this.setData({
              [`table_gd.${index}.material_id`]: itemId,
              [`table_gd.${index}.gd_material_desc`]: sourceItem.so_desc || "",
              [`table_gd.${index}.gd_order_quantity`]: orderedQty,
              [`table_gd.${index}.gd_delivered_qty`]: deliveredSoFar,
              [`table_gd.${index}.gd_initial_delivered_qty`]: deliveredSoFar,
              [`table_gd.${index}.gd_order_uom_id`]:
                sourceItem.so_item_uom || "",
              [`table_gd.${index}.unit_price`]: sourceItem.so_item_price,
              [`table_gd.${index}.total_price`]: sourceItem.so_amount,
              [`dialog_insufficient.table_insufficient.${index}.material_id`]:
                itemId,
              [`dialog_insufficient.table_insufficient.${index}.order_quantity`]:
                orderedQty,
            });

            db.collection("Item")
              .where({
                id: itemId,
              })
              .get()
              .then((response) => {
                console.log("Response from item query:", response);
                const itemData = response.data[0];

                if (itemData.item_batch_management === 1) {
                  db.collection("item_batch_balance")
                    .where({
                      material_id: itemId,
                    })
                    .get()
                    .then((response) => {
                      console.log(
                        "Response from item_batch_balance query:",
                        response
                      );
                      const itemBatchBalanceData = response.data;

                      const totalUnrestrictedQty = itemBatchBalanceData.reduce(
                        (sum, balance) => sum + (balance.unrestricted_qty || 0),
                        0
                      );
                      console.log(
                        "Total unrestricted quantity:",
                        totalUnrestrictedQty
                      );

                      const shortfallQty = orderedQty - totalUnrestrictedQty;
                      console.log("shortfallQty", shortfallQty);

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
                } else {
                  db.collection("item_balance")
                    .where({
                      material_id: itemId,
                    })
                    .get()
                    .then((response) => {
                      console.log(
                        "Response from item_balance query:",
                        response
                      );

                      const itemBatchBalanceData = response.data;

                      const totalUnrestrictedQty = itemBatchBalanceData.reduce(
                        (sum, balance) => sum + (balance.unrestricted_qty || 0),
                        0
                      );
                      console.log(
                        "Total unrestricted quantity:",
                        totalUnrestrictedQty
                      );

                      const shortfallQty = orderedQty - totalUnrestrictedQty;
                      console.log("shortfallQty", shortfallQty);

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
                      console.error("Error fetching item_balance:", error);
                    });
                }
              })
              .catch((error) => {
                console.error("Error fetching item:", error);
              });
          });

          console.log("Finished populating table_gd");
        }, 200);
      }, 100);
    } catch (e) {
      console.error("Error setting up table_gd:", e);
    }
  })
  .catch((error) => {
    console.error("Error retrieving data:", error);
  });
