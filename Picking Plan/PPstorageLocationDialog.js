(async () => {
  try {
    console.log("Triggering storage location");

    const storageLocationId = arguments[0]?.value;
    const previousStorageLocationId = this.models["previous_storage_location_id"];
    const currentTableData = this.getValues()?.to_item_balance?.table_item_balance || [];
    let storageLocationData = this.models["default_storage_location"];

    console.log("storageLocationId", storageLocationId);
    console.log("previousStorageLocationId", previousStorageLocationId);

    if (storageLocationId === previousStorageLocationId) {
      console.log("Storage location unchanged, skipping confirmation");
      this.models["previous_storage_location_id"] = storageLocationId;
      return;
    }

    if (!storageLocationData && storageLocationData.length === 0) {
      storageLocationData = await db
        .collection("storage_location")
        .where({ id: storageLocationId })
        .get()
        .then((res) => res.data[0]);
    }

    const fullBalanceData = this.models["full_balance_data"];

    const hasAllocatedItems = currentTableData.some(
      (data) => (data.to_quantity || 0) > 0
    );

    if (hasAllocatedItems && previousStorageLocationId) {
      try {
        await this.$confirm(
          "There are items with allocated quantities. Changing storage location will reset all allocated quantities. Do you want to continue?",
          "Warning",
          {
            confirmButtonText: "OK",
            cancelButtonText: "Cancel",
            type: "warning",
          }
        );

        fullBalanceData.forEach((data) => {
          data.to_quantity = 0;
        });

        console.log("User confirmed: Reset all to_quantity to 0");
      } catch {
        console.log("User cancelled: Restoring previous storage location");
        await this.setData({
          "to_item_balance.storage_location": previousStorageLocationId,
          "to_item_balance.table_item_balance": currentTableData,
        });
        return;
      }
    }

    this.models["previous_storage_location_id"] = storageLocationId;

    const binLocationList =
      storageLocationData.table_bin_location?.map(
        (bin) => bin.bin_location_id
      ) || [];

    const filteredBalanceData =
      fullBalanceData?.filter((data) => {
        const hasAllocation = (data.to_quantity || 0) > 0;
        const inStorageLocation = binLocationList.includes(data.location_id);

        return hasAllocation || inStorageLocation;
      }) || [];

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
        "to_item_balance.table_item_balance": fullBalanceData,
        "to_item_balance.storage_location": "",
      });
      return;
    }

    await this.setData({
      "to_item_balance.table_item_balance": filteredBalanceData,
    });
  } catch (error) {
    console.error("Error in storage location dialog:", error);
  }
})();
