// read once per plant
const plantDefaultBinCache = {};

const getPlantDefaultBin = (plantId) => {
  const key = String(plantId);
  if (!plantDefaultBinCache[key]) {
    plantDefaultBinCache[key] = (async () => {
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
    })();
  }
  return plantDefaultBinCache[key];
};

// one projected Item query per 500 ids
const fetchItemDefaultBins = async (itemIds) => {
  const ids = [...new Set(itemIds.filter(Boolean).map(String))];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 500) {
    chunks.push(ids.slice(i, i + 500));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      db
        .collection("Item")
        .field("table_default_bin,is_deleted")
        .filter(new Filter().in("id", chunk).build())
        .get(),
    ),
  );

  const itemMap = new Map();
  results.forEach((res) => {
    (res?.data || []).forEach((item) => {
      if (Number(item.is_deleted) === 1) return;
      itemMap.set(String(item.id), item);
    });
  });
  return itemMap;
};

const needsLocation = (item) => !(item.storage_location && item.target_location);

// merged into the live table: mounted's serial selection may have been written while the lookups ran
const writeLocations = async (snapshot, updated) => {
  const changes = new Map();
  updated.forEach((row, index) => {
    if (row !== snapshot[index]) {
      changes.set(index, {
        target_location: row.target_location,
        storage_location: row.storage_location,
      });
    }
  });
  if (changes.size === 0) return;

  const live = this.getValue("table_putaway_item") || [];
  const sameRow = (a, b) =>
    a && b && (a.fm_key !== undefined || b.fm_key !== undefined ? a.fm_key === b.fm_key : true);
  const table = live.length === snapshot.length ? live : snapshot;
  this.setData({
    table_putaway_item: table.map((row, index) =>
      changes.has(index) && sameRow(row, snapshot[index])
        ? { ...row, ...changes.get(index) }
        : row,
    ),
  });
};

(async () => {
  try {
    const pageStatus = this.getValue("page_status");
    const status = this.getValue("to_status");
    const plantId = this.getValue("plant_id");
    const tablePutaway = JSON.parse(
      JSON.stringify(this.getValue("table_putaway_item") || []),
    );

    console.log("Putaway Get Strategy");

    if (status === "Created" || status === "In Progress") {
      if (plantId) {
        // For non-Add: skip strategy if item already has storage_location & target_location
        if (!tablePutaway.some(needsLocation)) {
          console.log("All putaway items already have storage_location and target_location, skipping strategy.");
          return;
        }

        const resPutawaySetup = await db
          .collection("putaway_setup")
          .where({ plant_id: plantId, is_deleted: 0 })
          .get();

        if (resPutawaySetup && resPutawaySetup.data.length > 0) {
          const putawaySetupData = resPutawaySetup.data[0];

          // if putaway mode is Auto
          if (putawaySetupData.putaway_mode === "Auto") {
            const updatedTablePutaway = [...tablePutaway];

            // if putaway default strategy is Fixed Bin
            if (
              putawaySetupData.default_strategy_id &&
              putawaySetupData.default_strategy_id === "FIXED BIN"
            ) {
              const itemMap = await fetchItemDefaultBins(
                tablePutaway.filter(needsLocation).map((item) => item.item_code),
              );

              for (const [index, item] of tablePutaway.entries()) {
                // Skip items that already have both locations
                if (!needsLocation(item)) continue;

                const itemData = itemMap.get(String(item.item_code));
                if (!itemData) continue;

                // find plant default bin from item table
                if (
                  itemData.table_default_bin &&
                  itemData.table_default_bin.length > 0
                ) {
                  const matchingBin = itemData.table_default_bin.find(
                    (bin) => bin.plant_id === plantId,
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
                // Skip items that already have both locations
                if (!needsLocation(updatedTablePutaway[i])) continue;

                updatedTablePutaway[i] = {
                  ...updatedTablePutaway[i],
                  target_location: defaultBinLocation,
                  storage_location: defaultStorageLocation,
                };
              }
            }

            await writeLocations(tablePutaway, updatedTablePutaway);
          }
        }
      }
    } else if (pageStatus === "Add") {
      if (plantId) {
        // Skip strategy if all items already have storage_location & target_location
        // (already populated by PutawayOnChangeGR via loading bay logic)
        if (!tablePutaway.some(needsLocation)) {
          console.log("All putaway items already have storage_location and target_location, skipping strategy.");
          return;
        }

        const resPutawaySetup = await db
          .collection("putaway_setup")
          .where({ plant_id: plantId, is_deleted: 0 })
          .get();

        if (resPutawaySetup && resPutawaySetup.data.length > 0) {
          const putawaySetupData = resPutawaySetup.data[0];

          // if putaway mode is Auto
          if (putawaySetupData.putaway_mode === "Auto") {
            const updatedTablePutaway = [...tablePutaway];
            const isFixedBin =
              putawaySetupData.default_strategy_id &&
              putawaySetupData.default_strategy_id === "FIXED BIN";
            const itemMap = isFixedBin
              ? await fetchItemDefaultBins(
                  tablePutaway.filter(needsLocation).map((item) => item.item_code),
                )
              : new Map();

            for (const [rowIndex, putawayLine] of updatedTablePutaway.entries()) {
              // Skip items that already have both locations
              if (!needsLocation(putawayLine)) continue;

              const itemId = putawayLine.item_code;
              if (!itemId) continue;

              // if putaway default strategy is Fixed Bin
              if (isFixedBin) {
                const itemData = itemMap.get(String(itemId));
                if (!itemData) continue;

                // find plant default bin from item table
                if (
                  itemData.table_default_bin &&
                  itemData.table_default_bin.length > 0
                ) {
                  const matchingBin = itemData.table_default_bin.find(
                    (bin) => bin.plant_id === plantId,
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

            await writeLocations(tablePutaway, updatedTablePutaway);
          }
        }
      }
    }
  } catch (error) {
    this.$message.error(error.message || String(error));
  }
})();
