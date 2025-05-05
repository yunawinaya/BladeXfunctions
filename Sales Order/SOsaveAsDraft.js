const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
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

const getDraftPrefix = async (organizationId) => {
  console.log("Getting draft prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Orders",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    console.log("Draft prefix data result:", prefixEntry);

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      console.log("No draft prefix configuration found");
      return null;
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error getting draft prefix data:", error);
    throw error;
  }
};

const updateDraftNumber = async (organizationId, draftNumber) => {
  console.log(
    "Updating draft number for organization:",
    organizationId,
    "with draft number:",
    draftNumber
  );
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Orders",
        organization_id: organizationId,
      })
      .update({ draft_number: draftNumber });
    console.log("Draft number update successful");
  } catch (error) {
    console.error("Error updating draft number:", error);
    throw error;
  }
};

const generateDraftPrefix = (draftNumber) => {
  console.log("Generating draft prefix with draft number:", draftNumber);
  try {
    const draftPrefix = "DRAFT-SO-" + draftNumber;
    console.log("Generated draft prefix:", draftPrefix);
    return draftPrefix;
  } catch (error) {
    console.error("Error generating draft prefix:", error);
    throw error;
  }
};

const addDraftEntry = async (organizationId, entry) => {
  console.log("Adding new draft entry for organization:", organizationId);
  try {
    const prefixData = await getDraftPrefix(organizationId);
    console.log("Got draft prefix data:", prefixData);

    if (prefixData) {
      const currDraftNum = parseInt(prefixData.draft_number) + 1;
      const draftPrefix = generateDraftPrefix(currDraftNum);

      // Set the generated draft prefix
      entry.so_no = draftPrefix;

      // Update the draft number first
      console.log("Updating draft number:", currDraftNum);
      await updateDraftNumber(organizationId, currDraftNum);

      // Then add the entry
      console.log("Adding draft entry to sales_order collection");
      const addResult = await db.collection("sales_order").add(entry);
      console.log("Add draft result:", addResult);

      console.log("Successfully added draft entry");
      return true;
    } else {
      // If no prefix is found, just add with current so_no
      console.log("No draft prefix data found, adding with current so_no");
      const addResult = await db.collection("sales_order").add(entry);
      console.log("Add draft result:", addResult);
      return true;
    }
  } catch (error) {
    console.error("Error in addDraftEntry:", error);
    throw error;
  }
};

const updateDraftEntry = async (organizationId, entry, salesOrderId) => {
  console.log("Updating draft entry for sales order ID:", salesOrderId);
  try {
    console.log("Updating draft entry in sales_order collection");
    const updateResult = await db
      .collection("sales_order")
      .doc(salesOrderId)
      .update(entry);
    console.log("Update draft result:", updateResult);

    console.log("Successfully updated draft entry");
    return true;
  } catch (error) {
    console.error("Error in updateDraftEntry:", error);
    throw error;
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  console.log("Starting Draft function");
  try {
    const data = this.getValues();
    console.log("Form data:", data);

    // Get page status and sales order ID
    const page_status = data.page_status;
    const sales_order_id = data.id;
    console.log("Page status:", page_status, "Sales order ID:", sales_order_id);

    // Define required fields
    const requiredFields = [{ name: "plant_name", label: "Plant" }];

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
      so_status: "Draft",
      so_no: data.so_no,
      so_date: data.so_date,
      customer_name: data.customer_name,
      so_currency: data.so_currency,
      plant_name: data.plant_name,
      organization_id: organizationId,
      cust_billing_name: data.cust_billing_name,
      cust_cp: data.cust_cp,
      cust_billing_address: data.cust_billing_address,
      cust_shipping_address: data.cust_shipping_address,
      so_payment_term: data.so_payment_term,
      so_delivery_method: data.so_delivery_method,
      so_shipping_date: data.so_shipping_date,
      so_ref_doc: data.so_ref_doc,
      cp_driver_name: data.cp_driver_name,
      cp_driver_contact_no: data.cp_driver_contact_no,
      cp_vehicle_number: data.cp_vehicle_number,
      cp_pickup_date: data.cp_pickup_date,
      cs_courier_company: data.cs_courier_company,
      cs_shipping_date: data.cs_shipping_date,
      est_arrival_date: data.est_arrival_date,
      ct_driver_name: data.ct_driver_name,
      ct_driver_contact_no: data.ct_driver_contact_no,
      ct_delivery_cost: data.ct_delivery_cost,
      ct_vehicle_number: data.ct_vehicle_number,
      ct_est_delivery_date: data.ct_est_delivery_date,
      ss_shipping_company: data.ss_shipping_company,
      ss_shipping_date: data.ss_shipping_date,
      ss_freight_charges: data.ss_freight_charges,
      ss_shipping_method: data.ss_shipping_method,
      ss_est_arrival_date: data.ss_est_arrival_date,
      ss_tracking_number: data.ss_tracking_number,
      table_so: data.table_so,
      so_sales_person: data.so_sales_person,
      so_total_gross: data.so_total_gross,
      so_total_discount: data.so_total_discount,
      so_total_tax: data.so_total_tax,
      so_total: data.so_total,
      so_remarks: data.so_remarks,
      so_tnc: data.so_tnc,
      so_payment_details: data.so_payment_details,
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
      exchange_rate: data.exchange_rate,
      myr_total_amount: data.myr_total_amount,
      sqt_no: data.sqt_no,
    };

    // Clean up undefined/null values
    Object.keys(entry).forEach((key) => {
      if (entry[key] === undefined || entry[key] === null) {
        delete entry[key];
      }
    });

    console.log("Entry prepared with keys:", Object.keys(entry));

    this.showLoading();
    let success = false;

    // Add or update based on page status
    if (page_status === "Add" || page_status === "Clone") {
      console.log("Adding new draft entry (Add/Clone)");
      success = await addDraftEntry(organizationId, entry);
    } else if (page_status === "Edit") {
      console.log("Updating existing draft entry (Edit)");
      success = await updateDraftEntry(organizationId, entry, sales_order_id);
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
      error.message ||
        "An error occurred while processing the sales order draft"
    );
  } finally {
    console.log("Draft function execution completed");
  }
})();
