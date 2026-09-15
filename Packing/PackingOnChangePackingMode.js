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
      // Per row, not the whole column. A Completed row must never be reopened
      // (the save would re-load its items into the HU and double them), and a
      // row holding picked items keeps its status so it is not offered for
      // delete while it still has contents.
      const tableHu = this.getValue("table_hu") || [];
      const resetUpdates = {};
      for (let i = 0; i < tableHu.length; i++) {
        const r = tableHu[i];
        if (r.hu_status === "Completed") continue;
        resetUpdates[`table_hu.${i}.hu_quantity`] = 0;
        if (!r.temp_data || r.temp_data === "[]") {
          resetUpdates[`table_hu.${i}.hu_status`] = "Unpacked";
        }
      }
      if (Object.keys(resetUpdates).length > 0) {
        await this.setData(resetUpdates);
      }
    }
  } catch (error) {
    this.$message.error(
      "Error in PackingOnChangePackingMode: " + error.message
    );
    console.error("Error in PackingOnChangePackingMode:", error);
  }
})();
