(async () => {
  const currentItemArray = this.getValue(`dialog_item_selection.item_array`);
  const saLineItem = this.getValue("stock_adjustment");
  const itemArray = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  for (const item of currentItemArray) {
    const saItem = {
      material_id: item.id,
      uom_id: item.based_uom,
      material_name: item.material_name,
      material_desc: item.material_desc,
      unit_price: item.purchase_unit_price,
      item_category: item.item_category,
      is_serialized_item: item.serial_number_management,
      is_single_serial: item.is_single_unit_serial,
    };

    itemArray.push(saItem);
  }

  await this.setData({
    stock_adjustment: [...saLineItem, ...itemArray],
    [`dialog_item_selection.item_array`]: [],
    [`dialog_item_selection.item_code_array`]: "",
    [`dialog_item_selection.item_code`]: "",
  });

  this.closeDialog("dialog_item_selection");
})();
