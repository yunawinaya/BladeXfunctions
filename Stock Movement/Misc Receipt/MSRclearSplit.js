(async () => {
  const data = this.getValues();
  const rowIndex = this.getValue("confirm_split_dialog.rowIndex");
  const tableSM = data.stock_movement;
  const currentRow = tableSM[rowIndex];

  // Open split dialog and close confirmation dialog
  await this.openDialog("split_dialog");
  await this.closeDialog("confirm_split_dialog");

  // For MSR, to_received_qty is simply the row's received_quantity
  const toReceivedQty = currentRow.received_quantity || 0;

  // Set split dialog data
  await this.setData({
    [`split_dialog.item_id`]: currentRow.item_selection,
    [`split_dialog.item_name`]: currentRow.item_name,
    [`split_dialog.to_received_qty`]: toReceivedQty,
    [`split_dialog.rowIndex`]: rowIndex,
    [`split_dialog.is_parent_split`]: 0,
  });

  // Handle serialized items
  if (currentRow.is_serialized_item === 1) {
    await this.display("split_dialog.table_split.select_serial_number");
    await this.setData({
      [`split_dialog.serial_number_data`]: currentRow.select_serial_number,
    });
  } else {
    await this.hide("split_dialog.table_split.select_serial_number");
  }

  // Filter out rows based on split type
  let latestTableSM;

  if (currentRow.parent_or_child === "Split-Parent") {
    // For Split-Parent: filter out all Split-Parent rows with same split_source_index
    const splitSourceIndex = currentRow.split_source_index;
    latestTableSM = tableSM.filter(
      (item) =>
        !(
          item.parent_or_child === "Split-Parent" &&
          item.split_source_index === splitSourceIndex
        ),
    );
  } else {
    // For hierarchy split: filter out existing child rows for this parent
    latestTableSM = tableSM.filter(
      (item) =>
        !(item.parent_or_child === "Child" && item.parent_index === rowIndex),
    );
  }

  await this.setData({ stock_movement: latestTableSM });
})();
