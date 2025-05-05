let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

const plant_id = this.getVarSystem("deptIds").split(",")[0];
const organization_id = organizationId;

this.setData({ plant_id: plant_id, organization_id: organization_id });
const data = this.getValues();
const salesOrderId = data.so_id;
console.log("salesorderid", salesOrderId);

const savedTableGd = data.table_gd || [];
const newSoId = arguments[0]?.fieldModel?.item?.so_id || salesOrderId;

if (arguments[0]?.fieldModel?.item) {
  this.setData({ so_no: arguments[0]?.fieldModel?.item?.so_no });
}
const isSOUnchanged =
  (data.page_status === "Edit" || data.page_status === "View") &&
  salesOrderId === newSoId &&
  savedTableGd.length > 0;

if (salesOrderId) {
  this.display("address_grid");
  const resetFormFields = () => {
    this.setData({
      gd_billing_name: "",
      gd_billing_cp: "",
      billing_address_line_1: "",
      billing_address_line_2: "",
      billing_address_line_3: "",
      billing_address_line_4: "",
      billing_address_city: "",
      billing_address_state: "",
      billing_postal_code: "",
      billing_address_country: "",
      shipping_address_line_1: "",
      shipping_address_line_2: "",
      shipping_address_line_3: "",
      shipping_address_line_4: "",
      shipping_address_city: "",
      shipping_address_state: "",
      shipping_postal_code: "",
      shipping_address_country: "",
    });
  };

  resetFormFields();

  let customerIdFromSO =
    arguments[0]?.fieldModel?.item.customer_name ||
    this.getValue("customer_name");
  if (customerIdFromSO) {
    Promise.all([
      db
        .collection("address_purpose")
        .where({ purpose_name: "Shipping" })
        .get(),
      db.collection("sales_order").where({ id: salesOrderId }).get(),
    ]).then(([resShipping, resSo]) => {
      if (resSo.data.length === 0 || resShipping.data.length === 0) return;

      const soData = resSo.data[0];

      this.setData({
        customer_name: soData.customer_name,
        gd_billing_name: soData.cust_billing_name,
        gd_billing_cp: soData.cust_cp,

        shipping_address_line_1: soData.shipping_address_line_1,
        shipping_address_line_2: soData.shipping_address_line_2,
        shipping_address_line_3: soData.shipping_address_line_3,
        shipping_address_line_4: soData.shipping_address_line_4,
        shipping_address_city: soData.shipping_address_city,
        shipping_address_state: soData.shipping_address_state,
        shipping_postal_code: soData.shipping_postal_code,
        shipping_address_country: soData.shipping_address_country,
        gd_shipping_address: soData.cust_shipping_address,

        billing_address_line_1: soData.billing_address_line_1,
        billing_address_line_2: soData.billing_address_line_2,
        billing_address_line_3: soData.billing_address_line_3,
        billing_address_line_4: soData.billing_address_line_4,
        billing_address_city: soData.billing_address_city,
        billing_address_state: soData.billing_address_state,
        billing_postal_code: soData.billing_postal_code,
        billing_address_country: soData.billing_address_country,
        gd_billing_address: soData.cust_billing_address,
      });
    });
  }
}

// Check if so_id has a value
if (!salesOrderId) {
  console.log("No sales order ID found");
  return;
}

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

db.collection("goods_delivery")
  .where({
    so_id: salesOrderId,
    gd_status: "Completed",
  })
  .get()
  .then((response) => {
    console.log("Response from goods_delivery query:", response);
    if (response.data.length === 0) {
      this.setData({
        so_no: arguments[0]?.fieldModel?.item?.so_no,
      });
    }

    const GDData = response.data || [];
    console.log("GDData extracted:", GDData);

    // Get source items from the sales order
    const sourceItems = arguments[0]?.fieldModel?.item?.table_so;
    console.log("sourceItems", sourceItems);
    if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
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

            if (!deliveredQty[itemId] || currentQty > deliveredQty[itemId]) {
              deliveredQty[itemId] = currentQty;
            }
          }
        });
      }
    });

    try {
      if (!isSOUnchanged) {
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

          console.log(
            "New table_insufficient structure:",
            newTableInsufficient
          );

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
              const altUOM = sourceItem.so_item_uom || "";

              // Get the latest delivered quantity for the item
              const deliveredSoFar = deliveredQty[itemId] || 0;

              console.log("deliveredSoFar", deliveredSoFar);

              // Update each field with correct values
              db.collection("Item")
                .where({ id: itemId })
                .get()
                .then((res) => {
                  const itemData = res.data[0];
                  if (
                    itemData &&
                    itemData.stock_control !== 0 &&
                    (itemData.show_delivery !== 0 || !itemData.show_delivery)
                  ) {
                    this.setData({
                      [`table_gd.${index}.material_id`]: itemId,
                      [`table_gd.${index}.gd_material_desc`]:
                        sourceItem.so_desc || "",
                      [`table_gd.${index}.gd_order_quantity`]: orderedQty,
                      [`table_gd.${index}.gd_delivered_qty`]: deliveredSoFar,
                      [`table_gd.${index}.gd_initial_delivered_qty`]:
                        deliveredSoFar,
                      [`table_gd.${index}.gd_order_uom_id`]: altUOM,
                      [`table_gd.${index}.good_delivery_uom_id`]: altUOM,
                      [`table_gd.${index}.base_uom_id`]:
                        itemData.based_uom || "",
                      [`table_gd.${index}.unit_price`]:
                        sourceItem.so_item_price,
                      [`table_gd.${index}.total_price`]: sourceItem.so_amount,
                      [`table_gd.${index}.item_costing_method`]:
                        itemData.material_costing_method,
                      [`dialog_insufficient.table_insufficient.${index}.material_id`]:
                        itemId,
                      [`dialog_insufficient.table_insufficient.${index}.order_quantity`]:
                        orderedQty,
                    });
                  } else {
                    console.log(
                      `Skipping item ${itemId} due to stock_control or show_delivery settings`
                    );
                  }
                })
                .catch((error) => {
                  console.error("Error fetching item:", error);
                });

              db.collection("Item")
                .where({
                  id: itemId,
                })
                .get()
                .then((response) => {
                  console.log("Response from item query:", response);
                  const itemData = response.data[0];
                  const baseUOM = itemData.based_uom || "";

                  if (
                    itemData.item_batch_management === 1 &&
                    itemData.stock_control !== 0
                  ) {
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

                        console.log(
                          "Total unrestricted quantity in base units:",
                          totalUnrestrictedQtyBase
                        );
                        console.log(
                          `Total unrestricted quantity in ${altUOM}:`,
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
                  } else if (
                    itemData.item_batch_management === 0 &&
                    itemData.stock_control !== 0
                  ) {
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

                        const itemBalanceData = response.data;

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

                        console.log(
                          "Total unrestricted quantity in base units:",
                          totalUnrestrictedQtyBase
                        );
                        console.log(
                          `Total unrestricted quantity in ${altUOM}:`,
                          totalUnrestrictedQty
                        );

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
                })
                .catch((error) => {
                  console.error("Error fetching item:", error);
                });
            });

            console.log("Finished populating table_gd");
          }, 200);
        }, 100);
      } else {
        console.log("Preserving existing table_gd data during edit");
      }
    } catch (e) {
      console.error("Error setting up table_gd:", e);
    }
  })
  .catch((error) => {
    console.error("Error retrieving data:", error);
  });
