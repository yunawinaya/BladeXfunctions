(async () => {
  const data = this.getValues();
  const rowIndex = this.getValue("confirm_split_dialog.rowIndex");
  const tableGR = data.table_gr;

  // Open split dialog and close confirmation dialog
  await this.openDialog("split_dialog");
  await this.closeDialog("confirm_split_dialog");

  // Calculate to_received_qty as ordered_qty - initial_received_qty
  const toReceivedQty =
    (tableGR[rowIndex].ordered_qty || 0) -
    (tableGR[rowIndex].initial_received_qty || 0);

  // Set split dialog data
  await this.setData({
    [`split_dialog.item_id`]: tableGR[rowIndex].item_id,
    [`split_dialog.item_name`]: tableGR[rowIndex].item_name,
    [`split_dialog.to_received_qty`]: toReceivedQty,
    [`split_dialog.rowIndex`]: rowIndex,
  });

  // Handle serialized items
  if (tableGR[rowIndex].is_serialized_item === 1) {
    await this.display("split_dialog.table_split.select_serial_number");
    await this.setData({
      [`split_dialog.serial_number_data`]: tableGR[rowIndex].serial_numbers,
    });
  } else {
    await this.hide("split_dialog.table_split.select_serial_number");
  }

  // Filter out existing child rows for this parent
  const latestTableGR = tableGR.filter(
    (item) =>
      !(item.parent_or_child === "Child" && item.parent_index === rowIndex)
  );

  await this.setData({ table_gr: latestTableGR });
})();
