(async () => {
  const isSelectPicking = await this.getValue("is_select_picking");

  if (isSelectPicking === 1) {
    const tableGD = this.getValue("table_gd");
    console.log("table_gd", tableGD);
    this.openDialog("dialog_select_picking");
    this.setData({
      [`dialog_select_picking.so_number_array`]: "",
      [`dialog_select_picking.item_array`]: [],
      [`dialog_select_picking.reference_type`]: "",
      [`dialog_select_picking.gd_line_data`]: tableGD,
    });
  } else {
    const tableGD = this.getValue("table_gd");
    console.log("table_gd", tableGD);
    this.openDialog("dialog_select_item");
    this.setData({
      [`dialog_select_item.so_number_array`]: "",
      [`dialog_select_item.item_array`]: [],
      [`dialog_select_item.reference_type`]: "",
      [`dialog_select_item.gd_line_data`]: tableGD,
    });
  }
})();
