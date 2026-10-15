(async () => {
  const rowIndex = arguments[0].rowIndex;

  const itemId = this.getValue(`table_po.${rowIndex}.item_id`);

  if (arguments[0].value !== "" && !itemId) {
    const resUOM = await db.collection("unit_of_measurement").get();

    if (resUOM && resUOM.data.length > 0) {
      const uomData = resUOM.data;

      this.disabled([`table_po.${rowIndex}.quantity_uom`], false);

      this.setOptionData([`table_po.${rowIndex}.quantity_uom`], uomData);

      this.setData({
        [`table_po.${rowIndex}.table_uom_conversion`]: uomData,
      });
    }
  } else if (arguments[0].value === "" && !itemId) {
    this.disabled([`table_po.${rowIndex}.quantity_uom`], true);
  }
})();
