const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const addInventory = (data, plantId, organizationId) => {
  const items = data.table_gr;

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to process");
    return Promise.resolve();
  }

  const processedItemPromises = items.map((item, itemIndex) => {
    return new Promise(async (resolve) => {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      // Input validation
      if (
        !item.item_id ||
        !item.received_qty ||
        isNaN(parseFloat(item.received_qty)) ||
        parseFloat(item.received_qty) <= 0
      ) {
        console.error(`Invalid item data for index ${itemIndex}:`, item);
        resolve();
        return;
      }

      const calculateCostPrice = (itemData, baseQty) => {
        return db
          .collection("purchase_order")
          .where({ id: data.purchase_order_id })
          .get()
          .then((poResponse) => {
            if (!poResponse.data || !poResponse.data.length) {
              console.log(
                `No purchase order found for ${itemData.purchase_order_id}`
              );
              return itemData.unit_price;
            }

            const poData = poResponse.data[0];
            const quantity = parseFloat(baseQty) || 0;

            let unitPrice = 0;
            let discount = 0;
            let discountUOM = "";
            let taxRate = 0;
            let taxInclusive = 0;

            for (const poItem of poData.table_po) {
              if (poItem.item_id === itemData.item_id) {
                unitPrice = parseFloat(poItem.unit_price) || 0;
                discount = parseFloat(poItem.discount) || 0;
                discountUOM = poItem.discount_uom;
                taxRate = parseFloat(poItem.tax_rate_percent) || 0;
                taxInclusive = poItem.tax_inclusive;
                break;
              }
            }

            const grossValue = quantity * unitPrice;

            let discountAmount = 0;
            if (discount !== 0 && discountUOM) {
              if (discountUOM === "Amount") {
                discountAmount = discount;
              } else if (discountUOM === "%") {
                discountAmount = (grossValue * discount) / 100;
              }

              if (discountAmount > grossValue) {
                discountAmount = 0;
              }
            }

            const amountAfterDiscount = grossValue - discountAmount;

            let taxAmount = 0;
            let finalAmount = amountAfterDiscount;

            if (taxRate) {
              const taxRateDecimal = taxRate / 100;

              if (taxInclusive === 1) {
                taxAmount =
                  amountAfterDiscount -
                  amountAfterDiscount / (1 + taxRateDecimal);
                finalAmount = amountAfterDiscount;
              } else {
                taxAmount = amountAfterDiscount * taxRateDecimal;
                finalAmount = amountAfterDiscount + taxAmount;
              }
            }

            const costPrice = quantity > 0 ? finalAmount / quantity : unitPrice;

            return Math.round(costPrice * 10000) / 10000;
          })
          .catch((error) => {
            console.error(`Error calculating cost price: ${error.message}`);
            return itemData.unit_price;
          });
      };

      // Function to process FIFO for batch
      const processFifoForBatch = (itemData, baseQty, batchId) => {
        return db
          .collection("fifo_costing_history")
          .where({ material_id: itemData.item_id, batch_id: batchId })
          .get()
          .then((fifoResponse) => {
            // Get the highest existing sequence number and add 1
            let sequenceNumber = 1;
            if (
              fifoResponse.data &&
              Array.isArray(fifoResponse.data) &&
              fifoResponse.data.length > 0
            ) {
              const existingSequences = fifoResponse.data.map((doc) =>
                parseInt(doc.fifo_sequence || 0)
              );
              sequenceNumber = Math.max(...existingSequences, 0) + 1;
            }

            return calculateCostPrice(itemData, baseQty).then((costPrice) => {
              const fifoData = {
                fifo_cost_price: costPrice,
                fifo_initial_quantity: baseQty,
                fifo_available_quantity: baseQty,
                material_id: itemData.item_id,
                batch_id: batchId,
                fifo_sequence: sequenceNumber,
                plant_id: plantId,
                organization_id: organizationId,
              };

              return db
                .collection("fifo_costing_history")
                .add(fifoData)
                .then(() => {
                  console.log(
                    `Successfully processed FIFO for item ${itemData.item_id} with batch ${batchId}`
                  );
                  return Promise.resolve();
                });
            });
          });
      };

      // Function to process FIFO for non-batch
      const processFifoForNonBatch = (itemData, baseQty) => {
        return db
          .collection("fifo_costing_history")
          .where({ material_id: itemData.item_id })
          .get()
          .then((fifoResponse) => {
            // Get the highest existing sequence number and add 1
            let sequenceNumber = 1;
            if (
              fifoResponse.data &&
              Array.isArray(fifoResponse.data) &&
              fifoResponse.data.length > 0
            ) {
              const existingSequences = fifoResponse.data.map((doc) =>
                parseInt(doc.fifo_sequence || 0)
              );
              sequenceNumber = Math.max(...existingSequences, 0) + 1;
            }

            return calculateCostPrice(itemData, baseQty).then((costPrice) => {
              const fifoData = {
                fifo_cost_price: costPrice,
                fifo_initial_quantity: baseQty,
                fifo_available_quantity: baseQty,
                material_id: itemData.item_id,
                fifo_sequence: sequenceNumber,
                plant_id: plantId,
                organization_id: organizationId,
              };

              return db
                .collection("fifo_costing_history")
                .add(fifoData)
                .then(() => {
                  console.log(
                    `Successfully processed FIFO for item ${itemData.item_id}`
                  );
                  return Promise.resolve();
                });
            });
          });
      };

      const processWeightedAverageForBatch = (item, baseQty, batchId) => {
        return calculateCostPrice(item, baseQty).then((costPrice) => {
          return db
            .collection("wa_costing_method")
            .add({
              material_id: item.item_id,
              batch_id: batchId,
              plant_id: plantId,
              organization_id: organizationId,
              wa_quantity: baseQty,
              wa_cost_price: costPrice,
              created_at: new Date(),
            })
            .then(() => {
              console.log(
                `Successfully processed Weighted Average for item ${item.item_id} with batch ${batchId}`
              );
              return Promise.resolve();
            })
            .catch((error) => {
              console.error(
                `Error processing Weighted Average for item ${item.item_id} with batch ${batchId}:`,
                error
              );
              return Promise.reject(error);
            });
        });
      };

      const processWeightedAverageForNonBatch = (item, baseQty) => {
        return db
          .collection("wa_costing_method")
          .where({ material_id: item.item_id })
          .get()
          .then((waResponse) => {
            const waData = waResponse.data;
            console.log("waData", waData);
            if (waData && waData.length) {
              waData.sort((a, b) => {
                if (a.created_at && b.created_at) {
                  return new Date(b.created_at) - new Date(a.created_at);
                }
                return 0;
              });
              const latestWa = waData[0];
              console.log("latestWa", latestWa);
              const waCostPrice = latestWa.wa_cost_price;
              const waQuantity = latestWa.wa_quantity;
              const newWaQuantity = waQuantity + baseQty;
              return calculateCostPrice(item, baseQty).then((costPrice) => {
                const calculatedWaCostPrice =
                  (waCostPrice * waQuantity + costPrice * baseQty) /
                  newWaQuantity;
                const newWaCostPrice =
                  Math.round(calculatedWaCostPrice * 100) / 100;
                console.log("newWaCostPrice", newWaCostPrice);

                return db
                  .collection("wa_costing_method")
                  .doc(latestWa.id)
                  .update({
                    wa_quantity: newWaQuantity,
                    wa_cost_price: newWaCostPrice,
                    plant_id: plantId,
                    organization_id: organizationId,
                    updated_at: new Date(),
                  })
                  .then(() => {
                    console.log(
                      `Successfully processed Weighted Average for item ${item.item_id}`
                    );
                    return Promise.resolve();
                  })
                  .catch((error) => {
                    console.error(
                      `Error processing Weighted Average for item ${item.item_id}:`,
                      error
                    );
                  });
              });
            } else {
              return calculateCostPrice(item, baseQty).then((costPrice) => {
                return db
                  .collection("wa_costing_method")
                  .add({
                    material_id: item.item_id,
                    wa_quantity: baseQty,
                    wa_cost_price: costPrice,
                    plant_id: plantId,
                    organization_id: organizationId,
                    created_at: new Date(),
                  })
                  .then(() => {
                    console.log(
                      `Successfully processed Weighted Average for item ${item.item_id}`
                    );
                    return Promise.resolve();
                  })
                  .catch((error) => {
                    console.error(
                      `Error processing Weighted Average for item ${item.item_id}:`,
                      error
                    );
                  });
              });
            }
          })
          .catch((error) => {
            console.error(
              `Error processing Weighted Average for item ${item.item_id}:`,
              error
            );
            return Promise.reject(error);
          });
      };

      try {
        // First check if this item should be processed based on stock_control
        const itemRes = await db
          .collection("Item")
          .where({ id: item.item_id })
          .get();

        if (!itemRes.data || !itemRes.data.length) {
          console.error(`Item not found: ${item.item_id}`);
          resolve();
          return;
        }

        const itemData = itemRes.data[0];
        if (itemData.stock_control === 0) {
          console.log(
            `Skipping inventory update for item ${item.item_id} (stock_control=0)`
          );
          resolve();
          return;
        }

        // UOM Conversion
        let altQty = parseFloat(item.received_qty);
        let baseQty = altQty;
        let altUOM = item.item_uom;
        let baseUOM = itemData.based_uom;

        if (
          Array.isArray(itemData.table_uom_conversion) &&
          itemData.table_uom_conversion.length > 0
        ) {
          console.log(`Checking UOM conversions for item ${item.item_id}`);

          const uomConversion = itemData.table_uom_conversion.find(
            (conv) => conv.alt_uom_id === altUOM
          );

          if (uomConversion) {
            console.log(
              `Found UOM conversion: 1 ${uomConversion.alt_uom_id} = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
            );

            baseQty = Math.round(altQty * uomConversion.base_qty * 1000) / 1000;

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

        // Create inventory_movement record
        const inventoryMovementData = {
          transaction_type: "GRN",
          trx_no: data.gr_no,
          parent_trx_no: data.purchase_order_number,
          movement: "IN",
          unit_price: item.unit_price,
          total_price: item.total_price,
          quantity: altQty,
          item_id: item.item_id,
          inventory_category: item.inv_category,
          uom_id: altUOM,
          base_qty: baseQty,
          base_uom_id: baseUOM,
          bin_location_id: item.location_id,
          batch_number_id: item.item_batch_no,
          costing_method_id: item.item_costing_method,
          plant_id: plantId,
          organization_id: organizationId,
        };

        await db.collection("inventory_movement").add(inventoryMovementData);

        // Update purchase order
        const poResponse = await db
          .collection("on_order_purchase_order")
          .where({
            purchase_order_number: data.purchase_order_number,
            material_id: item.item_id,
          })
          .get();

        if (
          poResponse.data &&
          Array.isArray(poResponse.data) &&
          poResponse.data.length > 0
        ) {
          const doc = poResponse.data[0];
          if (doc && doc.id) {
            const existingReceived = parseFloat(doc.received_qty || 0);
            const openQuantity = parseFloat(doc.open_qty || 0);
            const newReceived = existingReceived + parseFloat(baseQty || 0);
            const newOpenQuantity = openQuantity - parseFloat(baseQty || 0);

            await db.collection("on_order_purchase_order").doc(doc.id).update({
              received_qty: newReceived,
              open_qty: newOpenQuantity,
            });
          }
        }

        // Setup inventory category quantities
        const itemBalanceParams = {
          material_id: item.item_id,
          location_id: item.location_id,
        };

        let block_qty = 0,
          reserved_qty = 0,
          unrestricted_qty = 0,
          qualityinsp_qty = 0,
          intransit_qty = 0;

        const receivedQty = parseFloat(baseQty || 0);

        if (item.inv_category === "BLK") {
          block_qty = receivedQty;
        } else if (item.inv_category === "RES") {
          reserved_qty = receivedQty;
        } else if (item.inv_category === "UNR") {
          unrestricted_qty = receivedQty;
        } else if (item.inv_category === "QIP") {
          qualityinsp_qty = receivedQty;
        } else if (item.inv_category === "ITR") {
          intransit_qty = receivedQty;
        } else {
          unrestricted_qty = receivedQty;
        }

        if (item.item_batch_no !== "-") {
          // Batch item processing
          return db
            .collection("batch")
            .add({
              batch_number: item.item_batch_no,
              material_id: item.item_id,
              initial_quantity: baseQty,
              goods_receiving_no: data.gr_no,
              goods_receiving_id: data.id || "",
              plant_id: plantId,
              organization_id: organizationId,
            })
            .then(() => {
              return new Promise((resolve) => setTimeout(resolve, 300));
            })
            .then(() => {
              return db
                .collection("batch")
                .where({
                  batch_number: item.item_batch_no,
                  material_id: item.item_id,
                  goods_receiving_no: data.gr_no,
                })
                .get();
            })
            .then((response) => {
              const batchResult = response.data;
              if (
                !batchResult ||
                !Array.isArray(batchResult) ||
                !batchResult.length
              ) {
                throw new Error("Batch not found after creation");
              }

              const batchId = batchResult[0].id;

              // Create new balance record
              balance_quantity =
                block_qty +
                reserved_qty +
                unrestricted_qty +
                qualityinsp_qty +
                intransit_qty;

              const newBalanceData = {
                material_id: item.item_id,
                location_id: item.location_id,
                batch_id: batchId,
                block_qty: block_qty,
                reserved_qty: reserved_qty,
                unrestricted_qty: unrestricted_qty,
                qualityinsp_qty: qualityinsp_qty,
                intransit_qty: intransit_qty,
                balance_quantity: balance_quantity,
                plant_id: plantId,
                organization_id: organizationId,
              };

              return db
                .collection("item_batch_balance")
                .add(newBalanceData)
                .then(() => {
                  console.log("Successfully added item_batch_balance record");
                  return { batchId };
                })
                .catch((error) => {
                  console.error(
                    `Error creating item_batch_balance: ${error.message}`
                  );
                  resolve();
                });
            })
            .then(({ batchId }) => {
              const costingMethod = itemData.material_costing_method;

              if (costingMethod === "First In First Out") {
                return processFifoForBatch(item, baseQty, batchId);
              } else {
                return processWeightedAverageForBatch(item, baseQty, batchId);
              }
            })
            .then(() => {
              console.log(
                `Successfully completed processing for batch item ${item.item_id}`
              );
              resolve();
            })
            .catch((error) => {
              console.error(
                `Error in batch processing chain: ${error.message}`
              );
              resolve();
            });
        } else {
          // Non-batch item processing with async/await
          try {
            const balanceResponse = await db
              .collection("item_balance")
              .where(itemBalanceParams)
              .get();

            const hasExistingBalance =
              balanceResponse.data &&
              Array.isArray(balanceResponse.data) &&
              balanceResponse.data.length > 0;
            const existingDoc = hasExistingBalance
              ? balanceResponse.data[0]
              : null;

            let balance_quantity;

            if (existingDoc && existingDoc.id) {
              // Update existing balance
              const updatedBlockQty =
                parseFloat(existingDoc.block_qty || 0) + block_qty;
              const updatedReservedQty =
                parseFloat(existingDoc.reserved_qty || 0) + reserved_qty;
              const updatedUnrestrictedQty =
                parseFloat(existingDoc.unrestricted_qty || 0) +
                unrestricted_qty;
              const updatedQualityInspQty =
                parseFloat(existingDoc.qualityinsp_qty || 0) + qualityinsp_qty;
              const updatedIntransitQty =
                parseFloat(existingDoc.intransit_qty || 0) + intransit_qty;
              balance_quantity =
                updatedBlockQty +
                updatedReservedQty +
                updatedUnrestrictedQty +
                updatedQualityInspQty +
                updatedIntransitQty;

              await db
                .collection("item_balance")
                .doc(existingDoc.id)
                .update({
                  block_qty: updatedBlockQty,
                  reserved_qty: updatedReservedQty,
                  unrestricted_qty: updatedUnrestrictedQty,
                  qualityinsp_qty: updatedQualityInspQty,
                  intransit_qty: updatedIntransitQty,
                  balance_quantity: balance_quantity,
                })
                .catch((error) => {
                  console.error(
                    `Error updating item_balance: ${error.message}`
                  );
                  resolve();
                });
            } else {
              // Create new balance record
              balance_quantity =
                block_qty +
                reserved_qty +
                unrestricted_qty +
                qualityinsp_qty +
                intransit_qty;

              const newBalanceData = {
                material_id: item.item_id,
                location_id: item.location_id,
                block_qty: block_qty,
                reserved_qty: reserved_qty,
                unrestricted_qty: unrestricted_qty,
                qualityinsp_qty: qualityinsp_qty,
                intransit_qty: intransit_qty,
                balance_quantity: balance_quantity,
                plant_id: plantId,
                organization_id: organizationId,
              };

              await db
                .collection("item_balance")
                .add(newBalanceData)
                .catch((error) => {
                  console.error(
                    `Error creating item_balance: ${error.message}`
                  );
                  resolve();
                });
            }

            const costingMethod = itemData.material_costing_method;

            if (costingMethod === "First In First Out") {
              await processFifoForNonBatch(item, baseQty);
            } else {
              await processWeightedAverageForNonBatch(item, baseQty);
            }

            console.log(
              `Successfully processed non-batch item ${item.item_id}`
            );
            resolve();
          } catch (nonBatchError) {
            console.error(
              `Error processing non-batch item: ${nonBatchError.message}`
            );
            resolve();
          }
        }
      } catch (error) {
        console.error(`Error processing item ${item.item_id}:`, error);
        console.log(`Error encountered for item ${item.item_id}`);
        resolve();
      }
    });
  });

  // Return a promise that resolves when all items are processed
  return Promise.all(processedItemPromises);
};

// Enhanced PO status update with proper error handling
const updatePurchaseOrderStatus = async (purchaseOrderId) => {
  try {
    // Store original PO status for potential rollback
    let poDoc = null;

    const [resGR, resPO] = await Promise.all([
      db
        .collection("goods_receiving")
        .where({ purchase_order_id: purchaseOrderId })
        .get(),
      db.collection("purchase_order").where({ id: purchaseOrderId }).get(),
    ]);

    const allGRs = resGR.data || [];

    if (!resPO.data || !resPO.data.length) {
      console.log(`Purchase order ${purchaseOrderId} not found`);
      return;
    }

    poDoc = resPO.data[0];
    const originalPOStatus = poDoc.po_status;

    const poItems = poDoc.table_po || [];
    if (!poItems.length) {
      console.log(`No items found in purchase order ${purchaseOrderId}`);
      return;
    }

    // Create a map to sum received quantities for each item
    const receivedQtyMap = {};

    // Initialize with zeros
    poItems.forEach((item) => {
      receivedQtyMap[item.item_id] = 0;
    });

    // Sum received quantities from all GRs
    allGRs.forEach((gr) => {
      (gr.table_gr || []).forEach((grItem) => {
        if (receivedQtyMap.hasOwnProperty(grItem.item_id)) {
          receivedQtyMap[grItem.item_id] += parseFloat(
            grItem.received_qty || 0
          );
        }
      });
    });

    // Check item completion status
    let allItemsComplete = true;
    let anyItemProcessing = false;

    poItems.forEach((item) => {
      const orderedQty = parseFloat(item.quantity || 0);
      const receivedQty = parseFloat(receivedQtyMap[item.item_id] || 0);

      if (receivedQty < orderedQty) {
        allItemsComplete = false;
        anyItemProcessing = true;
      }
    });

    // Determine new status
    let newPOStatus = poDoc.po_status;
    let newGRStatus = poDoc.gr_status;

    if (allItemsComplete) {
      newPOStatus = "Completed";
      newGRStatus = "Fully Received";
    } else if (anyItemProcessing) {
      newPOStatus = "Processing";
      newGRStatus = "Partially Received";
    }

    // Update PO status if changed
    if (newPOStatus !== poDoc.po_status || newGRStatus !== poDoc.gr_status) {
      await db.collection("purchase_order").doc(poDoc.id).update({
        po_status: newPOStatus,
        gr_status: newGRStatus,
      });

      console.log(
        `Updated PO ${purchaseOrderId} status from ${originalPOStatus} to ${newPOStatus}`
      );
    }
  } catch (error) {
    console.error(`Error updating purchase order status:`, error);
    // Status update errors shouldn't stop the process, just log them
  }
};

// Main execution flow with better error handling
this.getData()
  .then(async (data) => {
    try {
      // Input validation
      if (
        !data ||
        !data.purchase_order_id ||
        !data.gr_no ||
        !Array.isArray(data.table_gr)
      ) {
        throw new Error("Missing required data for goods receiving");
      }

      const {
        purchase_order_id,
        plant_id,
        organization_id,
        currency_code,
        purchase_order_number,
        gr_billing_name,
        gr_billing_cp,
        gr_billing_address,
        gr_shipping_address,
        supplier_name,
        supplier_contact_person,
        supplier_contact_number,
        supplier_email,
        gr_no,
        gr_received_by,
        gr_date,
        table_gr,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        billing_address_city,
        shipping_address_city,
        billing_postal_code,
        shipping_postal_code,
        billing_address_state,
        shipping_address_state,
        billing_address_country,
        shipping_address_country,
      } = data;

      const gr = {
        gr_status: "Completed",
        purchase_order_id,
        plant_id,
        currency_code,
        organization_id,
        purchase_order_number,
        gr_billing_name,
        gr_billing_cp,
        gr_billing_address,
        gr_shipping_address,
        supplier_name,
        supplier_contact_person,
        supplier_contact_number,
        supplier_email,
        gr_no,
        gr_received_by,
        gr_date,
        table_gr,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        billing_address_city,
        shipping_address_city,
        billing_postal_code,
        shipping_postal_code,
        billing_address_state,
        shipping_address_state,
        billing_address_country,
        shipping_address_country,
      };

      console.log("GR result", gr);

      if (page_status === "Add") {
        await db
          .collection("goods_receiving")
          .add(gr)
          .then(() => {
            return db
              .collection("prefix_configuration")
              .where({ document_types: "Goods Receiving", is_deleted: 0 })
              .get()
              .then((prefixEntry) => {
                const data = prefixEntry.data[0];
                return db
                  .collection("prefix_configuration")
                  .where({ document_types: "Goods Receiving", is_deleted: 0 })
                  .update({
                    running_number: parseInt(data.running_number) + 1,
                  });
              });
          });

        const result = await db
          .collection("purchase_order")
          .doc(data.purchase_order_id)
          .get();

        const plantId = result.data[0].po_plant;
        const organizationId = result.data[0].organization_id;

        await addInventory(data, plantId, organizationId);
        await updatePurchaseOrderStatus(purchase_order_id);
      } else if (page_status === "Edit") {
        const goodsReceivingId = this.getParamsVariables("goods_receiving_no");

        if (gr.gr_no.startsWith("DRAFT")) {
          const prefixEntry = db
            .collection("prefix_configuration")
            .where({ document_types: "Goods Receiving" })
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
                gr.gr_no = prefixToShow;

                db.collection("goods_receiving")
                  .doc(goodsReceivingId)
                  .update(gr);
                return prefixData.running_number;
              }
            })
            .then((currentRunningNumber) => {
              db.collection("prefix_configuration")
                .where({ document_types: "Goods Receiving", is_deleted: 0 })
                .update({ running_number: parseInt(currentRunningNumber) + 1 });
            })
            .then(() => {
              closeDialog();
            })
            .catch((error) => {
              console.log(error);
            });
        } else {
          db.collection("goods_receiving")
            .doc(goodsReceivingId)
            .update(gr)
            .then(() => {
              closeDialog();
            })
            .catch((error) => {
              console.log(error);
            });
        }

        await db.collection("goods_receiving").doc(goodsReceivingId).update(gr);
        const result = await db
          .collection("purchase_order")
          .doc(data.purchase_order_id)
          .get();

        const plantId = result.data[0].po_plant;
        const organizationId = result.data[0].organization_id;

        await addInventory(data, plantId, organizationId);
        await updatePurchaseOrderStatus(purchase_order_id);
      }

      closeDialog();
    } catch (error) {
      console.error("Error in goods receiving process:", error);
      alert(
        "An error occurred during processing. Please try again or contact support."
      );
      throw error;
    }
  })
  .catch((error) => {
    console.error("Error in goods receiving process:", error);
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
