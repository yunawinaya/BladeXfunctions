const page_status = this.getParamsVariables("page_status");
const self = this;

const updateInventory = async (data, plantId, organizationId) => {
  const items = data.table_srr;

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
          const updatedAvailableQuantity =
            parseFloat(fifoDoc.fifo_available_quantity || 0) + returnQty;

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
        const waCostPrice = parseFloat(waDoc.wa_cost_price || 0);
        const waQuantity = parseFloat(waDoc.wa_quantity || 0);

        const newWaQuantity = Math.max(0, waQuantity + returnQty);

        const calculatedWaCostPrice =
          (waCostPrice * waQuantity + waCostPrice * returnQty) / newWaQuantity;
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
        let altQty = parseFloat(item.return_quantity);
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

        // Create inventory movement record
        await db.collection("inventory_movement").add({
          transaction_type: "SRR",
          trx_no: data.srr_no,
          parent_trx_no: item.sr_number,
          movement: "IN",
          unit_price: item.unit_price,
          total_price: item.unit_price * altQty,
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

        const returnQty = parseFloat(baseQty || 0);

        if (item.inventory_category === "BLK") {
          block_qty = returnQty;
        } else if (item.inventory_category === "RES") {
          reserved_qty = returnQty;
        } else if (item.inventory_category === "UNR") {
          unrestricted_qty = returnQty;
        } else if (item.inventory_category === "QIP") {
          qualityinsp_qty = returnQty;
        } else if (item.inventory_category === "ITR") {
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
            const updatedBlockQty =
              parseFloat(existingDoc.block_qty || 0) + block_qty;
            const updatedReservedQty =
              parseFloat(existingDoc.reserved_qty || 0) + reserved_qty;
            const updatedUnrestrictedQty =
              parseFloat(existingDoc.unrestricted_qty || 0) + unrestricted_qty;
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
            balance_quantity =
              block_qty +
              reserved_qty +
              unrestricted_qty +
              qualityinsp_qty +
              intransit_qty;

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
            const updatedBlockQty =
              parseFloat(existingDoc.block_qty || 0) + block_qty;
            const updatedReservedQty =
              parseFloat(existingDoc.reserved_qty || 0) + reserved_qty;
            const updatedUnrestrictedQty =
              parseFloat(existingDoc.unrestricted_qty || 0) + unrestricted_qty;
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
            balance_quantity =
              block_qty +
              reserved_qty +
              unrestricted_qty +
              qualityinsp_qty +
              intransit_qty;

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

        const costingMethod = item.costing_method;
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

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

this.getData()
  .then(async (data) => {
    try {
      const {
        so_id,
        sales_return_id,
        sr_no_display,
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

      const srr = {
        srr_status: "Completed",
        so_id,
        sales_return_id,
        sr_no_display,
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
      };

      if (page_status === "Add") {
        this.showLoading();
        await db
          .collection("sales_return_receiving")
          .add(srr)
          .then(() => {
            let organizationId = this.getVarGlobal("deptParentId");
            if (organizationId === "0") {
              organizationId = this.getVarSystem("deptIds").split(",")[0];
            }

            return db
              .collection("prefix_configuration")
              .where({
                document_types: "Sales Return Receiving",
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
                      document_types: "Sales Return Receiving",
                      is_deleted: 0,
                      organization_id: organizationId,
                    })
                    .update({
                      running_number: parseInt(data.running_number) + 1,
                      has_record: 1,
                    });
                }
              });
          })
          .then(async () => {
            const result = await db
              .collection("sales_order")
              .doc(srr.so_no)
              .get();

            const plantId = result.data[0].plant_name;
            const organizationId = result.data[0].organization_id;
            await updateInventory(srr, plantId, organizationId);
            await db.collection("sales_return").doc(sales_return_id).update({
              sr_status: "Completed",
            });
          })
          .then(() => {
            closeDialog();
          })
          .catch((error) => {
            alert(
              "Please fill in all required fields marked with (*) before submitting."
            );
          });
      } else if (page_status === "Edit") {
        this.showLoading();
        const salesReturnReceivingId = this.getParamsVariables(
          "sales_return_receiving_no"
        );

        let organizationId = this.getVarGlobal("deptParentId");
        if (organizationId === "0") {
          organizationId = this.getVarSystem("deptIds").split(",")[0];
        }

        const prefixEntry = db
          .collection("prefix_configuration")
          .where({
            document_types: "Sales Return Receiving",
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
                generated = generated.replace(
                  "prefix",
                  prefixData.prefix_value
                );
                generated = generated.replace(
                  "suffix",
                  prefixData.suffix_value
                );
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
                  .collection("sales_return_receiving")
                  .where({ srr_no: generatedPrefix })
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
                    "Could not generate a unique Sales Return Receiving number after maximum attempts"
                  );
                } else {
                  srr.srr_no = prefixToShow;
                  db.collection("sales_return_receiving")
                    .doc(salesReturnReceivingId)
                    .update(srr);
                  db.collection("prefix_configuration")
                    .where({
                      document_types: "Sales Return Receiving",
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
            } else {
              db.collection("sales_return_receiving")
                .doc(salesReturnReceivingId)
                .update(srr);
            }
          })
          .then(async () => {
            await db
              .collection("sales_return_receiving")
              .doc(salesReturnReceivingId)
              .update(srr);

            const result = await db
              .collection("sales_order")
              .doc(srr.so_no)
              .get();

            const plantId = result.data[0].plant_name;
            await updateInventory(srr, plantId, organizationId);
            await db.collection("sales_return").doc(sales_return_id).update({
              sr_status: "Completed",
            });
          })
          .then(() => {
            closeDialog();
          })
          .catch((error) => {
            alert(error);
          });
      }
    } catch (error) {
      console.error("Error in sales return receiving process:", error);
      alert(
        "An error occurred during processing. Please try again or contact support."
      );
    }
  })
  .catch((error) => {
    console.error("Error in sales return receiving process:", error);
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
