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

    const tableSourceHU = dialogData.table_source_hu || [];
    const selected = tableSourceHU.find((r) => r.select_hu === 1);

    if (!selected) {
      this.$message.error("Please select a handling unit");
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

    const tableRepack = this.getValue("table_repack") || [];
    const currentRow = tableRepack[rowIndex] || {};
    let oldSourceId = null;
    if (currentRow.source_temp_data) {
      try {
        const parsed = JSON.parse(currentRow.source_temp_data);
        oldSourceId = parsed?.id || null;
      } catch (e) {
        console.error("Error parsing source_temp_data:", e);
      }
    }
    const huChanged = oldSourceId && oldSourceId !== selected.id;

    const updates = {
      [`table_repack.${rowIndex}.source_temp_data`]: JSON.stringify(snapshot),
      [`table_repack.${rowIndex}.handling_unit_id`]: snapshot.id,
      [`table_repack.${rowIndex}.total_hu_item_quantity`]: snapshot.total_quantity,
      [`table_repack.${rowIndex}.hu_storage_location`]: snapshot.storage_location_id,
      [`table_repack.${rowIndex}.hu_location`]: snapshot.location_id,
    };

    if (huChanged) {
      updates[`table_repack.${rowIndex}.items_temp_data`] = "";
      updates[`table_repack.${rowIndex}.item_details`] = "";
      updates[`table_repack.${rowIndex}.target_temp_data`] = "";
      updates[`table_repack.${rowIndex}.target_hu_id`] = "";
      updates[`table_repack.${rowIndex}.target_hu_location`] = "";
    }

    await this.setData(updates);

    await this.closeDialog("dialog_repack");
  } catch (error) {
    this.$message.error("Error in ROconfirmSourceHU: " + error.message);
    console.error("Error in ROconfirmSourceHU:", error);
  }
})();
