(async () => {
  try {
    const storageLocationID = arguments[0].value;
    const plantID = this.getValue("plant_id");

    this.setData({ location_id: "" });

    if (!storageLocationID || !plantID) return;

    const resBinLocation = await db
      .collection("bin_location")
      .where({
        plant_id: plantID,
        storage_location_id: storageLocationID,
        is_deleted: 0,
        is_default: 1,
        bin_status: 1,
      })
      .get();

    if (resBinLocation.data && resBinLocation.data.length > 0) {
      this.setData({ location_id: resBinLocation.data[0].id });
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
