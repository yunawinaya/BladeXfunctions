(async () => {
  try {
    const value = arguments[0]?.value || "";
    const rowIndex = arguments[0].rowIndex;
    const plantId = this.getValue("plant_id");

    await this.setData({
      [`table_repack.${rowIndex}.target_location`]: "",
    });

    if (!value || !plantId) return;

    const resBin = await db
      .collection("bin_location")
      .where({
        plant_id: plantId,
        storage_location_id: value,
        is_default: 1,
        is_deleted: 0,
      })
      .get();

    const defaultBin = resBin?.data?.[0];
    if (defaultBin?.id) {
      await this.setData({
        [`table_repack.${rowIndex}.target_location`]: defaultBin.id,
      });
    }
  } catch (error) {
    this.$message.error("Error in ROonChangeTargetStorageLocation: " + error.message);
    console.error("Error in ROonChangeTargetStorageLocation:", error);
  }
})();
