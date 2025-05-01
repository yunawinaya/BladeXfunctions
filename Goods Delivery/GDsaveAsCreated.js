const page_status = this.getParamsVariables("page_status");
const self = this;

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

// check credit & overdue limit before doing any process
const checkCreditOverdueLimit = async (customer_name, so_id) => {
  try {
    const fetchCustomer = await db
      .collection("customer")
      .where({ customer_name, is_deleted: 0 })
      .get();

    const customerData = fetchCustomer.data[0];
    if (!customerData) {
      console.error(`Customer ${customer_name} not found`);
      return false;
    }

    const soData = await db
      .collection("sales_order")
      .where({ id: so_id, is_deleted: 0 })
      .get();

    const so_total = parseFloat(soData.data[0].so_total || 0);

    const controlTypes = customerData.control_type_list;
    const isAccurate = customerData.is_accurate;
    const outstandingAmount = parseFloat(customerData.outstanding_balance || 0);
    const overdueAmount = parseFloat(customerData.overdue_inv_total_am || 0);
    const overdueLimit = parseFloat(customerData.overdue_limit || 0);
    const creditLimit = parseFloat(customerData.customer_credit_limit || 0);
    const revisedOutstandingAmount =
      outstandingAmount + parseFloat(so_total || 0);

    // Helper function to show popup with appropriate messages and data
    const showLimitDialog = (
      type,
      includeCredit = false,
      includeOverdue = false,
      isBlock = true
    ) => {
      this.openDialog("dialog_credit_limit");

      const alerts = {
        credit: "alert_credit_limit",
        overdue: "alert_overdue_limit",
        both: "alert_credit_overdue",
        suspended: "alert_suspended",
      };

      const texts = {
        credit: "text_credit_limit",
        overdue: "text_overdue_limit",
        both: "text_credit_overdue",
        suspended: "text_suspended",
      };

      const alertType = type;

      this.display(`dialog_credit_limit.${alerts[alertType]}`);
      this.display(`dialog_credit_limit.${texts[alertType]}`);

      const dataToSet = {};

      if (includeCredit) {
        this.display("dialog_credit_limit.total_allowed_credit");
        this.display("dialog_credit_limit.total_credit");
        dataToSet["dialog_credit_limit.total_allowed_credit"] = creditLimit;
        dataToSet["dialog_credit_limit.total_credit"] =
          revisedOutstandingAmount;
      }

      if (includeOverdue) {
        this.display("dialog_credit_limit.total_allowed_overdue");
        this.display("dialog_credit_limit.total_overdue");
        dataToSet["dialog_credit_limit.total_allowed_overdue"] = overdueLimit;
        dataToSet["dialog_credit_limit.total_overdue"] = overdueAmount;
      }

      this.display(
        `dialog_credit_limit.text_${
          isBlock ? (includeCredit && includeOverdue ? "3" : "1") : "4"
        }`
      );

      if (isBlock) {
        this.display("dialog_credit_limit.button_back");
      } else {
        this.display("dialog_credit_limit.button_yes");
        this.display("dialog_credit_limit.button_no");
      }

      this.setData(dataToSet);

      return false;
    };

    // Check if accuracy flag is set
    if (controlTypes) {
      if (isAccurate === 0) {
        this.openDialog("dialog_sync_customer");
        return false;
      }

      // Define control type behaviors
      const controlTypeChecks = {
        // Check overdue limit (block)
        1: () => {
          if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, true);
          }
          return true;
        },

        // Check overdue limit (override)
        2: () => {
          if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, false);
          }
          return true;
        },

        // Check credit limit (block)
        3: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, true);
          }
          return true;
        },

        // Check both limits (block)
        4: () => {
          if (
            revisedOutstandingAmount > creditLimit &&
            overdueAmount > overdueLimit
          ) {
            return showLimitDialog("both", true, true, true);
          } else if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, true);
          } else if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, true);
          }
          return true;
        },

        // Check both limits (credit block, overdue override)
        5: () => {
          if (
            revisedOutstandingAmount > creditLimit &&
            overdueAmount > overdueLimit
          ) {
            return showLimitDialog("both", true, true, true);
          } else if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, true);
          } else if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, false);
          }
          return true;
        },

        // Check credit limit (override)
        6: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, false);
          }
          return true;
        },

        // Check both limits (credit override, overdue block)
        7: () => {
          if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, true);
          } else if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, false);
          }
          return true;
        },

        // Check both limits (credit override, overdue override)
        8: () => {
          if (
            revisedOutstandingAmount > creditLimit &&
            overdueAmount > overdueLimit
          ) {
            return showLimitDialog("both", true, true, false);
          } else if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, false);
          } else if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, false);
          }
          return true;
        },

        9: () => {
          return showLimitDialog("suspended", false, false, true);
        },
      };

      // Check each control type that applies to Sales Orders
      for (const controlType of controlTypes) {
        const { control_type, document_type } = controlType;
        if (
          document_type === "Sales Orders" &&
          controlTypeChecks[control_type]
        ) {
          const result = controlTypeChecks[control_type]();
          if (result !== true) {
            return result; // Return false if a limit check fails
          }
        }
      }

      // All checks passed
      return true;
    } else {
      console.log("No control type defined for customer");
      return true;
    }
  } catch (error) {
    console.error("Error checking credit/overdue limits:", error);
    this.$alert(
      "An error occurred while checking credit limits. Please try again.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );
    return false;
  }
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
    console.error(`Error retrieving FIFO cost price for ${materialId}:`, error);
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

const getFixedCostPrice = async (materialId) => {
  const query = db.collection("Item").where({ id: materialId });
  const response = await query.get();
  const result = response.data;
  return roundPrice(result[0].purchase_unit_price || 0);
};

const processBalanceTable = async (data, isUpdate = false) => {
  const items = data.table_gd;

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to process");
    return;
  }

  const processedItemPromises = items.map(async (item, itemIndex) => {
    try {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      // Input validation
      if (!item.material_id || !item.temp_qty_data) {
        console.error(`Invalid item data for index ${itemIndex}:`, item);
        return;
      }

      // Track created or updated documents for potential rollback
      const updatedDocs = [];
      const createdDocs = [];
      // First check if this item should be processed based on stock_control
      const itemRes = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.material_id}`);
        return;
      }

      const itemData = itemRes.data[0];
      if (itemData.stock_control === 0) {
        console.log(
          `Skipping inventory update for item ${item.material_id} (stock_control=0)`
        );
        return;
      }

      const temporaryData = JSON.parse(item.temp_qty_data);
      const prevTempData = isUpdate
        ? JSON.parse(item.prev_temp_qty_data)
        : null;

      if (
        temporaryData.length > 0 &&
        (!isUpdate || (prevTempData && prevTempData.length > 0))
      ) {
        for (let i = 0; i < temporaryData.length; i++) {
          const temp = temporaryData[i];
          const prevTemp = isUpdate ? prevTempData[i] : null;

          const itemBalanceParams = {
            material_id: item.material_id,
            location_id: temp.location_id,
          };

          const balanceCollection = temp.batch_id
            ? "item_batch_balance"
            : "item_balance";

          const balanceQuery = await db
            .collection(balanceCollection)
            .where(itemBalanceParams)
            .get();

          const hasExistingBalance =
            balanceQuery.data &&
            Array.isArray(balanceQuery.data) &&
            balanceQuery.data.length > 0;

          const existingDoc = hasExistingBalance ? balanceQuery.data[0] : null;

          // UOM Conversion
          let altQty = roundQty(temp.gd_quantity);
          let baseQty = altQty;
          let altUOM = item.gd_order_uom_id;
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

          const costingMethod = itemData.material_costing_method;

          let unitPrice = roundPrice(item.unit_price);
          let totalPrice = roundPrice(unitPrice * altQty);

          if (costingMethod === "First In First Out") {
            // Get unit price from latest FIFO sequence
            const fifoCostPrice = await getLatestFIFOCostPrice(
              item.material_id,
              temp.batch_id
            );
            unitPrice = fifoCostPrice;
            totalPrice = roundPrice(fifoCostPrice * baseQty);
          } else if (costingMethod === "Weighted Average") {
            // Get unit price from WA cost price
            const waCostPrice = await getWeightedAverageCostPrice(
              item.material_id,
              temp.batch_id
            );
            unitPrice = waCostPrice;
            totalPrice = roundPrice(waCostPrice * baseQty);
          } else if (costingMethod === "Fixed Cost") {
            // Get unit price from Fixed Cost
            const fixedCostPrice = await getFixedCostPrice(item.material_id);
            unitPrice = fixedCostPrice;
            totalPrice = roundPrice(fixedCostPrice * baseQty);
          } else {
            return Promise.resolve();
          }

          // Create inventory_movement record
          const inventoryMovementDataUNR = {
            transaction_type: "GDL",
            trx_no: data.delivery_no,
            parent_trx_no: data.so_no,
            movement: "OUT",
            unit_price: unitPrice,
            total_price: totalPrice,
            quantity: altQty,
            item_id: item.material_id,
            inventory_category: "Unrestricted",
            uom_id: altUOM,
            base_qty: baseQty,
            base_uom_id: baseUOM,
            bin_location_id: temp.location_id,
            batch_number_id: temp.batch_id ? temp.batch_id : null,
            costing_method_id: item.item_costing_method,
            plant_id: data.plant_id,
            organization_id: data.organization_id,
          };

          const inventoryMovementDataRES = {
            transaction_type: "GDL",
            trx_no: data.delivery_no,
            parent_trx_no: data.so_no,
            movement: "IN",
            unit_price: unitPrice,
            total_price: totalPrice,
            quantity: altQty,
            item_id: item.material_id,
            inventory_category: "Reserved",
            uom_id: altUOM,
            base_qty: baseQty,
            base_uom_id: baseUOM,
            bin_location_id: temp.location_id,
            batch_number_id: temp.batch_id ? temp.batch_id : null,
            costing_method_id: item.item_costing_method,
            plant_id: data.plant_id,
            organization_id: data.organization_id,
          };

          const invMovementResultUNR = await db
            .collection("inventory_movement")
            .add(inventoryMovementDataUNR);
          createdDocs.push({
            collection: "inventory_movement",
            docId: invMovementResultUNR.id,
          });

          const invMovementResultRES = await db
            .collection("inventory_movement")
            .add(inventoryMovementDataRES);
          createdDocs.push({
            collection: "inventory_movement",
            docId: invMovementResultRES.id,
          });

          if (existingDoc && existingDoc.id) {
            // Determine quantity change based on update or add
            const gdQuantity = isUpdate
              ? roundQty(parseFloat(baseQty) - parseFloat(prevTemp.gd_quantity))
              : roundQty(parseFloat(baseQty));

            // Store original values for potential rollback
            updatedDocs.push({
              collection: balanceCollection,
              docId: existingDoc.id,
              originalData: {
                unrestricted_qty: roundQty(existingDoc.unrestricted_qty || 0),
                reserved_qty: roundQty(existingDoc.reserved_qty || 0),
              },
            });

            // Update balance
            await db
              .collection(balanceCollection)
              .doc(existingDoc.id)
              .update({
                unrestricted_qty: roundQty(
                  parseFloat(existingDoc.unrestricted_qty || 0) - gdQuantity
                ),
                reserved_qty: roundQty(
                  parseFloat(existingDoc.reserved_qty || 0) + gdQuantity
                ),
              });
          }
        }
      }
    } catch (error) {
      console.error(`Error processing item ${item.material_id}:`, error);

      // Rollback changes if any operation fails
      for (const doc of updatedDocs.reverse()) {
        try {
          await db
            .collection(doc.collection)
            .doc(doc.docId)
            .update(doc.originalData);
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }

      for (const doc of createdDocs.reverse()) {
        try {
          await db.collection(doc.collection).doc(doc.docId).delete();
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }
    }
  });

  await Promise.all(processedItemPromises);
};

// Main execution flow with improved error handling
this.getData()
  .then(async (data) => {
    try {
      // Input validation
      if (!data || !data.so_id || !Array.isArray(data.table_gd)) {
        throw new Error("Missing required data for goods delivery");
      }

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }
      // Destructure required fields
      const {
        so_id,
        so_no,
        gd_billing_name,
        gd_billing_cp,
        gd_billing_address,
        gd_shipping_address,
        delivery_no,
        gd_ref_doc,
        plant_id,
        organization_id,
        customer_name,
        gd_contact_name,
        contact_number,
        email_address,
        document_description,
        gd_delivery_method,
        delivery_date,
        driver_name,
        driver_contact_no,
        validity_of_collection,
        vehicle_no,
        pickup_date,
        courier_company,
        shipping_date,
        freight_charges,
        tracking_number,
        est_arrival_date,
        driver_cost,
        est_delivery_date,
        shipping_company,
        shipping_method,
        table_gd,
        order_remark,
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

      const canProceed = await checkCreditOverdueLimit(customer_name, so_id);
      if (!canProceed) {
        this.hideLoading();
        return;
      }

      // If this is an edit, store previous temporary quantities
      if (page_status === "Edit" && Array.isArray(table_gd)) {
        table_gd.forEach((item) => {
          item.prev_temp_qty_data = item.temp_qty_data;
        });
      }

      // Prepare goods delivery object
      const gd = {
        gd_status: "Created",
        so_id,
        so_no,
        plant_id,
        organization_id,
        gd_billing_name,
        gd_billing_cp,
        gd_billing_address,
        gd_shipping_address,
        delivery_no,
        gd_ref_doc,
        customer_name,
        gd_contact_name,
        contact_number,
        email_address,
        document_description,
        gd_delivery_method,
        delivery_date,
        driver_name,
        driver_contact_no,
        validity_of_collection,
        vehicle_no,
        pickup_date,
        courier_company,
        shipping_date,
        freight_charges,
        tracking_number,
        est_arrival_date,
        driver_cost,
        est_delivery_date,
        shipping_company,
        shipping_method,
        table_gd,
        order_remark,
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

      // Perform action based on page status
      if (page_status === "Add") {
        this.showLoading();
        await db
          .collection("goods_delivery")
          .add(gd)
          .then(() => {
            return db
              .collection("prefix_configuration")
              .where({
                document_types: "Goods Delivery",
                is_deleted: 0,
                organization_id: organizationId,
                is_active: 1,
              })
              .get()
              .then((prefixEntry) => {
                const data = prefixEntry.data[0];
                return db
                  .collection("prefix_configuration")
                  .where({
                    document_types: "Goods Delivery",
                    is_deleted: 0,
                    organization_id: organizationId,
                  })
                  .update({
                    running_number: parseInt(data.running_number) + 1,
                    has_record: 1,
                  });
              });
          });
        await processBalanceTable(gd);
      } else if (page_status === "Edit") {
        this.showLoading();
        const goodsDeliveryId = this.getParamsVariables("goods_delivery_no");

        if (gd.delivery_no.startsWith("DRAFT")) {
          const prefixEntry = db
            .collection("prefix_configuration")
            .where({
              document_types: "Goods Delivery",
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
                    .collection("goods_delivery")
                    .where({ delivery_no: generatedPrefix })
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
                      "Could not generate a unique Goods Delivery number after maximum attempts"
                    );
                  } else {
                    gd.delivery_no = prefixToShow;
                    db.collection("goods_delivery")
                      .doc(goodsDeliveryId)
                      .update(gd);
                    db.collection("prefix_configuration")
                      .where({
                        document_types: "Goods Delivery",
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
                db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);
              }
            })
            .catch((error) => {
              this.$message.error(error);
            });
        } else {
          db.collection("goods_delivery")
            .doc(goodsDeliveryId)
            .update(gd)
            .catch((error) => {
              this.$message.error(error);
            });
        }

        await processBalanceTable(gd, true);
      }
    } catch (error) {
      console.error("Error in goods delivery process:", error);
      this.$message.error(
        "An error occurred during processing. Please try again or contact support."
      );
    }
  })
  .then(() => {
    closeDialog();
  })
  .catch((error) => {
    console.error("Error in goods delivery process:", error);
    this.$message.error(error);
  });
