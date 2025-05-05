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

const checkUniqueness = async (generatedPrefix) => {
  console.log("Checking uniqueness for prefix:", generatedPrefix);
  try {
    const existingDoc = await db
      .collection("Quotation")
      .where({ sqt_no: generatedPrefix })
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
        "Could not generate a unique Quotation number after maximum attempts"
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

const addEntry = async (organizationId, entry) => {
  console.log("Adding new entry for organization:", organizationId);
  try {
    const prefixData = await getPrefixData(organizationId);
    console.log("Got prefix data:", prefixData);

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );
      console.log("Found unique prefix:", prefixToShow);

      // Set the generated prefix
      entry.sqt_no = prefixToShow;

      // First add the entry
      console.log("Adding entry to Quotation collection");
      const addResult = await db.collection("Quotation").add(entry);
      console.log("Add result:", addResult);

      // Then update the prefix
      console.log("Updating prefix with running number:", runningNumber);
      await updatePrefix(organizationId, runningNumber);

      console.log("Successfully added entry");
      return true;
    } else {
      // If no prefix is found, just add with current sqt_no
      console.log("No prefix data found, adding with current sqt_no");
      const addResult = await db.collection("Quotation").add(entry);
      console.log("Add result:", addResult);
      return true;
    }
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, entry, quotationId) => {
  console.log("Updating entry for quotation ID:", quotationId);
  try {
    // For issued status, generate a new number
    if (entry.sqt_status === "Issued") {
      const prefixData = await getPrefixData(organizationId);
      console.log("Got prefix data for update:", prefixData);

      if (prefixData) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData
        );
        console.log("Found unique prefix for update:", prefixToShow);

        // Set the generated prefix
        entry.sqt_no = prefixToShow;

        // Update the entry
        console.log("Updating entry in Quotation collection");
        const updateResult = await db
          .collection("Quotation")
          .doc(quotationId)
          .update(entry);
        console.log("Update result:", updateResult);

        // Then update the prefix
        console.log("Updating prefix with running number:", runningNumber);
        await updatePrefix(organizationId, runningNumber);
      } else {
        // If no prefix data found, just update with current data
        console.log(
          "No prefix data found for update, updating with current data"
        );
        const updateResult = await db
          .collection("Quotation")
          .doc(quotationId)
          .update(entry);
        console.log("Update result:", updateResult);
      }
    } else {
      // For other statuses, just update without changing number
      console.log("Updating entry without changing number");
      const updateResult = await db
        .collection("Quotation")
        .doc(quotationId)
        .update(entry);
      console.log("Update result:", updateResult);
    }

    console.log("Successfully updated entry");
    return true;
  } catch (error) {
    console.error("Error in updateEntry:", error);
    throw error;
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  console.log("Starting Issued function");
  try {
    this.showLoading();
    console.log("Loading shown");

    const data = this.getValues();
    console.log("Form data:", data);

    // Get page status and quotation ID from parameters
    const page_status = data.page_status;
    const quotation_id = data.id;
    console.log("Page status:", page_status, "Quotation ID:", quotation_id);

    // Define required fields
    const requiredFields = [
      { name: "sqt_customer_id", label: "Customer" },
      { name: "sqt_plant", label: "Plant" },
      { name: "sqt_date", label: "Quotation Date" },
      { name: "sqt_validity_period", label: "Validity Period" },
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

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }
    console.log("Organization ID:", organizationId);

    // Prepare entry data
    const entry = {
      sqt_status: "Issued",
      sqt_customer_id: data.sqt_customer_id,
      currency_code: data.currency_code,
      sqt_billing_name: data.sqt_billing_name,
      sqt_billing_address: data.sqt_billing_address,
      sqt_billing_cp: data.sqt_billing_cp,
      organization_id: organizationId,
      sqt_shipping_address: data.sqt_shipping_address,
      sqt_no: data.sqt_no,
      sqt_plant: data.sqt_plant,
      sqt_date: data.sqt_date,
      sqt_validity_period: data.sqt_validity_period,
      sales_person_id: data.sales_person_id,
      sqt_payment_term: data.sqt_payment_term,
      sqt_delivery_method_id: data.sqt_delivery_method_id,
      cp_customer_pickup: data.cp_customer_pickup,
      driver_contact_no: data.driver_contact_no,
      courier_company: data.courier_company,
      vehicle_number: data.vehicle_number,
      pickup_date: data.pickup_date,
      shipping_date: data.shipping_date,
      ct_driver_name: data.ct_driver_name,
      ct_vehicle_number: data.ct_vehicle_number,
      ct_driver_contact_no: data.ct_driver_contact_no,
      ct_est_delivery_date: data.ct_est_delivery_date,
      ct_delivery_cost: data.ct_delivery_cost,
      ct_shipping_company: data.ct_shipping_company,
      ss_shipping_method: data.ss_shipping_method,
      ss_shipping_date: data.ss_shipping_date,
      est_arrival_date: data.est_arrival_date,
      ss_freight_charges: data.ss_freight_charges,
      ss_tracking_number: data.ss_tracking_number,
      sqt_sub_total: data.sqt_sub_total,
      sqt_total_discount: data.sqt_total_discount,
      sqt_total_tax: data.sqt_total_tax,
      sqt_totalsum: data.sqt_totalsum,
      sqt_remarks: data.sqt_remarks,
      table_sqt: data.table_sqt,
      sqt_ref_no: data.sqt_ref_no,
      exchange_rate: data.exchange_rate,
      myr_total_amount: data.myr_total_amount,

      // Include address fields if they exist
      billing_address_line_1: data.billing_address_line_1,
      billing_address_line_2: data.billing_address_line_2,
      billing_address_line_3: data.billing_address_line_3,
      billing_address_line_4: data.billing_address_line_4,
      billing_address_city: data.billing_address_city,
      billing_address_state: data.billing_address_state,
      billing_postal_code: data.billing_postal_code,
      billing_address_country: data.billing_address_country,
      shipping_address_line_1: data.shipping_address_line_1,
      shipping_address_line_2: data.shipping_address_line_2,
      shipping_address_line_3: data.shipping_address_line_3,
      shipping_address_line_4: data.shipping_address_line_4,
      shipping_address_city: data.shipping_address_city,
      shipping_address_state: data.shipping_address_state,
      shipping_postal_code: data.shipping_postal_code,
      shipping_address_country: data.shipping_address_country,
    };

    // Clean up undefined/null values
    Object.keys(entry).forEach((key) => {
      if (entry[key] === undefined || entry[key] === null) {
        delete entry[key];
      }
    });

    console.log("Entry prepared with keys:", Object.keys(entry));

    let success = false;

    // Add or update based on page status
    if (page_status === "Add" || page_status === "Clone") {
      console.log("Adding new entry (Add/Clone)");
      success = await addEntry(organizationId, entry);
    } else if (page_status === "Edit") {
      console.log("Updating existing entry (Edit)");
      success = await updateEntry(organizationId, entry, quotation_id);
    } else {
      console.log("Unknown page status:", page_status);
      this.hideLoading();
      this.$message.error("Invalid page status");
      return;
    }

    console.log("Operation success:", success);

    if (success) {
      console.log("Closing dialog");
      closeDialog();
    } else {
      console.log("Operation did not succeed, hiding loading");
      this.hideLoading();
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.hideLoading();
    this.$message.error(
      error.message || "An error occurred while processing the quotation"
    );
  } finally {
    console.log("Function execution completed");
  }
})();
