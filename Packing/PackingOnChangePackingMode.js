(async () => {
  try {
    const packingMode = arguments[0].value;

    console.log("Packing mode:", packingMode);

    if (packingMode === "Basic") {
      await this.display(["table_hu.hu_quantity"]);
      await this.hide([
        "table_hu.select_items",
        "table_hu.item_count",
        "table_hu.total_quantity",
      ]);
    } else {
      await this.hide(["table_hu.hu_quantity"]);
      await this.display([
        "table_hu.select_items",
        "table_hu.item_count",
        "table_hu.total_quantity",
      ]);
      await this.setData({
        "table_hu.hu_quantity": 0,
        "table_hu.hu_status": "Unpacked",
      });
    }
  } catch (error) {
    this.$message.error(
      "Error in PackingOnChangePackingMode: " + error.message
    );
    console.error("Error in PackingOnChangePackingMode:", error);
  }
})();
