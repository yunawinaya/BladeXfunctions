(async () => {
  const fake_so_id = arguments[0]?.value;

  if (fake_so_id && !Array.isArray(fake_so_id)) {
    const resSO = await db
      .collection("sales_order")
      .where({ id: fake_so_id })
      .get();

    const soData = resSO.data[0];

    await this.setData({
      so_id: [fake_so_id],
      customer_name: soData.customer_name,
      gd_delivery_method: soData.so_delivery_method,
    });

    await this.triggerEvent("func_reset_delivery_method");

    this.setData({ delivery_method_text: soData.so_delivery_method });
    const visibilityMap = {
      "Self Pickup": "self_pickup",
      "Courier Service": "courier_service",
      "Company Truck": "company_truck",
      "Shipping Service": "shipping_service",
      "3rd Party Transporter": "third_party_transporter",
    };

    const selectedField = visibilityMap[arguments[0].fieldModel.label] || null;
    const fields = [
      "self_pickup",
      "courier_service",
      "company_truck",
      "shipping_service",
      "third_party_transporter",
    ];

    fields.forEach((field) => {
      field === selectedField ? this.display(field) : this.hide(field);
    });

    switch (soData.so_delivery_method) {
      case "Self Pickup":
        this.setData({
          driver_name: soData.cp_driver_name,
          ic_no: soData.cp_ic_no,
          driver_contact_no: soData.cp_driver_contact_no,
          vehicle_no: soData.cp_vehicle_number,
          pickup_date: soData.cp_pickup_date,
          validity_of_collection: soData.validity_of_collection,
        });
        break;

      case "Courier Service":
        this.setData({
          courier_company: soData.cs_courier_company,
          shipping_date: soData.cs_shipping_date,
          tracking_number: soData.cs_tracking_number,
          est_arrival_date: soData.est_arrival_date,
          freight_charges: soData.cs_freight_charges,
        });
        break;

      case "Company Truck":
        this.setData({
          driver_name: soData.ct_driver_name,
          driver_contact_no: soData.ct_driver_contact_no,
          ic_no: soData.ct_ic_no,
          vehicle_no: soData.ct_vehicle_number,
          est_delivery_date: soData.ct_est_delivery_date,
          delivery_cost: soData.ct_delivery_cost,
        });
        break;

      case "Shipping Service":
        this.setData({
          shipping_company: soData.ss_shipping_company,
          shipping_date: soData.ss_shippping_date,
          freight_charges: soData.ss_freight_charges,
          shipping_method: soData.ss_shipping_method,
          est_arrival_date: soData.ss_est_arrival_date,
          tracking_number: soData.ss_tracking_number,
        });
        break;

      case "3rd Party Transporter":
        this.setData({
          tpt_vehicle_number: soData.tpt_vehicle_number,
          tpt_transport_name: soData.tpt_transport_name,
          tpt_ic_no: soData.tpt_ic_no,
          tpt_driver_contact_no: soData.tpt_driver_contact_no,
        });
        break;
    }

    await this.display("so_id");
    await this.hide("fake_so_id");
  }
})();
