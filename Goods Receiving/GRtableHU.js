(async () => {
  const data = this.getValues();

  const rowIndex = arguments[0].rowIndex;
  const grItem = data.table_gr[rowIndex];
  const tempHUdata = JSON.parse(grItem.temp_hu_data || "[]");

  let receivedQty = grItem.received_qty || 0;
  if (receivedQty <= 0) {
    receivedQty = grItem.to_received_qty || 0;
    this.setData({ [`table_gr.${rowIndex}.received_qty`]: receivedQty });
  }

  if (receivedQty <= 0) {
    this.$message.error(
      "Unable to select handling unit when received quantity is 0 or less.",
    );
    return;
  }

  // Determine loading bay location for HU filtering
  let loadingBayLocationId = "";

  // Step 1: Check putaway_setup for default_loading_bay
  const resPutawaySetup = await db
    .collection("putaway_setup")
    .where({
      plant_id: data.plant_id,
      is_deleted: 0,
      movement_type: "Good Receiving",
    })
    .get();

  if (resPutawaySetup?.data?.length > 0) {
    loadingBayLocationId = resPutawaySetup.data[0].default_loading_bay || "";
  }

  // Step 2: If still empty, fallback - find default Loading Bay storage location's default bin
  if (!loadingBayLocationId) {
    const resStorageLocation = await db
      .collection("storage_location")
      .where({
        plant_id: data.plant_id,
        storage_status: 1,
        location_type: "Loading Bay",
        is_default: 1,
      })
      .get();

    if (resStorageLocation?.data?.length > 0) {
      const defaultBin = resStorageLocation.data[0].table_bin_location?.find(
        (bin) => bin.is_default_bin === 1,
      );
      if (defaultBin) {
        loadingBayLocationId = defaultBin.bin_location_id;
      }
    }
  }

  // Step 3: If still no loading bay, skip HU fetch
  if (!loadingBayLocationId) {
    await this.openDialog("hu_dialog");

    const combinedHUdata = tempHUdata.length > 0 ? tempHUdata : [];

    if (combinedHUdata.length > 0) {
      this.setData({ [`hu_dialog.table_hu`]: combinedHUdata });
    }

    this.setData({
      [`hu_dialog.item_id`]: grItem.item_id,
      [`hu_dialog.item_name`]: grItem.item_name,
      [`hu_dialog.received_qty`]: receivedQty,
      [`hu_dialog.storage_location_id`]: grItem.storage_location_id,
      [`hu_dialog.location_id`]: grItem.location_id,
      [`hu_dialog.rowIndex`]: rowIndex,
    });
    return;
  }

  await this.openDialog("hu_dialog");

  const responseHU = await db
    .collection("handling_unit")
    .where({
      plant_id: data.plant_id,
      organization_id: data.organization_id,
      location_id: loadingBayLocationId,
    })
    .get();

  console.log("responseHU", responseHU.data);

  const huData = responseHU.data.map((item, index) => {
    return {
      handling_unit_id: item.id,
      store_in_quantity: 0,
      line_index: index,
      ...item,
    };
  });

  // Combine huData (existing HUs from DB) with tempHUdata (user's selections)
  // Order: [existing HUs from DB, newly created HUs from user]
  let combinedHUdata = [];

  if (tempHUdata.length > 0) {
    // Separate tempHUdata into existing HUs (has handling_unit_id) and new HUs (no handling_unit_id)
    const existingHUsFromTemp = tempHUdata.filter((hu) => hu.handling_unit_id);
    const newHUsFromUser = tempHUdata.filter((hu) => !hu.handling_unit_id);

    // Create a map of existing HUs from tempHUdata for quick lookup
    const tempHUMap = {};
    existingHUsFromTemp.forEach((hu) => {
      tempHUMap[hu.handling_unit_id] = hu;
    });

    // Start with huData, but use tempHUdata values if they exist (preserves store_in_quantity)
    combinedHUdata = huData.map((hu, index) => {
      if (tempHUMap[hu.handling_unit_id]) {
        // Use tempHUdata version (preserves user's store_in_quantity)
        return { ...tempHUMap[hu.handling_unit_id], line_index: index };
      }
      return { ...hu, line_index: index };
    });

    // Add newly created HUs at the end with proper line_index
    let maxLineIndex = combinedHUdata.length;
    newHUsFromUser.forEach((hu) => {
      combinedHUdata.push({ ...hu, line_index: maxLineIndex });
      maxLineIndex++;
    });
  } else {
    combinedHUdata = huData;
  }

  if (combinedHUdata.length > 0) {
    this.setData({ [`hu_dialog.table_hu`]: combinedHUdata });
  }

  this.setData({
    [`hu_dialog.item_id`]: grItem.item_id,
    [`hu_dialog.item_name`]: grItem.item_name,
    [`hu_dialog.received_qty`]: receivedQty,
    [`hu_dialog.storage_location_id`]: grItem.storage_location_id,
    [`hu_dialog.location_id`]: grItem.location_id,
    [`hu_dialog.rowIndex`]: rowIndex,
  });
})();
