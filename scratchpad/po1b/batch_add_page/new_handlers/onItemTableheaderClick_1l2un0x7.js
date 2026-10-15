(async () => {
  if (this.isView) {
    return;
  }

  let selectedArrays = this.getComponent("item_table").$refs.crud.tableSelect;
  console.log("selectedArrays", selectedArrays);
  let currentItemArray = this.getValue(`item_array`);

  // The selection's missing items in one projected query per 500 ids.
  const fetchItems = async (ids, fields) => {
    const chunks = [];
    for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
    const results = await Promise.all(
      chunks.map((chunk) =>
        db
          .collection("Item")
          .field(fields)
          .filter(new Filter().in("id", chunk).build())
          .get(),
      ),
    );
    const byId = new Map();
    results.forEach((res) =>
      (res.data || []).forEach((item) => byId.set(String(item.id), item)),
    );
    return byId;
  };
  // Rows toggle in order, so a row is fetched when its turn would add it.
  const present = new Set(currentItemArray.map((item) => item.id));
  const toFetch = [];
  for (const selectedItem of selectedArrays) {
    if (present.has(selectedItem.id)) present.delete(selectedItem.id);
    else {
      present.add(selectedItem.id);
      toFetch.push(selectedItem.id);
    }
  }
  const fetched = await fetchItems(
    [...new Set(toFetch)],
    "material_code,material_name,material_desc,based_uom,table_uom_conversion,item_category,item_batch_management,stock_control,table_sup_item_bind",
  );

  for (const selectedItem of selectedArrays) {
    const index = currentItemArray.findIndex(
      (item) => item.id === selectedItem.id,
    );
    if (index !== -1) {
      currentItemArray.splice(index, 1);
    } else {
      const itemData = fetched.get(String(selectedItem.id));
      if (!itemData) continue;

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
