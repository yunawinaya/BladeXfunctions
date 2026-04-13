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

    const tableTargetHU = dialogData.table_target_hu || [];
    const selected = tableTargetHU.find((r) => r.select_hu === 1);

    if (!selected) {
      this.$message.error("Please select a target handling unit");
      return;
    }

    if (!selected.hu_material_id) {
      this.$message.error("Selected handling unit is missing handling unit material");
      return;
    }

    if (!selected.location_id) {
      this.$message.error("Selected handling unit is missing location");
      return;
    }

    const activeHuItems = (selected.table_hu_items || []).filter(
      (it) => it.is_deleted !== 1,
    );

    const snapshot = {
      id: selected.id,
      handling_no: selected.handling_no,
      hu_material_id: selected.hu_material_id,
      hu_type: selected.hu_type,
      hu_quantity: selected.hu_quantity,
      hu_uom: selected.hu_uom,
      item_count: selected.item_count,
      total_quantity: selected.total_quantity,
      gross_weight: selected.gross_weight,
      net_weight: selected.net_weight,
      net_volume: selected.net_volume,
      storage_location_id: selected.storage_location_id,
      location_id: selected.location_id,
      hu_status: selected.hu_status,
      parent_hu_id: selected.parent_hu_id,
      packing_id: selected.packing_id,
      table_hu_items: activeHuItems,
    };

    await this.setData({
      [`table_repack.${rowIndex}.target_temp_data`]: JSON.stringify(snapshot),
      [`table_repack.${rowIndex}.target_hu_id`]: snapshot.id,
      [`table_repack.${rowIndex}.target_hu_no`]: snapshot.handling_no,
      [`table_repack.${rowIndex}.target_hu_location`]: snapshot.location_id,
    });

    await this.closeDialog("dialog_repack");
  } catch (error) {
    this.$message.error("Error in ROconfirmTargetHU: " + error.message);
    console.error("Error in ROconfirmTargetHU:", error);
  }
})();
