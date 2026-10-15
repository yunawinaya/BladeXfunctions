(async () => {
  const itemCodes = this.getValue(`item_code`);
  const currentItemArray = this.getValue(`item_array`);

  const itemCodeArray = itemCodes.split("\n");

  console.log("itemCodeArray", itemCodeArray);

  console.log("currentItemArray", currentItemArray);

  let updatedItemArray = [...currentItemArray];

  itemCodeArray.forEach((itemCode) => {
    const indexToRemove = updatedItemArray.findIndex(
      (item) => item.material_code === itemCode,
    );
    if (indexToRemove !== -1) {
      updatedItemArray.splice(indexToRemove, 1);
    }
  });

  const updatedItemCode = updatedItemArray.map((item) => item.material_code);
  console.log("updatedItemArray", updatedItemArray);
  console.log("updatedItemCode", updatedItemCode.join(", "));

  this.setData({
    [`item_code_array`]: updatedItemCode.join("\n"),
    [`item_array`]: updatedItemArray,
  });

  const selectedRecords =
    this.getComponent("item_table").$refs.crud.tableSelect;

  console.log("selectedRecords", selectedRecords);

  await this.$nextTick();
  this.getComponent("item_table").$refs.crud.clearSelection();

  await this.$nextTick();
  this.getComponent("item_table").$refs.crud.toggleSelection(
    updatedItemArray,
    true,
  );
})();
