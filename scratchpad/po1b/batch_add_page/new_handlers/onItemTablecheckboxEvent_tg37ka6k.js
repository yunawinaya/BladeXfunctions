(async () => {
  let currentItemArray = this.getValue(`item_array`);
  const selectedItemList = arguments[0].$eventArgs[0];
  console.log("selectedItemList", selectedItemList);

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

  // filter out items that are not in selectedItemList
  const selectedIds = new Set(selectedItemList.map((item) => item.id));
  currentItemArray = currentItemArray.filter((item) => selectedIds.has(item.id));

  console.log("currentItemArray", currentItemArray);
  const kept = new Set(currentItemArray.map((item) => item.id));
  const fetched = await fetchItems(
    [...new Set(selectedItemList.map((item) => item.id))].filter(
      (id) => !kept.has(id),
    ),
    "material_code,material_name,material_desc,based_uom,purchase_default_uom,purchase_unit_price,table_uom_conversion,mat_purchase_tax_id,item_category,purchase_tax_percent,item_batch_management,stock_control,further_description,table_sup_item_bind",
  );

  for (const selectedItem of selectedItemList) {
    if (kept.has(selectedItem.id)) {
      continue;
    } else {
      kept.add(selectedItem.id);
      const itemData = fetched.get(String(selectedItem.id));
      if (!itemData) continue;

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
  }

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
