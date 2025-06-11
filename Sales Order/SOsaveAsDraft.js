const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
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

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Sales Orders",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const generateDraftPrefix = async (organizationId) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData.length !== 0) {
      const currDraftNum = parseInt(prefixData.draft_number) + 1;
      const newPrefix = "DRAFT-SO-" + currDraftNum;

      db.collection("prefix_configuration")
        .where({
          document_types: "Sales Orders",
          organization_id: organizationId,
          is_deleted: 0,
        })
        .update({ draft_number: currDraftNum });

      return newPrefix;
    }
  } catch (error) {
    this.$message.error(error);
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = this.getValues();

    // Get page status and sales order ID
    const page_status = data.page_status;
    const sales_order_id = data.id;

    // Define required fields
    const requiredFields = [
      { name: "plant_name", label: "Plant" },
      {
        name: "table_so",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        so_no,
        so_date,
        customer_name,
        so_currency,
        plant_name,
        partially_delivered,
        fully_delivered,
        cust_billing_address,
        cust_shipping_address,
        so_payment_term,
        so_delivery_method,
        so_shipping_date,
        so_ref_doc,
        cp_driver_name,
        cp_driver_contact_no,
        cp_vehicle_number,
        cp_pickup_date,
        cp_ic_no,
        validity_of_collection,
        cs_courier_company,
        cs_shipping_date,
        est_arrival_date,
        cs_tracking_number,
        ct_driver_name,
        ct_driver_contact_no,
        ct_delivery_cost,
        ct_vehicle_number,
        ct_est_delivery_date,
        ct_ic_no,
        ss_shipping_company,
        ss_shipping_date,
        ss_freight_charges,
        ss_shipping_method,
        ss_est_arrival_date,
        ss_tracking_number,
        table_so,
        so_sales_person,
        so_total_gross,
        so_total_discount,
        so_total_tax,
        so_total,
        so_remarks,
        so_tnc,
        so_payment_details,
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
        exchange_rate,
        myr_total_amount,
        sqt_no,
        tpt_vehicle_number,
        tpt_transport_name,
        tpt_ic_no,
        tpt_driver_contact_no,
        cs_freight_charges,
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
        so_status: "Draft",
        so_no,
        so_date,
        customer_name,
        so_currency,
        plant_name,
        organization_id: organizationId,
        partially_delivered,
        fully_delivered,
        cust_billing_address,
        cust_shipping_address,
        so_payment_term,
        so_delivery_method,
        so_shipping_date,
        so_ref_doc,
        cp_driver_name,
        cp_driver_contact_no,
        cp_vehicle_number,
        cp_pickup_date,
        cp_ic_no,
        validity_of_collection,
        cs_courier_company,
        cs_shipping_date,
        est_arrival_date,
        cs_tracking_number,
        ct_driver_name,
        ct_driver_contact_no,
        ct_delivery_cost,
        ct_vehicle_number,
        ct_est_delivery_date,
        ct_ic_no,
        ss_shipping_company,
        ss_shipping_date,
        ss_freight_charges,
        ss_shipping_method,
        ss_est_arrival_date,
        ss_tracking_number,
        table_so,
        so_sales_person,
        so_total_gross,
        so_total_discount,
        so_total_tax,
        so_total,
        so_remarks,
        so_tnc,
        so_payment_details,
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
        exchange_rate,
        myr_total_amount,
        sqt_no,
        tpt_vehicle_number,
        tpt_transport_name,
        tpt_ic_no,
        tpt_driver_contact_no,
        cs_freight_charges,
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

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        const newPrefix = await generateDraftPrefix(organizationId);
        entry.so_no = newPrefix;
        await db.collection("sales_order").add(entry);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db.collection("sales_order").doc(sales_order_id).update(entry);
        this.$message.success("Update successfully");
        closeDialog();
      } else {
        console.log("Unknown page status:", page_status);
        this.hideLoading();
        this.$message.error("Invalid page status");
        return;
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
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
