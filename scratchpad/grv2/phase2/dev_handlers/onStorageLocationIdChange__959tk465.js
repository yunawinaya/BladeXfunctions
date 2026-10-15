(async () => {
  try {
    const plantId = this.getValue("plant_id");
    const storageLocationId = arguments[0]?.value;
    const rowIndex = arguments[0]?.rowIndex;

    // rowIndex is not a usable position once table_gr is a tree -- a bundle's items
    // are not rows of it. The event hands over the row itself, so address it by its
    // own key and fall back to the index only for a row the platform has not keyed.
    const eventRow = arguments[0]?.row;
    const rowPath =
      eventRow && eventRow.fm_key
        ? `table_gr.${eventRow.fm_key}`
        : `table_gr.${rowIndex}`;

    if (storageLocationId) {
      this.disabled([`${rowPath}.location_id`], false);

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
        // find() returns undefined when no bin under this storage is flagged default
        if (defaultBinLocation) {
          await this.setData({
            [`${rowPath}.location_id`]: defaultBinLocation.id,
          });
        }
      }
    } else {
      this.setData({
        [`${rowPath}.location_id`]: "",
      });
      this.disabled([`${rowPath}.location_id`], true);
    }
  } catch (error) {
    console.error("Error in change storage location:", error);
  }
})();
