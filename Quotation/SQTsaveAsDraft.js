// Save as Draft Button onClick Handler
const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    const data = this.getValues();
    const page_status = data.page_status;
    const quotation_no = data.id; // Get ID from form data

    // Define required fields
    const requiredFields = [
      { name: "sqt_plant", label: "Plant" },
      {
        name: "table_sqt",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = requiredFields.filter((field) => {
      const value = data[field.name];

      if (Array.isArray(value)) {
        return value.length === 0;
      } else if (typeof value === "string") {
        return value.trim() === "";
      } else {
        return !value;
      }
    });

    if (missingFields.length > 0) {
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
      return;
    }

    // Show loading indicator
    this.showLoading();

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Prepare entry data
    const {
      sqt_customer_id,
      currency_code,
      sqt_billing_address,
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
      freight_charges,
      sqt_sub_total,
      sqt_total_discount,
      sqt_total_tax,
      sqt_totalsum,
      sqt_remarks,
      table_sqt,
      sqt_ref_no,
      exchange_rate,
      myr_total_amount,
      validity_of_collection,
      sqt_new_customer,
      cs_tracking_number,
      cs_est_arrival_date,
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

    // Construct `entry` using object shorthand (no need to repeat `field: field`)
    const entry = {
      sqt_status: "Draft",
      organization_id: organizationId,
      sqt_ref_doc,
      sqt_customer_id,
      currency_code,
      sqt_billing_address,
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
      try {
        // Get prefix configuration
        const prefixEntry = await db
          .collection("prefix_configuration")
          .where({
            document_types: "Quotations",
            is_deleted: 0,
            organization_id: organizationId,
            is_active: 1,
          })
          .get();

        // Generate draft number
        if (prefixEntry.data && prefixEntry.data.length > 0) {
          const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
          const newPrefix = "DRAFT-SQT-" + currDraftNum;
          entry.sqt_no = newPrefix;

          // Update draft number
          await db
            .collection("prefix_configuration")
            .where({
              document_types: "Quotations",
              organization_id: organizationId,
            })
            .update({ draft_number: currDraftNum });
        }

        // Add quotation entry
        await db.collection("Quotation").add(entry);

        // Close dialog
        closeDialog();
      } catch (error) {
        console.error("Error saving draft:", error);
        this.hideLoading();
        this.$message.error(error.message || "Failed to save draft");
      }
    } else if (page_status === "Edit") {
      try {
        // Update existing quotation
        if (!quotation_no) {
          throw new Error("Quotation ID not found");
        }

        await db.collection("Quotation").doc(quotation_no).update(entry);

        // Close dialog
        closeDialog();
      } catch (error) {
        console.error("Error updating draft:", error);
        this.hideLoading();
        this.$message.error(error.message || "Failed to update draft");
      }
    } else {
      this.hideLoading();
      this.$message.error("Invalid page status");
    }
  } catch (error) {
    console.error("Error in save as draft:", error);
    this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
  }
})();
