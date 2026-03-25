(async () => {
  const data = this.getValue("split_dialog");
  const isSplit = this.getValue(`table_gr.${data.rowIndex}.is_split`);

  const grItem = this.getValue("table_gr");

  if (isSplit && isSplit === "Yes") {
    this.disabled(
      [
        `table_gr.${data.rowIndex}.received_qty`,
        `table_gr.${data.rowIndex}.storage_location_id`,
        `table_gr.${data.rowIndex}.location_id`,
        `table_gr.${data.rowIndex}.line_remark_1`,
        `table_gr.${data.rowIndex}.line_remark_2`,
        `table_gr.${data.rowIndex}.line_remark_3`,
      ],
      false,
    );

    this.setData({
      [`table_gr.${data.rowIndex}.is_split`]: "No",
    });
  }

  for (const [index, putaway] of grItem.entries()) {
    if (putaway.parent_or_child === "Child") {
      this.disabled([`table_gr.${index}.button_split`], true);
    } else {
      this.disabled([`table_gr.${index}.button_split`], false);
    }
  }

  await this.triggerEvent("func_reset_split_dialog");
  await this.closeDialog("split_dialog");
})();
