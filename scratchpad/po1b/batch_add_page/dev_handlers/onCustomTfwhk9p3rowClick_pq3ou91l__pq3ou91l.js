(async () => {
  let currentItemArray = this.getValue(`item_array`);
  const selectedItem = arguments[0].$eventArgs[0];
  console.log("selectedItem", selectedItem);
  if (!currentItemArray) {
    currentItemArray = [];
  }

  const index = currentItemArray.findIndex(
    (item) => item.id === selectedItem.id,
  );
  if (index !== -1) {
    currentItemArray.splice(index, 1);
  } else {
    const resItem = await db.collection("Item").doc(selectedItem.id).get();
    const itemData = resItem.data[0];

    currentItemArray.push({
      id: itemData.id,
      material_code: itemData.material_code,
      material_name: itemData.material_name,
      material_desc: itemData.material_desc,
      based_uom: itemData.based_uom,
      purchase_default_uom: itemData.purchase_default_uom,
      purchase_unit_price: itemData.purchase_unit_price,
      table_uom_conversion: itemData.table_uom_conversion,
      mat_purchase_tax_id: itemData.mat_purchase_tax_id,
      item_category: itemData.item_category,
      purchase_tax_percent: itemData.purchase_tax_percent,
      item_batch_management: itemData.item_batch_management,
      stock_control: itemData.stock_control,
      further_description: itemData.further_description,
      table_sup_item_bind: itemData.table_sup_item_bind,
    });
  }

  console.log("currentItemArray", currentItemArray);

  const updatedItemCode = currentItemArray.map((item) => item.material_code);

  console.log("updatedItemCode", updatedItemCode.join(", "));

  this.setData({
    [`item_code_array`]: updatedItemCode.join("\n"),
    [`item_array`]: currentItemArray,
  });

  const selectedRecords =
    this.getComponent("item_table").$refs.crud.tableSelect;

  console.log("selectedRecords", selectedRecords);

  await this.$nextTick();
  this.getComponent("item_table").$refs.crud.clearSelection();

  await this.$nextTick();
  this.getComponent("item_table").$refs.crud.toggleSelection(
    currentItemArray,
    true,
  );
})();
