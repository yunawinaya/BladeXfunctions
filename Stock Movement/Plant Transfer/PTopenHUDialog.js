(async () => {
  const data = this.getValues();

  const rowIndex = arguments[0].rowIndex;
  const ptItem = data.stock_movement[rowIndex];
  const tempHUdata = JSON.parse(ptItem.temp_hu_data || "[]");

  let receivedQty = ptItem.received_quantity || 0;

  if (receivedQty <= 0) {
    receivedQty = ptItem.received_quantity || 0;
    this.setData({
      [`stock_movement.${rowIndex}.received_quantity`]: receivedQty,
    });
  }

  if (receivedQty <= 0) {
    this.$message.error(
      "Unable to select handling unit when received quantity is 0 or less.",
    );
    return;
  }

  // Determine loading bay location for HU filtering
  let loadingBayLocationId = "";

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

  // Step 3: If still no loading bay, skip HU fetch
  if (!loadingBayLocationId) {
    await this.openDialog("hu_dialog");

    const combinedHUdata = tempHUdata.length > 0 ? tempHUdata : [];

    if (combinedHUdata.length > 0) {
      this.setData({ [`hu_dialog.table_hu`]: combinedHUdata });
    }

    this.setData({
      [`hu_dialog.item_id`]: ptItem.item_selection,
      [`hu_dialog.item_name`]: ptItem.item_name,
      [`hu_dialog.received_qty`]: receivedQty,
      [`hu_dialog.storage_location_id`]: ptItem.storage_location_id,
      [`hu_dialog.location_id`]: ptItem.location_id,
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
    [`hu_dialog.item_id`]: ptItem.item_selection,
    [`hu_dialog.item_name`]: ptItem.item_name,
    [`hu_dialog.received_qty`]: receivedQty,
    [`hu_dialog.storage_location_id`]: ptItem.storage_location_id,
    [`hu_dialog.location_id`]: ptItem.location_id,
    [`hu_dialog.rowIndex`]: rowIndex,
  });
})();
