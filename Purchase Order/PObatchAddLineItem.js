const fetchUomData = async (uomIds) => {
  try {
    const resUOM = await Promise.all(
      uomIds.map((id) =>
        db.collection("unit_of_measurement").where({ id }).get()
      )
    );

    const uomData = resUOM.map((response) => response.data[0]);

    return uomData;
  } catch (error) {
    console.error("Error fetching UOM data:", error);
    return [];
  }
};

(async () => {
  const currentItemArray = this.getValue(`dialog_item_selection.item_array`);
  const poLineItems = this.getValue("table_po");
  const itemArray = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  for (const item of currentItemArray) {
    const poItem = {
      item_id: item.id,
      item_name: item.material_name,
      item_desc: item.material_desc,
      unit_price: item.purchase_unit_price || 0,
      item_category_id: item.item_category,
      tax_preference: item.mat_purchase_tax_id || null,
      tax_percent: item.purchase_tax_percent || null,
      quantity_uom: item.purchase_default_uom || item.based_uom,
    };

    itemArray.push(poItem);
  }

  await this.setData({
    table_po: [...poLineItems, ...itemArray],
    [`dialog_item_selection.item_array`]: [],
    [`dialog_item_selection.item_code_array`]: "",
    [`dialog_item_selection.item_code`]: "",
  });

  this.closeDialog("dialog_item_selection");

  setTimeout(async () => {
    for (const [index, item] of currentItemArray.entries()) {
      const newIndex = poLineItems.length + index;
      const altUoms = item.table_uom_conversion?.map((data) => data.alt_uom_id);
      let uomOptions = [];

      const res = await fetchUomData(altUoms);
      uomOptions.push(...res);

      await this.setOptionData(
        [`table_po.${newIndex}.quantity_uom`],
        uomOptions
      );

      console.log("uomOptions", uomOptions);
      this.setData({
        [`table_po.${newIndex}.table_uom_conversion`]:
          JSON.stringify(uomOptions),
        [`table_po.${newIndex}.alt_uom`]: JSON.stringify(
          item.table_uom_conversion
        ),
      });

      this.disabled([`table_po.${newIndex}.quantity_uom`], false);

      if (item.mat_purchase_tax_id) {
        this.disabled([`table_po.${newIndex}.tax_percent`], false);
      }
    }
  }, 50);
})();
