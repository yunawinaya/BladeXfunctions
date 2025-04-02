const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const addBalanceTable = (data) => {
  const items = data.table_gd;

  if (Array.isArray(items)) {
    items.forEach(async (item, itemIndex) => {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      try {
        const itemRes = await db
          .collection("item")
          .where({ id: item.material_id })
          .get();

        if (!itemRes.data || !itemRes.data.length) {
          console.error(`Item not found: ${item.item_id}`);
          return;
        }

        const itemData = itemRes.data[0];
        if (itemData.stock_control === 0) {
          console.log(
            `Skipping inventory update for item ${item.item_id} (stock_control=0)`
          );
          return;
        }

        const temporaryData = JSON.parse(item.temp_qty_data);
        console.log("Temporary data:", temporaryData);

        if (temporaryData.length > 0) {
          for (const temp of temporaryData) {
            const itemBalanceParams = {
              material_id: item.material_id,
              location_id: temp.location_id,
            };

            if (temp.batch_id) {
              db.collection("item_batch_balance")
                .where(itemBalanceParams)
                .get()
                .then((response) => {
                  const result = response.data;
                  const hasExistingBalance =
                    result && Array.isArray(result) && result.length > 0;
                  const existingDoc = hasExistingBalance ? result[0] : null;

                  if (existingDoc && existingDoc.id) {
                    const updatedUnrestrictedQty =
                      parseFloat(existingDoc.unrestricted_qty || 0) -
                      temp.gd_quantity;

                    const updatedReservedQty =
                      parseFloat(existingDoc.reserved_qty || 0) +
                      temp.gd_quantity;

                    db.collection("item_batch_balance")
                      .doc(existingDoc.id)
                      .update({
                        unrestricted_qty: updatedUnrestrictedQty,
                        reserved_qty: updatedReservedQty,
                      });
                  } else {
                    console.log("No existing item_batch_balance found");
                  }
                })
                .catch((error) =>
                  console.error(
                    `Error updating item_batch_balance for item ${
                      itemIndex + 1
                    }:`,
                    error
                  )
                );
            } else {
              db.collection("item_balance")
                .where(itemBalanceParams)
                .get()
                .then((response) => {
                  const result = response.data;
                  const hasExistingBalance =
                    result && Array.isArray(result) && result.length > 0;
                  const existingDoc = hasExistingBalance ? result[0] : null;

                  if (existingDoc && existingDoc.id) {
                    const updatedUnrestrictedQty =
                      parseFloat(existingDoc.unrestricted_qty || 0) -
                      temp.gd_quantity;

                    const updatedReservedQty =
                      parseFloat(existingDoc.reserved_qty || 0) +
                      temp.gd_quantity;

                    db.collection("item_balance").doc(existingDoc.id).update({
                      unrestricted_qty: updatedUnrestrictedQty,
                      reserved_qty: updatedReservedQty,
                    });
                  } else {
                    console.log("No existing item_balance found");
                  }
                })
                .catch((error) =>
                  console.error(
                    `Error querying item_balance for item ${itemIndex + 1}:`,
                    error
                  )
                );
            }
          }
        }
      } catch (error) {
        console.error(`Error processing item ${itemIndex + 1}:`, error);
      }
    });
  }
};

const updateBalanceTable = (data) => {
  const items = data.table_gd;

  if (Array.isArray(items)) {
    items.forEach(async (item, itemIndex) => {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      try {
        const itemRes = await db
          .collection("item")
          .where({ id: item.material_id })
          .get();

        if (!itemRes.data || !itemRes.data.length) {
          console.error(`Item not found: ${item.item_id}`);
          return;
        }

        const itemData = itemRes.data[0];
        if (itemData.stock_control === 0) {
          console.log(
            `Skipping inventory update for item ${item.item_id} (stock_control=0)`
          );
          return;
        }

        const temporaryData = JSON.parse(item.temp_qty_data);
        const prevTempData = JSON.parse(item.prev_temp_qty_data);
        console.log("Temporary data:", temporaryData);
        console.log("Previous temporary data:", prevTempData);

        if (temporaryData.length > 0 && prevTempData.length > 0) {
          for (let i = 0; i < temporaryData.length; i++) {
            const temp = temporaryData[i];
            const prevTemp = prevTempData[i];

            const itemBatchBalanceParams = {
              material_id: item.material_id,
              location_id: temp.location_id,
              batch_id: temp.batch_id,
            };

            const itemBalanceParams = {
              material_id: item.material_id,
              location_id: temp.location_id,
            };

            if (temp.batch_id) {
              db.collection("item_batch_balance")
                .where(itemBatchBalanceParams)
                .get()
                .then((response) => {
                  const result = response.data;
                  const hasExistingBalance =
                    result && Array.isArray(result) && result.length > 0;
                  const existingDoc = hasExistingBalance ? result[0] : null;

                  if (existingDoc && existingDoc.id) {
                    const updatedUnrestrictedQty =
                      parseFloat(existingDoc.unrestricted_qty || 0) -
                      (temp.gd_quantity - prevTemp.gd_quantity);

                    const updatedReservedQty =
                      parseFloat(existingDoc.reserved_qty || 0) +
                      (temp.gd_quantity - prevTemp.gd_quantity);

                    db.collection("item_batch_balance")
                      .doc(existingDoc.id)
                      .update({
                        unrestricted_qty: updatedUnrestrictedQty,
                        reserved_qty: updatedReservedQty,
                      });
                  } else {
                    console.log("No existing item_batch_balance found");
                  }
                })
                .catch((error) =>
                  console.error(
                    `Error updating item_batch_balance for item ${
                      itemIndex + 1
                    }:`,
                    error
                  )
                );
            } else {
              db.collection("item_balance")
                .where(itemBalanceParams)
                .get()
                .then((response) => {
                  const result = response.data;
                  const hasExistingBalance =
                    result && Array.isArray(result) && result.length > 0;
                  const existingDoc = hasExistingBalance ? result[0] : null;

                  if (existingDoc && existingDoc.id) {
                    const updatedUnrestrictedQty =
                      parseFloat(existingDoc.unrestricted_qty || 0) -
                      (temp.gd_quantity - prevTemp.gd_quantity);

                    const updatedReservedQty =
                      parseFloat(existingDoc.reserved_qty || 0) +
                      (temp.gd_quantity - prevTemp.gd_quantity);

                    db.collection("item_balance").doc(existingDoc.id).update({
                      unrestricted_qty: updatedUnrestrictedQty,
                      reserved_qty: updatedReservedQty,
                    });
                  } else {
                    console.log("No existing item_balance found");
                  }
                })
                .catch((error) =>
                  console.error(
                    `Error querying item_balance for item ${itemIndex + 1}:`,
                    error
                  )
                );
            }
          }
        }
      } catch (error) {
        console.error(`Error processing item ${itemIndex + 1}:`, error);
      }
    });
  }
};

this.getData()
  .then((data) => {
    const {
      so_id,
      so_no,
      gd_billing_name,
      gd_billing_cp,
      gd_billing_address,
      gd_shipping_address,
      delivery_no,
      gd_ref_doc,
      customer_name,
      gd_contact_name,
      contact_number,
      email_address,
      document_description,
      gd_delivery_method,
      delivery_date,
      driver_name,
      driver_contact_no,
      validity_of_collection,
      vehicle_no,
      pickup_date,
      courier_company,
      shipping_date,
      freight_charges,
      tracking_number,
      est_arrival_date,
      driver_cost,
      est_delivery_date,
      shipping_company,
      shipping_method,
      table_gd,
      order_remark,
      billing_address_line_1,
      billing_address_line_2,
      billing_address_line_3,
      billing_address_line_4,
      billing_address_city,
      billing_address_state,
      billing_address_country,
      billing_postal_code,
      shipping_address_line_1,
      shipping_address_line_2,
      shipping_address_line_3,
      shipping_address_line_4,
      shipping_address_city,
      shipping_address_state,
      shipping_address_country,
      shipping_postal_code,
    } = data;

    if (Array.isArray(table_gd)) {
      table_gd.forEach((item) => {
        item.prev_temp_qty_data = item.temp_qty_data;
      });
    }

    const gd = {
      gd_status: "Created",
      so_id,
      so_no,
      gd_billing_name,
      gd_billing_cp,
      gd_billing_address,
      gd_shipping_address,
      delivery_no,
      gd_ref_doc,
      customer_name,
      gd_contact_name,
      contact_number,
      email_address,
      document_description,
      gd_delivery_method,
      delivery_date,
      driver_name,
      driver_contact_no,
      validity_of_collection,
      vehicle_no,
      pickup_date,
      courier_company,
      shipping_date,
      freight_charges,
      tracking_number,
      est_arrival_date,
      driver_cost,
      est_delivery_date,
      shipping_company,
      shipping_method,
      table_gd,
      order_remark,
      billing_address_line_1,
      billing_address_line_2,
      billing_address_line_3,
      billing_address_line_4,
      billing_address_city,
      billing_address_state,
      billing_address_country,
      billing_postal_code,
      shipping_address_line_1,
      shipping_address_line_2,
      shipping_address_line_3,
      shipping_address_line_4,
      shipping_address_city,
      shipping_address_state,
      shipping_address_country,
      shipping_postal_code,
    };

    if (page_status === "Add") {
      db.collection("goods_delivery").add(gd);
      addBalanceTable(data);
    } else if (page_status === "Edit") {
      const goodsDeliveryId = this.getParamsVariables("goods_delivery_no");
      db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);
      updateBalanceTable(data);
    }
  })
  .then(() => {
    closeDialog();
  })
  .catch(() => {
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
