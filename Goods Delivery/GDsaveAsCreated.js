const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
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
  try {
    const query = db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;

    if (result && result.length > 0) {
      return roundPrice(parseFloat(result[0].purchase_unit_price || 0));
    }

    return 0;
  } catch (error) {
    console.error(
      `Error retrieving fixed cost price for ${materialId}:`,
      error
    );
    return 0;
  }
};

const getPrefixData = async (organizationId) => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Goods Delivery",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    console.log("Prefix data result:", prefixEntry);

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      console.log("No prefix configuration found");
      return null;
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error getting prefix data:", error);
    throw error;
  }
};

const updatePrefix = async (organizationId, runningNumber) => {
  console.log(
    "Updating prefix for organization:",
    organizationId,
    "with running number:",
    runningNumber
  );
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Goods Delivery",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({
        running_number: parseInt(runningNumber) + 1,
        has_record: 1,
      });
    console.log("Prefix update successful");
  } catch (error) {
    console.error("Error updating prefix:", error);
    throw error;
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  console.log("Generating prefix with running number:", runNumber);
  try {
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
    console.log("Generated prefix:", generated);
    return generated;
  } catch (error) {
    console.error("Error generating prefix:", error);
    throw error;
  }
};

const checkUniqueness = async (generatedPrefix) => {
  console.log("Checking uniqueness for prefix:", generatedPrefix);
  try {
    const existingDoc = await db
      .collection("goods_delivery")
      .where({ delivery_no: generatedPrefix })
      .get();

    const isUnique = !existingDoc.data || existingDoc.data.length === 0;
    console.log("Is unique:", isUnique);
    return isUnique;
  } catch (error) {
    console.error("Error checking uniqueness:", error);
    throw error;
  }
};

const findUniquePrefix = async (prefixData) => {
  console.log("Finding unique prefix");
  try {
    const now = new Date();
    let prefixToShow;
    let runningNumber = prefixData.running_number || 1;
    let isUnique = false;
    let maxAttempts = 10;
    let attempts = 0;

    while (!isUnique && attempts < maxAttempts) {
      attempts++;
      console.log(`Attempt ${attempts} to find unique prefix`);
      prefixToShow = generatePrefix(runningNumber, now, prefixData);
      isUnique = await checkUniqueness(prefixToShow);
      if (!isUnique) {
        console.log("Prefix not unique, incrementing running number");
        runningNumber++;
      }
    }

    if (!isUnique) {
      console.error("Could not find unique prefix after maximum attempts");
      throw new Error(
        "Could not generate a unique Goods Delivery number after maximum attempts"
      );
    }

    console.log(
      "Found unique prefix:",
      prefixToShow,
      "with running number:",
      runningNumber
    );
    return { prefixToShow, runningNumber };
  } catch (error) {
    console.error("Error finding unique prefix:", error);
    throw error;
  }
};

const processBalanceTable = async (data, isUpdate = false) => {
  console.log("Processing balance table");

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

          if (temp.batch_id) {
            itemBalanceParams.batch_id = temp.batch_id;
          }

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

          // Create inventory_movement record - OUT from Unrestricted
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

          // Create inventory_movement record - IN to Reserved
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

          // Add both movement records
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

const validateForm = (data, requiredFields) => {
  console.log("Validating form");
  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return !value;
  });
  console.log("Missing fields:", missingFields);
  return missingFields;
};

// Main execution wrapped in an async IIFE
(async () => {
  console.log("Starting Goods Delivery Created function");

  try {
    const data = await this.getValues();
    console.log("Form data:", data);

    // Get page status
    const page_status = data.page_status;
    console.log("Page status:", page_status);

    // Define required fields
    const requiredFields = [
      { name: "customer_name", label: "Customer" },
      { name: "plant_id", label: "Plant" },
      { name: "so_id", label: "Sales Order" },
    ];

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length > 0) {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(
        `Please fill in all required fields: ${missingFieldNames}`
      );
      console.log("Validation failed, missing fields:", missingFieldNames);
      return;
    }

    console.log("Validation passed");

    // If this is an edit, store previous temporary quantities
    if (page_status === "Edit" && Array.isArray(data.table_gd)) {
      data.table_gd.forEach((item) => {
        item.prev_temp_qty_data = item.temp_qty_data;
      });
    }

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }
    console.log("Organization ID:", organizationId);

    // Prepare goods delivery object
    const gd = {
      gd_status: "Created",
      fake_so_id: data.fake_so_id,
      so_id: data.so_id,
      so_no: data.so_no,
      gd_billing_name: data.gd_billing_name,
      gd_billing_cp: data.gd_billing_cp,
      gd_billing_address: data.gd_billing_address,
      gd_shipping_address: data.gd_shipping_address,
      delivery_no: data.delivery_no,
      plant_id: data.plant_id,
      organization_id: organizationId,
      gd_ref_doc: data.gd_ref_doc,
      customer_name: data.customer_name,
      gd_contact_name: data.gd_contact_name,
      contact_number: data.contact_number,
      email_address: data.email_address,
      document_description: data.document_description,
      gd_delivery_method: data.gd_delivery_method,
      delivery_date: data.delivery_date,
      driver_name: data.driver_name,
      driver_contact_no: data.driver_contact_no,
      validity_of_collection: data.validity_of_collection,
      vehicle_no: data.vehicle_no,
      pickup_date: data.pickup_date,
      courier_company: data.courier_company,
      shipping_date: data.shipping_date,
      freight_charges: data.freight_charges,
      tracking_number: data.tracking_number,
      est_arrival_date: data.est_arrival_date,
      driver_cost: data.driver_cost,
      est_delivery_date: data.est_delivery_date,
      shipping_company: data.shipping_company,
      shipping_method: data.shipping_method,
      table_gd: data.table_gd,
      order_remark: data.order_remark,
      billing_address_line_1: data.billing_address_line_1,
      billing_address_line_2: data.billing_address_line_2,
      billing_address_line_3: data.billing_address_line_3,
      billing_address_line_4: data.billing_address_line_4,
      billing_address_city: data.billing_address_city,
      billing_address_state: data.billing_address_state,
      billing_address_country: data.billing_address_country,
      billing_postal_code: data.billing_postal_code,
      shipping_address_line_1: data.shipping_address_line_1,
      shipping_address_line_2: data.shipping_address_line_2,
      shipping_address_line_3: data.shipping_address_line_3,
      shipping_address_line_4: data.shipping_address_line_4,
      shipping_address_city: data.shipping_address_city,
      shipping_address_state: data.shipping_address_state,
      shipping_address_country: data.shipping_address_country,
      shipping_postal_code: data.shipping_postal_code,
    };

    // Clean up undefined/null values
    Object.keys(gd).forEach((key) => {
      if (gd[key] === undefined || gd[key] === null) {
        delete gd[key];
      }
    });

    console.log("Entry prepared with keys:", Object.keys(gd));

    this.showLoading();

    // Perform action based on page status
    if (page_status === "Add") {
      console.log("Adding new GD entry (Add)");

      // Add new document
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
              if (!prefixEntry.data || prefixEntry.data.length === 0) {
                return;
              }

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

      // Process inventory updates
      await processBalanceTable(gd);
    } else if (page_status === "Edit") {
      console.log("Updating existing GD entry (Edit)");

      // Get the GD document ID
      const goodsDeliveryId = data.id;
      console.log("Goods Delivery ID:", goodsDeliveryId);

      if (gd.delivery_no.startsWith("DRAFT")) {
        // For draft -> created, generate a new number if needed
        const prefixData = await getPrefixData(organizationId);

        if (prefixData) {
          // Generate new prefix
          const { prefixToShow, runningNumber } = await findUniquePrefix(
            prefixData
          );
          gd.delivery_no = prefixToShow;

          // Update document with new prefix
          await db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);

          // Update prefix configuration
          await updatePrefix(organizationId, runningNumber);
        } else {
          // Just update without changing number
          await db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);
        }
      } else {
        // Normal update (not changing from draft)
        await db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);
      }

      // Process inventory updates
      await processBalanceTable(gd, true);
    }

    console.log("Completed GD operation successfully");
    closeDialog();
  } catch (error) {
    console.error("Error in goods delivery process:", error);
    this.$message.error(
      error.message || "An error occurred processing the goods delivery"
    );
    this.hideLoading();
  }
})();
