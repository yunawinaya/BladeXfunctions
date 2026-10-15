(async () => {
  const itemCodes = this.getValue(`item_code`);
  const organizationId =
    this.getVarGlobal("deptParentId") === "0"
      ? this.getVarSystem("deptIds")
      : this.getVarGlobal("deptParentId");

  console.log("organization id", organizationId);

  const currentItemArray = this.getValue(`item_array`);

  const itemCodeArray = itemCodes.split("\n");

  console.log("itemCodeArray", itemCodeArray);

  const resItems = await Promise.all(
    itemCodeArray.map((item) =>
      db
        .collection("Item")
        .where({
          material_code: item,
          organization_id: organizationId,
          is_deleted: 0,
        })
        .get(),
    ),
  );

  const itemData = resItems.map((response) => response.data[0]);

  for (const item of itemData) {
    currentItemArray.push({
      id: item.id,
      material_code: item.material_code,
      material_name: item.material_name,
      material_desc: item.material_desc,
      based_uom: item.based_uom,
      table_uom_conversion: item.table_uom_conversion,
      item_category: item.item_category,
      item_batch_management: item.item_batch_management,
      stock_control: item.stock_control,
      serial_number_management: item.serial_number_management,
      further_description: item.further_description,
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
