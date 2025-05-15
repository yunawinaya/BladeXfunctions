// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
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

      const calculateCostPrice = (itemData, conversion) => {
        return db
          .collection("purchase_order")
          .where({ id: data.purchase_order_id })
          .get()
          .then((poResponse) => {
            if (!poResponse.data || !poResponse.data.length) {
              console.log(
                `No purchase order found for ${data.purchase_order_id}`
              );
              return roundPrice(itemData.unit_price);
            }

            const poData = poResponse.data[0];

            const exchangeRate = poData.exchange_rate;
            let poQuantity = 0;
            let totalAmount = 0;

            for (const poItem of poData.table_po) {
              if (poItem.item_id === itemData.item_id) {
                poQuantity = roundQty(parseFloat(poItem.quantity) || 0);
                totalAmount = roundPrice(parseFloat(poItem.po_amount) || 0);
                break;
              }
            }

            const pricePerUnit = roundPrice(totalAmount / poQuantity);
            const costPrice = roundPrice(
              (pricePerUnit / conversion) * exchangeRate
            );
            console.log("costPrice", costPrice);

            return costPrice;
          })
          .catch((error) => {
            console.error(`Error calculating cost price: ${error.message}`);
            return roundPrice(itemData.unit_price);
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

            return calculateCostPrice(
              itemData,
              roundQty(baseQty / parseFloat(itemData.received_qty))
            ).then((costPrice) => {
              const fifoData = {
                fifo_cost_price: roundPrice(costPrice),
                fifo_initial_quantity: roundQty(baseQty),
                fifo_available_quantity: roundQty(baseQty),
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

            return calculateCostPrice(
              itemData,
              roundQty(baseQty / parseFloat(itemData.received_qty))
            ).then((costPrice) => {
              const fifoData = {
                fifo_cost_price: roundPrice(costPrice),
                fifo_initial_quantity: roundQty(baseQty),
                fifo_available_quantity: roundQty(baseQty),
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
        return calculateCostPrice(
          item,
          roundQty(baseQty / parseFloat(item.received_qty))
        ).then((costPrice) => {
          return db
            .collection("wa_costing_method")
            .add({
              material_id: item.item_id,
              batch_id: batchId,
              plant_id: plantId,
              organization_id: organizationId,
              wa_quantity: roundQty(baseQty),
              wa_cost_price: roundPrice(costPrice),
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
              const waCostPrice = roundPrice(latestWa.wa_cost_price);
              const waQuantity = roundQty(latestWa.wa_quantity);
              const newWaQuantity = roundQty(waQuantity + baseQty);
              return calculateCostPrice(
                item,
                roundQty(baseQty / parseFloat(item.received_qty))
              ).then((costPrice) => {
                const calculatedWaCostPrice = roundPrice(
                  (waCostPrice * waQuantity + costPrice * baseQty) /
                    newWaQuantity
                );
                const newWaCostPrice = roundPrice(calculatedWaCostPrice);
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
              return calculateCostPrice(
                item,
                roundQty(baseQty / parseFloat(item.received_qty))
              ).then((costPrice) => {
                return db
                  .collection("wa_costing_method")
                  .add({
                    material_id: item.item_id,
                    wa_quantity: roundQty(baseQty),
                    wa_cost_price: roundPrice(costPrice),
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

      // Function to get Fixed Cost price
      const getFixedCostPrice = async (materialId) => {
        const query = db.collection("Item").where({ id: materialId });
        const response = await query.get();
        const result = response.data;
        return roundPrice(parseFloat(result[0].purchase_unit_price || 0));
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
        let altQty = roundQty(parseFloat(item.received_qty));
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

            baseQty = roundQty(altQty * uomConversion.base_qty);

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

        let unitPrice = roundPrice(item.unit_price);
        let totalPrice = roundPrice(item.unit_price * baseQty);

        const costingMethod = itemData.material_costing_method;

        if (
          costingMethod === "First In First Out" ||
          costingMethod === "Weighted Average"
        ) {
          const fifoCostPrice = await calculateCostPrice(
            item,
            roundQty(baseQty / parseFloat(item.received_qty))
          );
          unitPrice = roundPrice(fifoCostPrice);
          totalPrice = roundPrice(fifoCostPrice * baseQty);
        } else if (costingMethod === "Fixed Cost") {
          const fixedCostPrice = await getFixedCostPrice(item.item_id);
          unitPrice = roundPrice(fixedCostPrice);
          totalPrice = roundPrice(fixedCostPrice * baseQty);
        }

        // Create inventory_movement record
        const inventoryMovementData = {
          transaction_type: "GRN",
          trx_no: data.gr_no,
          parent_trx_no: data.purchase_order_number,
          movement: "IN",
          unit_price: roundPrice(unitPrice),
          total_price: roundPrice(totalPrice),
          quantity: roundQty(altQty),
          item_id: item.item_id,
          inventory_category: item.inv_category,
          uom_id: altUOM,
          base_qty: roundQty(baseQty),
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
            const existingReceived = roundQty(
              parseFloat(doc.received_qty || 0)
            );
            const openQuantity = roundQty(parseFloat(doc.open_qty || 0));
            const newReceived = roundQty(
              existingReceived + parseFloat(baseQty || 0)
            );
            let newOpenQuantity = roundQty(
              openQuantity - parseFloat(baseQty || 0)
            );

            if (newOpenQuantity < 0) {
              newOpenQuantity = 0;
            }

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

        const receivedQty = roundQty(parseFloat(baseQty || 0));

        if (item.inv_category === "Blocked") {
          block_qty = receivedQty;
        } else if (item.inv_category === "Reserved") {
          reserved_qty = receivedQty;
        } else if (item.inv_category === "Unrestricted") {
          unrestricted_qty = receivedQty;
        } else if (item.inv_category === "Quality Inspection") {
          qualityinsp_qty = receivedQty;
        } else if (item.inv_category === "In Transit") {
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
                this.$message.error("Batch not found after creation");
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
              if (costingMethod === "First In First Out") {
                return processFifoForBatch(item, baseQty, batchId);
              } else if (costingMethod === "Weighted Average") {
                return processWeightedAverageForBatch(item, baseQty, batchId);
              } else {
                return Promise.resolve();
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
              const updatedBlockQty = roundQty(
                parseFloat(existingDoc.block_qty || 0) + block_qty
              );
              const updatedReservedQty = roundQty(
                parseFloat(existingDoc.reserved_qty || 0) + reserved_qty
              );
              const updatedUnrestrictedQty = roundQty(
                parseFloat(existingDoc.unrestricted_qty || 0) + unrestricted_qty
              );
              const updatedQualityInspQty = roundQty(
                parseFloat(existingDoc.qualityinsp_qty || 0) + qualityinsp_qty
              );
              const updatedIntransitQty = roundQty(
                parseFloat(existingDoc.intransit_qty || 0) + intransit_qty
              );
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
            } else if (costingMethod === "Weighted Average") {
              await processWeightedAverageForNonBatch(item, baseQty);
            } else {
              return Promise.resolve();
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

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value, field)) {
        missingFields.push(field.label);
      }
      return;
    }

    // Handle array fields
    if (!Array.isArray(value)) {
      missingFields.push(`${field.label}`);
      return;
    }

    if (value.length === 0) {
      missingFields.push(`${field.label}`);
      return;
    }

    // Check each item in the array
    if (field.arrayType === "object" && field.arrayFields) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue, subField)) {
            missingFields.push(
              `${subField.label} (in ${field.label} #${index + 1})`
            );
          }
        });
      });
    }
  });

  return missingFields;
};

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Receiving",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Goods Receiving",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
  } catch (error) {
    this.$message.error(error);
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  let generated = prefixData.current_prefix_config;
  generated = generated.replace("prefix", prefixData.prefix_value);
  generated = generated.replace("suffix", prefixData.suffix_value);
  generated = generated.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0")
  );
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(runNumber).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("goods_receiving")
    .where({ gr_no: generatedPrefix })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      "Could not generate a unique Goods Receiving number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData.length !== 0) {
      await updatePrefix(organizationId, prefixData.running_number);
      await db
        .collection("goods_receiving")
        .add(entry)
        .then(() => {
          this.runWorkflow(
            "1917412667253141505",
            { gr_no: entry.gr_no },
            async (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              alert();
              console.error("失败结果：", err);
              closeDialog();
            }
          );
        });
      await addInventory(entry, entry.plant_id, organizationId);
      await updatePurchaseOrderStatus(entry.purchase_order_id);
      this.$message.success("Add successfully");
      closeDialog();
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, goodsReceivingId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.gr_no = prefixToShow;
      await db
        .collection("goods_receiving")
        .doc(goodsReceivingId)
        .update(entry)
        .then(() => {
          this.runWorkflow(
            "1917412667253141505",
            { gr_no: entry.gr_no },
            async (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              alert();
              console.error("失败结果：", err);
              closeDialog();
            }
          );
        });
      await addInventory(entry, entry.plant_id, organizationId);
      await updatePurchaseOrderStatus(entry.purchase_order_id);
      this.$message.success("Update successfully");
      await closeDialog();
    }
  } catch (error) {
    this.$message.error(error);
  }
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

    const requiredFields = [
      { name: "purchase_order_id", label: "PO Number" },
      { name: "gr_no", label: "GR Number" },
      { name: "gr_date", label: "GR Date" },
      {
        name: "table_gr",
        label: "GR Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [
          { name: "location_id", label: "Target Location" },
          { name: "item_batch_no", label: "Batch Number" },
          { name: "inv_category", label: "Inventory Category" },
        ],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
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
      } = data;

      const entry = {
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

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
        closeDialog();
      } else if (page_status === "Edit") {
        const goodsReceivingId = this.getValue("id");
        await updateEntry(organizationId, entry, goodsReceivingId);
        closeDialog();
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
})();
