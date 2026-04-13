(async () => {
  try {
    const rawValue = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    const tableItems = this.getValue("dialog_repack.table_items") || [];
    const row = tableItems[rowIndex];
    if (!row) return;

    const itemQuantity = parseFloat(row.item_quantity) || 0;
    const value = parseFloat(rawValue);

    if (Number.isNaN(value)) {
      await this.setData({
        [`dialog_repack.table_items.${rowIndex}.unload_quantity`]: 0,
      });
      return;
    }

    if (value < 0) {
      await this.setData({
        [`dialog_repack.table_items.${rowIndex}.unload_quantity`]: 0,
      });
      this.$message.warning("Quantity cannot be negative");
      return;
    }

    if (value > itemQuantity) {
      await this.setData({
        [`dialog_repack.table_items.${rowIndex}.unload_quantity`]: itemQuantity,
      });
      this.$message.warning(
        `Quantity cannot exceed available ${itemQuantity}`,
      );
    }
  } catch (error) {
    this.$message.error("Error in ROonChangeUnloadQty: " + error.message);
    console.error("Error in ROonChangeUnloadQty:", error);
  }
})();
