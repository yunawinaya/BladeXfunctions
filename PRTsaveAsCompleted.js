const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
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

  const updateWeightedAverage = (item, returnQty, batchId) => {
    // Input validation
    if (
      !item ||
      !item.material_id ||
      isNaN(parseFloat(returnQty)) ||
      parseFloat(returnQty) <= 0
    ) {
      console.error("Invalid item data for weighted average update:", item);
      return Promise.resolve();
    }

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

        const calculatedWaCostPrice =
          (waCostPrice * waQuantity - waCostPrice * returnQty) / newWaQuantity;
        const newWaCostPrice =
          Math.round(calculatedWaCostPrice * 10000) / 10000;

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

  // Function to get latest FIFO cost price with available quantity check
  const getLatestFIFOCostPrice = async (materialId, batchId) => {
    try {
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
        // Sort by FIFO sequence (lowest/oldest first, as per FIFO principle)
        const sortedRecords = result.sort(
          (a, b) => a.fifo_sequence - b.fifo_sequence
        );

        // First look for records with available quantity
        for (const record of sortedRecords) {
          const availableQty = parseFloat(record.fifo_available_quantity || 0);
          if (availableQty > 0) {
            console.log(
              `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
            );
            return parseFloat(record.fifo_cost_price || 0);
          }
        }

        // If no records with available quantity, use the most recent record
        console.warn(
          `No FIFO records with available quantity found for ${materialId}, using most recent cost price`
        );
        return parseFloat(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
      }

      console.warn(`No FIFO records found for material ${materialId}`);
      return 0;
    } catch (error) {
      console.error(
        `Error retrieving FIFO cost price for ${materialId}:`,
        error
      );
      return 0;
    }
  };

  // Function to get Weighted Average cost price
  const getWeightedAverageCostPrice = async (materialId, batchId) => {
    try {
      const query = batchId
        ? db
            .collection("wa_costing_method")
            .where({ material_id: materialId, batch_id: batchId })
        : db.collection("wa_costing_method").where({ material_id: materialId });

      const response = await query.get();
      const waData = response.data;

      if (waData && Array.isArray(waData) && waData.length > 0) {
        // Sort by date (newest first) to get the latest record
        waData.sort((a, b) => {
          if (a.created_at && b.created_at) {
            return new Date(b.created_at) - new Date(a.created_at);
          }
          return 0;
        });

        return parseFloat(waData[0].wa_cost_price || 0);
      }

      console.warn(
        `No weighted average records found for material ${materialId}`
      );
      return 0;
    } catch (error) {
      console.error(`Error retrieving WA cost price for ${materialId}:`, error);
      return 0;
    }
  };

  // Function to get Fixed Cost price
  const getFixedCostPrice = async (materialId) => {
    const query = db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;
    return parseFloat(result[0].purchase_unit_price || 0);
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

            // UOM Conversion
            let altQty = parseFloat(temp.return_quantity);
            let baseQty = altQty;
            let altUOM = item.return_uom_id;
            let baseUOM = itemData.based_uom;
            let altWAQty = parseFloat(item.return_quantity);
            let baseWAQty = altWAQty;

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

                baseQty =
                  Math.round(altQty * uomConversion.base_qty * 1000) / 1000;

                baseWAQty =
                  Math.round(altWAQty * uomConversion.base_qty * 1000) / 1000;

                console.log(
                  `Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`
                );
              } else {
                console.log(
                  `No conversion found for UOM ${altUOM}, using as-is`
                );
              }
            } else {
              console.log(
                `No UOM conversion table for item ${item.item_id}, using received quantity as-is`
              );
            }

            const costingMethod = itemData.material_costing_method;

            let unitPrice = item.unit_price;
            let totalPrice = item.unit_price * altQty;

            if (costingMethod === "First In First Out") {
              // Get unit price from latest FIFO sequence
              const fifoCostPrice = await getLatestFIFOCostPrice(
                item.material_id,
                temp.batch_id
              );
              unitPrice = fifoCostPrice;
              totalPrice = fifoCostPrice * baseQty;
            } else if (costingMethod === "Weighted Average") {
              // Get unit price from WA cost price
              const waCostPrice = await getWeightedAverageCostPrice(
                item.material_id,
                temp.batch_id
              );
              unitPrice = waCostPrice;
              totalPrice = waCostPrice * baseQty;
            } else if (costingMethod === "Fixed Cost") {
              // Get unit price from Fixed Cost
              const fixedCostPrice = await getFixedCostPrice(item.material_id);
              unitPrice = fixedCostPrice;
              totalPrice = fixedCostPrice * baseQty;
            } else {
              return Promise.resolve();
            }

            // Create inventory movement record
            await db.collection("inventory_movement").add({
              transaction_type: "PRT",
              trx_no: data.purchase_return_no,
              parent_trx_no: item.gr_number,
              movement: "OUT",
              unit_price: unitPrice,
              total_price: totalPrice,
              quantity: altQty,
              item_id: item.material_id,
              inventory_category: item.inv_category,
              uom_id: altUOM,
              base_qty: baseQty,
              base_uom_id: baseUOM,
              bin_location_id: temp.location_id,
              batch_number_id: temp.batch_id,
              costing_method_id: item.costing_method,
              plant_id: plantId,
              organization_id: organizationId,
            });

            const categoryType = temp.inventory_category;
            const categoryValue = baseQty;

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

            if (costingMethod === "First In First Out") {
              await updateFIFOInventory(
                item.material_id,
                baseQty,
                temp.batch_id
              );
            } else if (costingMethod === "Weighted Average") {
              await updateWeightedAverage(item, baseWAQty, temp.batch_id);
            } else {
              return Promise.resolve();
            }
          }
        }
      } catch (error) {
        console.error(`Error processing item ${item.material_id}:`, error);
      }
    }
  }
};

this.getData().then(async (data) => {
  try {
    const {
      purchase_return_no,
      purchase_order_id,
      goods_receiving_id,
      gr_ids,
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

    const entry = {
      purchase_return_status: "Issued",
      purchase_return_no,
      purchase_order_id,
      goods_receiving_id,
      gr_ids,
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
      this.showLoading();
      await db
        .collection("purchase_return_head")
        .add(entry)
        .then(() => {
          let organizationId = this.getVarGlobal("deptParentId");
          if (organizationId === "0") {
            organizationId = this.getVarSystem("deptIds").split(",")[0];
          }

          return db
            .collection("prefix_configuration")
            .where({
              document_types: "Purchase Returns",
              is_deleted: 0,
              organization_id: organizationId,
              is_active: 1,
            })
            .get()
            .then((prefixEntry) => {
              if (prefixEntry.data.length === 0) return;
              else {
                const data = prefixEntry.data[0];
                return db
                  .collection("prefix_configuration")
                  .where({
                    document_types: "Purchase Returns",
                    is_deleted: 0,
                    organization_id: organizationId,
                  })
                  .update({
                    running_number: parseInt(data.running_number) + 1,
                    has_record: 1,
                  });
              }
            });
        });

      const result = await db
        .collection("purchase_order")
        .doc(data.purchase_order_id)
        .get();

      const plantId = result.data[0].po_plant;
      const organizationId = result.data[0].organization_id;

      await updateInventory(data, plantId, organizationId);
    } else if (page_status === "Edit") {
      this.showLoading();
      const purchaseReturnId = this.getParamsVariables("purchase_return_no");
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const prefixEntry = db
        .collection("prefix_configuration")
        .where({
          document_types: "Purchase Returns",
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
        })
        .get()
        .then((prefixEntry) => {
          if (prefixEntry.data.length > 0) {
            const prefixData = prefixEntry.data[0];
            const now = new Date();
            let prefixToShow;
            let runningNumber = prefixData.running_number;
            let isUnique = false;
            let maxAttempts = 10;
            let attempts = 0;

            const generatePrefix = (runNumber) => {
              let generated = prefixData.current_prefix_config;
              generated = generated.replace("prefix", prefixData.prefix_value);
              generated = generated.replace("suffix", prefixData.suffix_value);
              generated = generated.replace(
                "month",
                String(now.getMonth() + 1).padStart(2, "0")
              );
              generated = generated.replace(
                "day",
                String(now.getDate()).padStart(2, "0")
              );
              generated = generated.replace("year", now.getFullYear());
              generated = generated.replace(
                "running_number",
                String(runNumber).padStart(prefixData.padding_zeroes, "0")
              );
              return generated;
            };

            const checkUniqueness = async (generatedPrefix) => {
              const existingDoc = await db
                .collection("purchase_return_head")
                .where({ purchase_return_no: generatedPrefix })
                .get();
              return existingDoc.data[0] ? false : true;
            };

            const findUniquePrefix = async () => {
              while (!isUnique && attempts < maxAttempts) {
                attempts++;
                prefixToShow = generatePrefix(runningNumber);
                isUnique = await checkUniqueness(prefixToShow);
                if (!isUnique) {
                  runningNumber++;
                }
              }

              if (!isUnique) {
                throw new Error(
                  "Could not generate a unique Purchase Return number after maximum attempts"
                );
              } else {
                entry.purchase_return_no = prefixToShow;
                db.collection("prefix_configuration")
                  .where({
                    document_types: "Purchase Returns",
                    is_deleted: 0,
                    organization_id: organizationId,
                  })
                  .update({
                    running_number: parseInt(runningNumber) + 1,
                    has_record: 1,
                  });
              }
            };

            findUniquePrefix();
          }
        });

      await db
        .collection("purchase_return_head")
        .doc(purchaseReturnId)
        .update(entry);

      const result = await db
        .collection("purchase_order")
        .doc(data.purchase_order_id)
        .get();

      const plantId = result.data[0].po_plant;
      organizationId = result.data[0].organization_id;

      await db
        .collection("purchase_return_head")
        .doc(purchaseReturnId)
        .update(entry);
      await updateInventory(data, plantId, organizationId);
    }

    closeDialog();
  } catch (error) {
    console.error("Error in purchase return process:", error);
    alert(
      "An error occurred during processing. Please try again or contact support."
    );
  }
});
