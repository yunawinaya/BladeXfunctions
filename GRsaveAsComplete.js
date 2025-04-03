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

      // Track created documents for potential rollback
      const createdDocs = [];
      const updatedDocs = [];

      // Function to process FIFO for batch
      const processFifoForBatch = (itemData, batchId) => {
        // Improved FIFO sequence generation
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

            // Add a small random component to handle potential concurrent operations
            const fifoData = {
              fifo_cost_price: itemData.unit_price,
              fifo_initial_quantity: itemData.received_qty,
              fifo_available_quantity: itemData.received_qty,
              material_id: itemData.item_id,
              batch_id: batchId,
              fifo_sequence: sequenceNumber,
              plant_id: plantId,
              organization_id: organizationId,
            };

            return db
              .collection("fifo_costing_history")
              .add(fifoData)
              .then((fifoResult) => {
                createdDocs.push({
                  collection: "fifo_costing_history",
                  docId: fifoResult.id,
                });

                console.log(
                  `Successfully processed FIFO for item ${itemData.item_id} with batch ${batchId}`
                );
                return Promise.resolve();
              });
          });
      };

      // Function to process FIFO for non-batch
      const processFifoForNonBatch = (itemData) => {
        // Improved FIFO sequence generation
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

            // Create FIFO record
            const fifoData = {
              fifo_cost_price: itemData.unit_price,
              fifo_initial_quantity: itemData.received_qty,
              fifo_available_quantity: itemData.received_qty,
              material_id: itemData.item_id,
              fifo_sequence: sequenceNumber,
              plant_id: plantId,
              organization_id: organizationId,
            };

            return db
              .collection("fifo_costing_history")
              .add(fifoData)
              .then((fifoResult) => {
                createdDocs.push({
                  collection: "fifo_costing_history",
                  docId: fifoResult.id,
                });

                console.log(
                  `Successfully processed FIFO for item ${itemData.item_id}`
                );
                return Promise.resolve();
              });
          });
      };

      const processWeightedAverageForBatch = (item, batchId) => {
        return db
          .collection("wa_costing_method")
          .add({
            material_id: item.item_id,
            batch_id: batchId,
            plant_id: plantId,
            organization_id: organizationId,
            wa_quantity: item.received_qty,
            wa_cost_price: item.unit_price,
            created_at: new Date(),
          })
          .then((waResult) => {
            createdDocs.push({
              collection: "wa_costing_method",
              docId: waResult.id,
            });

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
      };

      const processWeightedAverageForNonBatch = (item) => {
        return db
          .collection("wa_costing_method")
          .where({ material_id: item.item_id })
          .get()
          .then((waResponse) => {
            const waData = waResponse.data;
            if (waData && waData.length) {
              waData.sort((a, b) => {
                if (a.created_at && b.created_at) {
                  return new Date(b.created_at) - new Date(a.created_at);
                }
                return 0;
              });
              const latestWa = waData[0];
              const waCostPrice = latestWa.wa_cost_price;
              const waQuantity = latestWa.wa_quantity;
              const newWaQuantity = waQuantity + item.received_qty;
              const newWaCostPrice =
                (waCostPrice * waQuantity +
                  item.unit_price * item.received_qty) /
                newWaQuantity;

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
                  updatedDocs.push({
                    collection: "wa_costing_method",
                    docId: latestWa.id,
                    originalData: {
                      wa_quantity: waQuantity,
                      wa_cost_price: waCostPrice,
                    },
                  });

                  console.log(
                    `Successfully processed Weighted Average for item ${item.item_id}`
                  );
                  return Promise.resolve();
                });
            } else {
              return db
                .collection("wa_costing_method")
                .add({
                  material_id: item.item_id,
                  wa_quantity: item.received_qty,
                  wa_cost_price: item.unit_price,
                  plant_id: plantId,
                  organization_id: organizationId,
                  created_at: new Date(),
                })
                .then((waResult) => {
                  createdDocs.push({
                    collection: "wa_costing_method",
                    docId: waResult.id,
                  });

                  console.log(
                    `Successfully processed Weighted Average for item ${item.item_id}`
                  );
                  return Promise.resolve();
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
          resolve(); // Skip if item not found
          return;
        }

        const itemData = itemRes.data[0];
        if (itemData.stock_control === 0) {
          console.log(
            `Skipping inventory update for item ${item.item_id} (stock_control=0)`
          );
          resolve(); // Skip inventory updates for this item
          return;
        }

        // Create inventory_movement record
        const inventoryMovementData = {
          transaction_type: "GRN",
          trx_no: data.gr_no,
          parent_trx_no: data.purchase_order_number,
          movement: "IN",
          unit_price: item.unit_price,
          total_price: item.total_price,
          quantity: item.received_qty,
          item_id: item.item_id,
          inventory_category: item.inv_category,
          uom_id: item.item_uom,
          base_qty: item.received_qty,
          base_uom_id: itemData.based_uom,
          bin_location_id: item.location_id,
          batch_number_id: item.item_batch_no,
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
            const orderedQty = parseFloat(item.ordered_qty || 0);
            const existingReceived = parseFloat(doc.received_qty || 0);
            const newReceived =
              existingReceived + parseFloat(item.received_qty || 0);
            const openQuantity = orderedQty - newReceived;

            // Store original values for potential rollback
            updatedDocs.push({
              collection: "on_order_purchase_order",
              docId: doc.id,
              originalData: {
                received_qty: existingReceived,
                open_qty: doc.open_qty || 0,
              },
            });

            await db.collection("on_order_purchase_order").doc(doc.id).update({
              received_qty: newReceived,
              open_qty: openQuantity,
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
          qualityinsp_qty = 0;

        const receivedQty = parseFloat(item.received_qty || 0);

        if (item.inv_category === "BLK") {
          block_qty = receivedQty;
        } else if (item.inv_category === "RES") {
          reserved_qty = receivedQty;
        } else if (item.inv_category === "UNR") {
          unrestricted_qty = receivedQty;
        } else if (item.inv_category === "QIP") {
          qualityinsp_qty = receivedQty;
        } else {
          unrestricted_qty = receivedQty;
        }

        // Following your existing logic for batch identification
        if (item.item_batch_no !== "-") {
          // Batch item processing
          return db
            .collection("batch")
            .add({
              batch_number: item.item_batch_no,
              material_id: item.item_id,
              initial_quantity: item.received_qty,
              goods_receiving_no: data.gr_no,
              goods_receiving_id: data.id || "",
              plant_id: plantId,
              organization_id: organizationId,
            })
            .then((batchResult) => {
              // Query for the batch document after creation
              return db
                .collection("batch")
                .where({
                  batch_number: item.item_batch_no,
                  material_id: item.item_id,
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

              // Track created batch document
              createdDocs.push({
                collection: "batch",
                docId: batchResult[0].id,
              });

              // Continue with item_batch_balance handling
              return db
                .collection("item_batch_balance")
                .where({
                  material_id: item.item_id,
                  location_id: item.location_id,
                  batch_id: batchResult[0].id,
                })
                .get();
            })
            .then((balanceResponse) => {
              const hasExistingBalance =
                balanceResponse.data &&
                Array.isArray(balanceResponse.data) &&
                balanceResponse.data.length > 0;
              const existingDoc = hasExistingBalance
                ? balanceResponse.data[0]
                : null;

              // Store the batchId from the previous step
              const batchId = createdDocs.find(
                (doc) => doc.collection === "batch"
              ).docId;

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
                  parseFloat(existingDoc.qualityinsp_qty || 0) +
                  qualityinsp_qty;
                balance_quantity =
                  updatedBlockQty +
                  updatedReservedQty +
                  updatedUnrestrictedQty +
                  updatedQualityInspQty;

                // Store original values for rollback
                updatedDocs.push({
                  collection: "item_batch_balance",
                  docId: existingDoc.id,
                  originalData: {
                    block_qty: existingDoc.block_qty || 0,
                    reserved_qty: existingDoc.reserved_qty || 0,
                    unrestricted_qty: existingDoc.unrestricted_qty || 0,
                    qualityinsp_qty: existingDoc.qualityinsp_qty || 0,
                    balance_quantity: existingDoc.balance_quantity || 0,
                  },
                });

                return db
                  .collection("item_batch_balance")
                  .doc(existingDoc.id)
                  .update({
                    batch_id: batchId,
                    block_qty: updatedBlockQty,
                    reserved_qty: updatedReservedQty,
                    unrestricted_qty: updatedUnrestrictedQty,
                    qualityinsp_qty: updatedQualityInspQty,
                    balance_quantity: balance_quantity,
                  })
                  .then(() => {
                    return { batchId };
                  });
              } else {
                // Create new balance record
                balance_quantity =
                  block_qty + reserved_qty + unrestricted_qty + qualityinsp_qty;

                const newBalanceData = {
                  material_id: item.item_id,
                  location_id: item.location_id,
                  batch_id: batchId,
                  block_qty: block_qty,
                  reserved_qty: reserved_qty,
                  unrestricted_qty: unrestricted_qty,
                  qualityinsp_qty: qualityinsp_qty,
                  balance_quantity: balance_quantity,
                  plant_id: plantId,
                  organization_id: organizationId,
                };

                return db
                  .collection("item_batch_balance")
                  .add(newBalanceData)
                  .then((balanceResult) => {
                    createdDocs.push({
                      collection: "item_batch_balance",
                      docId: balanceResult.id,
                    });

                    return { batchId };
                  });
              }
            })
            .then(({ batchId }) => {
              const costingMethod = itemData.material_costing_method;

              if (costingMethod === "First In First Out") {
                return processFifoForBatch(item, batchId);
              } else {
                return processWeightedAverageForBatch(item, batchId);
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
              balance_quantity =
                updatedBlockQty +
                updatedReservedQty +
                updatedUnrestrictedQty +
                updatedQualityInspQty;

              // Store original values for rollback
              updatedDocs.push({
                collection: "item_balance",
                docId: existingDoc.id,
                originalData: {
                  block_qty: existingDoc.block_qty || 0,
                  reserved_qty: existingDoc.reserved_qty || 0,
                  unrestricted_qty: existingDoc.unrestricted_qty || 0,
                  qualityinsp_qty: existingDoc.qualityinsp_qty || 0,
                  balance_quantity: existingDoc.balance_quantity || 0,
                },
              });

              await db.collection("item_balance").doc(existingDoc.id).update({
                block_qty: updatedBlockQty,
                reserved_qty: updatedReservedQty,
                unrestricted_qty: updatedUnrestrictedQty,
                qualityinsp_qty: updatedQualityInspQty,
                balance_quantity: balance_quantity,
              });
            } else {
              // Create new balance record
              balance_quantity =
                block_qty + reserved_qty + unrestricted_qty + qualityinsp_qty;

              const newBalanceData = {
                material_id: item.item_id,
                location_id: item.location_id,
                block_qty: block_qty,
                reserved_qty: reserved_qty,
                unrestricted_qty: unrestricted_qty,
                qualityinsp_qty: qualityinsp_qty,
                balance_quantity: balance_quantity,
                plant_id: plantId,
                organization_id: organizationId,
              };

              const balanceResult = await db
                .collection("item_balance")
                .add(newBalanceData);
              createdDocs.push({
                collection: "item_balance",
                docId: balanceResult.id,
              });
            }

            const costingMethod = itemData.material_costing_method;

            if (costingMethod === "First In First Out") {
              await processFifoForNonBatch(item);
            } else {
              await processWeightedAverageForNonBatch(item);
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
        console.log(`Rollback completed for item ${item.item_id}`);
        resolve(); // Resolve after rollback to continue with other items
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
    let originalPOStatus = null;
    let originalGRStatus = null;
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
    originalPOStatus = poDoc.po_status;
    originalGRStatus = poDoc.gr_status;

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
        await db.collection("goods_receiving").add(gr);

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
      throw error; // Re-throw to be caught by outer catch
    }
  })
  .catch((error) => {
    console.error("Error in goods receiving process:", error);
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
