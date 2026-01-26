const handleUOM = async (currentItemArray, smLineItem) => {
  for (const [index, item] of currentItemArray.entries()) {
    const rowIndex = smLineItem.length + index;

    const altUoms = item.table_uom_conversion.map((data) => data.alt_uom_id);

    const uomPromises = altUoms.map((uomId) =>
      db.collection("unit_of_measurement").where({ id: uomId }).get(),
    );
    const uomResults = await Promise.all(uomPromises);
    const uomOptions = uomResults.map((res) => res.data[0]).filter(Boolean);

    this.setOptionData([`stock_movement.${rowIndex}.quantity_uom`], uomOptions);

    this.setData({
      [`stock_movement.${rowIndex}.uom_options`]: uomOptions,
    });
  }
};

(async () => {
  const currentItemArray = arguments[0].itemArray;
  const smLineItem = this.getValue("stock_movement");

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });
    return;
  }

  const itemArray = currentItemArray.map((item) => ({
    stock_summary: "",
    item_selection: item.id,
    item_name: item.material_name,
    item_desc: item.material_desc,
    quantity_uom: item.based_uom,
    is_serialized_item: item.serial_number_management,
  }));

  await this.setData({
    stock_movement: [...smLineItem, ...itemArray],
  });

  this.closeDialog("dialog_item_selection");

  await handleUOM(currentItemArray, smLineItem);
})();
