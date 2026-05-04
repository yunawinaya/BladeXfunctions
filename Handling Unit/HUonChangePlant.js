(async () => {
  try {
    const plantID = arguments[0].value;

    this.setData({
      storage_location_id: "",
    });

    if (!plantID) return;

    const resStorageLocation = await db
      .collection("storage_location")
      .where({
        plant_id: plantID,
        is_deleted: 0,
        is_default: 1,
        storage_status: 1,
        location_type: "Loading Bay",
      })
      .get();

    if (!resStorageLocation.data || resStorageLocation.data.length === 0) {
      return;
    }

    const defaultStorageLocationID = resStorageLocation.data[0].id;
    this.setData({ storage_location_id: defaultStorageLocationID });
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
