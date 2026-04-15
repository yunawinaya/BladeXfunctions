const resetFormData = () => {
  this.setData({
    stock_movement: [],
    delivery_method_text: "",
    default_bin: "",
    default_storage_location: "",
  });
};

(async () => {
  const plantID = arguments[0].value;
  resetFormData();

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

    const resPutAwaySetup = await db
      .collection("putaway_setup")
      .where({ plant_id: plantID, is_deleted: 0 })
      .get();

    if (
      resPutAwaySetup &&
      resPutAwaySetup.data.length > 0 &&
      resPutAwaySetup.data[0].show_hu === 1
    ) {
      this.display(["stock_movement.select_hu", "stock_movement.view_hu"]);
    } else {
      this.hide(["stock_movement.select_hu", "stock_movement.view_hu"]);
    }
  } else {
    this.hide(["stock_movement.select_hu", "stock_movement.view_hu"]);
  }
})();
