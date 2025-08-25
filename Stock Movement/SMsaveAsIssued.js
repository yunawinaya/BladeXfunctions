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

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, smLineItem] of entry.stock_movement.entries()) {
      smLineItem.organization_id = entry.organization_id;
      smLineItem.issuing_plant = entry.issuing_operation_faci || null;
      smLineItem.receiving_plant = entry.receiving_operation_faci || null;
      smLineItem.line_index = index + 1;
    }
    return entry.stock_movement;
  } catch (error) {
    throw new Error("Error processing Stock Movement.");
  }
};

(async () => {
  try {
    this.showLoading();

    // Get all data at once
    const formData = this.getValues();

    const requiredFields = [
      { name: "issuing_operation_faci", label: "Plant" },
      { name: "issue_date", label: "Issue Date" },
      { name: "movement_type", label: "Movement Type" },
      { name: "receiving_operation_faci", label: "Receiving Plant" },
      {
        name: "stock_movement",
        label: "Stock Movement Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(formData, requiredFields);

    if (missingFields.length > 0) {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
      return;
    }

    const {
      id: stockMovementId,
      page_status,
      issue_date,
      stock_movement_no,
      movement_type,
      movement_type_id,
      movement_reason,
      issued_by,
      issuing_operation_faci,
      remarks,
      delivery_method,
      reference_documents,
      receiving_operation_faci,
      movement_id,
      is_production_order,
      production_order_id,

      cp_driver_name,
      cp_ic_no,
      cp_driver_contact_no,
      cp_vehicle_number,
      cp_pickup_date,
      cp_validity_collection,
      cs_courier_company,
      cs_shipping_date,
      cs_tracking_number,
      cs_est_arrival_date,
      cs_freight_charges,
      ct_driver_name,
      ct_driver_contact_no,
      ct_ic_no,
      ct_vehicle_number,
      ct_est_delivery_date,
      ct_delivery_cost,
      ss_shipping_company,
      ss_shipping_date,
      ss_freight_charges,
      ss_shipping_method,
      ss_est_arrival_date,
      ss_tracking_number,
      tpt_vehicle_number,
      tpt_transport_name,
      tpt_ic_no,
      tpt_driver_contact_no,

      stock_movement,
      balance_index,
      sm_item_balance,
      table_item_balance,
      material_id,
      material_name,
      row_index,
    } = formData;

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Create entry data
    const entry = {
      stock_movement_status: "Issued",
      organization_id: organizationId,
      posted_status: "",
      issue_date,
      stock_movement_no,
      movement_type,
      movement_type_id,
      movement_reason,
      issued_by,
      issuing_operation_faci,
      remarks,
      delivery_method,
      reference_documents,
      receiving_operation_faci,
      movement_id,
      is_production_order,
      production_order_id,

      cp_driver_name,
      cp_ic_no,
      cp_driver_contact_no,
      cp_vehicle_number,
      cp_pickup_date,
      cp_validity_collection,
      cs_courier_company,
      cs_shipping_date,
      cs_tracking_number,
      cs_est_arrival_date,
      cs_freight_charges,
      ct_driver_name,
      ct_driver_contact_no,
      ct_ic_no,
      ct_vehicle_number,
      ct_est_delivery_date,
      ct_delivery_cost,
      ss_shipping_company,
      ss_shipping_date,
      ss_freight_charges,
      ss_shipping_method,
      ss_est_arrival_date,
      ss_tracking_number,
      tpt_vehicle_number,
      tpt_transport_name,
      tpt_ic_no,
      tpt_driver_contact_no,

      stock_movement,
      balance_index,
      sm_item_balance,
      table_item_balance,
      material_id,
      material_name,
      row_index,
    };

    entry.stock_movement = await fillbackHeaderFields(entry);

    // Helper function to close dialog
    const closeDialog = () => {
      if (this.parentGenerateForm) {
        this.parentGenerateForm.$refs.SuPageDialogRef.hide();
        this.parentGenerateForm.refresh();
        this.hideLoading();
      }
    };

    // Helper function to generate a unique prefix
    const generateUniquePrefix = async (prefixData, organizationId) => {
      const now = new Date();
      let runningNumber = prefixData.running_number;
      let isUnique = false;
      let maxAttempts = 10;
      let attempts = 0;
      let prefixToShow;

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

      const checkUniqueness = async (generatedPrefix, organizationId) => {
        const existingDoc = await db
          .collection("stock_movement")
          .where({
            stock_movement_no: generatedPrefix,
            organization_id: organizationId,
          })
          .get();
        return !existingDoc.data || existingDoc.data.length === 0;
      };

      while (!isUnique && attempts < maxAttempts) {
        attempts++;
        prefixToShow = generatePrefix(runningNumber);
        isUnique = await checkUniqueness(prefixToShow, organizationId);
        if (!isUnique) {
          runningNumber++;
        }
      }

      if (!isUnique) {
        throw new Error(
          "Could not generate a unique Stock Movement number after maximum attempts"
        );
      }

      return { prefixToShow, runningNumber };
    };

    // Helper function to update prefix running number
    const updatePrefixRunningNumber = async (
      movementType,
      runningNumber,
      organizationId
    ) => {
      await db
        .collection("prefix_configuration")
        .where({
          document_types: "Stock Movement",
          is_deleted: 0,
          organization_id: organizationId,
          movement_type: movementType,
        })
        .update({
          running_number: parseInt(runningNumber) + 1,
          has_record: 1,
        });
    };

    const updateItemTransactionDate = async (entry) => {
      try {
        const tableSM = entry.stock_movement;

        const uniqueItemIds = [
          ...new Set(
            tableSM
              .filter((item) => item.item_selection)
              .map((item) => item.item_selection)
          ),
        ];

        const date = new Date().toISOString();
        for (const [index, item] of uniqueItemIds.entries()) {
          try {
            await db
              .collection("Item")
              .doc(item)
              .update({ last_transaction_date: date });
          } catch (error) {
            throw new Error(
              `Cannot update last transaction date for item #${index + 1}.`
            );
          }
        }
      } catch (error) {
        throw new Error(error);
      }
    };

    try {
      if (page_status === "Add") {
        // Add mode
        console.log("Processing Add mode");

        // Update prefix running number
        const prefixEntryResponse = await db
          .collection("prefix_configuration")
          .where({
            document_types: "Stock Movement",
            is_deleted: 0,
            movement_type: movement_type,
            organization_id: organizationId,
            is_active: 1,
          })
          .get();

        if (prefixEntryResponse.data && prefixEntryResponse.data.length > 0) {
          const prefixData = prefixEntryResponse.data[0];
          const { prefixToShow, runningNumber } = await generateUniquePrefix(
            prefixData,
            organizationId
          );

          entry.stock_movement_no = prefixToShow;
          await updatePrefixRunningNumber(
            movement_type,
            runningNumber,
            organizationId
          );
        }
        await db.collection("stock_movement").add(entry);

        this.$message.success("Stock Movement successfully issued");
      } else if (page_status === "Edit") {
        // Edit mode
        console.log("Processing Edit mode");
        const prefixEntryResponse = await db
          .collection("prefix_configuration")
          .where({
            document_types: "Stock Movement",
            is_deleted: 0,
            organization_id: organizationId,
            is_active: 1,
            movement_type: movement_type,
          })
          .get();

        if (prefixEntryResponse.data && prefixEntryResponse.data.length > 0) {
          const prefixData = prefixEntryResponse.data[0];
          const { prefixToShow, runningNumber } = await generateUniquePrefix(
            prefixData,
            organizationId
          );

          // Update entry with new stock_movement_no
          entry.stock_movement_no = prefixToShow;

          // Update prefix running number
          await updatePrefixRunningNumber(
            movement_type,
            runningNumber,
            organizationId
          );
          await db
            .collection("stock_movement")
            .doc(stockMovementId)
            .update(entry);
        } else {
          await db
            .collection("stock_movement")
            .doc(stockMovementId)
            .update(entry);
        }

        this.$message.success("Stock Movement successfully updated and issued");
      }

      // Close dialog on success
      await updateItemTransactionDate(entry);
      await closeDialog();
    } catch (error) {
      console.error("Error processing stock movement:", error);
      this.$message.error(error.message || "An error occurred");
      this.hideLoading();
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.$message.error(error.message || "An error occurred");
    this.hideLoading();
  }
})();
