const getPlantDefaultBin = async (plantId) => {
  let defaultStorageLocation;
  let defaultBinLocation;

  const resStorageLocation = await db
    .collection("storage_location")
    .where({
      plant_id: plantId,
      is_deleted: 0,
      is_default: 1,
      location_type: "Common",
    })
    .get()
    .then((res) => {
      if (res.data.length > 0) {
        defaultStorageLocation = res.data[0].id;
      }
    });

  if (resStorageLocation && resStorageLocation.data.length > 0) {
    const resBinLocation = await db
      .collection("bin_location")
      .where({
        plant_id: plantId,
        storage_location_id: resStorageLocation.data[0].id,
        is_default: 1,
        is_deleted: 0,
      })
      .get()
      .then((res) => {
        if (res.data.length > 0) {
          defaultBinLocation = res.data[0].id;
        }
      });

    if (!resBinLocation && resBinLocation.data.length === 0)
      throw new Error("Cannot find default bin location.");
  }

  return {
    defaultBinLocation,
    defaultStorageLocation,
  };
};

(async () => {
  try {
    const data = this.getValues();

    const pageStatus = data.page_status;
    const status = data.to_status;
    const tablePutaway = data.table_putaway_item;
    const plantId = data.plant_id;

    console.log("Putaway Get Strategy");

    if (status === "Created" || status === "In Progress") {
      if (plantId) {
        const resPutawaySetup = await db
          .collection("putaway_setup")
          .where({ plant_id: plantId, is_deleted: 0 })
          .get();

        if (resPutawaySetup && resPutawaySetup.data.length > 0) {
          const putawaySetupData = resPutawaySetup.data[0];

          // if putaway mode is Auto
          if (putawaySetupData.putaway_mode === "Auto") {
            // if putaway default strategy is Fixed Bin
            if (
              putawaySetupData.default_strategy_id &&
              putawaySetupData.default_strategy_id === "FIXED BIN"
            ) {
              for (const [index, item] of tablePutaway.entries()) {
                const itemId = item.item_code;
                const resItem = await db
                  .collection("Item")
                  .where({ id: itemId, is_deleted: 0 })
                  .get();

                if (!resItem && resItem.data.length === 0) continue;

                const itemData = resItem.data[0];

                // find plant default bin from item table
                if (itemData.table_default_bin.length > 0) {
                  for (const bin of itemData.table_default_bin) {
                    // if the table default bin has the selected plant id
                    if (bin.plant_id === plantId) {
                      this.setData({
                        [`table_putaway_item.${index}.target_location`]:
                          bin.bin_location,
                        [`table_putaway_item.${index}.storage_location`]:
                          bin.storage_location,
                      });
                    }
                    // if the table default bin doesnt have the selected plant id, look at the fallback strategy
                    else {
                      // if the fallback strategy has no data and the fallback strategy is Random, then get the plant default bin location from bin location table
                      if (
                        !putawaySetupData.fallback_strategy_id ||
                        putawaySetupData.fallback_strategy_id === "RANDOM"
                      ) {
                        const { defaultBinLocation, defaultStorageLocation } =
                          await getPlantDefaultBin(plantId);

                        this.setData({
                          [`table_putaway_item.${index}.target_location`]:
                            defaultBinLocation,
                          [`table_putaway_item.${index}.storage_location`]:
                            defaultStorageLocation,
                        });
                      }
                    }
                  }
                } else {
                  if (
                    !putawaySetupData.fallback_strategy_id ||
                    putawaySetupData.fallback_strategy_id === "RANDOM"
                  ) {
                    const { defaultBinLocation, defaultStorageLocation } =
                      await getPlantDefaultBin(plantId);

                    this.setData({
                      [`table_putaway_item.${index}.target_location`]:
                        defaultBinLocation,
                      [`table_putaway_item.${index}.storage_location`]:
                        defaultStorageLocation,
                    });
                  }
                }
              }
            }

            // if putaway default strategy is random or has no data
            if (
              !putawaySetupData.default_strategy_id ||
              putawaySetupData.default_strategy_id === "RANDOM"
            ) {
              const { defaultBinLocation, defaultStorageLocation } =
                await getPlantDefaultBin(plantId);
              for (const [index, _item] of tablePutaway.entries()) {
                this.setData({
                  [`table_putaway_item.${index}.target_location`]:
                    defaultBinLocation,
                  [`table_putaway_item.${index}.storage_location`]:
                    defaultStorageLocation,
                });
              }
            }
          }
        }
      }
    } else if (pageStatus === "Add") {
      if (plantId) {
        const resPutawaySetup = await db
          .collection("putaway_setup")
          .where({ plant_id: plantId, is_deleted: 0 })
          .get();

        if (resPutawaySetup && resPutawaySetup.data.length > 0) {
          const putawaySetupData = resPutawaySetup.data[0];

          console.log("arguments[0]", arguments[0]);
          // if putaway mode is Auto
          if (putawaySetupData.putaway_mode === "Auto") {
            for (const [rowIndex, putawayLine] of tablePutaway.entries()) {
              const itemId = putawayLine.item_code;

              if (!itemId) return;

              // if putaway default strategy is Fixed Bin
              if (
                putawaySetupData.default_strategy_id &&
                putawaySetupData.default_strategy_id === "FIXED BIN"
              ) {
                const resItem = await db
                  .collection("Item")
                  .where({ id: itemId, is_deleted: 0 })
                  .get();

                if (!resItem && resItem.data.length === 0) return;

                const itemData = resItem.data[0];

                // find plant default bin from item table
                if (itemData.table_default_bin.length > 0) {
                  for (const bin of itemData.table_default_bin) {
                    // if the table default bin has the selected plant id
                    if (bin.plant_id === plantId) {
                      this.setData({
                        [`table_putaway_item.${rowIndex}.target_location`]:
                          bin.bin_location,
                        [`table_putaway_item.${rowIndex}.storage_location`]:
                          bin.storage_location,
                      });
                    }
                    // if the table default bin doesnt have the selected plant id, look at the fallback strategy
                    else {
                      // if the fallback strategy has no data and the fallback strategy is Random, then get the plant default bin location from bin location table
                      if (
                        !putawaySetupData.fallback_strategy_id ||
                        putawaySetupData.fallback_strategy_id === "RANDOM"
                      ) {
                        const { defaultBinLocation, defaultStorageLocation } =
                          await getPlantDefaultBin(plantId);

                        this.setData({
                          [`table_putaway_item.${rowIndex}.target_location`]:
                            defaultBinLocation,
                          [`table_putaway_item.${rowIndex}.storage_location`]:
                            defaultStorageLocation,
                        });
                      }
                    }
                  }
                }
              }

              // if putaway default strategy is random or has no data
              if (
                !putawaySetupData.default_strategy_id ||
                putawaySetupData.default_strategy_id === "RANDOM"
              ) {
                const { defaultBinLocation, defaultStorageLocation } =
                  await getPlantDefaultBin(plantId);

                this.setData({
                  [`table_putaway_item.${rowIndex}.target_location`]:
                    defaultBinLocation,
                  [`table_putaway_item.${rowIndex}.storage_location`]:
                    defaultStorageLocation,
                });
              }
            }
          }
        }
      }
    }
  } catch (error) {
    this.$message.error(error.message || String(error));
  }
})();
