(async () => {
  try {
    const dialogData = this.getValue("dialog_select_items");
    const tableHU = this.getValue("table_hu");
    const tableItem = this.getValue("table_items");
    const rowIndex = dialogData.row_index;
    const tableSelectItems = dialogData.table_select_items;

    if (!tableHU || rowIndex === undefined || rowIndex === null) {
      throw new Error("Invalid HU table or row index");
    }

    // Check if any items have quantity_to_pack > 0
    const hasItemsToPack = tableSelectItems.some(
      (item) => parseFloat(item.quantity_to_pack) > 0
    );

    // Validate quantities
    for (const item of tableSelectItems) {
      const quantityToPack = parseFloat(item.quantity_to_pack) || 0;
      const totalQuantity = parseFloat(item.total_quantity) || 0;
      const packedQty = parseFloat(item.packed_qty) || 0;

      if (quantityToPack < 0) {
        this.$message.error(
          `Quantity to pack cannot be negative for ${item.item_name}`
        );
        return;
      }

      // Check if total packed quantity exceeds total quantity
      const totalPacked = packedQty + quantityToPack;
      if (totalPacked > totalQuantity) {
        this.$message.error(
          `Total packed quantity (${totalPacked}) exceeds total quantity (${totalQuantity}) for ${item.item_name}`
        );
        return;
      }
    }

    // Filter items that have quantity_to_pack > 0
    const itemsToSave = tableSelectItems.filter(
      (item) => parseFloat(item.quantity_to_pack) > 0
    );

    // Remove the _fromRowIndex field and add SO/GD/TO IDs from tableItem
    const cleanedItems = itemsToSave.map((item) => {
      const { _fromRowIndex, ...cleanItem } = item;

      // Find matching item in tableItem using line_item_id
      const matchingTableItem = tableItem.find(
        (tableItemRow) => tableItemRow.id === item.line_item_id
      );

      // Add SO, GD, and TO IDs if matching item found
      if (matchingTableItem) {
        cleanItem.so_id = matchingTableItem.so_id || "";
        cleanItem.so_line_id = matchingTableItem.so_line_id || "";
        cleanItem.gd_id = matchingTableItem.gd_id || "";
        cleanItem.gd_line_id = matchingTableItem.gd_line_id || "";
        cleanItem.to_id = matchingTableItem.to_id || "";
        cleanItem.to_line_id = matchingTableItem.to_line_id || "";
      }

      return cleanItem;
    });

    // If no items to pack, clear temp_data and set status to Unpacked
    if (!hasItemsToPack || cleanedItems.length === 0) {
      tableHU[rowIndex].temp_data = "";
      tableHU[rowIndex].item_count = 0;
      tableHU[rowIndex].total_quantity = 0;
      tableHU[rowIndex].status = "Unpacked";
    } else {
      // Save to temp_data as JSON string
      tableHU[rowIndex].temp_data = JSON.stringify(cleanedItems);

      console.log("cleanedItems", cleanedItems);

      // Calculate item_count (total individual items packed)
      tableHU[rowIndex].item_count = cleanedItems.length;

      // Calculate total_quantity (sum of all quantity_to_pack)
      const totalQuantity = cleanedItems.reduce(
        (sum, item) => sum + (parseFloat(item.quantity_to_pack) || 0),
        0
      );
      tableHU[rowIndex].total_quantity = totalQuantity;

      // Update HU status
      tableHU[rowIndex].status = "Packed";
    }

    // Update the table_hu in the form
    await this.setData({
      table_hu: tableHU,
    });

    // Close the dialog
    await this.closeDialog("dialog_select_items");

    this.$message.success("Items saved to HU successfully");
  } catch (error) {
    this.$message.error(
      "Error in PackingSaveSelectItemDialog: " + error.message
    );
    console.error("Error in PackingSaveSelectItemDialog:", error);
  }
})();
