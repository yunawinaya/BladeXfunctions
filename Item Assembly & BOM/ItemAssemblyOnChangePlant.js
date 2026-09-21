// Item master default bin for this plant. A row without a bin is treated as
// unconfigured so we never stamp a blank bin over the plant default.
const getItemDefaultBin = (tableDefaultBin, plantId) => {
  if (!plantId || !Array.isArray(tableDefaultBin)) return null;

  const matchingBin = tableDefaultBin.find(
    (bin) => bin.plant_id === plantId && bin.bin_location
  );

  if (!matchingBin) return null;

  return {
    binLocation: matchingBin.bin_location,
    storageLocation: matchingBin.storage_location || null,
  };
};

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

    const assembledItemID = this.getValue("item_id");

    const [resStorageLocation, resItem] = await Promise.all([
      db
        .collection("storage_location")
        .where({
          plant_id: plantID,
          is_deleted: 0,
          is_default: 1,
          storage_status: 1,
          location_type: "Common",
        })
        .get(),
      assembledItemID
        ? db
            .collection("item")
            .field("table_default_bin")
            .where({ id: assembledItemID })
            .get()
            .catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
    ]);

    const defaultStorageLocationID = resStorageLocation.data?.[0]?.id;

    // The assembled item's own default bin for this plant wins over the plant default.
    const itemDefaultBin = getItemDefaultBin(
      resItem.data?.[0]?.table_default_bin,
      plantID
    );

    if (itemDefaultBin) {
      this.setData({
        storage_location_id:
          itemDefaultBin.storageLocation || defaultStorageLocationID || "",
        location_id: itemDefaultBin.binLocation,
      });
      return;
    }

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
