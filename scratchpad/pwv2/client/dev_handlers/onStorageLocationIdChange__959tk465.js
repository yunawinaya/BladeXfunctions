(async () => {
  try {
    const plantId = this.getValue("plant_id");
    const storageLocationId = arguments[0]?.value;
    const rowIndex = arguments[0]?.rowIndex;

    if (storageLocationId) {
      this.disabled([`table_putaway_item.${rowIndex}.target_location`], false);

      const resBinLocation = await db
        .collection("bin_location")
        .where({
          storage_location_id: storageLocationId,
          plant_id: plantId,
          is_deleted: 0,
        })
        .get();

      if (resBinLocation.data.length > 0) {
        const defaultBinLocation = resBinLocation.data.find(
          (bin) => bin.is_default === 1
        );
        await this.setData({
          [`table_putaway_item.${rowIndex}.target_location`]: defaultBinLocation.id,
        });
      }
    } else {
      this.setData({
        [`table_putaway_item.${rowIndex}.target_location`]: "",
      });
      this.disabled([`table_putaway_item.${rowIndex}.target_location`], true);
    }
  } catch (error) {
    console.error("Error in change storage location:", error);
  }
})();
