(async () => {
  try {
    const value = arguments[0]?.value || "";
    const fieldModel = arguments[0]?.fieldModel || {};
    const rowIndex = arguments[0]?.rowIndex || 0;
    const { based_uom, hu_type, item_properties, net_weight, gross_weight } = fieldModel.item || {};

    if (value && value !== "") {
      await this.setData({
        [`hu_dialog.table_hu.${rowIndex}.hu_type`]: hu_type.dict_key || item_properties,
        [`hu_dialog.table_hu.${rowIndex}.hu_uom`]: based_uom,
        [`hu_dialog.table_hu.${rowIndex}.net_weight`]: net_weight || 0,
        [`hu_dialog.table_hu.${rowIndex}.gross_weight`]: gross_weight || 0,
      });
    } else {
      await this.setData({
        [`hu_dialog.table_hu.${rowIndex}.hu_type`]: "",
        [`hu_dialog.table_hu.${rowIndex}.hu_uom`]: "",
        [`hu_dialog.table_hu.${rowIndex}.net_weight`]: 0,
        [`hu_dialog.table_hu.${rowIndex}.gross_weight`]: 0,
      });
    }
  } catch (error) {
    this.$message.error(error);
    console.log(error);
  }
})();
