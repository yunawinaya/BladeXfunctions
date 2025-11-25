(async () => {
  const soIDs = arguments[0].value;

  if (soIDs.length > 0) {
    const firstSO = soIDs[0];

    console.log("firstSO", firstSO);

    const resSO = await db
      .collection("sales_order")
      .where({ id: firstSO })
      .get();

    const soData = resSO.data[0];

    await this.triggerEvent("func_reset_delivery_method");
    this.display("address_grid");

    await this.setData({
      gd_delivery_method: soData.so_delivery_method,
      delivery_method_text: soData.so_delivery_method,
      // Main address fields (formatted addresses)
      gd_billing_address: soData.cust_billing_address || "",
      gd_shipping_address: soData.cust_shipping_address || "",

      // Detailed billing address fields
      billing_address_line_1: soData.billing_address_line_1 || "",
      billing_address_line_2: soData.billing_address_line_2 || "",
      billing_address_line_3: soData.billing_address_line_3 || "",
      billing_address_line_4: soData.billing_address_line_4 || "",
      billing_address_city: soData.billing_address_city || "",
      billing_address_state: soData.billing_address_state || "",
      billing_address_country: soData.billing_address_country || "",
      billing_postal_code: soData.billing_postal_code || "",
      billing_address_phone: soData.billing_address_phone || "",
      billing_address_name: soData.billing_address_name || "",
      billing_attention: soData.billing_attention || "",

      // Detailed shipping address fields
      shipping_address_line_1: soData.shipping_address_line_1 || "",
      shipping_address_line_2: soData.shipping_address_line_2 || "",
      shipping_address_line_3: soData.shipping_address_line_3 || "",
      shipping_address_line_4: soData.shipping_address_line_4 || "",
      shipping_address_city: soData.shipping_address_city || "",
      shipping_address_state: soData.shipping_address_state || "",
      shipping_address_country: soData.shipping_address_country || "",
      shipping_postal_code: soData.shipping_postal_code || "",
      shipping_address_name: soData.shipping_address_name || "",
      shipping_address_phone: soData.shipping_address_phone || "",
      shipping_attention: soData.shipping_attention || "",
    });

    const visibilityMap = {
      "Self Pickup": "self_pickup",
      "Courier Service": "courier_service",
      "Company Truck": "company_truck",
      "Shipping Service": "shipping_service",
      "3rd Party Transporter": "third_party_transporter",
    };

    const selectedField = visibilityMap[soData.so_delivery_method] || null;
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
        setTimeout(() => {
          this.setData({
            driver_name: soData.cp_driver_name,
            ic_no: soData.cp_ic_no,
            driver_contact_no: soData.cp_driver_contact_no,
            vehicle_no: soData.cp_vehicle_number,
            pickup_date: soData.cp_pickup_date,
            validity_of_collection: soData.validity_of_collection,
          });
        }, 100);
        break;

      case "Courier Service":
        setTimeout(() => {
          this.setData({
            courier_company: soData.cs_courier_company,
            shipping_date: soData.cs_shipping_date,
            tracking_number: soData.cs_tracking_number,
            est_arrival_date: soData.est_arrival_date,
            freight_charges: soData.cs_freight_charges,
          });
        }, 100);
        break;

      case "Company Truck":
        setTimeout(() => {
          this.setData({
            driver_name: soData.ct_driver_name,
            driver_contact_no: soData.ct_driver_contact_no,
            ic_no: soData.ct_ic_no,
            vehicle_no: soData.ct_vehicle_number,
            est_delivery_date: soData.ct_est_delivery_date,
            delivery_cost: soData.ct_delivery_cost,
          });
        }, 100);
        break;

      case "Shipping Service":
        setTimeout(() => {
          this.setData({
            shipping_company: soData.ss_shipping_company,
            shipping_date: soData.ss_shippping_date,
            freight_charges: soData.ss_freight_charges,
            shipping_method: soData.ss_shipping_method,
            est_arrival_date: soData.ss_est_arrival_date,
            tracking_number: soData.ss_tracking_number,
          });
        }, 100);
        break;

      case "3rd Party Transporter":
        setTimeout(() => {
          this.setData({
            tpt_vehicle_number: soData.tpt_vehicle_number,
            tpt_transport_name: soData.tpt_transport_name,
            tpt_ic_no: soData.tpt_ic_no,
            tpt_driver_contact_no: soData.tpt_driver_contact_no,
          });
        }, 100);
        break;
    }
  } else {
    await this.triggerEvent("func_reset_delivery_method");
    this.hide([
      "address_grid",
      "self_pickup",
      "courier_service",
      "company_truck",
      "shipping_service",
      "third_party_transporter",
    ]);

    await this.setData({
      gd_delivery_method: "",
      delivery_method_text: "",
      // Main address fields (formatted addresses)
      gd_billing_address: "",
      gd_shipping_address: "",

      // Detailed billing address fields
      billing_address_line_1: "",
      billing_address_line_2: "",
      billing_address_line_3: "",
      billing_address_line_4: "",
      billing_address_city: "",
      billing_address_state: "",
      billing_address_country: "",
      billing_postal_code: "",
      billing_address_phone: "",
      billing_address_name: "",
      billing_attention: "",

      // Detailed shipping address fields
      shipping_address_line_1: "",
      shipping_address_line_2: "",
      shipping_address_line_3: "",
      shipping_address_line_4: "",
      shipping_address_city: "",
      shipping_address_state: "",
      shipping_address_country: "",
      shipping_postal_code: "",
      shipping_address_name: "",
      shipping_address_phone: "",
      shipping_attention: "",
    });
  }
})();
