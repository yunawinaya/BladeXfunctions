const resetFormData = () => {
  this.setData({
    so_id: "",
    customer_name: "",
    so_no: "",

    to_delivery_method: "",
    document_description: "",
    so_docref: "",
    to_dockey: "",
    table_to: [],
    "to_item_balance.table_item_balance": [],
    "to_item_balance.material_code": "",
    "to_item_balance.material_name": "",
    "to_item_balance.material_uom": "",
    "to_item_balance.row_index": "",

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

    order_remark: "",
  });
};

(async () => {
  const plant = this.getValue("plant_id");

  const resPlant = await db.collection("blade_dept").where({ id: plant }).get();

  this.setData({
    plant_name: resPlant.data[0].dept_name,
  });

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
        "to_ref_doc",
        "table_gd",
        "to_delivery_method",
        "document_description",
        "order_remark",
      ],
      false
    );

    const pickingSetupResponse = await db
      .collection("picking_setup")
      .where({
        plant_id: plant,
        movement_type: "Good Delivery",
        picking_required: 1,
      })
      .get();

    if (pickingSetupResponse.data.length > 0) {
      this.display("assigned_to");
    }
  }
})();
