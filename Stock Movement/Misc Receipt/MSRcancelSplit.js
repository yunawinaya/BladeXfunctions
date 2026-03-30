(async () => {
  const data = this.getValue("split_dialog");
  const isSplit = this.getValue(`stock_movement.${data.rowIndex}.is_split`);

  const tableSM = this.getValue("stock_movement");

  if (isSplit && isSplit === "Yes") {
    this.disabled(
      [
        `stock_movement.${data.rowIndex}.received_quantity`,
        `stock_movement.${data.rowIndex}.storage_location_id`,
        `stock_movement.${data.rowIndex}.location_id`,
        `stock_movement.${data.rowIndex}.item_remark`,
        `stock_movement.${data.rowIndex}.item_remark2`,
        `stock_movement.${data.rowIndex}.item_remark3`,
      ],
      false,
    );

    this.setData({
      [`stock_movement.${data.rowIndex}.is_split`]: "No",
    });
  }

  for (const [index, item] of tableSM.entries()) {
    if (item.parent_or_child === "Child") {
      this.disabled([`stock_movement.${index}.button_split`], true);
    } else {
      this.disabled([`stock_movement.${index}.button_split`], false);
    }
  }

  await this.triggerEvent("func_reset_split_dialog");
  await this.closeDialog("split_dialog");
})();
