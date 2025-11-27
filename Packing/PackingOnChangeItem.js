(async () => {
  try {
    const value = arguments[0]?.value || "";
    const fieldModel = arguments[0]?.fieldModel || {};
    const rowIndex = arguments[0]?.rowIndex || 0;
    const { based_uom, item_properties } = fieldModel.item || {};

    if (value && value !== "") {
      await this.setData({
        [`table_hu.${rowIndex}.hu_type`]: item_properties,
        [`table_hu.${rowIndex}.based_uom`]: based_uom,
      });
    } else {
      await this.setData({
        [`table_hu.${rowIndex}.hu_type`]: "",
        [`table_hu.${rowIndex}.based_uom`]: "",
      });
    }
  } catch (error) {
    this.$message.error(error);
    console.log(error);
  }
})();
