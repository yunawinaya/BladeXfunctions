const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const getPrefixData = async (organizationId) => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Quotations",
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
        document_types: "Quotations", // Make sure this matches exactly
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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("Quotation")
    .where({ sqt_no: generatedPrefix, organization_id: organizationId })
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
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Quotation number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
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
    if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
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
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
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

      entry.sqt_no = prefixToShow;
    }

    await db.collection("Quotation").add(entry);
    await this.runWorkflow(
      "1917416112949374977",
      { sqt_no: entry.sqt_no },
      (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
      }
    );

    this.$message.success("Add successfully");
    await closeDialog();
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, entry, quotationId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sqt_no = prefixToShow;
    }

    await db.collection("Quotation").doc(quotationId).update(entry);
    await this.runWorkflow(
      "1917416112949374977",
      { sqt_no: entry.sqt_no },
      (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
      }
    );

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  console.log("Starting Issued function");
  try {
    this.showLoading();

    const data = this.getValues();

    // Get page status and quotation ID from parameters
    const page_status = data.page_status;
    const quotation_id = data.id;

    // Define required fields
    const requiredFields = [
      { name: "sqt_plant", label: "Plant" },
      { name: "sqt_date", label: "Quotation Date" },
      { name: "sqt_validity_period", label: "Validity Period" },
      {
        name: "table_sqt",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        sqt_customer_id,
        currency_code,
        sqt_billing_name,
        sqt_billing_address,
        sqt_billing_cp,
        sqt_shipping_address,
        sqt_no,
        sqt_plant,
        sqt_date,
        sqt_validity_period,
        sales_person_id,
        sqt_payment_term,
        sqt_delivery_method_id,
        cp_customer_pickup,
        cp_ic_no,
        driver_contact_no,
        courier_company,
        vehicle_number,
        pickup_date,
        shipping_date,
        ct_driver_name,
        ct_ic_no,
        ct_vehicle_number,
        ct_driver_contact_no,
        ct_est_delivery_date,
        ct_delivery_cost,
        ss_shipping_company,
        ss_shipping_method,
        ss_shipping_date,
        est_arrival_date,
        ss_freight_charges,
        ss_tracking_number,
        tpt_vehicle_number,
        tpt_transport_name,
        tpt_ic_no,
        tpt_driver_contact_no,
        validity_of_collection,
        sqt_sub_total,
        sqt_total_discount,
        sqt_total_tax,
        sqt_totalsum,
        sqt_remarks,
        table_sqt,
        sqt_ref_no,
        exchange_rate,
        myr_total_amount,
        sqt_new_customer,
        cs_tracking_number,
        cs_est_arrival_date,
        customer_type,
        freight_charges,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_postal_code,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_postal_code,
        shipping_address_country,
        sqt_ref_doc,
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
        acc_integration_type,
        last_sync_date,
        customer_credit_limit,
        overdue_limit,
        outstanding_balance,
        overdue_inv_total_amount,
        is_accurate,
      } = data;

      const entry = {
        sqt_status: "Issued",
        organization_id: organizationId,
        validity_of_collection,
        sqt_ref_doc,
        sqt_customer_id,
        currency_code,
        sqt_billing_name,
        sqt_billing_address,
        sqt_billing_cp,
        sqt_shipping_address,
        sqt_no,
        sqt_plant,
        sqt_date,
        sqt_validity_period,
        sales_person_id,
        sqt_payment_term,
        sqt_delivery_method_id,
        cp_customer_pickup,
        cp_ic_no,
        driver_contact_no,
        courier_company,
        vehicle_number,
        pickup_date,
        shipping_date,
        ct_driver_name,
        ct_ic_no,
        ct_vehicle_number,
        ct_driver_contact_no,
        ct_est_delivery_date,
        ct_delivery_cost,
        ss_shipping_company,
        ss_shipping_method,
        ss_shipping_date,
        est_arrival_date,
        ss_freight_charges,
        ss_tracking_number,
        tpt_vehicle_number,
        tpt_transport_name,
        tpt_ic_no,
        tpt_driver_contact_no,
        customer_type,
        sqt_sub_total,
        sqt_total_discount,
        sqt_total_tax,
        sqt_totalsum,
        sqt_remarks,
        table_sqt,
        sqt_ref_no,
        exchange_rate,
        myr_total_amount,
        sqt_new_customer,
        cs_tracking_number,
        cs_est_arrival_date,
        freight_charges,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_postal_code,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_postal_code,
        shipping_address_country,
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
        acc_integration_type,
        last_sync_date,
        customer_credit_limit,
        overdue_limit,
        outstanding_balance,
        overdue_inv_total_amount,
        is_accurate,
      };

      if (page_status === "Add" || page_status === "Clone") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        await updateEntry(organizationId, entry, quotation_id);
      } else {
        console.log("Unknown page status:", page_status);
        this.hideLoading();
        this.$message.error("Invalid page status");
        return;
      }
    } else {
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.hideLoading();
    this.$message.error(
      error.message || "An error occurred while processing the quotation"
    );
  } finally {
    console.log("Function execution completed");
    console.log("Credit limit override by:", this.getVarGlobal("nickname"));
  }
})();
