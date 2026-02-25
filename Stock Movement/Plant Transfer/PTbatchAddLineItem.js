const ALLOWED_CATEGORIES = ["Unrestricted", "Blocked"];

const handleInvCategory = async (currentItemArray, smLineItem) => {
  const categoryObjectResponse = await db
    .collection("blade_dict")
    .where({ code: "inventory_category" })
    .get();

  const filteredCategories = categoryObjectResponse.data.filter((category) =>
    ALLOWED_CATEGORIES.includes(category.dict_key),
  );

  for (const [index, _item] of currentItemArray.entries()) {
    const rowIndex = smLineItem.length + index;

    this.setData({
      [`stock_movement.${rowIndex}.category`]: "Unrestricted",
    });

    this.disabled([`stock_movement.${rowIndex}.category`], false);

    this.setOptionData(
      [`stock_movement.${rowIndex}.category`],
      filteredCategories,
    );
  }
};

const handleUOM = async (currentItemArray, smLineItem) => {
  for (const [index, item] of currentItemArray.entries()) {
    const rowIndex = smLineItem.length + index;

    const altUoms = item.table_uom_conversion.map((data) => data.alt_uom_id);

    const uomPromises = altUoms.map((uomId) =>
      db.collection("unit_of_measurement").where({ id: uomId }).get(),
    );
    const uomResults = await Promise.all(uomPromises);
    const uomOptions = uomResults.map((res) => res.data[0]).filter(Boolean);

    this.setOptionData(
      [`stock_movement.${rowIndex}.received_quantity_uom`],
      uomOptions,
    );

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
    received_quantity_uom: item.based_uom,
    item_name: item.material_name,
    item_desc: item.material_desc,
    quantity_uom: item.based_uom,
    unit_price: item.purchase_unit_price,
    item_category: item.item_category,
    is_serialized_item: item.serial_number_management,
  }));

  await this.setData({
    stock_movement: [...smLineItem, ...itemArray],
  });

  this.closeDialog("dialog_item_selection");

  await handleInvCategory(currentItemArray, smLineItem);
  await handleUOM(currentItemArray, smLineItem);
})();
