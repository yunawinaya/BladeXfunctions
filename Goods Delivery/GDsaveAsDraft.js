const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const data = this.getValues();

const requiredFields = [{ name: "so_id", label: "SO Number" }];

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
    so_id,
    so_no,
    plant_id,
    organization_id,
    gd_billing_name,
    gd_billing_cp,
    gd_billing_address,
    gd_shipping_address,
    delivery_no,
    gd_ref_doc,
    customer_name,
    gd_contact_name,
    contact_number,
    email_address,
    document_description,
    gd_delivery_method,
    delivery_date,
    driver_name,
    driver_contact_no,
    validity_of_collection,
    vehicle_no,
    pickup_date,
    courier_company,
    shipping_date,
    freight_charges,
    tracking_number,
    est_arrival_date,
    driver_cost,
    est_delivery_date,
    shipping_company,
    shipping_method,
    table_gd,
    order_remark,
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

  if (Array.isArray(table_gd)) {
    table_gd.forEach((item) => {
      item.prev_temp_qty_data = item.temp_qty_data;
    });
  }

  const gd = {
    gd_status: "Draft",
    so_id,
    so_no,
    plant_id,
    organization_id,
    gd_billing_name,
    gd_billing_cp,
    gd_billing_address,
    gd_shipping_address,
    delivery_no,
    gd_ref_doc,
    customer_name,
    gd_contact_name,
    contact_number,
    email_address,
    document_description,
    gd_delivery_method,
    delivery_date,
    driver_name,
    driver_contact_no,
    validity_of_collection,
    vehicle_no,
    pickup_date,
    courier_company,
    shipping_date,
    freight_charges,
    tracking_number,
    est_arrival_date,
    driver_cost,
    est_delivery_date,
    shipping_company,
    shipping_method,
    table_gd,
    order_remark,
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
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }
    db.collection("prefix_configuration")
      .where({
        document_types: "Goods Delivery",
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
          const newPrefix = "DRAFT-GD-" + currDraftNum;
          gd.delivery_no = newPrefix;

          return db
            .collection("prefix_configuration")
            .where({
              document_types: "Goods Delivery",
              organization_id: organizationId,
            })
            .update({ draft_number: currDraftNum });
        }
      })
      .then(() => {
        return db.collection("goods_delivery").add(gd);
      })

      .then(() => {
        closeDialog();
      })
      .catch((error) => {
        console.error("Error:", error);
        this.$message.error(error);
      });
  } else if (page_status === "Edit") {
    const goodsDeliveryId = this.getParamsVariables("goods_delivery_no");
    db.collection("goods_delivery")
      .doc(goodsDeliveryId)
      .update(gd)
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
