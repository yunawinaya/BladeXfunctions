(async () => {
  const data = this.getValues();

  const rowIndex = arguments[0].index;
  const isSplit = this.getValue(`table_gr.${rowIndex}.is_split`);
  const isSerializedItem = this.getValue(
    `table_gr.${rowIndex}.is_serialized_item`,
  );
  const grItem = data.table_gr[rowIndex];

  // Calculate to_received_qty as ordered_qty - initial_received_qty
  const toReceivedQty =
    (grItem.ordered_qty || 0) - (grItem.initial_received_qty || 0);

  // Validate before allowing split
  if (toReceivedQty <= 0) {
    this.$message.error("Cannot split when quantity to receive is 0 or less.");
    return;
  }

  // Check if row has HU data - warn and reset before splitting
  const tempHuDataStr = grItem.temp_hu_data;
  if (tempHuDataStr && tempHuDataStr !== "[]") {
    await this.$alert(
      "Splitting this row will reset the selected Handling Units.",
      "Warning",
      {
        confirmButtonText: "OK",
        type: "warning",
      }
    );

    // Clear temp_hu_data and view_hu
    await this.setData({
      [`table_gr.${rowIndex}.temp_hu_data`]: "[]",
      [`table_gr.${rowIndex}.view_hu`]: "",
    });
  }

  if (isSplit && isSplit === "Yes") {
    this.setData({ [`confirm_split_dialog.rowIndex`]: rowIndex });
    await this.openDialog("confirm_split_dialog");
  } else {
    await this.openDialog("split_dialog");

    this.setData({
      [`split_dialog.item_id`]: grItem.item_id,
      [`split_dialog.item_name`]: grItem.item_name,
      [`split_dialog.to_received_qty`]: toReceivedQty,
      [`split_dialog.rowIndex`]: rowIndex,
    });
  }

  if (isSerializedItem === 1) {
    await this.display("split_dialog.table_split.select_serial_number");
    await this.setData({
      [`split_dialog.serial_number_data`]: grItem.serial_numbers,
    });
  } else {
    await this.hide("split_dialog.table_split.select_serial_number");
  }
})();
