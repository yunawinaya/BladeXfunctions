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
      to_delivery_method: soData.so_delivery_method,
      delivery_method_text: soData.so_delivery_method,

      // Delivery Info — one shared block, identical column names on SO and PP,
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
    });

  } else {
    await this.triggerEvent("func_reset_delivery_method");
    this.hide("address_grid");

    await this.setData({
      to_delivery_method: "",
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
    });
  }
})();
