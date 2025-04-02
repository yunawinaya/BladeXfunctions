const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

this.getData()
  .then((data) => {
    const {
      so_id,
      so_no,
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
      db.collection("goods_delivery").add(gd);
    } else if (page_status === "Edit") {
      const goodsDeliveryId = this.getParamsVariables("goods_delivery_no");
      db.collection("goods_delivery").doc(goodsDeliveryId).update(gd);
    }
  })
  .then(() => {
    closeDialog();
  })
  .catch(() => {
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
