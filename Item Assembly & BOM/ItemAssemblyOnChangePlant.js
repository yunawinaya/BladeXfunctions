(async () => {
  try {
    const plantID = arguments[0].value;

    this.setData({
      storage_location_id: "",
      location_id: "",
      stock_movement: [],
    });

    if (!plantID) {
      // No plant means no stock to allocate against.
      this.disabled(["stock_movement"], true);
      return;
    }

    this.disabled(["stock_movement"], false);

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

    const defaultStorageLocationID = resStorageLocation.data?.[0]?.id;
    if (!defaultStorageLocationID) return;

    this.setData({ storage_location_id: defaultStorageLocationID });

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

    if (resBinLocation.data?.[0]?.id) {
      this.setData({ location_id: resBinLocation.data[0].id });
    }
  } catch (error) {
    console.error("Error loading plant defaults:", error);
    this.$message.error(error.message || "Failed to load the plant defaults");
  }
})();
