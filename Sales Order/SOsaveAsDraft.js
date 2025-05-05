const page_status = this.getParamsVariables("page_status");
const self = this;
const salesOrderId = this.getParamsVariables("sales_order_id");
const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

const data = this.getValues();

const requiredFields = [{ name: "plant_name", label: "PLant" }];

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

if (missingFields.length === 0) {
  this.showLoading();
  const {
    so_no,
    so_date,
    customer_name,
    so_currency,
    so_payment_term,
    so_delivery_method,
    organization_id,
    so_shipping_date,
    so_ref_doc,
    plant_name,
    cust_billing_name,
    cust_billing_address,
    cust_cp,
    cust_shipping_address,
    cp_driver_name,
    cp_driver_contact_no,
    cp_vehicle_no,
    cp_pickup_date,
    cs_courier_company,
    cs_shipping_date,
    est_arrival_date,
    ss_tracking_number,
    ct_driver_name,
    ct_driver_contact_no,
    ct_delivery_cost,
    ct_vehicle_number,
    ct_est_delivery_date,
    ss_shipping_company,
    ss_shipping_method,
    ss_shipping_date,
    ss_est_arrival_date,
    ss_freight_charges,
    so_total_gross,
    table_so,
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
    exchange_rate,
    myr_total_amount,
  } = data;

  const entry = {
    so_status: "Draft",
    so_no,
    so_date,
    customer_name,
    so_currency,
    so_payment_term,
    so_delivery_method,
    organization_id: organizationId,
    so_shipping_date,
    so_ref_doc,
    plant_name,
    cust_billing_name,
    cust_billing_address,
    cust_cp,
    cust_shipping_address,
    cp_driver_name,
    cp_driver_contact_no,
    cp_vehicle_no,
    cp_pickup_date,
    cs_courier_company,
    cs_shipping_date,
    est_arrival_date,
    ss_tracking_number,
    ct_driver_name,
    ct_driver_contact_no,
    ct_delivery_cost,
    ct_vehicle_number,
    ct_est_delivery_date,
    ss_shipping_company,
    ss_shipping_method,
    ss_shipping_date,
    ss_est_arrival_date,
    ss_freight_charges,
    so_total_gross,
    table_so,
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
    exchange_rate,
    myr_total_amount,
  };

  if (page_status === "Add" || page_status === "Clone") {
    this.showLoading();

    db.collection("prefix_configuration")
      .where({
        document_types: "Sales Orders",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get()
      .then((prefixEntry) => {
        if (!prefixEntry.data || prefixEntry.data.length === 0) {
          return;
        } else {
          const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
          const newPrefix = "DRAFT-SO-" + currDraftNum;
          entry.so_no = newPrefix;

          return db
            .collection("prefix_configuration")
            .where({
              document_types: "Sales Orders",
              organization_id: organizationId,
            })
            .update({ draft_number: currDraftNum });
        }
      })
      .then(() => {
        return db.collection("sales_order").add(entry);
      })
      .then(() => {
        closeDialog();
      })
      .catch((error) => {
        this.$message.error(error);
      });
  } else if (page_status === "Edit") {
    this.showLoading();
    db.collection("sales_order")
      .doc(salesOrderId)
      .update(entry)
      .then(() => {
        closeDialog();
      })
      .catch((error) => {
        this.$message.error(error);
      });
  }
} else {
  this.hideLoading();
  const missingFieldNames = missingFields.map((f) => f.label).join(", ");
  this.$message.error(`Missing required fields: ${missingFieldNames}`);
}
