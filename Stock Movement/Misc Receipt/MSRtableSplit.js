(async () => {
  const data = this.getValues();

  const rowIndex = arguments[0].index;
  const isSplit = this.getValue(`stock_movement.${rowIndex}.is_split`);
  const isSerializedItem = this.getValue(
    `stock_movement.${rowIndex}.is_serialized_item`,
  );
  const msrItem = data.stock_movement[rowIndex];

  const toReceivedQty = msrItem.received_quantity || 0;

  // Validate before allowing split
  if (toReceivedQty <= 0) {
    this.$message.error("Cannot split when received quantity is 0 or less.");
    return;
  }

  // Check if row has HU data - warn and reset before splitting
  const tempHuDataStr = msrItem.temp_hu_data;
  if (tempHuDataStr && tempHuDataStr !== "[]") {
    await this.$alert(
      "Splitting this row will reset the selected Handling Units.",
      "Warning",
      {
        confirmButtonText: "OK",
        type: "warning",
      },
    );

    // Clear temp_hu_data and view_hu
    await this.setData({
      [`stock_movement.${rowIndex}.temp_hu_data`]: "[]",
      [`stock_movement.${rowIndex}.view_hu`]: "",
    });
  }

  if (isSplit && isSplit === "Yes") {
    this.setData({ [`confirm_split_dialog.rowIndex`]: rowIndex });
    await this.openDialog("confirm_split_dialog");
  } else {
    await this.openDialog("split_dialog");

    this.setData({
      [`split_dialog.item_id`]: msrItem.item_selection,
      [`split_dialog.item_name`]: msrItem.item_name,
      [`split_dialog.to_received_qty`]: toReceivedQty,
      [`split_dialog.rowIndex`]: rowIndex,
      [`split_dialog.is_parent_split`]: 0,
    });
  }

  if (isSerializedItem === 1) {
    await this.display("split_dialog.table_split.select_serial_number");
    await this.setData({
      [`split_dialog.serial_number_data`]: msrItem.select_serial_number,
    });
  } else {
    await this.hide("split_dialog.table_split.select_serial_number");
  }
})();
