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

        let remainingQtyToDeduct = roundQty(returnQty);
        console.log(
          `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory for material ${materialId}`
        );

        // Process each FIFO record in sequence until we've accounted for all return quantity
        for (const record of sortedRecords) {
          if (remainingQtyToDeduct <= 0) {
            break;
          }

          const availableQty = roundQty(record.fifo_available_quantity || 0);
          console.log(
            `FIFO record ${record.fifo_sequence} has ${availableQty} available`
          );

          // Calculate how much to take from this record
          const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
          const newAvailableQty = roundQty(availableQty - qtyToDeduct);

          console.log(
            `Deducting ${qtyToDeduct} from FIFO record ${record.fifo_sequence}, new available: ${newAvailableQty}`
          );

          // Update this FIFO record
          await db.collection("fifo_costing_history").doc(record.id).update({
            fifo_available_quantity: newAvailableQty,
          });

          // Reduce the remaining quantity to deduct
          remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
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
        const waCostPrice = roundPrice(waDoc.wa_cost_price || 0);
        const waQuantity = roundQty(waDoc.wa_quantity || 0);

        if (waQuantity <= returnQty) {
          console.warn(
            `Warning: Cannot fully update weighted average for ${item.material_id} - ` +
              `Available: ${waQuantity}, Requested: ${returnQty}`
          );

          if (waQuantity <= 0) {
            return Promise.resolve();
          }
        }

        const newWaQuantity = Math.max(0, roundQty(waQuantity - returnQty));

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

        // const calculatedWaCostPrice = roundPrice(
        //   (waCostPrice * waQuantity - waCostPrice * returnQty) / newWaQuantity
        // );

        return db
          .collection("wa_costing_method")
          .doc(waDoc.id)
          .update({
            wa_quantity: newWaQuantity,
            wa_cost_price: waCostPrice,
            updated_at: new Date(),
          })
          .then(() => {
            console.log(
              `Successfully processed Weighted Average for item ${item.material_id}, ` +
                `new quantity: ${newWaQuantity}, new cost price: ${waCostPrice}`
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
          const availableQty = roundQty(record.fifo_available_quantity || 0);
          if (availableQty > 0) {
            console.log(
              `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
            );
            return roundPrice(record.fifo_cost_price || 0);
          }
        }

        // If no records with available quantity, use the most recent record
        console.warn(
          `No FIFO records with available quantity found for ${materialId}, using most recent cost price`
        );
        return roundPrice(
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

        return roundPrice(waData[0].wa_cost_price || 0);
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
    return roundPrice(result[0].purchase_unit_price || 0);
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

        const temporaryData = item.temp_qty_data
          ? JSON.parse(item.temp_qty_data)
          : [];
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
            let altQty = roundQty(temp.return_quantity);
            let baseQty = altQty;
            let altUOM = item.return_uom_id;
            let baseUOM = itemData.based_uom;
            let altWAQty = roundQty(item.return_quantity);
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

                baseQty = roundQty(altQty * uomConversion.base_qty);
                baseWAQty = roundQty(altWAQty * uomConversion.base_qty);

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

            let unitPrice = roundPrice(item.unit_price);
            let totalPrice = roundPrice(unitPrice * altQty);

            if (costingMethod === "First In First Out") {
              // Get unit price from latest FIFO sequence
              const fifoCostPrice = await getLatestFIFOCostPrice(
                item.material_id,
                temp.batch_id
              );
              unitPrice = roundPrice(fifoCostPrice);
              totalPrice = roundPrice(fifoCostPrice * baseQty);
            } else if (costingMethod === "Weighted Average") {
              // Get unit price from WA cost price
              const waCostPrice = await getWeightedAverageCostPrice(
                item.material_id,
                temp.batch_id
              );
              unitPrice = roundPrice(waCostPrice);
              totalPrice = roundPrice(waCostPrice * baseQty);
            } else if (costingMethod === "Fixed Cost") {
              // Get unit price from Fixed Cost
              const fixedCostPrice = await getFixedCostPrice(item.material_id);
              unitPrice = roundPrice(fixedCostPrice);
              totalPrice = roundPrice(fixedCostPrice * baseQty);
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
                let updatedUnrestrictedQty = roundQty(
                  existingBatchDoc.unrestricted_qty || 0
                );
                let updatedQualityInspectionQty = roundQty(
                  existingBatchDoc.qualityinsp_qty || 0
                );
                let updatedBlockQty = roundQty(existingBatchDoc.block_qty || 0);
                let updatedIntransitQty = roundQty(
                  existingBatchDoc.intransit_qty || 0
                );

                if (categoryType === "Unrestricted") {
                  updatedUnrestrictedQty = roundQty(
                    updatedUnrestrictedQty - categoryValue
                  );
                } else if (categoryType === "Quality Inspection") {
                  updatedQualityInspectionQty = roundQty(
                    updatedQualityInspectionQty - categoryValue
                  );
                } else if (categoryType === "Blocked") {
                  updatedBlockQty = roundQty(updatedBlockQty - categoryValue);
                } else if (categoryType === "In Transit") {
                  updatedIntransitQty = roundQty(
                    updatedIntransitQty - categoryValue
                  );
                }

                const updatedBalanceQty = roundQty(
                  parseFloat(existingBatchDoc.balance_quantity || 0) -
                    categoryValue
                );

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
                let updatedUnrestrictedQty = roundQty(
                  existingDoc.unrestricted_qty || 0
                );
                let updatedQualityInspectionQty = roundQty(
                  existingDoc.qualityinsp_qty || 0
                );
                let updatedBlockQty = roundQty(existingDoc.block_qty || 0);
                let updatedIntransitQty = roundQty(
                  existingDoc.intransit_qty || 0
                );

                if (categoryType === "Unrestricted") {
                  updatedUnrestrictedQty = roundQty(
                    updatedUnrestrictedQty - categoryValue
                  );
                } else if (categoryType === "Quality Inspection") {
                  updatedQualityInspectionQty = roundQty(
                    updatedQualityInspectionQty - categoryValue
                  );
                } else if (categoryType === "Blocked") {
                  updatedBlockQty = roundQty(updatedBlockQty - categoryValue);
                } else if (categoryType === "In Transit") {
                  updatedIntransitQty = roundQty(
                    updatedIntransitQty - categoryValue
                  );
                }

                const updatedBalanceQty = roundQty(
                  parseFloat(existingDoc.balance_quantity || 0) - categoryValue
                );

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
      document_types: "Purchase Returns",
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
        document_types: "Purchase Returns",
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
    .collection("purchase_return_head")
    .where({ purchase_return_no: generatedPrefix })
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
      "Could not generate a unique Purchase Returns number after maximum attempts"
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
        .collection("purchase_return_head")
        .add(entry)
        .then(() => {
          this.runWorkflow(
            "1917415391491338241",
            { purchase_return_no: entry.purchase_return_no },
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
      await updateInventory(entry, entry.plant, organizationId);
      this.$message.success("Add successfully");
      closeDialog();
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, purchaseReturnId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.purchase_return_no = prefixToShow;
      await db
        .collection("purchase_return_head")
        .doc(purchaseReturnId)
        .update(entry)
        .then(() => {
          this.runWorkflow(
            "1917415391491338241",
            { purchase_return_no: entry.purchase_return_no },
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
      await updateInventory(entry, entry.plant, organizationId);
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
      { name: "purchase_return_no", label: "Return ID" },
      { name: "purchase_order_id", label: "PO Number" },
      { name: "goods_receiving_id", label: "Good Receiving  Number" },
      {
        name: "table_prt",
        label: "PRT Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [{ name: "return_condition", label: "Condition" }],
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
        organization_id,
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
        organization_id,
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
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        const goodsReceivingId = this.getValue("id");
        await updateEntry(organizationId, entry, goodsReceivingId);
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
