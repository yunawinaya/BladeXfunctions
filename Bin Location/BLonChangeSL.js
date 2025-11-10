(async () => {
  const StorageLocationId = this.getValue("storage_location_id");
  const plantId = this.getValue("plant_id");

  if (StorageLocationId) {
    this.disabled(
      ["is_default", "bin_name", "bin_code_tier_1", "bin_description"],
      false
    );
    await this.setData({
      [`storage_location_name`]: arguments[0]?.fieldModel?.label,
    });
    const resBin = await db
      .collection("bin_location")
      .where({
        plant_id: plantId,
        storage_location_id: StorageLocationId,
        is_default: 1,
      })
      .get();
    if (resBin.data.length === 0) {
      this.setData({ is_default: 1 });
    } else {
      this.setData({ is_default: 0 });
    }
  } else {
    this.setData({
      [`storage_location_name`]: "",
    });
  }
})();
