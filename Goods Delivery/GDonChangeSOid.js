(async () => {
  const soIDs = arguments[0].value;

  console.log("JN Debug 2", soIDs);

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

      // Delivery Info — one shared block, identical column names on SO and GD,
      // so it copies straight across with no per-method branching.
      di_shipping_method: soData.di_shipping_method || "",
      di_driver_name: soData.di_driver_name || "",
      di_ic_no: soData.di_ic_no || "",
      di_driver_contact_no: soData.di_driver_contact_no || "",
      di_shipping_company: soData.di_shipping_company || "",
      di_transport_name: soData.di_transport_name || "",
      di_vehicle_number: soData.di_vehicle_number || "",
      di_est_delivery_date: soData.di_est_delivery_date || "",
      di_est_arrival_date: soData.di_est_arrival_date || "",
      di_pickup_date: soData.di_pickup_date || "",
      di_validity_of_collection: soData.di_validity_of_collection || "",
      di_tracking_number: soData.di_tracking_number || "",
      di_freight_charges: soData.di_freight_charges || 0,

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
      billing_address_fax: soData.billing_address_fax || "",
      billing_address_code: soData.billing_address_code || "",

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
      shipping_address_fax: soData.shipping_address_fax || "",
      shipping_address_code: soData.shipping_address_code || "",

      gd_area_id: soData.so_area_id || "",
      order_tnc: soData.so_tnc || "",
      order_payment_details: soData.so_payment_details || "",
      order_delivery_term: soData.so_delivery_term || "",
      order_remark: soData.so_remarks || "",
      order_remark2: soData.so_remarks2 || "",
      order_remark3: soData.so_remarks3 || "",
      order_remark4: soData.so_remarks4 || "",
      order_remark5: soData.so_remarks5 || "",
      sales_person: soData.so_sales_person ? [soData.so_sales_person] : [],
    });

  } else {
    await this.triggerEvent("func_reset_delivery_method");
    this.hide("address_grid");

    await this.setData({
      gd_delivery_method: "",
      delivery_method_text: "",

      di_shipping_method: "",
      di_driver_name: "",
      di_ic_no: "",
      di_driver_contact_no: "",
      di_shipping_company: "",
      di_transport_name: "",
      di_vehicle_number: "",
      di_est_delivery_date: "",
      di_est_arrival_date: "",
      di_pickup_date: "",
      di_validity_of_collection: "",
      di_tracking_number: "",
      di_freight_charges: 0,

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
      billing_address_fax: "",

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
      shipping_address_fax: "",

      gd_area_id: "",
      order_tnc: "",
      order_payment_details: "",
      order_delivery_term: "",
      order_remark: "",
      order_remark2: "",
      order_remark3: "",
      order_remark4: "",
      order_remark5: "",
      sales_person: [],
    });
  }
})();
