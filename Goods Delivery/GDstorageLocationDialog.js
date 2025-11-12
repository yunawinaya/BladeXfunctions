(async () => {
  try {
    console.log("Triggering storage location");

    const storageLocationId = arguments[0]?.value;
    let storageLocationData = this.models["default_storage_location"];

    console.log("storageLocationId", storageLocationId);

    if (!storageLocationData && storageLocationData.length === 0) {
      storageLocationData = await db
        .collection("storage_location")
        .where({ id: storageLocationId })
        .get()
        .then((res) => res.data[0]);
    }

    const fullBalanceData = this.models["full_balance_data"];

    const binLocationList =
      storageLocationData.table_bin_location?.map(
        (bin) => bin.bin_location_id
      ) || [];

    const filteredBalanceData =
      fullBalanceData.filter((data) =>
        binLocationList.includes(data.location_id)
      ) || [];

    if (
      !storageLocationId ||
      !storageLocationData ||
      !fullBalanceData ||
      storageLocationId === "" ||
      filteredBalanceData.length === 0
    ) {
      console.log("No storage location data found");
      if (filteredBalanceData.length === 0) {
        this.$message.error(
          "Inventory is not available in this storage location"
        );
      }
      await this.setData({
        "gd_item_balance.table_item_balance": fullBalanceData,
        "gd_item_balance.storage_location": "",
      });
      return;
    }

    await this.setData({
      "gd_item_balance.table_item_balance": filteredBalanceData,
    });
  } catch (error) {
    console.error("Error in storage location dialog:", error);
  }
})();
