const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const processBalanceTable = async (data, isUpdate = false) => {
  const items = data.table_gd;

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to process");
    return;
  }

  const processedItemPromises = items.map(async (item, itemIndex) => {
    try {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      // Input validation
      if (!item.material_id || !item.temp_qty_data) {
        console.error(`Invalid item data for index ${itemIndex}:`, item);
        return;
      }

      // Track created or updated documents for potential rollback
      const updatedDocs = [];

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

      const temporaryData = JSON.parse(item.temp_qty_data);
      const prevTempData = isUpdate
        ? JSON.parse(item.prev_temp_qty_data)
        : null;

      if (
        temporaryData.length > 0 &&
        (!isUpdate || (prevTempData && prevTempData.length > 0))
      ) {
        for (let i = 0; i < temporaryData.length; i++) {
          const temp = temporaryData[i];
          const prevTemp = isUpdate ? prevTempData[i] : null;

          const itemBalanceParams = {
            material_id: item.material_id,
            location_id: temp.location_id,
          };

          const balanceCollection = temp.batch_id
            ? "item_batch_balance"
            : "item_balance";

          const balanceQuery = await db
            .collection(balanceCollection)
            .where(itemBalanceParams)
            .get();

          const hasExistingBalance =
            balanceQuery.data &&
            Array.isArray(balanceQuery.data) &&
            balanceQuery.data.length > 0;

          const existingDoc = hasExistingBalance ? balanceQuery.data[0] : null;

          if (existingDoc && existingDoc.id) {
            // Determine quantity change based on update or add
            const gdQuantity = isUpdate
              ? temp.gd_quantity - prevTemp.gd_quantity
              : temp.gd_quantity;

            // Store original values for potential rollback
            updatedDocs.push({
              collection: balanceCollection,
              docId: existingDoc.id,
              originalData: {
                unrestricted_qty: existingDoc.unrestricted_qty || 0,
                reserved_qty: existingDoc.reserved_qty || 0,
              },
            });

            // Update balance
            await db
              .collection(balanceCollection)
              .doc(existingDoc.id)
              .update({
                unrestricted_qty:
                  parseFloat(existingDoc.unrestricted_qty || 0) - gdQuantity,
                reserved_qty:
                  parseFloat(existingDoc.reserved_qty || 0) + gdQuantity,
              });
          }
        }
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
    }
  });

  await Promise.all(processedItemPromises);
};

// Main execution flow with improved error handling
this.getData()
  .then(async (data) => {
    try {
      // Input validation
      if (!data || !data.so_id || !Array.isArray(data.table_gd)) {
        throw new Error("Missing required data for goods delivery");
      }

      // Destructure required fields
      const {
        so_id,
        so_no,
        gd_billing_name,
        gd_billing_cp,
        gd_billing_address,
        gd_shipping_address,
        delivery_no,
        gd_ref_doc,
        plant_id,
        organization_id,
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

      // If this is an edit, store previous temporary quantities
      if (page_status === "Edit" && Array.isArray(table_gd)) {
        table_gd.forEach((item) => {
          item.prev_temp_qty_data = item.temp_qty_data;
        });
      }

      // Prepare goods delivery object
      const gd = {
        gd_status: "Created",
        so_id,
        so_no,
        plant_id,
        organization_id,
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

      // Perform action based on page status
      if (page_status === "Add") {
        await db
          .collection("goods_delivery")
          .add(gd)
          .then(() => {
            return db
              .collection("prefix_configuration")
              .where({ document_types: "Goods Delivery", is_deleted: 0 })
              .get()
              .then((prefixEntry) => {
                const data = prefixEntry.data[0];
                return db
                  .collection("prefix_configuration")
                  .where({ document_types: "Goods Delivery", is_deleted: 0 })
                  .update({
                    running_number: parseInt(data.running_number) + 1,
                  });
              });
          });
        await processBalanceTable(data);
      } else if (page_status === "Edit") {
        const goodsDeliveryId = this.getParamsVariables("goods_delivery_no");

        if (gd.delivery_no.startsWith("DRAFT")) {
          const prefixEntry = db
            .collection("prefix_configuration")
            .where({ document_types: "Goods Delivery" })
            .get()
            .then((prefixEntry) => {
              if (prefixEntry) {
                const prefixData = prefixEntry.data[0];
                const now = new Date();
                let prefixToShow = prefixData.current_prefix_config;

                prefixToShow = prefixToShow.replace(
                  "prefix",
                  prefixData.prefix_value
                );
                prefixToShow = prefixToShow.replace(
                  "suffix",
                  prefixData.suffix_value
                );
                prefixToShow = prefixToShow.replace(
                  "month",
                  String(now.getMonth() + 1).padStart(2, "0")
                );
                prefixToShow = prefixToShow.replace(
                  "day",
                  String(now.getDate()).padStart(2, "0")
                );
                prefixToShow = prefixToShow.replace("year", now.getFullYear());
                prefixToShow = prefixToShow.replace(
                  "running_number",
                  String(prefixData.running_number).padStart(
                    prefixData.padding_zeroes,
                    "0"
                  )
                );
                gd.delivery_no = prefixToShow;

                db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);
                return prefixData.running_number;
              }
            })
            .then((currentRunningNumber) => {
              db.collection("prefix_configuration")
                .where({ document_types: "Goods Delivery", is_deleted: 0 })
                .update({ running_number: parseInt(currentRunningNumber) + 1 });
            })
            .then(() => {
              closeDialog();
            })
            .catch((error) => {
              console.log(error);
            });
        } else {
          db.collection("goods_delivery")
            .doc(goodsDeliveryId)
            .update(gd)
            .then(() => {
              closeDialog();
            })
            .catch((error) => {
              console.log(error);
            });
        }

        await processBalanceTable(data, true);
      }

      // Close dialog
      closeDialog();
    } catch (error) {
      console.error("Error in goods delivery process:", error);
      alert(
        "An error occurred during processing. Please try again or contact support."
      );
      throw error;
    }
  })
  .catch((error) => {
    console.error("Error in goods delivery process:", error);
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
