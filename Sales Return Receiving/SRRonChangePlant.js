(async () => {
  const plantID = arguments[0].value;

  if (arguments[0].fieldModel) {
    this.setData({
      table_srr: [],
      so_id: [],
      gd_id: [],
      sr_id: [],
      so_no_display: "",
      gd_no_display: "",
      sr_no_display: "",
    });
  }

  if (plantID) {
    this.disabled("table_srr", false);

    let defaultStorageLocationID = "";
    let defaultBinLocationID = "";

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
        defaultBinLocationID = resBinLocation.data[0].id;
      }
    }

    const resSRSetup = await db
      .collection("sales_return_setup")
      .where({ plant_id: plantID })
      .get();

    const hasSRSetup = !!resSRSetup && resSRSetup.data.length > 0;

    // Left unset, the save workflow neither generates a batch nor reuses the
    // delivered one, so new_batch always has to be written.
    const newBatch = hasSRSetup ? resSRSetup.data[0].generate_new_batch : 1;

    this.setData({
      default_bin_location: defaultBinLocationID ?? null,
      default_storage_location: defaultStorageLocationID ?? null,
      new_batch: newBatch,
    });

    if (!hasSRSetup) {
      this.$message.warning(
        "No Sales Return Setup found for this plant. Please contact support.",
      );
    }
  }
})();
