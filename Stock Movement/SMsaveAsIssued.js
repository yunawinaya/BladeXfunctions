(async () => {
  try {
    this.showLoading();

    // Get all data at once
    const formData = this.getValues();

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
      driver_name,
      driver_contact_no,
      vehicle_no,
      pickup_date,
      courier_company,
      shipping_date,
      freight_charges,
      tracking_number,
      est_arrival_date,
      delivery_cost,
      est_delivery_date,
      shipping_company,
      date_qn0dl3t6,
      input_77h4nsq8,
      shipping_method,
      tracking_no,
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
      posted_status: "Unposted",
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
      driver_name,
      driver_contact_no,
      vehicle_no,
      pickup_date,
      courier_company,
      shipping_date,
      freight_charges,
      tracking_number,
      est_arrival_date,
      delivery_cost,
      est_delivery_date,
      shipping_company,
      date_qn0dl3t6,
      input_77h4nsq8,
      shipping_method,
      tracking_no,
      stock_movement,
      balance_index,
      sm_item_balance,
      table_item_balance,
      material_id,
      material_name,
      row_index,
    };

    // Helper function to close dialog
    const closeDialog = () => {
      if (this.parentGenerateForm) {
        this.parentGenerateForm.$refs.SuPageDialogRef.hide();
        this.parentGenerateForm.refresh();
        this.hideLoading();
      }
    };

    // Helper function to generate a unique prefix
    const generateUniquePrefix = async (prefixData) => {
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

      const checkUniqueness = async (generatedPrefix) => {
        const existingDoc = await db
          .collection("stock_movement")
          .where({ stock_movement_no: generatedPrefix })
          .get();
        return !existingDoc.data || existingDoc.data.length === 0;
      };

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
          "Could not generate a unique Stock Movement number after maximum attempts"
        );
      }

      return { prefixToShow, runningNumber };
    };

    // Helper function to update prefix running number
    const updatePrefixRunningNumber = async (movementType, runningNumber) => {
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

    try {
      if (page_status === "Add") {
        // Add mode
        console.log("Processing Add mode");
        await db.collection("stock_movement").add(entry);

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
          await updatePrefixRunningNumber(
            movement_type,
            prefixData.running_number
          );
        }

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
            prefixData
          );

          // Update entry with new stock_movement_no
          entry.stock_movement_no = prefixToShow;
          await db
            .collection("stock_movement")
            .doc(stockMovementId)
            .update(entry);

          // Update prefix running number
          await updatePrefixRunningNumber(movement_type, runningNumber);
        } else {
          await db
            .collection("stock_movement")
            .doc(stockMovementId)
            .update(entry);
        }

        this.$message.success("Stock Movement successfully updated and issued");
      }

      // Close dialog on success
      closeDialog();
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
