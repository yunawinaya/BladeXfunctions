// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

const updateInventory = async (data, plantId, organizationId) => {
  const items = data.table_srr;

  const calculateCostPrice = (itemData, conversion) => {
    return db
      .collection("sales_order")
      .where({ id: itemData.so_id })
      .get()
      .then((soResponse) => {
        if (!soResponse.data || !soResponse.data.length) {
          console.log(`No sales order found for ${itemData.so_id}`);
          return roundPrice(itemData.unit_price);
        }

        const soData = soResponse.data[0];

        const exchangeRate = soData.exchange_rate;
        let soQuantity = 0;
        let totalAmount = 0;

        for (const soItem of soData.table_so) {
          if (soItem.id === itemData.so_line_id) {
            soQuantity = roundQty(soItem.so_quantity);
            totalAmount = roundPrice(soItem.so_amount);
            break;
          }
        }

        const pricePerUnit = roundPrice(totalAmount / soQuantity);
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

  // Extracted FIFO update logic
  const updateFIFOInventory = async (item, returnQty, batchId) => {
    try {
      // Extract fifoSequence from the item
      const fifoSequence =
        item.fifo_sequence && typeof item.fifo_sequence === "string"
          ? item.fifo_sequence.split("(")[0]
          : null;
      console.log("fifoSequence", fifoSequence);

      if (fifoSequence) {
        const query = batchId
          ? db.collection("fifo_costing_history").where({
              fifo_sequence: fifoSequence,
              material_id: item.material_id,
              batch_id: batchId,
            })
          : db.collection("fifo_costing_history").where({
              fifo_sequence: fifoSequence,
              material_id: item.material_id,
            });

        const fifoResponse = await query.get();

        const fifoResult = fifoResponse.data;
        const fifoDoc =
          fifoResult && Array.isArray(fifoResult) && fifoResult.length > 0
            ? fifoResult[0]
            : null;

        if (fifoDoc && fifoDoc.id) {
          const updatedAvailableQuantity = roundQty(
            parseFloat(fifoDoc.fifo_available_quantity || 0) + returnQty
          );

          await db.collection("fifo_costing_history").doc(fifoDoc.id).update({
            fifo_available_quantity: updatedAvailableQuantity,
          });

          console.log(
            `Updated FIFO record for sequence ${fifoSequence}, material ${item.material_id}`
          );
        } else {
          console.warn(
            `No FIFO record found for sequence ${fifoSequence}, material ${item.material_id}`
          );
        }
      } else {
        console.warn(
          `No FIFO sequence available for material ${item.material_id}`
        );
      }
    } catch (error) {
      console.error(
        `Error updating FIFO inventory for material ${item.material_id}:`,
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

        const newWaQuantity = Math.max(0, roundQty(waQuantity + returnQty));

        const calculatedWaCostPrice = roundPrice(
          (waCostPrice * waQuantity + waCostPrice * returnQty) / newWaQuantity
        );

        return db
          .collection("wa_costing_method")
          .doc(waDoc.id)
          .update({
            wa_quantity: newWaQuantity,
            wa_cost_price: calculatedWaCostPrice,
            updated_at: new Date(),
          })
          .then(() => {
            console.log(
              `Successfully processed Weighted Average for item ${item.material_id}, ` +
                `new quantity: ${newWaQuantity}, new cost price: ${calculatedWaCostPrice}`
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

        // UOM Conversion
        let altQty = roundQty(item.received_qty);
        let baseQty = altQty;
        let altUOM = item.quantity_uom;
        let baseUOM = itemData.based_uom;

        if (
          Array.isArray(itemData.table_uom_conversion) &&
          itemData.table_uom_conversion.length > 0
        ) {
          console.log(`Checking UOM conversions for item ${item.material_id}`);

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
            `No UOM conversion table for item ${item.material_id}, using received quantity as-is`
          );
        }

        let unitPrice = roundPrice(item.unit_price);
        let totalPrice = roundPrice(unitPrice * baseQty);

        const costingMethod = itemData.material_costing_method;

        if (
          costingMethod === "First In First Out" ||
          costingMethod === "Weighted Average"
        ) {
          const fifoCostPrice = await calculateCostPrice(
            item,
            baseQty / roundQty(item.received_qty)
          );
          unitPrice = roundPrice(fifoCostPrice);
          totalPrice = roundPrice(fifoCostPrice * baseQty);
        } else if (costingMethod === "Fixed Cost") {
          const fixedCostPrice = await getFixedCostPrice(item.material_id);
          unitPrice = roundPrice(fixedCostPrice);
          totalPrice = roundPrice(fixedCostPrice * baseQty);
        }

        const inventoryMovementData = {
          transaction_type: "SRR",
          trx_no: data.srr_no,
          parent_trx_no: item.sr_number,
          movement: "IN",
          unit_price: unitPrice,
          total_price: totalPrice,
          quantity: altQty,
          item_id: item.material_id,
          inventory_category: item.inventory_category,
          uom_id: altUOM,
          base_qty: baseQty,
          base_uom_id: baseUOM,
          bin_location_id: item.location_id,
          batch_number_id: item.batch_id,
          costing_method_id: item.costing_method,
          plant_id: plantId,
          organization_id: organizationId,
        };

        const itemBatchBalanceParams = {
          material_id: item.material_id,
          location_id: item.location_id,
          plant_id: plantId,
        };

        if (item.batch_no !== "-") {
          const batchData = {
            batch_number: item.batch_no,
            material_id: item.material_id,
            initial_quantity: baseQty,
            transaction_no: data.srr_no,
            parent_transaction_no: item.sr_number,
            plant_id: plantId,
            organization_id: organizationId,
          };

          const batchResponse = await db.collection("batch").add(batchData);

          // Get the batch_id from the add response if available
          let batchId = batchResponse?.data[0].id || null;
          item.batch_id = batchId;

          inventoryMovementData.batch_number_id = batchId;

          console.log(`Batch ID for ${item.material_name}: ${batchId}`);

          await db
            .collection("sales_return_receiving_05z4r94a_sub")
            .doc(item.id)
            .update({ batch_id: batchId });
        }
        await db.collection("inventory_movement").add(inventoryMovementData);

        // Add batch_id to query params if it exists
        if (item.batch_id) {
          itemBatchBalanceParams.batch_id = item.batch_id;
        }

        let block_qty = 0,
          reserved_qty = 0,
          unrestricted_qty = 0,
          qualityinsp_qty = 0,
          intransit_qty = 0;

        const returnQty = roundQty(baseQty || 0);

        if (item.inventory_category === "Blocked") {
          block_qty = returnQty;
        } else if (item.inventory_category === "Reserved") {
          reserved_qty = returnQty;
        } else if (item.inventory_category === "Unrestricted") {
          unrestricted_qty = returnQty;
        } else if (item.inventory_category === "Quality Inspection") {
          qualityinsp_qty = returnQty;
        } else if (item.inventory_category === "In Transit") {
          intransit_qty = returnQty;
        } else {
          unrestricted_qty = returnQty;
        }

        if (item.batch_id) {
          const batchResponse = await db
            .collection("item_batch_balance")
            .where(itemBatchBalanceParams)
            .get();

          const result = batchResponse.data;
          const hasExistingBalance =
            result && Array.isArray(result) && result.length > 0;
          const existingDoc = hasExistingBalance ? result[0] : null;

          let balance_quantity;

          if (existingDoc && existingDoc.id) {
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

            balance_quantity = roundQty(
              updatedBlockQty +
                updatedReservedQty +
                updatedUnrestrictedQty +
                updatedQualityInspQty +
                updatedIntransitQty
            );

            await db
              .collection("item_batch_balance")
              .doc(existingDoc.id)
              .update({
                batch_id: item.batch_id,
                block_qty: updatedBlockQty,
                reserved_qty: updatedReservedQty,
                unrestricted_qty: updatedUnrestrictedQty,
                qualityinsp_qty: updatedQualityInspQty,
                intransit_qty: updatedIntransitQty,
                balance_quantity: balance_quantity,
              });

            console.log(
              `Updated batch balance for item ${item.material_id}, batch ${item.batch_id}`
            );
          } else {
            balance_quantity = roundQty(
              block_qty +
                reserved_qty +
                unrestricted_qty +
                qualityinsp_qty +
                intransit_qty
            );

            await db.collection("item_batch_balance").add({
              material_id: item.material_id,
              location_id: item.location_id,
              batch_id: item.batch_id,
              block_qty: block_qty,
              reserved_qty: reserved_qty,
              unrestricted_qty: unrestricted_qty,
              qualityinsp_qty: qualityinsp_qty,
              intransit_qty: intransit_qty,
              balance_quantity: balance_quantity,
              plant_id: plantId,
              organization_id: organizationId,
            });

            console.log(
              `Created new batch balance for item ${item.material_id}, batch ${item.batch_id}`
            );
          }
        } else {
          const balanceResponse = await db
            .collection("item_balance")
            .where(itemBatchBalanceParams)
            .get();

          const result = balanceResponse.data;
          const hasExistingBalance =
            result && Array.isArray(result) && result.length > 0;
          const existingDoc = hasExistingBalance ? result[0] : null;

          let balance_quantity;

          if (existingDoc && existingDoc.id) {
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

            balance_quantity = roundQty(
              updatedBlockQty +
                updatedReservedQty +
                updatedUnrestrictedQty +
                updatedQualityInspQty +
                updatedIntransitQty
            );

            await db.collection("item_balance").doc(existingDoc.id).update({
              block_qty: updatedBlockQty,
              reserved_qty: updatedReservedQty,
              unrestricted_qty: updatedUnrestrictedQty,
              qualityinsp_qty: updatedQualityInspQty,
              intransit_qty: updatedIntransitQty,
              balance_quantity: balance_quantity,
            });

            console.log(`Updated balance for item ${item.material_id}`);
          } else {
            balance_quantity = roundQty(
              block_qty +
                reserved_qty +
                unrestricted_qty +
                qualityinsp_qty +
                intransit_qty
            );

            await db.collection("item_balance").add({
              material_id: item.material_id,
              location_id: item.location_id,
              block_qty: block_qty,
              reserved_qty: reserved_qty,
              unrestricted_qty: unrestricted_qty,
              qualityinsp_qty: qualityinsp_qty,
              intransit_qty: intransit_qty,
              balance_quantity: balance_quantity,
              plant_id: plantId,
              organization_id: organizationId,
            });

            console.log(`Created new balance for item ${item.material_id}`);
          }
        }

        if (costingMethod === "First In First Out") {
          await updateFIFOInventory(item, returnQty, item.batch_id);
        } else if (costingMethod === "Weighted Average") {
          await updateWeightedAverage(item, returnQty, item.batch_id);
        } else {
          return Promise.resolve();
        }
      } catch (error) {
        console.error(`Error processing item ${item.material_id}:`, error);
      }
    }
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
      document_types: "Sales Return Receiving",
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
        document_types: "Sales Return Receiving",
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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("sales_return_receiving")
    .where({ srr_no: generatedPrefix, organization_id: organizationId })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Sales Return Receiving number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const processRow = async (item, organizationId) => {
  if (item.batch_no === "Auto-generated batch number") {
    const resBatchConfig = await db
      .collection("batch_level_config")
      .where({ organization_id: organizationId })
      .get();

    if (resBatchConfig && resBatchConfig.data.length > 0) {
      const batchConfigData = resBatchConfig.data[0];

      let batchDate = "";
      let dd,
        mm,
        yy = "";

      // Checking for related field
      switch (batchConfigData.batch_format) {
        case "Document Date":
          let issueDate = this.getValue("received_date");

          if (!issueDate)
            throw new Error(
              "Received Date is required for generating batch number."
            );

          console.log("issueDate", new Date(issueDate));

          issueDate = new Date(issueDate);

          dd = String(issueDate.getDate()).padStart(2, "0");
          mm = String(issueDate.getMonth() + 1).padStart(2, "0");
          yy = String(issueDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Document Created Date":
          let createdDate = new Date().toISOString().split("T")[0];

          console.log("createdDate", createdDate);

          createdDate = new Date(createdDate);

          dd = String(createdDate.getDate()).padStart(2, "0");
          mm = String(createdDate.getMonth() + 1).padStart(2, "0");
          yy = String(createdDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Manufacturing Date":
          let manufacturingDate = item.manufacturing_date;

          console.log("manufacturingDate", manufacturingDate);

          if (!manufacturingDate)
            throw new Error(
              "Manufacturing Date is required for generating batch number."
            );

          manufacturingDate = new Date(manufacturingDate);

          dd = String(manufacturingDate.getDate()).padStart(2, "0");
          mm = String(manufacturingDate.getMonth() + 1).padStart(2, "0");
          yy = String(manufacturingDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Expired Date":
          let expiredDate = item.expired_date;

          console.log("expiredDate", expiredDate);

          if (!expiredDate)
            throw new Error(
              "Expired Date is required for generating batch number."
            );

          expiredDate = new Date(expiredDate);

          dd = String(expiredDate.getDate()).padStart(2, "0");
          mm = String(expiredDate.getMonth() + 1).padStart(2, "0");
          yy = String(expiredDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;
      }

      let batchPrefix = batchConfigData.batch_prefix || "";
      if (batchPrefix) batchPrefix += "-";

      const generatedBatchNo =
        batchPrefix +
        batchDate +
        String(batchConfigData.batch_running_number).padStart(
          batchConfigData.batch_padding_zeroes,
          "0"
        );

      item.batch_no = generatedBatchNo;
      await db
        .collection("batch_level_config")
        .where({ id: batchConfigData.id })
        .update({
          batch_running_number: batchConfigData.batch_running_number + 1,
        });

      return item;
    }
  } else {
    return item;
  }
};

const updateSalesReturn = async (entry) => {
  try {
    const resSRLineData = await Promise.all(
      entry.table_srr.map(
        async (item) =>
          await db
            .collection("sales_return_mes6yhqe_sub")
            .doc(item.sr_line_id)
            .get()
      )
    );

    const srLineItemData = resSRLineData.map((response) => response.data[0]);

    await Promise.all(
      entry.table_srr.map(async (item, index) => {
        await db
          .collection("sales_return_mes6yhqe_sub")
          .doc(item.sr_line_id)
          .update({
            received_qty:
              parseFloat(srLineItemData[index].received_qty || 0) +
              parseFloat(item.received_qty || 0),
            srr_status:
              parseFloat(srLineItemData[index].received_qty || 0) +
                parseFloat(item.received_qty || 0) >=
              parseFloat(srLineItemData[index].expected_return_qty || 0)
                ? "Fully Received"
                : "Partially Received",
          });
      })
    );

    const resSR = await Promise.all(
      entry.sr_id.map(
        async (item) => await db.collection("sales_return").doc(item).get()
      )
    );

    const srData = resSR.map((response) => response.data[0]);

    const updatedSR = await Promise.all(
      srData.map(async (item, index) => {
        const updatedSRStatus = item.table_sr.some(
          (srItem) =>
            parseFloat(srItem.received_qty || 0) <
            parseFloat(srItem.expected_return_qty || 0)
        )
          ? "Partially Received"
          : "Fully Received";

        return {
          id: item.id,
          srr_status: updatedSRStatus,
        };
      })
    );

    await Promise.all(
      updatedSR.map(async (item) => {
        await db.collection("sales_return").doc(item.id).update({
          srr_status: item.srr_status,
        });
      })
    );
  } catch (error) {
    throw new Error("Error updating Sales Return records." + error);
  }
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      // Set the SRR number
      entry.srr_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(entry.srr_no, organizationId);
      if (!isUnique) {
        throw new Error(
          `SRR Number "${entry.srr_no}" already exists. Please use a different number.`
        );
      }
    }

    const processedTableSRR = [];
    for (const item of entry.table_srr) {
      const processedItem = await processRow(item, organizationId);
      processedTableSRR.push(processedItem);
    }
    entry.table_srr = processedTableSRR;

    const resSRR = await db.collection("sales_return_receiving").add(entry);

    console.log(`resSRR ${resSRR.data[0]}`);
    await updateInventory(resSRR.data[0], entry.plant_id, organizationId);
    await updateSalesReturn(entry);

    this.$message.success("Add successfully");
    closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error(error);
    this.$message.error(error.message || String(error));
  }
};

const updateEntry = async (organizationId, entry, salesReturnReceivingId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.srr_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(entry.srr_no, organizationId);
      if (!isUnique) {
        throw new Error(
          `SRR Number "${entry.srr_no}" already exists. Please use a different number.`
        );
      }
    }

    const processedTableSRR = [];
    for (const item of entry.table_srr) {
      const processedItem = await processRow(item, organizationId);
      processedTableSRR.push(processedItem);
    }
    entry.table_srr = processedTableSRR;

    const resSRR = await db
      .collection("sales_return_receiving")
      .doc(salesReturnReceivingId)
      .update(entry);

    console.log(`resSRR ${resSRR.data[0]}`);
    await updateInventory(resSRR.data[0], entry.plant_id, organizationId);
    await updateSalesReturn(entry);

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error(error);
    this.$message.error(error.message || String(error));
  }
};

// Helper function to calculate total received quantities for validation
const calculateReceivedQuantities = async (
  salesReturnIds,
  excludeSrrId = null
) => {
  try {
    // Get all SRRs for these Sales Returns
    const srrResponse = await db.collection("sales_return_receiving").get();

    let allReceivingItems = [];

    if (srrResponse.data && srrResponse.data.length > 0) {
      // Filter to only include SRRs related to our Sales Returns and exclude current SRR if updating
      const relevantSrrs = srrResponse.data.filter((srr) => {
        const srrSalesReturns = Array.isArray(srr.sales_return_id)
          ? srr.sales_return_id
          : [srr.sales_return_id];

        const isRelevant = srrSalesReturns.some((id) =>
          salesReturnIds.includes(id)
        );
        const isNotCurrent = excludeSrrId ? srr.id !== excludeSrrId : true;

        return isRelevant && isNotCurrent;
      });

      // Extract all table_srr items from the relevant SRRs
      relevantSrrs.forEach((srr) => {
        if (srr.table_srr && Array.isArray(srr.table_srr)) {
          allReceivingItems = [...allReceivingItems, ...srr.table_srr];
        }
      });
    }

    // Calculate total received quantities per SR and material
    const receivedByMaterial = {};

    allReceivingItems.forEach((item) => {
      if (item.material_id && item.sr_number) {
        const key = `${item.sr_number}_${item.material_id}`;
        receivedByMaterial[key] =
          (receivedByMaterial[key] || 0) + Number(item.return_quantity || 0);
      }
    });

    return receivedByMaterial;
  } catch (error) {
    console.error("Error calculating received quantities:", error);
    return {};
  }
};

// Validate that quantities don't exceed expected amounts
const validateReceivingQuantities = async (entry, isUpdate = false) => {
  try {
    const salesReturnIds = Array.isArray(entry.sales_return_id)
      ? entry.sales_return_id
      : [entry.sales_return_id];

    // Get all Sales Returns
    const srPromises = salesReturnIds.map((srId) =>
      db.collection("sales_return").where({ id: srId }).get()
    );

    const srResults = await Promise.all(srPromises);

    // Build a map of expected quantities by material and SR
    const expectedQuantities = {};
    const srNumbers = {};

    srResults.forEach((result) => {
      if (result.data && result.data.length > 0) {
        const sr = result.data[0];
        srNumbers[sr.id] = sr.sales_return_no;

        if (sr.table_sr && Array.isArray(sr.table_sr)) {
          sr.table_sr.forEach((item) => {
            if (item.material_id) {
              const key = `${sr.sales_return_no}_${item.material_id}`;
              expectedQuantities[key] = Number(item.expected_return_qty || 0);
            }
          });
        }
      }
    });

    // Get already received quantities from other SRRs
    const receivedQuantities = await calculateReceivedQuantities(
      salesReturnIds,
      isUpdate ? entry.id : null
    );

    // Validate quantities in the current entry
    const currentItems = entry.table_srr || [];
    const errors = [];

    for (const item of currentItems) {
      if (item.material_id && item.sr_number) {
        const key = `${item.sr_number}_${item.material_id}`;
        const expected = expectedQuantities[key] || 0;
        const alreadyReceived = receivedQuantities[key] || 0;
        const currentQuantity = Number(item.return_quantity || 0);

        if (alreadyReceived + currentQuantity > expected) {
          errors.push(
            `The total received quantity (${
              alreadyReceived + currentQuantity
            }) for material ${item.material_name} in SR ${
              item.sr_number
            } exceeds the expected return quantity (${expected})`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    console.error("Error validating receiving quantities:", error);
    return {
      valid: false,
      errors: [`Error validating quantities: ${error.message}`],
    };
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }

    return obj.toString();
  }
  return null;
};

const fetchReceivedQuantity = async () => {
  const tableSRR = this.getValue("table_srr") || [];

  const resSRLineData = await Promise.all(
    tableSRR.map((item) =>
      db.collection("sales_return_mes6yhqe_sub").doc(item.sr_line_id).get()
    )
  );

  const srLineItemData = resSRLineData.map((response) => response.data[0]);

  const invalidReceivedQty = [];

  for (const [index, item] of tableSRR.entries()) {
    const srLine = srLineItemData.find((sr) => sr.id === item.sr_line_id);

    if (srLine) {
      const maxReceivableQty =
        (srLine.expected_return_qty || 0) - (srLine.received_qty || 0);
      if ((item.received_qty || 0) > maxReceivableQty) {
        invalidReceivedQty.push(`#${index + 1}`);
        this.setData({
          [`table.srr.${index}.to_receive_qty`]: maxReceivableQty,
        });
      }
    }
  }

  if (invalidReceivedQty.length > 0) {
    await this.$alert(
      `Line${
        invalidReceivedQty.length > 1 ? "s" : ""
      } ${invalidReceivedQty.join(", ")} ha${
        invalidReceivedQty.length > 1 ? "ve" : "s"
      } an expected receive quantity exceeding the maximum receivable quantity.`,
      "Invalid Receive Quantity",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );

    throw new Error("Invalid receive quantity detected.");
  }
};

const processSRRLineItem = async (entry) => {
  const totalQuantity = entry.table_srr.reduce((sum, item) => {
    const { received_qty } = item;
    return sum + (received_qty || 0); // Handle null/undefined received_qty
  }, 0);

  if (totalQuantity === 0) {
    throw new Error("Total receive quantity is 0.");
  }

  const zeroQtyArray = [];
  for (const [index, srr] of entry.table_srr.entries()) {
    console.log("srr.received_qty", srr.received_qty);
    if (!srr.received_qty || (srr.received_qty && srr.received_qty <= 0)) {
      zeroQtyArray.push(`#${index + 1}`);
    }
  }

  console.log("zeroQtyArray", zeroQtyArray);
  if (zeroQtyArray.length > 0) {
    await this.$confirm(
      `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
        zeroQtyArray.length > 1 ? "ve" : "s"
      } a zero receive quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 receive quantity. \nWould you like to proceed?`,
      "Zero Receive Quantity Detected",
      {
        confirmButtonText: "OK",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: false,
      }
    )
      .then(async () => {
        console.log("User clicked OK");
        entry.table_srr = entry.table_srr.filter(
          (item) => item.received_qty > 0
        );
        let salesOrderNumber = [];
        let soId = [];
        let goodsDeliveryNumber = [];
        let gdId = [];
        let salesReturnNumber = [];
        let srId = [];
        for (const srr of entry.table_srr) {
          gdId.push(srr.gd_id);
          goodsDeliveryNumber.push(srr.gd_number);

          soId.push(srr.so_id);
          salesOrderNumber.push(srr.so_number);

          srId.push(srr.sr_id);
          salesReturnNumber.push(srr.sr_number);
        }

        soId = [...new Set(soId)];
        gdId = [...new Set(gdId)];
        srId = [...new Set(srId)];
        salesOrderNumber = [...new Set(salesOrderNumber)];
        goodsDeliveryNumber = [...new Set(goodsDeliveryNumber)];
        salesReturnNumber = [...new Set(salesReturnNumber)];

        entry.so_id = soId;
        entry.gd_id = gdId;
        entry.sr_id = srId;
        entry.so_no_display = salesOrderNumber.join(", ");
        entry.gd_no_display = goodsDeliveryNumber.join(", ");
        entry.sr_no_display = salesReturnNumber.join(", ");

        return entry;
      })
      .catch(() => {
        // Function to execute when the user clicks "Cancel" or closes the dialog
        console.log("User clicked Cancel or closed the dialog");
        this.hideLoading();
        throw new Error("Saving sales return receiving cancelled.");
        // Add your logic to stop or handle cancellation here
        // Example: this.stopFunction();
      });
  }

  return entry;
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, srrLineItem] of entry.table_srr.entries()) {
      srrLineItem.customer_id = entry.customer_id || null;
      srrLineItem.plant_id = entry.plant_id || null;
      srrLineItem.line_index = index + 1;
    }
    return entry.table_srr;
  } catch (error) {
    throw new Error("Error processing sales return receiving.");
  }
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "srr_no", label: "SRR Number" },
      {
        name: "table_srr",
        label: "SRR Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [
          { name: "location_id", label: "Target Location" },
          { name: "inventory_category", label: "Inventory Category" },
          { name: "batch_no", label: "Batch Number" },
        ],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);
    await fetchReceivedQuantity();

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        plant_id,
        srr_no,
        sr_no_display,
        gd_no_display,
        so_no_display,

        sr_id,
        gd_id,
        so_id,

        customer_id,
        contact_person,

        user_id,
        srr_ref_doc,
        received_date,
        table_srr,
        received_details,
        remarks,
        remarks2,
        remarks3,
        organization_id,

        reference_type,
      } = data;

      const entry = {
        srr_status: "Completed",
        plant_id,
        srr_no,
        sr_no_display,
        gd_no_display,
        so_no_display,

        sr_id,
        gd_id,
        so_id,

        customer_id,
        contact_person,

        user_id,
        srr_ref_doc,
        received_date,
        table_srr,
        received_details,
        remarks,
        remarks2,
        remarks3,
        organization_id,

        reference_type,
      };

      const latestSRR = await processSRRLineItem(entry);

      if (latestSRR.table_srr.length === 0) {
        throw new Error(
          "All Received Quantity must not be 0. Please add at lease one item with receive quantity > 0."
        );
      }

      latestSRR.table_srr = await fillbackHeaderFields(latestSRR);

      if (page_status === "Add") {
        await addEntry(organizationId, latestSRR);
      } else if (page_status === "Edit") {
        const salesReturnReceivingId = this.getValue("id");
        await updateEntry(organizationId, latestSRR, salesReturnReceivingId);
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    // Try to get message from standard locations first
    let errorMessage = "";
    console.log(error);

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
