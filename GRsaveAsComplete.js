const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const addInventory = (data) => {
  const items = data.table_gr;

  if (Array.isArray(items)) {
    const processedItemPromises = items.map((item, itemIndex) => {
      return new Promise((resolve) => {
        console.log(`Processing item ${itemIndex + 1}/${items.length}`);

        // Track created documents for potential rollback
        const createdDocs = [];
        const updatedDocs = [];

        // Function to rollback changes if any operation fails
        const rollbackChanges = async () => {
          console.log(`Rolling back changes for item ${item.item_id}`);

          // Delete all created documents in reverse order
          for (let i = createdDocs.length - 1; i >= 0; i--) {
            try {
              const { collection, docId } = createdDocs[i];
              await db.collection(collection).doc(docId).delete();
              console.log(`Deleted ${collection} document ${docId}`);
            } catch (error) {
              console.error(`Error rolling back created document:`, error);
            }
          }

          // Revert all updated documents
          for (let i = updatedDocs.length - 1; i >= 0; i--) {
            try {
              const { collection, docId, originalData } = updatedDocs[i];
              await db.collection(collection).doc(docId).update(originalData);
              console.log(`Reverted ${collection} document ${docId}`);
            } catch (error) {
              console.error(`Error rolling back updated document:`, error);
            }
          }
        };

        // First check if this item should be processed based on stock_control
        db.collection("Item")
          .where({ id: item.item_id })
          .get()
          .then((res) => {
            if (!res.data || !res.data.length) {
              console.error(`Item not found: ${item.item_id}`);
              resolve(); // Skip if item not found
              return;
            }

            const itemData = res.data[0];
            if (itemData.stock_control === 0) {
              console.log(
                `Skipping inventory update for item ${item.item_id} (stock_control=0)`
              );
              resolve(); // Skip inventory updates for this item
              return;
            }

            // Continue with inventory operations if stock_control is not 0
            db.collection("inventory_movement")
              .add({
                transaction_type: "GRN",
                trx_no: data.gr_no,
                parent_trx_no: data.purchase_order_number,
                movement: "IN",
                unit_price: item.unit_price,
                total_price: item.total_price,
                quantity: item.received_qty,
                material_id: item.item_id,
                inventory_category: item.inv_category,
                uom_id: item.item_uom,
                base_uom_id: item.base_uom_id,
                bin_location_id: item.location_id,
                batch_number_id: item.item_batch_no,
                costing_method_id: item.item_costing_method,
              })
              .then((result) => {
                // Track this created document for potential rollback
                createdDocs.push({
                  collection: "inventory_movement",
                  docId: result.id,
                });

                return db
                  .collection("on_order_purchase_order")
                  .where({
                    purchase_order_number: data.purchase_order_number,
                    material_id: item.item_id,
                  })
                  .get();
              })
              .then((response) => {
                const result = response.data;
                if (result && Array.isArray(result) && result.length > 0) {
                  const doc = result[0];
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

                    return db
                      .collection("on_order_purchase_order")
                      .doc(doc.id)
                      .update({
                        received_qty: newReceived,
                        open_qty: openQuantity,
                      });
                  }
                }
                return Promise.resolve();
              })
              .then(() => {
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
                    })
                    .then((batchResult) => {
                      // Track created batch document
                      createdDocs.push({
                        collection: "batch",
                        docId: batchResult.id,
                      });

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

                      const batchDoc = batchResult[0];

                      return db
                        .collection("item_batch_balance")
                        .where(itemBalanceParams)
                        .get()
                        .then((response) => {
                          const result = response.data;
                          const hasExistingBalance =
                            result &&
                            Array.isArray(result) &&
                            result.length > 0;
                          const existingDoc = hasExistingBalance
                            ? result[0]
                            : null;

                          if (existingDoc && existingDoc.id) {
                            // Update existing balance
                            const updatedBlockQty =
                              parseFloat(existingDoc.block_qty || 0) +
                              block_qty;
                            const updatedReservedQty =
                              parseFloat(existingDoc.reserved_qty || 0) +
                              reserved_qty;
                            const updatedUnrestrictedQty =
                              parseFloat(existingDoc.unrestricted_qty || 0) +
                              unrestricted_qty;
                            const updatedQualityInspQty =
                              parseFloat(existingDoc.qualityinsp_qty || 0) +
                              qualityinsp_qty;
                            const balance_quantity =
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
                                unrestricted_qty:
                                  existingDoc.unrestricted_qty || 0,
                                qualityinsp_qty:
                                  existingDoc.qualityinsp_qty || 0,
                                balance_quantity:
                                  existingDoc.balance_quantity || 0,
                              },
                            });

                            return db
                              .collection("item_batch_balance")
                              .doc(existingDoc.id)
                              .update({
                                batch_id: batchDoc.id,
                                block_qty: updatedBlockQty,
                                reserved_qty: updatedReservedQty,
                                unrestricted_qty: updatedUnrestrictedQty,
                                qualityinsp_qty: updatedQualityInspQty,
                                balance_quantity: balance_quantity,
                              });
                          } else {
                            // Create new balance record
                            const balance_quantity =
                              block_qty +
                              reserved_qty +
                              unrestricted_qty +
                              qualityinsp_qty;

                            return db
                              .collection("item_batch_balance")
                              .add({
                                material_id: item.item_id,
                                location_id: item.location_id,
                                batch_id: batchDoc.id,
                                block_qty: block_qty,
                                reserved_qty: reserved_qty,
                                unrestricted_qty: unrestricted_qty,
                                qualityinsp_qty: qualityinsp_qty,
                                balance_quantity: balance_quantity,
                              })
                              .then((result) => {
                                createdDocs.push({
                                  collection: "item_batch_balance",
                                  docId: result.id,
                                });
                                return Promise.resolve();
                              });
                          }
                        });
                    })
                    .then(() => {
                      return db
                        .collection("fifo_costing_history")
                        .where({ material_id: item.item_id })
                        .get();
                    })
                    .then((response) => {
                      const result = response.data;
                      const sequenceNumber =
                        result && Array.isArray(result) && result.length > 0
                          ? result.length + 1
                          : 1;

                      return db.collection("fifo_costing_history").add({
                        fifo_cost_price: item.unit_price,
                        fifo_initial_quantity: item.received_qty,
                        fifo_available_quantity: item.received_qty,
                        material_id: item.item_id,
                        batch_id: batchDoc.id,
                        fifo_sequence: sequenceNumber,
                      });
                    })
                    .then((result) => {
                      createdDocs.push({
                        collection: "fifo_costing_history",
                        docId: result.id,
                      });
                      console.log(
                        `Successfully processed batch item ${item.item_id}`
                      );
                      resolve(); // All operations succeeded
                    });
                } else {
                  // Non-batch item processing
                  return db
                    .collection("item_balance")
                    .where(itemBalanceParams)
                    .get()
                    .then((response) => {
                      const result = response.data;
                      const hasExistingBalance =
                        result && Array.isArray(result) && result.length > 0;
                      const existingDoc = hasExistingBalance ? result[0] : null;

                      if (existingDoc && existingDoc.id) {
                        // Update existing balance
                        const updatedBlockQty =
                          parseFloat(existingDoc.block_qty || 0) + block_qty;
                        const updatedReservedQty =
                          parseFloat(existingDoc.reserved_qty || 0) +
                          reserved_qty;
                        const updatedUnrestrictedQty =
                          parseFloat(existingDoc.unrestricted_qty || 0) +
                          unrestricted_qty;
                        const updatedQualityInspQty =
                          parseFloat(existingDoc.qualityinsp_qty || 0) +
                          qualityinsp_qty;
                        const balance_quantity =
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

                        return db
                          .collection("item_balance")
                          .doc(existingDoc.id)
                          .update({
                            block_qty: updatedBlockQty,
                            reserved_qty: updatedReservedQty,
                            unrestricted_qty: updatedUnrestrictedQty,
                            qualityinsp_qty: updatedQualityInspQty,
                            balance_quantity: balance_quantity,
                          });
                      } else {
                        // Create new balance record
                        const balance_quantity =
                          block_qty +
                          reserved_qty +
                          unrestricted_qty +
                          qualityinsp_qty;

                        return db
                          .collection("item_balance")
                          .add({
                            material_id: item.item_id,
                            location_id: item.location_id,
                            block_qty: block_qty,
                            reserved_qty: reserved_qty,
                            unrestricted_qty: unrestricted_qty,
                            qualityinsp_qty: qualityinsp_qty,
                            balance_quantity: balance_quantity,
                          })
                          .then((result) => {
                            createdDocs.push({
                              collection: "item_balance",
                              docId: result.id,
                            });
                            return Promise.resolve();
                          });
                      }
                    })
                    .then(() => {
                      return db
                        .collection("fifo_costing_history")
                        .where({ material_id: item.item_id })
                        .get();
                    })
                    .then((response) => {
                      const result = response.data;
                      const sequenceNumber =
                        result && Array.isArray(result) && result.length > 0
                          ? result.length + 1
                          : 1;

                      return db.collection("fifo_costing_history").add({
                        fifo_cost_price: item.unit_price,
                        fifo_initial_quantity: item.received_qty,
                        fifo_available_quantity: item.received_qty,
                        material_id: item.item_id,
                        fifo_sequence: sequenceNumber,
                      });
                    })
                    .then((result) => {
                      createdDocs.push({
                        collection: "fifo_costing_history",
                        docId: result.id,
                      });
                      console.log(
                        `Successfully processed non-batch item ${item.item_id}`
                      );
                      resolve(); // All operations succeeded
                    });
                }
              })
              .catch((error) => {
                console.error(`Error processing item ${item.item_id}:`, error);
                // Perform rollback
                rollbackChanges().then(() => {
                  console.log(`Rollback completed for item ${item.item_id}`);
                  resolve(); // Resolve after rollback
                });
              });
          })
          .catch((error) => {
            console.error(
              `Error checking item stock_control for ${item.item_id}:`,
              error
            );
            resolve(); // Resolve even on error checking stock_control
          });
      });
    });

    // Return a promise that resolves when all items are processed
    return Promise.all(processedItemPromises);
  }

  return Promise.resolve(); // Return a resolved promise if no items to process
};

const updatePurchaseOrderStatus = (purchaseOrderId) => {
  Promise.all([
    db
      .collection("goods_receiving")
      .where({ purchase_order_id: purchaseOrderId })
      .get(),
    db.collection("purchase_order").where({ id: purchaseOrderId }).get(),
  ]).then(([resGR, resPO]) => {
    const allGRs = resGR.data || [];

    const poData = resPO.data[0];
    if (!poData) return;

    const poItems = poData.table_po || [];

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
          receivedQtyMap[grItem.item_id] += grItem.received_qty || 0;
        }
      });
    });

    // Check if all items are fully received
    let allItemsComplete = false;
    let anyItemProcessing = false;

    poItems.forEach((item) => {
      const orderedQty = item.quantity || 0;
      const receivedQty = receivedQtyMap[item.item_id] || 0;

      if (receivedQty < orderedQty) {
        anyItemProcessing = true;
      } else {
        allItemsComplete = true;
      }
    });

    // Determine new status
    let newPOStatus = poData.po_status;
    let newGRStatus = poData.gr_status;

    if (allItemsComplete) {
      newPOStatus = "Completed";
      newGRStatus = "Fully Received";
    } else if (anyItemProcessing) {
      newPOStatus = "Processing";
      newGRStatus = "Partially Received";
    }

    // Update PO status if changed
    if (newPOStatus !== poData.po_status) {
      db.collection("purchase_order").doc(poData.id).update({
        po_status: newPOStatus,
        gr_status: newGRStatus,
      });
    }
  });
};

this.getData()
  .then((data) => {
    const {
      purchase_order_id,
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

    if (page_status === "Add") {
      db.collection("goods_receiving")
        .add(gr)
        .then(() => {
          return addInventory(data);
        })
        .then(() => {
          updatePurchaseOrderStatus(purchase_order_id);
        });
    } else if (page_status === "Edit") {
      const goodsReceivingId = this.getParamsVariables("goods_receiving_no");
      db.collection("goods_receiving")
        .doc(goodsReceivingId)
        .update(gr)
        .then(() => {
          return addInventory(data);
        })
        .then(() => {
          updatePurchaseOrderStatus(purchase_order_id);
        });
    }
  })
  .then(() => {
    closeDialog();
  })
  .catch((error) => {
    console.error("Error in goods receiving process:", error);
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
