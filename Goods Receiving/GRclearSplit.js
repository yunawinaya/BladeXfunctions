(async () => {
  const data = this.getValues();
  const rowIndex = this.getValue("confirm_split_dialog.rowIndex");
  const tableGR = data.table_gr;
  const currentRow = tableGR[rowIndex];

  // Open split dialog and close confirmation dialog
  await this.openDialog("split_dialog");
  await this.closeDialog("confirm_split_dialog");

  // Rebuild table_gr to clear the existing split. newRowIndex is the row in
  // the rebuilt table that the re-split dialog should target.
  let latestTableGR;
  let newRowIndex;

  if (currentRow.parent_or_child === "Split-Parent") {
    // Split-Parent has no persistent summary row, so collapse all sibling
    // Split-Parent rows (same split_source_index) back into a single regular
    // row, then re-split that row. Without this the clicked row would be
    // removed entirely and split_dialog.rowIndex would dangle into a shorter
    // table, causing "Cannot read properties of undefined (reading
    // 'ordered_qty')" on the next confirm.
    const splitSourceIndex = currentRow.split_source_index;
    const isSibling = (item) =>
      item.parent_or_child === "Split-Parent" &&
      item.split_source_index === splitSourceIndex;

    // Preserve the received total across the collapsed siblings.
    const totalReceivedQty = parseFloat(
      tableGR
        .filter(isSibling)
        .reduce((sum, item) => sum + (parseFloat(item.received_qty) || 0), 0)
        .toFixed(3),
    );
    const uomConversion = currentRow.uom_conversion || 1;

    const restoredRow = {
      ...currentRow,
      received_qty: totalReceivedQty,
      base_received_qty: parseFloat(
        (totalReceivedQty * uomConversion).toFixed(3),
      ),
      to_received_qty:
        (currentRow.ordered_qty || 0) - (currentRow.initial_received_qty || 0),
      is_split: "No",
      parent_or_child: "Parent", // regular (non-split) row default
      split_source_index: null,
    };

    latestTableGR = [];
    newRowIndex = -1;
    for (const item of tableGR) {
      if (isSibling(item)) {
        // Replace the first sibling encountered with the restored row; drop
        // the remaining siblings.
        if (newRowIndex === -1) {
          newRowIndex = latestTableGR.length;
          latestTableGR.push(restoredRow);
        }
      } else {
        latestTableGR.push(item);
      }
    }

    // Align the restored regular row's parent_index with its new position.
    latestTableGR[newRowIndex].parent_index = newRowIndex;
  } else {
    // Hierarchy split: remove child rows; the Parent summary row remains in
    // place so its index stays valid.
    latestTableGR = tableGR.filter(
      (item) =>
        !(item.parent_or_child === "Child" && item.parent_index === rowIndex),
    );
    newRowIndex = rowIndex;
  }

  await this.setData({ table_gr: latestTableGR });

  // Configure the split dialog against the rebuilt table.
  const targetRow = latestTableGR[newRowIndex];
  const toReceivedQty =
    (targetRow.ordered_qty || 0) - (targetRow.initial_received_qty || 0);

  await this.setData({
    [`split_dialog.item_id`]: targetRow.item_id,
    [`split_dialog.item_name`]: targetRow.item_name,
    [`split_dialog.to_received_qty`]: toReceivedQty,
    [`split_dialog.rowIndex`]: newRowIndex,
    [`split_dialog.is_parent_split`]: 0, // Reset to default
  });

  // Handle serialized items
  if (targetRow.is_serialized_item === 1) {
    await this.display("split_dialog.table_split.select_serial_number");
    await this.setData({
      [`split_dialog.serial_number_data`]: targetRow.serial_numbers,
    });
  } else {
    await this.hide("split_dialog.table_split.select_serial_number");
  }
})();
