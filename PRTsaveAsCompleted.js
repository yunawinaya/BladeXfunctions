const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const updateInventory = async (data, plantId, organizationId) => {
  const items = data.table_prt;

  // Update FIFO inventory
  const updateFIFOInventory = async (materialId, returnQty, batchId) => {
    try {
      // Get all FIFO records for this material sorted by sequence (oldest first)
      const query = batchId
        ? db
            .collection("fifo_costing_history")
            .where({ material_id: materialId, batch_id: batchId })
        : db
            .collection("fifo_costing_history")
            .where({ material_id: materialId });

      const response = await query.get();

      const result = response.data;

      if (result && Array.isArray(result) && result.length > 0) {
        // Sort by FIFO sequence (lowest/oldest first)
        const sortedRecords = result.sort(
          (a, b) => a.fifo_sequence - b.fifo_sequence
        );

        let remainingQtyToDeduct = parseFloat(returnQty);
        console.log(
          `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory for material ${materialId}`
        );

        // Process each FIFO record in sequence until we've accounted for all return quantity
        for (const record of sortedRecords) {
          if (remainingQtyToDeduct <= 0) {
            break;
          }

          const availableQty = parseFloat(record.fifo_available_quantity || 0);
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
          await db.collection("fifo_costing_history").doc(record.id).update({
            fifo_available_quantity: newAvailableQty,
          });

          // Reduce the remaining quantity to deduct
          remainingQtyToDeduct -= qtyToDeduct;
        }

        if (remainingQtyToDeduct > 0) {
          console.warn(
            `Warning: Couldn't fully satisfy FIFO deduction for material ${materialId}. Remaining qty: ${remainingQtyToDeduct}`
          );
        }
      } else {
        console.warn(`No FIFO records found for material ${materialId}`);
      }
    } catch (error) {
      console.error(
        `Error updating FIFO inventory for material ${materialId}:`,
        error
      );
      throw error;
    }
  };

  const updateWeightedAverage = (item, batchId) => {
    // Input validation
    if (
      !item ||
      !item.material_id ||
      isNaN(parseFloat(item.return_quantity)) ||
      parseFloat(item.return_quantity) <= 0
    ) {
      console.error("Invalid item data for weighted average update:", item);
      return Promise.resolve();
    }

    const returnQty = parseFloat(item.return_quantity);
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

        if (waQuantity <= returnQty) {
          console.warn(
            `Warning: Cannot fully update weighted average for ${item.material_id} - ` +
              `Available: ${waQuantity}, Requested: ${returnQty}`
          );

          if (waQuantity <= 0) {
            return Promise.resolve();
          }
        }

        const newWaQuantity = Math.max(0, waQuantity - returnQty);

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

        const newWaCostPrice =
          (waCostPrice * waQuantity - waCostPrice * returnQty) / newWaQuantity;

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

  if (Array.isArray(items)) {
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      console.log(
        `Processing item ${itemIndex + 1}/${items.length}: ${item.material_id}`
      );

      try {
        // Check if item has stock control enabled
        const itemRes = await db
          .collection("Item")
          .where({ id: item.material_id })
          .get();

        if (!itemRes.data || !itemRes.data.length) {
          console.error(`Item not found: ${item.material_id}`);
          continue;
        }

        const itemData = itemRes.data[0];
        if (itemData.stock_control === 0) {
          console.log(
            `Skipping inventory update for item ${item.material_id} (stock_control=0)`
          );
          continue;
        }

        // Create inventory movement record
        await db.collection("inventory_movement").add({
          transaction_type: "PRT",
          trx_no: data.purchase_return_no,
          parent_trx_no: item.gr_number,
          movement: "OUT",
          unit_price: item.unit_price,
          total_price: item.total_price,
          quantity: item.return_quantity,
          item_id: item.material_id,
          inventory_category: item.inv_category,
          uom_id: item.return_uom_id,
          base_uom_id: itemData.base_uom,
          bin_location_id: item.location_id,
          batch_number_id: item.batch_id,
          costing_method_id: item.costing_method,
          plant_id: plantId,
          organization_id: organizationId,
        });

        const temporaryData = JSON.parse(item.temp_qty_data);
        console.log(
          `Temporary data for item ${item.material_id}:`,
          temporaryData
        );

        if (temporaryData.length > 0) {
          for (const temp of temporaryData) {
            const itemBalanceParams = {
              material_id: item.material_id,
              location_id: temp.location_id,
            };

            const categoryType = temp.inventory_category;
            const categoryValue = temp.return_quantity;

            if (temp.batch_id) {
              itemBalanceParams.batch_id = temp.batch_id;

              const batchResponse = await db
                .collection("item_batch_balance")
                .where(itemBalanceParams)
                .get();

              const batchResult = batchResponse.data;
              const hasBatchBalance =
                batchResult &&
                Array.isArray(batchResult) &&
                batchResult.length > 0;
              const existingBatchDoc = hasBatchBalance ? batchResult[0] : null;

              if (existingBatchDoc && existingBatchDoc.id) {
                let updatedUnrestrictedQty = parseFloat(
                  existingBatchDoc.unrestricted_qty || 0
                );
                let updatedQualityInspectionQty = parseFloat(
                  existingBatchDoc.qualityinsp_qty || 0
                );
                let updatedBlockQty = parseFloat(
                  existingBatchDoc.block_qty || 0
                );
                let updatedIntransitQty = parseFloat(
                  existingBatchDoc.intransit_qty || 0
                );

                if (categoryType === "UNR") {
                  updatedUnrestrictedQty -= categoryValue;
                } else if (categoryType === "QIP") {
                  updatedQualityInspectionQty -= categoryValue;
                } else if (categoryType === "BLK") {
                  updatedBlockQty -= categoryValue;
                } else if (categoryType === "ITR") {
                  updatedIntransitQty -= categoryValue;
                }

                const updatedBalanceQty =
                  parseFloat(existingBatchDoc.balance_quantity || 0) -
                  categoryValue;

                await db
                  .collection("item_batch_balance")
                  .doc(existingBatchDoc.id)
                  .update({
                    unrestricted_qty: updatedUnrestrictedQty,
                    qualityinsp_qty: updatedQualityInspectionQty,
                    block_qty: updatedBlockQty,
                    intransit_qty: updatedIntransitQty,
                    balance_quantity: updatedBalanceQty,
                    last_updated: new Date(),
                    last_transaction: data.purchase_return_no,
                  });

                console.log(
                  `Updated batch balance for item ${item.material_id}, batch ${temp.batch_id}`
                );
              } else {
                console.log(
                  `No existing item_batch_balance found for item ${item.material_id}, batch ${temp.batch_id}`
                );
              }
            } else {
              const balanceResponse = await db
                .collection("item_balance")
                .where(itemBalanceParams)
                .get();

              const balanceResult = balanceResponse.data;
              const hasBalance =
                balanceResult &&
                Array.isArray(balanceResult) &&
                balanceResult.length > 0;
              const existingDoc = hasBalance ? balanceResult[0] : null;

              if (existingDoc && existingDoc.id) {
                let updatedUnrestrictedQty = parseFloat(
                  existingDoc.unrestricted_qty || 0
                );
                let updatedQualityInspectionQty = parseFloat(
                  existingDoc.qualityinsp_qty || 0
                );
                let updatedBlockQty = parseFloat(existingDoc.block_qty || 0);
                let updatedIntransitQty = parseFloat(
                  existingDoc.intransit_qty || 0
                );

                if (categoryType === "UNR") {
                  updatedUnrestrictedQty -= categoryValue;
                } else if (categoryType === "QIP") {
                  updatedQualityInspectionQty -= categoryValue;
                } else if (categoryType === "BLK") {
                  updatedBlockQty -= categoryValue;
                } else if (categoryType === "ITR") {
                  updatedIntransitQty -= categoryValue;
                }

                const updatedBalanceQty =
                  parseFloat(existingDoc.balance_quantity || 0) - categoryValue;

                await db.collection("item_balance").doc(existingDoc.id).update({
                  unrestricted_qty: updatedUnrestrictedQty,
                  qualityinsp_qty: updatedQualityInspectionQty,
                  block_qty: updatedBlockQty,
                  intransit_qty: updatedIntransitQty,
                  balance_quantity: updatedBalanceQty,
                  last_updated: new Date(),
                  last_transaction: data.purchase_return_no,
                });

                console.log(`Updated balance for item ${item.material_id}`);
              } else {
                console.log(
                  `No existing item_balance found for item ${item.material_id}`
                );
              }
            }

            const costingMethod = itemData.material_costing_method;
            if (costingMethod === "First In First Out") {
              await updateFIFOInventory(
                item.material_id,
                temp.return_quantity,
                temp.batch_id
              );
            } else {
              await updateWeightedAverage(item, temp.batch_id);
            }
          }
        }
      } catch (error) {
        console.error(`Error processing item ${item.material_id}:`, error);
      }
    }
  }
};

this.getData()
  .then(async (data) => {
    try {
      const {
        purchase_return_no,
        purchase_order_id,
        goods_receiving_id,
        supplier_id,
        prt_billing_name,
        prt_billing_cp,
        prt_billing_address,
        prt_shipping_address,
        gr_date,
        plant,
        purchase_return_date,
        input_hvxpruem,
        return_delivery_method,
        purchase_return_ref,
        shipping_details,
        reason_for_return,
        driver_name,
        vehicle_no,
        driver_contact,
        pickup_date,
        courier_company,
        shipping_date,
        estimated_arrival,
        shipping_method,
        freight_charge,
        driver_name2,
        driver_contact_no2,
        estimated_arrival2,
        vehicle_no2,
        delivery_cost,
        table_prt,
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

      const prt = {
        purchase_return_status: "Issued",
        purchase_return_no,
        purchase_order_id,
        goods_receiving_id,
        supplier_id,
        prt_billing_name,
        prt_billing_cp,
        prt_billing_address,
        prt_shipping_address,
        gr_date,
        plant,
        purchase_return_date,
        input_hvxpruem,
        return_delivery_method,
        purchase_return_ref,
        shipping_details,
        reason_for_return,
        driver_name,
        vehicle_no,
        driver_contact,
        pickup_date,
        courier_company,
        shipping_date,
        estimated_arrival,
        shipping_method,
        freight_charge,
        driver_name2,
        driver_contact_no2,
        estimated_arrival2,
        vehicle_no2,
        delivery_cost,
        table_prt,
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
        await db.collection("purchase_return_head").add(prt);

        const result = await db
          .collection("purchase_order")
          .doc(data.purchase_order_id)
          .get();

        const plantId = result.data[0].po_plant;
        const organizationId = result.data[0].organization_id;

        await updateInventory(data, plantId, organizationId);
      } else if (page_status === "Edit") {
        const purchaseReturnId = this.getParamsVariables("purchase_return_no");

        const result = await db
          .collection("purchase_order")
          .doc(data.purchase_order_id)
          .get();

        const plantId = result.data[0].po_plant;
        const organizationId = result.data[0].organization_id;

        await db
          .collection("purchase_return_head")
          .doc(purchaseReturnId)
          .update(prt);
        await updateInventory(data, plantId, organizationId);
      }

      closeDialog();
    } catch (error) {
      console.error("Error in purchase return process:", error);
      alert(
        "An error occurred during processing. Please try again or contact support."
      );
    }
  })
  .catch((error) => {
    console.error("Error in purchase return process:", error);
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
