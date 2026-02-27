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
    .get();

  if (resStorageLocation && resStorageLocation.data.length > 0) {
    defaultStorageLocation = resStorageLocation.data[0].id;

    const resBinLocation = await db
      .collection("bin_location")
      .where({
        plant_id: plantId,
        storage_location_id: resStorageLocation.data[0].id,
        is_default: 1,
        is_deleted: 0,
      })
      .get();

    if (resBinLocation && resBinLocation.data.length > 0) {
      defaultBinLocation = resBinLocation.data[0].id;
    } else {
      throw new Error("Cannot find default bin location.");
    }
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
    const tablePutaway = data.table_putaway_item || [];
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
            // Build updated table without looping setData
            const updatedTablePutaway = [...tablePutaway];

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

                if (!resItem || resItem.data.length === 0) continue;

                const itemData = resItem.data[0];

                // find plant default bin from item table
                if (itemData.table_default_bin && itemData.table_default_bin.length > 0) {
                  const matchingBin = itemData.table_default_bin.find(
                    (bin) => bin.plant_id === plantId
                  );

                  if (matchingBin) {
                    updatedTablePutaway[index] = {
                      ...updatedTablePutaway[index],
                      target_location: matchingBin.bin_location,
                      storage_location: matchingBin.storage_location,
                    };
                  } else if (
                    !putawaySetupData.fallback_strategy_id ||
                    putawaySetupData.fallback_strategy_id === "RANDOM"
                  ) {
                    const { defaultBinLocation, defaultStorageLocation } =
                      await getPlantDefaultBin(plantId);

                    updatedTablePutaway[index] = {
                      ...updatedTablePutaway[index],
                      target_location: defaultBinLocation,
                      storage_location: defaultStorageLocation,
                    };
                  }
                } else {
                  if (
                    !putawaySetupData.fallback_strategy_id ||
                    putawaySetupData.fallback_strategy_id === "RANDOM"
                  ) {
                    const { defaultBinLocation, defaultStorageLocation } =
                      await getPlantDefaultBin(plantId);

                    updatedTablePutaway[index] = {
                      ...updatedTablePutaway[index],
                      target_location: defaultBinLocation,
                      storage_location: defaultStorageLocation,
                    };
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

              for (let i = 0; i < updatedTablePutaway.length; i++) {
                updatedTablePutaway[i] = {
                  ...updatedTablePutaway[i],
                  target_location: defaultBinLocation,
                  storage_location: defaultStorageLocation,
                };
              }
            }

            // Single setData call for the entire table
            this.setData({ table_putaway_item: updatedTablePutaway });
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
            // Build updated table without looping setData
            const updatedTablePutaway = [...tablePutaway];

            for (const [rowIndex, putawayLine] of tablePutaway.entries()) {
              const itemId = putawayLine.item_code;

              if (!itemId) continue;

              // if putaway default strategy is Fixed Bin
              if (
                putawaySetupData.default_strategy_id &&
                putawaySetupData.default_strategy_id === "FIXED BIN"
              ) {
                const resItem = await db
                  .collection("Item")
                  .where({ id: itemId, is_deleted: 0 })
                  .get();

                if (!resItem || resItem.data.length === 0) continue;

                const itemData = resItem.data[0];

                // find plant default bin from item table
                if (itemData.table_default_bin && itemData.table_default_bin.length > 0) {
                  const matchingBin = itemData.table_default_bin.find(
                    (bin) => bin.plant_id === plantId
                  );

                  if (matchingBin) {
                    updatedTablePutaway[rowIndex] = {
                      ...updatedTablePutaway[rowIndex],
                      target_location: matchingBin.bin_location,
                      storage_location: matchingBin.storage_location,
                    };
                  } else if (
                    !putawaySetupData.fallback_strategy_id ||
                    putawaySetupData.fallback_strategy_id === "RANDOM"
                  ) {
                    const { defaultBinLocation, defaultStorageLocation } =
                      await getPlantDefaultBin(plantId);

                    updatedTablePutaway[rowIndex] = {
                      ...updatedTablePutaway[rowIndex],
                      target_location: defaultBinLocation,
                      storage_location: defaultStorageLocation,
                    };
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

                updatedTablePutaway[rowIndex] = {
                  ...updatedTablePutaway[rowIndex],
                  target_location: defaultBinLocation,
                  storage_location: defaultStorageLocation,
                };
              }
            }

            // Single setData call for the entire table
            this.setData({ table_putaway_item: updatedTablePutaway });
          }
        }
      }
    }
  } catch (error) {
    this.$message.error(error.message || String(error));
  }
})();
