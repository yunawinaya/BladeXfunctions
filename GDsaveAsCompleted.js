const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

// Update FIFO inventory
const updateFIFOInventory = (materialId, deliveryQty, batchId) => {
  return new Promise((resolve, reject) => {
    const query = batchId
      ? db
          .collection("fifo_costing_history")
          .where({ material_id: materialId, batch_id: batchId })
      : db
          .collection("fifo_costing_history")
          .where({ material_id: materialId });

    query
      .get()
      .then((response) => {
        const result = response.data;

        if (result && Array.isArray(result) && result.length > 0) {
          // Sort by FIFO sequence (lowest/oldest first)
          const sortedRecords = result.sort(
            (a, b) => a.fifo_sequence - b.fifo_sequence
          );

          let remainingQtyToDeduct = parseFloat(deliveryQty);
          console.log(
            `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory`
          );

          // Process each FIFO record in sequence until we've accounted for all delivery quantity
          for (const record of sortedRecords) {
            if (remainingQtyToDeduct <= 0) {
              break;
            }

            const availableQty = parseFloat(
              record.fifo_available_quantity || 0
            );
            console.log(
              `FIFO record ${record.fifo_sequence} has ${availableQty} available`
            );

            // Calculate how much to take from this record
            const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
            const newAvailableQty = availableQty - qtyToDeduct;

            console.log(
              `Deducting ${qtyToDeduct} from FIFO record ${record.fifo_sequence}, new available: ${newAvailableQty}`
            );

            // Update this FIFO record
            db.collection("fifo_costing_history")
              .doc(record.id)
              .update({
                fifo_available_quantity: newAvailableQty,
              })
              .catch((error) =>
                console.error(
                  `Error updating FIFO record ${record.fifo_sequence}:`,
                  error
                )
              );

            // Reduce the remaining quantity to deduct
            remainingQtyToDeduct -= qtyToDeduct;
          }

          if (remainingQtyToDeduct > 0) {
            console.warn(
              `Warning: Couldn't fully satisfy FIFO deduction. Remaining qty: ${remainingQtyToDeduct}`
            );
          }
        } else {
          console.warn(`No FIFO records found for material ${materialId}`);
        }
      })
      .catch((error) =>
        console.error(
          `Error retrieving FIFO history for material ${materialId}:`,
          error
        )
      )
      .then(() => {
        resolve();
      })
      .catch((error) => {
        console.error(`Error in FIFO update:`, error);
        reject(error);
      });
  });
};

const updateWeightedAverage = (item, batchId) => {
  // Input validation
  if (
    !item ||
    !item.material_id ||
    isNaN(parseFloat(item.received_qty)) ||
    parseFloat(item.received_qty) <= 0
  ) {
    console.error("Invalid item data for weighted average update:", item);
    return Promise.resolve();
  }

  const receivedQty = parseFloat(item.received_qty);
  const query = batchId
    ? db
        .collection("wa_costing_method")
        .where({ material_id: item.material_id, batch_id: batchId })
    : db
        .collection("wa_costing_method")
        .where({ material_id: item.material_id });

  return query
    .get()
    .then((waResponse) => {
      const waData = waResponse.data;

      if (!waData || !Array.isArray(waData) || waData.length === 0) {
        console.warn(
          `No weighted average records found for material ${item.material_id}`
        );
        return Promise.resolve();
      }

      // Sort by date (newest first) to get the latest record
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      const waDoc = waData[0];
      const waCostPrice = parseFloat(waDoc.wa_cost_price || 0);
      const waQuantity = parseFloat(waDoc.wa_quantity || 0);

      if (waQuantity <= receivedQty) {
        console.warn(
          `Warning: Cannot fully update weighted average for ${item.material_id} - ` +
            `Available: ${waQuantity}, Requested: ${receivedQty}`
        );

        if (waQuantity <= 0) {
          return Promise.resolve();
        }
      }

      const newWaQuantity = Math.max(0, waQuantity - receivedQty);

      // If new quantity would be zero, handle specially
      if (newWaQuantity === 0) {
        return db
          .collection("wa_costing_method")
          .doc(waDoc.id)
          .update({
            wa_quantity: 0,
            updated_at: new Date(),
          })
          .then(() => {
            console.log(
              `Updated Weighted Average for item ${item.material_id} to zero quantity`
            );
            return Promise.resolve();
          });
      }

      (waCostPrice * waQuantity - waCostPrice * receivedQty) / newWaQuantity;
      const newWaCostPrice = Math.round(calculatedWaCostPrice * 100) / 100;

      return db
        .collection("wa_costing_method")
        .doc(waDoc.id)
        .update({
          wa_quantity: newWaQuantity,
          wa_cost_price: newWaCostPrice,
          updated_at: new Date(),
        })
        .then(() => {
          console.log(
            `Successfully processed Weighted Average for item ${item.material_id}, ` +
              `new quantity: ${newWaQuantity}, new cost price: ${newWaCostPrice}`
          );
          return Promise.resolve();
        });
    })
    .catch((error) => {
      console.error(
        `Error processing Weighted Average for item ${
          item?.material_id || "unknown"
        }:`,
        error
      );
      return Promise.reject(error);
    });
};

const processBalanceTable = async (data, isUpdate, plantId, organizationId) => {
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
      const createdDocs = [];

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

          const inventoryCategory =
            data.gd_status === "Created" ? "RES" : "UNR";

          // Create inventory_movement record
          const inventoryMovementData = {
            transaction_type: "GDL",
            trx_no: data.delivery_no,
            parent_trx_no: data.so_no,
            movement: "OUT",
            unit_price: item.unit_price,
            total_price: item.total_price,
            quantity: temp.gd_quantity,
            item_id: item.material_id,
            inventory_category: inventoryCategory,
            uom_id: item.item_uom,
            base_qty: item.base_qty,
            base_uom_id: itemData.based_uom,
            bin_location_id: temp.location_id,
            batch_number_id: temp.batch_id,
            costing_method_id: item.item_costing_method,
            plant_id: plantId,
            organization_id: organizationId,
          };

          const invMovementResult = await db
            .collection("inventory_movement")
            .add(inventoryMovementData);
          createdDocs.push({
            collection: "inventory_movement",
            docId: invMovementResult.id,
          });

          const itemBalanceParams = {
            material_id: item.material_id,
            location_id: temp.location_id,
          };

          if (temp.batch_id) {
            itemBalanceParams.batch_id = temp.batch_id;
          }

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
            // Update balance
            let finalUnrestrictedQty = parseFloat(
              existingDoc.unrestricted_qty || 0
            );
            let finalReservedQty = parseFloat(existingDoc.reserved_qty || 0);
            let finalBalanceQty = parseFloat(existingDoc.balance_quantity || 0);

            if (isUpdate) {
              const gdQuantity = temp.gd_quantity - prevTemp.gd_quantity;
              finalUnrestrictedQty -= gdQuantity;
              finalReservedQty += gdQuantity;
            }

            if (data.gd_status === "Created") {
              finalReservedQty -= temp.gd_quantity;
              finalBalanceQty -= temp.gd_quantity;
            } else {
              finalUnrestrictedQty -= temp.gd_quantity;
              finalBalanceQty -= temp.gd_quantity;
            }

            updatedDocs.push({
              collection: balanceCollection,
              docId: existingDoc.id,
              originalData: {
                unrestricted_qty: existingDoc.unrestricted_qty || 0,
                reserved_qty: existingDoc.reserved_qty || 0,
                balance_quantity: existingDoc.balance_quantity || 0,
              },
            });

            await db.collection(balanceCollection).doc(existingDoc.id).update({
              unrestricted_qty: finalUnrestrictedQty,
              reserved_qty: finalReservedQty,
              balance_quantity: finalBalanceQty,
            });
          }

          const costingMethod = itemData.material_costing_method;

          if (costingMethod === "First In First Out") {
            await updateFIFOInventory(
              item.material_id,
              temp.gd_quantity,
              temp.batch_id
            );
          } else {
            await updateWeightedAverage(item, temp.batch_id);
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

// Enhanced goods delivery status update
const updateSalesOrderStatus = async (salesOrderId) => {
  try {
    const [resSO, resPO] = await Promise.all([
      db.collection("sales_order").where({ id: salesOrderId }).get(),
      db.collection("goods_delivery").where({ so_id: salesOrderId }).get(),
    ]);

    if (!resSO.data || !resSO.data.length) {
      console.log(`Sales order ${salesOrderId} not found`);
      return;
    }

    const soDoc = resSO.data[0];
    const allGDs = resPO.data || [];

    const soItems = soDoc.table_so || [];
    if (!soItems.length) {
      console.log(`No items found in sales order ${salesOrderId}`);
      return;
    }

    // Create a map to sum delivered quantities for each item
    const deliveredQtyMap = {};

    // Initialize with zeros
    soItems.forEach((item) => {
      deliveredQtyMap[item.item_name] = 0;
    });

    // Sum delivered quantities from all GDs
    allGDs.forEach((gd) => {
      (gd.table_gd || []).forEach((gdItem) => {
        if (deliveredQtyMap.hasOwnProperty(gdItem.material_id)) {
          deliveredQtyMap[gdItem.material_id] += parseFloat(gdItem.gd_qty || 0);
        }
      });
    });

    // Check item completion status
    let allItemsComplete = true;
    let anyItemProcessing = false;

    soItems.forEach((item) => {
      const orderedQty = parseFloat(item.so_quantity || 0);
      const deliveredQty = parseFloat(deliveredQtyMap[item.item_name] || 0);

      if (deliveredQty < orderedQty) {
        allItemsComplete = false;
        anyItemProcessing = true;
      }
    });

    // Determine new status
    let newSOStatus = soDoc.so_status;
    let newGDStatus = soDoc.gd_status;

    if (allItemsComplete) {
      newSOStatus = "Completed";
      newGDStatus = "Fully Delivered";
    } else if (anyItemProcessing) {
      newSOStatus = "Processing";
      newGDStatus = "Partially Delivered";
    }

    // Update SO status if changed
    if (newSOStatus !== soDoc.so_status || newGDStatus !== soDoc.gd_status) {
      await db.collection("sales_order").doc(soDoc.id).update({
        so_status: newSOStatus,
        gd_status: newGDStatus,
      });

      console.log(`Updated SO ${salesOrderId} status to ${newSOStatus}`);
    }
  } catch (error) {
    console.error(`Error updating sales order status:`, error);
  }
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
        plant_id,
        organization_id,
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

      // If this is an edit, store previous temporary quantities
      if (page_status === "Edit" && Array.isArray(table_gd)) {
        table_gd.forEach((item) => {
          item.prev_temp_qty_data = item.temp_qty_data;
        });
      }

      // Prepare goods delivery object
      const gd = {
        gd_status: "Completed",
        so_id,
        so_no,
        gd_billing_name,
        gd_billing_cp,
        gd_billing_address,
        gd_shipping_address,
        delivery_no,
        plant_id,
        organization_id,
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

        await processBalanceTable(data, false, plant_id, organization_id);
        await updateSalesOrderStatus(so_id);
      } else if (page_status === "Edit") {
        const goodsDeliveryId = this.getParamsVariables("goods_delivery_no");
        await db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);

        await processBalanceTable(data, true, plant_id, organization_id);
        await updateSalesOrderStatus(so_id);
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
