const resetFormData = () => {
  this.setData({
    so_id: "",
    customer_name: "",
    currency_code: "",
    so_no: "",

    gd_billing_name: "",
    gd_billing_cp: "",
    gd_billing_address: "",
    gd_shipping_address: "",

    gd_contact_name: "",
    contact_number: "",
    email_address: "",

    gd_delivery_method: "",
    document_description: "",
    so_docref: "",
    gd_dockey: "",
    table_gd: [],
    "gd_item_balance.table_item_balance": [],
    "gd_item_balance.material_code": "",
    "gd_item_balance.material_name": "",
    "gd_item_balance.material_uom": "",
    "gd_item_balance.row_index": "",

    delivery_method_text: "",

    driver_name: "",
    driver_contact_no: "",
    ic_no: "",
    vehicle_no: "",
    est_delivery_date: "",
    delivery_cost: "",

    shipping_company: "",
    shipping_date: "",
    freight_charges: "",
    shipping_method: "",
    est_arrival_date: "",
    tracking_number: "",

    tpt_vehicle_number: "",
    tpt_transport_name: "",
    tpt_ic_no: "",
    tpt_driver_contact_no: "",

    billing_address_line_1: "",
    billing_address_line_2: "",
    billing_address_line_3: "",
    billing_address_line_4: "",

    billing_address_city: "",
    billing_postal_code: "",
    billing_address_state: "",
    billing_address_country: "",

    shipping_address_line_1: "",
    shipping_address_line_2: "",
    shipping_address_line_3: "",
    shipping_address_line_4: "",

    shipping_address_city: "",
    shipping_postal_code: "",
    shipping_address_state: "",
    shipping_address_country: "",

    order_remark: "",
  });
};

(async () => {
  const plant = this.getValue("plant_id");

  if (plant) {
    this.hide("address_grid");
    if (arguments[0].fieldModel) {
      await resetFormData();
      this.hide([
        "so_id",
        "self_pickup",
        "courier_service",
        "company_truck",
        "shipping_service",
        "third_party_transporter",
      ]);
    }

    this.disabled(
      [
        "fake_so_id",
        "gd_ref_doc",
        "table_gd",
        "gd_delivery_method",
        "document_description",
        "order_remark",
      ],
      false
    );

    const pickingSetupResponse = await db
      .collection("picking_setup")
      .where({
        plant_id: plant,
        picking_required: 1,
      })
      .get();

    if (pickingSetupResponse.data.length > 0) {
      if (pickingSetupResponse.data[0].picking_after === "Good Delivery") {
        this.display("assigned_to");
      } else if (pickingSetupResponse.data[0].picking_after === "Sales Order") {
        this.setData({ is_select_picking: 1 });
        this.hide("button_save_as_created");
      }
    }
  }
})();
