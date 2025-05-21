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
      .collection("purchase_order")
      .where({ id: data.purchase_order_id })
      .get()
      .then((poResponse) => {
        if (!poResponse.data || !poResponse.data.length) {
          console.log(`No purchase order found for ${data.purchase_order_id}`);
          return roundPrice(itemData.unit_price);
        }

        const poData = poResponse.data[0];

        const exchangeRate = poData.exchange_rate;
        let poQuantity = 0;
        let totalAmount = 0;

        for (const poItem of poData.table_po) {
          if (poItem.item_id === itemData.item_id) {
            poQuantity = roundQty(poItem.quantity);
            totalAmount = roundPrice(poItem.po_amount);
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
        let altQty = roundQty(item.return_quantity);
        let baseQty = altQty;
        let altUOM = item.quantity_uom;
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
          unitPrice = fifoCostPrice;
          totalPrice = roundPrice(fifoCostPrice * baseQty);
        } else if (costingMethod === "Fixed Cost") {
          const fixedCostPrice = await getFixedCostPrice(item.item_id);
          unitPrice = fixedCostPrice;
          totalPrice = roundPrice(fixedCostPrice * baseQty);
        }

        // Create inventory movement record
        await db.collection("inventory_movement").add({
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
        });

        const itemBatchBalanceParams = {
          material_id: item.material_id,
          location_id: item.location_id,
        };

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

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("sales_return_receiving")
    .where({ srr_no: generatedPrefix })
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
      "Could not generate a unique Sales Return Receiving number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const updateSalesReturn = async (entry) => {
  entry.sales_return_id.forEach(async (salesReturnId) => {
    await db.collection("sales_return").doc(salesReturnId).update({
      sr_status: "Completed",
    });
  });
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData.length !== 0) {
      await updatePrefix(organizationId, prefixData.running_number);
      await db
        .collection("sales_return_receiving")
        .add(entry)
        .then(() => {
          this.runWorkflow(
            "1918241501326159874",
            { srr_no: entry.srr_no },
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
      await updateInventory(entry, entry.plantId, organizationId);
      await updateSalesReturn(entry);
      this.$message.success("Add successfully");
      closeDialog();
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, salesReturnReceivingId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.srr_no = prefixToShow;
      await db
        .collection("sales_return_receiving")
        .doc(salesReturnReceivingId)
        .update(entry)
        .then(() => {
          this.runWorkflow(
            "1918241501326159874",
            { srr_no: entry.srr_no },
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
      await updateInventory(entry, entry.plantId, organizationId);
      await updateSalesReturn(entry);
      this.$message.success("Update successfully");
      await closeDialog();
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

    const requiredFields = [
      { name: "so_id", label: "SO Number" },
      { name: "sales_return_id", label: "Sales Return Number" },
      { name: "srr_no", label: "SRR Number" },
      {
        name: "table_srr",
        label: "SRR Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [
          { name: "location_id", label: "Target Location" },
          { name: "inventory_category", label: "Inventory Category" },
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
        fake_so_id,
        so_id,
        so_no_display,
        sales_return_id,
        sr_no_display,
        customer_id,
        contact_person,
        srr_no,
        plant_id,
        organization_id,
        user_id,
        fileupload_ed0qx6ga,
        received_date,
        table_srr,
        input_y0dr1vke,
        remarks,
      } = data;

      const entry = {
        srr_status: "Completed",
        so_id,
        so_no_display,
        fake_so_id,
        customer_id,
        contact_person,
        sales_return_id,
        sr_no_display,
        srr_no,
        plant_id,
        organization_id,
        user_id,
        fileupload_ed0qx6ga,
        received_date,
        table_srr,
        input_y0dr1vke,
        remarks,
      };

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
        closeDialog();
      } else if (page_status === "Edit") {
        const salesReturnReceivingId = this.getValue("id");
        await updateEntry(organizationId, entry, salesReturnReceivingId);
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
