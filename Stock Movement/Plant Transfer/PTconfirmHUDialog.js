// Helper to build a stock_movement row with all fields explicitly assigned (no spread)
// This prevents shared reactive references between rows in the platform
const buildSmRow = (
  sourceItem,
  lineIndex,
  receivedQty,
  storageLocationId,
  locationId,
  isSplit,
  parentOrChild,
  parentIndex,
  tempHuData,
  viewHu,
) => {
  return {
    line_index: lineIndex,

    // Item information
    item_selection: sourceItem.item_selection,
    item_name: sourceItem.item_name,
    item_desc: sourceItem.item_desc,

    // Quantity
    received_quantity: receivedQty,
    received_quantity_uom: sourceItem.received_quantity_uom,

    // Pricing
    unit_price: sourceItem.unit_price || 0,
    amount: receivedQty * (sourceItem.unit_price || 0),

    // Location
    storage_location_id: storageLocationId,
    location_id: locationId,

    // Batch
    batch_id: sourceItem.batch_id,
    manufacturing_date: sourceItem.manufacturing_date,
    expired_date: sourceItem.expired_date,

    // Category
    category: sourceItem.category,

    // Serial number
    is_serialized_item: sourceItem.is_serialized_item,
    select_serial_number: sourceItem.select_serial_number
      ? [...sourceItem.select_serial_number]
      : [],

    // Remarks
    item_remark: sourceItem.item_remark || "",
    item_remark2: sourceItem.item_remark2 || "",
    item_remark3: sourceItem.item_remark3 || "",

    // Stock
    stock_summary: sourceItem.stock_summary || "",
    balance_id: sourceItem.balance_id || "",
    temp_qty_data: sourceItem.temp_qty_data || "",

    // UOM options (needed for dropdown)
    uom_options: sourceItem.uom_options ? [...sourceItem.uom_options] : [],

    // HU data
    temp_hu_data: tempHuData,
    view_hu: viewHu,

    // Split tracking
    is_split: isSplit,
    parent_or_child: parentOrChild,
    parent_index: parentIndex,
  };
};

(async () => {
  try {
    const data = this.getValues();
    const tableHU = this.getValue("hu_dialog.table_hu") || [];
    const receivedQty =
      parseFloat(this.getValue("hu_dialog.received_qty")) || 0;
    const rowIndex = this.getValue("hu_dialog.rowIndex");
    const storageLocationId = this.getValue("hu_dialog.storage_location_id");
    const locationId = this.getValue("hu_dialog.location_id");

    // Helper function to format HU data for view_hu display
    const formatViewHU = async (huArray) => {
      if (!huArray || huArray.length === 0) return "";

      const hu = huArray[0];
      const huName = hu.handling_no || hu.handling_unit_id || "New HU";
      const qty = hu.store_in_quantity || 0;

      let materialCode = "";
      if (hu.hu_material_id) {
        try {
          const res = await db
            .collection("Item")
            .where({ id: hu.hu_material_id })
            .get();
          materialCode = res.data?.[0]?.material_code || hu.hu_material_id;
        } catch (error) {
          console.error(`Error fetching material ${hu.hu_material_id}:`, error);
          materialCode = hu.hu_material_id;
        }
      }

      let result = `${huName}: ${qty} qty`;
      if (materialCode) {
        result += `\n[HU Material: ${materialCode}]`;
      }
      return result;
    };

    // Filter rows with store_in_quantity > 0
    const confirmedHUs = tableHU.filter(
      (hu) => parseFloat(hu.store_in_quantity) > 0,
    );

    // Calculate total store_in_quantity
    const totalStoreInQty = confirmedHUs.reduce(
      (sum, hu) => sum + (parseFloat(hu.store_in_quantity) || 0),
      0,
    );

    // Validate hu_material_id is not empty for all confirmed HUs
    const missingMaterialHUs = confirmedHUs.filter((hu) => !hu.hu_material_id);
    if (missingMaterialHUs.length > 0) {
      this.$message.warning(
        `Please select a material for all handling units with store in quantity.`,
      );
      return;
    }

    // Validate total does not exceed received_qty
    if (totalStoreInQty > receivedQty) {
      this.$message.warning(
        `Total store in quantity (${totalStoreInQty}) cannot exceed received quantity (${receivedQty}).`,
      );
      return;
    }

    const tableSM = data.stock_movement;
    const currentItem = tableSM[rowIndex];
    const remainingQty = parseFloat((receivedQty - totalStoreInQty).toFixed(3));
    const parentIndex = currentItem.parent_index ?? rowIndex;

    // Determine if split is needed
    const needsSplit = confirmedHUs.length > 1 || remainingQty > 0;

    // Warn user if there's remaining qty without HU
    if (remainingQty > 0 && totalStoreInQty > 0) {
      try {
        await this.$confirm(
          `Total HU quantity (${totalStoreInQty}) is less than received quantity (${receivedQty}). A new line with ${remainingQty} without HU will be created. Continue?`,
          "Remaining Quantity",
          {
            confirmButtonText: "Yes",
            cancelButtonText: "No",
            type: "warning",
          },
        );
      } catch {
        return;
      }
    }

    if (needsSplit && totalStoreInQty > 0) {
      const latestTableSM = [];

      if (currentItem.parent_or_child === "Child") {
        // Scenario: Child row - add sibling children for each HU
        const existingChildren = tableSM.filter(
          (row) =>
            row.parent_or_child === "Child" && row.parent_index === parentIndex,
        );
        let nextChildNum = existingChildren.length + 1;

        for (const [index, item] of tableSM.entries()) {
          if (index === rowIndex) {
            // First HU goes to current child row
            const firstHU = confirmedHUs[0];
            const firstHUQty = parseFloat(firstHU.store_in_quantity) || 0;

            latestTableSM.push(
              buildSmRow(
                item,
                item.line_index,
                firstHUQty,
                item.storage_location_id,
                item.location_id,
                item.is_split || "No",
                "Child",
                parentIndex,
                JSON.stringify([firstHU]),
                await formatViewHU([firstHU]),
              ),
            );

            // Create sibling children for remaining HUs
            for (let i = 1; i < confirmedHUs.length; i++) {
              const hu = confirmedHUs[i];
              const huQty = parseFloat(hu.store_in_quantity) || 0;

              latestTableSM.push(
                buildSmRow(
                  item,
                  `${parentIndex + 1} - ${nextChildNum}`,
                  huQty,
                  storageLocationId,
                  locationId,
                  "No",
                  "Child",
                  parentIndex,
                  JSON.stringify([hu]),
                  await formatViewHU([hu]),
                ),
              );
              nextChildNum++;
            }

            // Sibling for remaining qty (no HU)
            if (remainingQty > 0) {
              latestTableSM.push(
                buildSmRow(
                  item,
                  `${parentIndex + 1} - ${nextChildNum}`,
                  remainingQty,
                  storageLocationId,
                  locationId,
                  "No",
                  "Child",
                  parentIndex,
                  "[]",
                  "",
                ),
              );
            }
          } else {
            // Preserve existing row (rebuild to avoid shared references)
            latestTableSM.push(
              buildSmRow(
                item,
                item.line_index,
                item.received_quantity,
                item.storage_location_id,
                item.location_id,
                item.is_split || "No",
                item.parent_or_child || "Parent",
                item.parent_index ?? index,
                item.temp_hu_data || "[]",
                item.view_hu || "",
              ),
            );
          }
        }
      } else {
        // Scenario: Regular row - create Parent + N Children + remaining
        for (const [index, item] of tableSM.entries()) {
          if (index === rowIndex) {
            // Parent row (summary)
            latestTableSM.push(
              buildSmRow(
                item,
                parentIndex + 1,
                receivedQty,
                "",
                "",
                "Yes",
                "Parent",
                parentIndex,
                "[]",
                "",
              ),
            );

            // One child per HU
            let childNum = 1;
            for (const hu of confirmedHUs) {
              const huQty = parseFloat(hu.store_in_quantity) || 0;

              latestTableSM.push(
                buildSmRow(
                  item,
                  `${parentIndex + 1} - ${childNum}`,
                  huQty,
                  storageLocationId,
                  locationId,
                  "No",
                  "Child",
                  parentIndex,
                  JSON.stringify([hu]),
                  await formatViewHU([hu]),
                ),
              );
              childNum++;
            }

            // Child for remaining qty (no HU)
            if (remainingQty > 0) {
              latestTableSM.push(
                buildSmRow(
                  item,
                  `${parentIndex + 1} - ${childNum}`,
                  remainingQty,
                  storageLocationId,
                  locationId,
                  "No",
                  "Child",
                  parentIndex,
                  "[]",
                  "",
                ),
              );
            }
          } else {
            // Preserve existing row (rebuild to avoid shared references)
            latestTableSM.push(
              buildSmRow(
                item,
                item.line_index,
                item.received_quantity,
                item.storage_location_id,
                item.location_id,
                item.is_split || "No",
                item.parent_or_child || "Parent",
                item.parent_index ?? index,
                item.temp_hu_data || "[]",
                item.view_hu || "",
              ),
            );
          }
        }
      }

      await this.setData({ stock_movement: latestTableSM });

      // Apply field states after split
      const updatedTableSM = this.getValue("stock_movement");
      for (const [index, item] of updatedTableSM.entries()) {
        if (item.is_split === "Yes" && item.parent_or_child === "Parent") {
          this.disabled(
            [
              `stock_movement.${index}.received_quantity`,
              `stock_movement.${index}.storage_location_id`,
              `stock_movement.${index}.location_id`,
              `stock_movement.${index}.select_serial_number`,
              `stock_movement.${index}.category`,
              `stock_movement.${index}.button_hu`,
            ],
            true,
          );
        } else if (item.parent_or_child === "Child") {
          this.disabled(
            [
              `stock_movement.${index}.batch_id`,
              `stock_movement.${index}.manufacturing_date`,
              `stock_movement.${index}.expired_date`,
            ],
            true,
          );
        }
      }

      // Reset dialog table before closing
      await this.setData({ "hu_dialog.table_hu": [] });
      await this.closeDialog("hu_dialog");

      const huCount = confirmedHUs.length;
      const message =
        remainingQty > 0
          ? `Split created: ${huCount} HU(s) with ${totalStoreInQty}, ${remainingQty} without HU.`
          : `Split created: ${huCount} HU(s) with ${totalStoreInQty} total.`;
      this.$message.success(message);
    } else {
      // No split needed - single HU matches received qty
      await this.setData({
        [`stock_movement.${rowIndex}.temp_hu_data`]:
          JSON.stringify(confirmedHUs),
        [`stock_movement.${rowIndex}.view_hu`]:
          await formatViewHU(confirmedHUs),
      });

      // Reset dialog table before closing
      await this.setData({ "hu_dialog.table_hu": [] });
      await this.closeDialog("hu_dialog");
      this.$message.success("Handling unit selection confirmed.");
    }
  } catch (error) {
    this.$message.error(error.message || String(error));
  }
})();
