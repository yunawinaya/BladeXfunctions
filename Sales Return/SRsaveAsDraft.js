const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return !value;
  });
  return missingFields;
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Sales Returns",
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
    const currDraftNum = parseInt(prefixData.draft_number) + 1;
    const newPrefix = "DRAFT-SR-" + currDraftNum;

    db.collection("prefix_configuration")
      .where({
        document_types: "Sales Returns",
        organization_id: organizationId,
      })
      .update({ draft_number: currDraftNum });

    return newPrefix;
  } catch (error) {
    this.$message.error(error);
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [{ name: "plant_id", label: "Plant ID" }];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;
      const salesReturnId = this.getValue("id");

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
        sr_billing_name,
        sr_billing_cp,
        sr_billing_address,
        sr_shipping_address,
        gd_no_display,
        customer_id,
        plant_id,
        organization_id,
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
        sr_status: "Draft",
        fake_sr_return_so_id,
        sr_return_so_id,
        sr_return_gd_id,
        sales_return_no,
        so_no_display,
        sr_return_date,
        sr_billing_name,
        sr_billing_cp,
        sr_billing_address,
        sr_shipping_address,
        gd_no_display,
        customer_id,
        plant_id,
        organization_id,
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
      };

      if (page_status === "Add") {
        const newPrefix = await generateDraftPrefix(organizationId);
        entry.sales_return_no = newPrefix;
        await db.collection("sales_return").add(entry);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db.collection("sales_return").doc(salesReturnId).update(entry);
        this.$message.success("Update successfully");
        closeDialog();
      }
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
