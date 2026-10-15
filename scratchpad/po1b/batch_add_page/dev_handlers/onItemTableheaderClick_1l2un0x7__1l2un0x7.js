(async () => {
  if (this.isView) {
    return;
  }

  let selectedArrays = this.getComponent("item_table").$refs.crud.tableSelect;
  console.log("selectedArrays", selectedArrays);
  let currentItemArray = this.getValue(`item_array`);

  for (const selectedItem of selectedArrays) {
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
        table_uom_conversion: itemData.table_uom_conversion,
        item_category: itemData.item_category,
        item_batch_management: itemData.item_batch_management,
        stock_control: itemData.stock_control,
        table_sup_item_bind: itemData.table_sup_item_bind,
      });
    }
  }
  console.log("currentItemArray", currentItemArray);

  const updatedItemCode = currentItemArray.map((item) => item.material_code);

  console.log("updatedItemCode", updatedItemCode.join(", "));

  this.setData({
    [`item_code_array`]: updatedItemCode.join("\n"),
    [`item_array`]: currentItemArray,
  });

  await this.$nextTick();
  this.getComponent("item_table").$refs.crud.clearSelection();

  await this.$nextTick();
  this.getComponent("item_table").$refs.crud.toggleSelection(
    currentItemArray,
    true,
  );
})();
