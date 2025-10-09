const getPlantDefaultBin = async (plantId) => {
  const resBinLocation = await db
    .collection("bin_location")
    .where({ plant_id: plantId, is_default: 1, is_deleted: 0 })
    .get();

  if (!resBinLocation && resBinLocation.data.length === 0)
    throw new Error("Cannot find default bin location.");

  return resBinLocation.data[0].id;
};

(async () => {
  try {
    const data = this.getValues();

    const pageStatus = data.page_status;
    const status = data.to_status;
    const tablePutaway = data.table_putaway_item;
    const plantId = data.plant_id;

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
                      });
                    }
                    // if the table default bin doesnt have the selected plant id, look at the fallback strategy
                    else {
                      // if the fallback strategy has no data and the fallback strategy is Random, then get the plant default bin location from bin location table
                      if (
                        !putawaySetupData.fallback_strategy_id ||
                        putawaySetupData.fallback_strategy_id === "RANDOM"
                      ) {
                        const binLocation = await getPlantDefaultBin(plantId);

                        this.setData({
                          [`table_putaway_item.${index}.target_location`]:
                            binLocation,
                        });
                      }
                    }
                  }
                } else {
                  if (
                    !putawaySetupData.fallback_strategy_id ||
                    putawaySetupData.fallback_strategy_id === "RANDOM"
                  ) {
                    const binLocation = await getPlantDefaultBin(plantId);

                    this.setData({
                      [`table_putaway_item.${index}.target_location`]:
                        binLocation,
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
              const binLocation = await getPlantDefaultBin(plantId);
              for (const [index, _item] of tablePutaway.entries()) {
                this.setData({
                  [`table_putaway_item.${index}.target_location`]: binLocation,
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
                      });
                    }
                    // if the table default bin doesnt have the selected plant id, look at the fallback strategy
                    else {
                      // if the fallback strategy has no data and the fallback strategy is Random, then get the plant default bin location from bin location table
                      if (
                        !putawaySetupData.fallback_strategy_id ||
                        putawaySetupData.fallback_strategy_id === "RANDOM"
                      ) {
                        const binLocation = await getPlantDefaultBin(plantId);

                        this.setData({
                          [`table_putaway_item.${rowIndex}.target_location`]:
                            binLocation,
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
                const binLocation = await getPlantDefaultBin(plantId);

                this.setData({
                  [`table_putaway_item.${rowIndex}.target_location`]:
                    binLocation,
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
