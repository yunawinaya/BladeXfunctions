(async () => {
  try {
    const plantId = this.getValue("plant_id");
    const storageLocationId = arguments[0]?.value;
    const rowIndex = arguments[0]?.rowIndex;

    if (storageLocationId) {
      this.disabled([`table_gr.${rowIndex}.location_id`], false);
      this.refreshFieldOptionData([`table_gr.${rowIndex}.location_id`]);

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
          [`table_gr.${rowIndex}.location_id`]: defaultBinLocation.id,
        });
      }
    } else {
      this.setData({
        [`table_gr.${rowIndex}.location_id`]: "",
      });
      this.disabled([`table_gr.${rowIndex}.location_id`], true);
    }
  } catch (error) {
    console.error("Error in change storage location:", error);
  }
})();
