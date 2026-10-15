(async () => {
  const data = this.getValues();

  const rowIndex = arguments[0].rowIndex;
  const isSplit = this.getValue(`table_putaway_item.${rowIndex}.is_split`);
  const isSerializedItem = this.getValue(
    `table_putaway_item.${rowIndex}.is_serialized_item`
  );
  const putawayItem = data.table_putaway_item[rowIndex];

  if (isSplit && isSplit === "Yes") {
    this.setData({ [`confirm_split_dialog.rowIndex`]: rowIndex });
    await this.openDialog("confirm_split_dialog");
  } else {
    await this.openDialog("split_dialog");

    this.setData({
      [`split_dialog.item_id`]: putawayItem.item_code,
      [`split_dialog.item_name`]: putawayItem.item_name,
      [`split_dialog.qty_to_putaway`]: putawayItem.pending_process_qty,
      [`split_dialog.rowIndex`]: rowIndex,
    });
  }

  if (isSerializedItem === 1) {
    await this.display("split_dialog.table_split.select_serial_number");
    await this.setData({
      [`split_dialog.serial_number_data`]: putawayItem.serial_numbers,
    });
  } else {
    await this.hide("split_dialog.table_split.select_serial_number");
  }
})();
