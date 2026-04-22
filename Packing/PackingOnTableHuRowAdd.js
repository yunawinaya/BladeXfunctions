// Initializes a newly-added table_hu row as a Generated HU.
// Paste into the `onTableHuRowAdd` handler slot (key 6ig0cg3h).
//
// Field setup:
//   hu_row_type   = "generated"   — distinguishes from Locked rows sourced from table_hu_source
//   temp_data     = "[]"          — empty pack list (JSON string)
//   item_count    = 0             — rollup
//   total_quantity = 0            — rollup
//   hu_status     = "Unpacked"    — initial pack status
//   handling_no   — left blank; backend workflow fills on save (GR pattern).

(async () => {
  try {
    console.log("argument", arguments[0]);
    const rowIndex = arguments[0].rowIndex;
    const data = this.getValues();
    const plantId = data.plant_id;

    // Resolve default loading bay (same logic as PackingOpenExistingHUDialog)
    let loadingBayLocationId = "";
    let loadingBayStorageLocationId = "";

    if (plantId) {
      // Step 1: putaway_setup default_loading_bay
      const resPutawaySetup = await db
        .collection("putaway_setup")
        .where({ plant_id: plantId, is_deleted: 0 })
        .get();

      if (resPutawaySetup?.data?.length > 0) {
        loadingBayLocationId =
          resPutawaySetup.data[0].default_loading_bay || "";
      }

      // Resolve parent storage_location from bin
      if (loadingBayLocationId) {
        const resBin = await db
          .collection("bin_location")
          .where({ id: loadingBayLocationId, is_deleted: 0 })
          .get();
        if (resBin?.data?.length > 0) {
          loadingBayStorageLocationId =
            resBin.data[0].storage_location_id || "";
        }
      }

      // Step 2 fallback: default Loading Bay storage location's default bin
      if (!loadingBayLocationId) {
        const resStorageLocation = await db
          .collection("storage_location")
          .where({
            plant_id: plantId,
            storage_status: 1,
            location_type: "Loading Bay",
            is_default: 1,
          })
          .get();

        if (resStorageLocation?.data?.length > 0) {
          loadingBayStorageLocationId = resStorageLocation.data[0].id;
          const defaultBin =
            resStorageLocation.data[0].table_bin_location?.find(
              (bin) => bin.is_default_bin === 1,
            );
          if (defaultBin) {
            loadingBayLocationId = defaultBin.bin_location_id;
          }
        }
      }
    }

    await this.setData({
      [`table_hu.${rowIndex}.handling_no`]: "Auto-generated Number",
      [`table_hu.${rowIndex}.hu_row_type`]: "generated",
      [`table_hu.${rowIndex}.temp_data`]: "[]",
      [`table_hu.${rowIndex}.item_count`]: 0,
      [`table_hu.${rowIndex}.total_quantity`]: 0,
      [`table_hu.${rowIndex}.hu_status`]: "Unpacked",
      [`table_hu.${rowIndex}.storage_location_id`]: loadingBayStorageLocationId,
      [`table_hu.${rowIndex}.location_id`]: loadingBayLocationId,
    });
  } catch (error) {
    console.error("PackingOnTableHuRowAdd error:", error);
    this.$message.error(error.message || String(error));
  }
})();
