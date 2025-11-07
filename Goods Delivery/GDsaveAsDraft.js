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
      document_types: "Goods Delivery",
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
      const newPrefix = `DRAFT-${prefixData.prefix_value}-` + currDraftNum;

      db.collection("prefix_configuration")
        .where({
          document_types: "Goods Delivery",
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

const fillbackHeaderFields = async (gd) => {
  try {
    for (const [index, gdLineItem] of gd.table_gd.entries()) {
      gdLineItem.customer_id = gd.customer_name || null;
      gdLineItem.organization_id = gd.organization_id;
      gdLineItem.plant_id = gd.plant_id || null;
      gdLineItem.billing_state_id = gd.billing_address_state || null;
      gdLineItem.billing_country_id = gd.billing_address_country || null;
      gdLineItem.shipping_state_id = gd.shipping_address_state || null;
      gdLineItem.shipping_country_id = gd.shipping_address_country || null;
      gdLineItem.assigned_to = gd.assigned_to || null;
      gdLineItem.line_index = index + 1;
    }
    return gd.table_gd;
  } catch (error) {
    throw new Error("Error processing goods delivery.");
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = this.getValues();

    // Get page status and goods delivery ID
    const page_status = data.page_status;
    const goods_delivery_no = data.id;

    // Define required fields
    const requiredFields = [
      { name: "so_id", label: "SO Number" },
      {
        name: "table_gd",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
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

      // Prepare goods delivery object
      const gd = {
        gd_status: "Draft",
        so_id: data.so_id,
        so_no: data.so_no,
        pp_no: data.pp_no,
        plant_id: data.plant_id,
        organization_id: organizationId,
        from_convert: "",
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
        assigned_to: data.assigned_to,
        currency_code: data.currency_code,

        driver_name: data.driver_name,
        driver_contact_no: data.driver_contact_no,
        ic_no: data.ic_no,
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

        tpt_vehicle_number: data.tpt_vehicle_number,
        tpt_transport_name: data.tpt_transport_name,
        tpt_ic_no: data.tpt_ic_no,
        tpt_driver_contact_no: data.tpt_driver_contact_no,

        select_vehicle_id: data.select_vehicle_id,
        gd_vehicle_type: data.gd_vehicle_type,
        gd_vehicle_capacity: data.gd_vehicle_capacity,
        gd_vehicle_cap_uom: data.gd_vehicle_cap_uom,
        select_driver_id: data.select_driver_id,
        gd_driver_contact: data.gd_driver_contact,
        gd_driver_ic: data.gd_driver_ic,

        table_gd: data.table_gd,
        order_remark: data.order_remark,
        order_remark2: data.order_remark2,
        order_remark3: data.order_remark3,
        billing_address_line_1: data.billing_address_line_1,
        billing_address_line_2: data.billing_address_line_2,
        billing_address_line_3: data.billing_address_line_3,
        billing_address_line_4: data.billing_address_line_4,
        billing_address_city: data.billing_address_city,
        billing_address_state: data.billing_address_state,
        billing_address_country: data.billing_address_country,
        billing_postal_code: data.billing_postal_code,
        billing_address_name: data.billing_address_name,
        billing_address_phone: data.billing_address_phone,
        billing_attention: data.billing_attention,

        shipping_address_line_1: data.shipping_address_line_1,
        shipping_address_line_2: data.shipping_address_line_2,
        shipping_address_line_3: data.shipping_address_line_3,
        shipping_address_line_4: data.shipping_address_line_4,
        shipping_address_city: data.shipping_address_city,
        shipping_address_state: data.shipping_address_state,
        shipping_address_country: data.shipping_address_country,
        shipping_postal_code: data.shipping_postal_code,
        shipping_address_name: data.shipping_address_name,
        shipping_address_phone: data.shipping_address_phone,
        shipping_attention: data.shipping_attention,
        acc_integration_type: data.acc_integration_type,
        last_sync_date: data.last_sync_date,
        customer_credit_limit: data.customer_credit_limit,
        overdue_limit: data.overdue_limit,
        outstanding_balance: data.outstanding_balance,
        overdue_inv_total_amount: data.overdue_inv_total_amount,
        is_accurate: data.is_accurate,
        gd_total: parseFloat(data.gd_total.toFixed(3)),
        reference_type: data.reference_type,
        gd_created_by: data.gd_created_by,
      };

      // Clean up undefined/null values
      Object.keys(gd).forEach((key) => {
        if (gd[key] === undefined || gd[key] === null) {
          delete gd[key];
        }
      });

      await fillbackHeaderFields(gd);

      // Add or update based on page status
      if (page_status === "Add") {
        const newPrefix = await generateDraftPrefix(organizationId);
        gd.delivery_no = newPrefix;
        await db.collection("goods_delivery").add(gd);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db.collection("goods_delivery").doc(goods_delivery_no).update(gd);
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
        "An error occurred while processing the goods delivery draft"
    );
  } finally {
    console.log("Draft function execution completed");
  }
})();
