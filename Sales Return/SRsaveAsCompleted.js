const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const getPrefixData = async (organizationId) => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Returns",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      throw new Error("Prefix configuration not found for Sales Returns");
    }

    return prefixEntry.data[0];
  } catch (error) {
    throw new Error(`Failed to get prefix data: ${error.message}`);
  }
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Returns",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
  } catch (error) {
    throw new Error(`Failed to update prefix: ${error.message}`);
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  try {
    let generated = prefixData.current_prefix_config;
    generated = generated.replace("prefix", prefixData.prefix_value || "");
    generated = generated.replace("suffix", prefixData.suffix_value || "");
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
  } catch (error) {
    throw new Error(`Failed to generate prefix: ${error.message}`);
  }
};

const checkUniqueness = async (generatedPrefix) => {
  try {
    const existingDoc = await db
      .collection("sales_return")
      .where({ sales_return_no: generatedPrefix })
      .get();
    return !existingDoc.data || existingDoc.data.length === 0;
  } catch (error) {
    throw new Error(`Failed to check uniqueness: ${error.message}`);
  }
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
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Sales Return number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const updateEntry = async (organizationId, entry, salesReturnId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sales_return_no = prefixToShow;

      await db.collection("sales_return").doc(salesReturnId).update(entry);

      // Run workflow after successful update
      await runWorkflowSafely(entry.sales_return_no);

      // Update sales order status
      await db
        .collection("sales_order")
        .doc(entry.sr_return_so_id)
        .update({ has_sr: true });

      return true;
    } else {
      throw new Error("No prefix configuration found");
    }
  } catch (error) {
    throw new Error(`Failed to update entry: ${error.message}`);
  }
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData) {
      // Generate a unique prefix for the new entry
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      // Set the generated prefix to the entry
      entry.sales_return_no = prefixToShow;

      // Add the new entry
      const addResult = await db.collection("sales_return").add(entry);

      // Run workflow after successful addition
      await runWorkflowSafely(entry.sales_return_no);

      // Update sales order status
      if (entry.sr_return_so_id) {
        await db
          .collection("sales_order")
          .doc(entry.sr_return_so_id)
          .update({ has_sr: true });
      }

      return addResult;
    } else {
      throw new Error("No prefix configuration found");
    }
  } catch (error) {
    throw new Error(`Failed to add entry: ${error.message}`);
  }
};

const runWorkflowSafely = async (salesReturnNo) => {
  return new Promise((resolve) => {
    try {
      this.runWorkflow(
        "1917417143259181058",
        { sales_return_no: salesReturnNo },
        (res) => {
          console.log("Workflow executed successfully:", res);
          resolve(true);
        },
        (err) => {
          console.error("Workflow execution failed:", err);
          resolve(false); // Resolve anyway to prevent blocking the main process
        }
      );
    } catch (error) {
      console.error("Error running workflow:", error);
      resolve(false);
    }
  });
};

const validateForm = (data, requiredFields) => {
  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return value === null || value === undefined;
  });
  return missingFields;
};

const updateSOandGDStatus = async (sr_return_so_id, sr_return_gd_id) => {
  try {
    const soIds = Array.isArray(sr_return_so_id)
      ? sr_return_so_id
      : [sr_return_so_id].filter(Boolean);
    const gdIds = Array.isArray(sr_return_gd_id)
      ? sr_return_gd_id
      : [sr_return_gd_id].filter(Boolean);

    const promises = [];

    for (const soId of soIds) {
      if (soId) {
        promises.push(
          db.collection("sales_order").doc(soId).update({ has_sr: 1 })
        );
      }
    }

    for (const gdId of gdIds) {
      if (gdId) {
        promises.push(
          db.collection("goods_delivery").doc(gdId).update({ has_sr: 1 })
        );
      }
    }

    await Promise.all(promises);
    return true;
  } catch (error) {
    throw new Error(`Failed to update SO and GD status: ${error.message}`);
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "sr_return_so_id", label: "SO Number" },
      { name: "sr_return_gd_id", label: "Goods Delivery Number" },
      { name: "sales_return_no", label: "Sales Return Number" },
    ];

    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        fake_sr_return_so_id,
        sr_return_so_id,
        sr_return_gd_id,
        sales_return_no,
        so_no_display,
        sr_return_date,
        plant_id,
        organization_id,
        sr_billing_name,
        sr_billing_cp,
        sr_billing_address,
        sr_shipping_address,
        gd_no_display,
        customer_id,
        sr_return_address_id,
        sales_pic_id,
        sr_remark,
        sr_delivery_method,
        sr_reference_doc,
        sr_driver_name,
        sr_vehicle_no,
        sr_driver_contact_no,
        sr_pickup_date,
        courier_company,
        sr_tracking_no,
        shipping_date,
        sr_est_arrival_date,
        sr_freight_charges,
        sr_est_delivery_date,
        sr_delivery_cost,
        shipping_company,
        shipping_method,
        sr_shipping_date,
        sr_tracking_number,
        sr_decision,
        sr_note,
        table_sr,
        remark,
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
        sr_status: "Issued",
        fake_sr_return_so_id,
        sr_return_so_id,
        sr_return_gd_id,
        sales_return_no,
        so_no_display,
        sr_return_date,
        plant_id,
        organization_id,
        gd_no_display,
        customer_id,
        sr_billing_name,
        sr_billing_cp,
        sr_billing_address,
        sr_shipping_address,
        sr_return_address_id,
        sales_pic_id,
        sr_remark,
        sr_delivery_method,
        sr_reference_doc,
        sr_driver_name,
        sr_vehicle_no,
        sr_driver_contact_no,
        sr_pickup_date,
        courier_company,
        sr_tracking_no,
        shipping_date,
        sr_est_arrival_date,
        sr_freight_charges,
        sr_est_delivery_date,
        sr_delivery_cost,
        shipping_company,
        shipping_method,
        sr_shipping_date,
        sr_tracking_number,
        sr_decision,
        sr_note,
        table_sr,
        remark,
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Update related SO and GD statuses
      await updateSOandGDStatus(sr_return_so_id, sr_return_gd_id);

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
        this.$message.success("Sales Return added successfully");
        await closeDialog();
      } else if (page_status === "Edit") {
        const salesReturnId = this.getValue("id");
        entry.updated_at = new Date().toISOString();
        await updateEntry(organizationId, entry, salesReturnId);
        this.$message.success("Sales Return updated successfully");
        await closeDialog();
      }
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(
      typeof error === "string"
        ? error
        : error.message || "An unexpected error occurred"
    );
    console.error("Error processing Sales Return:", error);
  }
})();
