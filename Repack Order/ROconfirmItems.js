(async () => {
  try {
    const dialogData = this.getValue("dialog_repack");
    if (!dialogData) {
      throw new Error("Dialog data not available");
    }

    const rowIndex = dialogData.row_index;
    if (typeof rowIndex !== "number") {
      throw new Error("Row index missing on dialog");
    }

    const tableItems = dialogData.table_items || [];
    const selectedItems = tableItems.filter(
      (it) => (parseFloat(it.unload_quantity) || 0) > 0,
    );

    if (selectedItems.length === 0) {
      this.$message.error("Please enter quantity for at least one item");
      return;
    }

    const itemsSnapshot = selectedItems.map((it) => ({
      material_id: it.material_id,
      material_name: it.material_name,
      material_desc: it.material_desc,
      location_id: it.location_id,
      batch_id: it.batch_id || null,
      material_uom: it.material_uom,
      item_quantity: parseFloat(it.item_quantity) || 0,
      unload_quantity: parseFloat(it.unload_quantity) || 0,
      balance_id: it.balance_id || "",
      line_status: it.line_status || "Open",
    }));

    await this.setData({
      [`table_repack.${rowIndex}.items_temp_data`]: JSON.stringify(itemsSnapshot),
    });

    await this.closeDialog("dialog_repack");
  } catch (error) {
    this.$message.error("Error in ROconfirmItems: " + error.message);
    console.error("Error in ROconfirmItems:", error);
  }
})();
