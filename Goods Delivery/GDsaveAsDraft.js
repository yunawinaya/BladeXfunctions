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
        document_types: "Goods Delivery",
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
        document_types: "Goods Delivery",
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
    const draftPrefix = "DRAFT-GD-" + draftNumber;
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
      entry.delivery_no = draftPrefix;

      // Update the draft number first
      console.log("Updating draft number:", currDraftNum);
      await updateDraftNumber(organizationId, currDraftNum);

      // Then add the entry
      console.log("Adding draft entry to goods_delivery collection");
      const addResult = await db.collection("goods_delivery").add(entry);
      console.log("Add draft result:", addResult);

      console.log("Successfully added draft entry");
      return true;
    } else {
      // If no prefix is found, just add with current delivery_no
      console.log(
        "No draft prefix data found, adding with current delivery_no"
      );
      const addResult = await db.collection("goods_delivery").add(entry);
      console.log("Add draft result:", addResult);
      return true;
    }
  } catch (error) {
    console.error("Error in addDraftEntry:", error);
    throw error;
  }
};

const updateDraftEntry = async (goodsDeliveryId, entry) => {
  console.log("Updating draft entry for goods delivery ID:", goodsDeliveryId);
  try {
    console.log("Updating draft entry in goods_delivery collection");
    const updateResult = await db
      .collection("goods_delivery")
      .doc(goodsDeliveryId)
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

    // Get page status and goods delivery ID
    const page_status = data.page_status;
    const goods_delivery_no = data.id;
    console.log(
      "Page status:",
      page_status,
      "Goods Delivery ID:",
      goods_delivery_no
    );

    // Define required fields
    const requiredFields = [{ name: "so_id", label: "SO Number" }];

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

    // Store previous temporary quantities if available
    if (Array.isArray(data.table_gd)) {
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
      gd_status: "Draft",
      fake_so_id: data.fake_so_id,
      so_id: data.so_id,
      so_no: data.so_no,
      plant_id: data.plant_id,
      organization_id: organizationId,
      gd_billing_name: data.gd_billing_name,
      gd_billing_cp: data.gd_billing_cp,
      gd_billing_address: data.gd_billing_address,
      gd_shipping_address: data.gd_shipping_address,
      delivery_no: data.delivery_no,
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
    let success = false;

    // Add or update based on page status
    if (page_status === "Add") {
      console.log("Adding new draft entry (Add)");
      success = await addDraftEntry(organizationId, gd);
    } else if (page_status === "Edit") {
      console.log("Updating existing draft entry (Edit)");
      success = await updateDraftEntry(goods_delivery_no, gd);
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
        "An error occurred while processing the goods delivery draft"
    );
  } finally {
    console.log("Draft function execution completed");
  }
})();
