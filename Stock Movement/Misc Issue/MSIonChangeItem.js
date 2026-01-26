const handleUOM = async (itemData, rowIndex) => {
  const altUoms = itemData.table_uom_conversion.map((data) => data.alt_uom_id);

  const uomPromises = altUoms.map((uomId) =>
    db.collection("unit_of_measurement").where({ id: uomId }).get(),
  );
  const uomResults = await Promise.all(uomPromises);
  const uomOptions = uomResults.map((res) => res.data[0]).filter(Boolean);

  this.setOptionData([`stock_movement.${rowIndex}.quantity_uom`], uomOptions);

  this.setData({
    [`stock_movement.${rowIndex}.uom_options`]: uomOptions,
  });
};

(async () => {
  const rowIndex = arguments[0].rowIndex;

  if (arguments[0].value) {
    const itemData = arguments[0]?.fieldModel?.item;

    if (itemData) {
      await handleUOM(itemData, rowIndex);

      this.setData({
        [`stock_movement.${rowIndex}.stock_summary`]: "",
        [`stock_movement.${rowIndex}.item_name`]: itemData.material_name,
        [`stock_movement.${rowIndex}.item_desc`]: itemData.material_desc,
        [`stock_movement.${rowIndex}.quantity_uom`]: itemData.based_uom,
        [`stock_movement.${rowIndex}.unit_price`]: itemData.purchase_unit_price,
      });
    } else {
      const tableSM = this.getValue("stock_movement");
      for (const [idx, sm] of tableSM.entries()) {
        this.setOptionData(
          [`stock_movement.${idx}.quantity_uom`],
          sm.uom_options,
        );
      }
    }
  } else {
    this.setData({
      [`stock_movement.${rowIndex}.requested_qty`]: 0,
      [`stock_movement.${rowIndex}.total_quantity`]: 0,
      [`stock_movement.${rowIndex}.quantity_uom`]: "",
      [`stock_movement.${rowIndex}.stock_summary`]: "",
      [`stock_movement.${rowIndex}.balance_id`]: "",
      [`stock_movement.${rowIndex}.temp_qty_data`]: "",
      [`stock_movement.${rowIndex}.item_name`]: "",
      [`stock_movement.${rowIndex}.item_desc`]: "",
    });
  }
})();
