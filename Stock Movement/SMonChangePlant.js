const resetFormData = () => {
  this.setData({
    movement_type: "",
    movement_reason: "",
    stock_movement_no: "",
    receiving_operation_faci: "",
    stock_movement: [],
    delivery_method_text: "",
    default_bin: "",
    default_storage_location: "",
  });

  this.triggerEvent("func_reset_delivery_method");

  this.hide([
    "self_pickup",
    "courier_service",
    "company_truck",
    "shipping_service",
    "third_party_transporter",
  ]);
};

(async () => {
  const plantID = arguments[0].value;
  resetFormData();

  this.disabled(["movement_type"], !plantID);

  if (plantID) {
    let defaultStorageLocationID = "";

    const resStorageLocation = await db
      .collection("storage_location")
      .where({
        plant_id: plantID,
        is_deleted: 0,
        is_default: 1,
        storage_status: 1,
        location_type: "Common",
      })
      .get();

    if (resStorageLocation.data && resStorageLocation.data.length > 0) {
      defaultStorageLocationID = resStorageLocation.data[0].id;
      this.setData({
        default_storage_location: defaultStorageLocationID,
      });
    }

    if (defaultStorageLocationID && defaultStorageLocationID !== "") {
      const resBinLocation = await db
        .collection("bin_location")
        .where({
          plant_id: plantID,
          storage_location_id: defaultStorageLocationID,
          is_deleted: 0,
          is_default: 1,
          bin_status: 1,
        })
        .get();

      if (resBinLocation.data && resBinLocation.data.length > 0) {
        this.setData({
          default_bin: resBinLocation.data[0].id,
        });
      }
    }
  }
})();
