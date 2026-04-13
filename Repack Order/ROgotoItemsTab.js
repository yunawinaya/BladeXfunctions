const selectTab = (tabName) => {
  setTimeout(() => {
    const tabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-${tabName}`;
    const tab = document.querySelector(tabSelector);
    if (tab) {
      tab.style.display = "flex";
      tab.setAttribute("aria-selected", "true");
      tab.setAttribute("aria-disabled", "false");
      tab.setAttribute("tabindex", "0");
      tab.classList.remove("is-disabled");
      tab.classList.add("is-active");
      tab.click();
    } else {
      console.log(`Tab ${tabName} not found`);
    }
  }, 100);
};

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

    const tableItems = activeHuItems.map((it, index) => ({
      material_id: it.material_id,
      material_name: it.material_name,
      material_desc: it.material_desc,
      location_id: it.location_id || selected.location_id,
      batch_id: it.batch_id || null,
      material_uom: it.material_uom,
      item_quantity: parseFloat(it.quantity) || 0,
      unload_quantity: 0,
      line_status: "Open",
      line_index: index,
      balance_id: it.balance_id || "",
    }));

    await this.setData({
      [`table_repack.${rowIndex}.source_temp_data`]: JSON.stringify(snapshot),
      [`table_repack.${rowIndex}.handling_unit_id`]: snapshot.id,
      [`table_repack.${rowIndex}.total_hu_item_quantity`]: snapshot.total_quantity,
      [`table_repack.${rowIndex}.hu_storage_location`]: snapshot.storage_location_id,
      [`table_repack.${rowIndex}.hu_location`]: snapshot.location_id,
      "dialog_repack.table_items": tableItems,
    });

    selectTab("tab_items");
  } catch (error) {
    this.$message.error("Error in ROgotoItemsTab: " + error.message);
    console.error("Error in ROgotoItemsTab:", error);
  }
})();
