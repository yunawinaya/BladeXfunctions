// View Detail button on a table_hu row.
// Opens dialog_detail_hu and populates table_view_items from the clicked
// target HU's temp_data (JSON string of picked/packed items).
// Paste into a new handler slot (e.g. "PackingViewDetailHU") and wire to the
// view_detail_button's onClick event (key 1swftjn4).
//
// Read-only dialog — no unpack actions in v1.

(async () => {
  try {
    const huRow = arguments[0] && arguments[0].row;
    if (!huRow) {
      this.$message.warning("Row not found.");
      return;
    }

    const entries = JSON.parse(huRow.temp_data || "[]");

    // Map temp_data entries to table_view_items row shape. Flatten nested_hu
    // entries so all items (direct + nested children) show as rows; prefix
    // item_name with "via HU-<handling_no>" for children so users can see
    // which HU each row belongs to.
    const viewItems = [];
    let seq = 0;
    const pushItem = (entry, fromHu) => {
      viewItems.push({
        line_index: seq++,
        line_item_id: entry.line_item_id || "",
        balance_id: entry.balance_id || "",
        item_code: entry.item_code || "",
        item_name: fromHu
          ? `${entry.item_name || ""} (via HU ${fromHu})`
          : entry.item_name || "",
        item_desc: entry.item_desc || "",
        item_uom: entry.item_uom || "",
        batch_no: entry.batch_no || "",
        source_bin_id: entry.bin_location || entry.source_bin_id || "",
        total_quantity: Number(entry.total_quantity) || 0,
        packed_qty: Number(entry.total_quantity) || 0,
      });
    };

    for (const entry of entries) {
      if (entry.type === "nested_hu") {
        const fromHu = entry.handling_no || entry.nested_hu_id || "nested";
        for (const c of entry.children || []) {
          pushItem(c, fromHu);
        }
      } else {
        pushItem(entry, null);
      }
    }

    await this.setData({
      "dialog_detail_hu.table_view_items": viewItems,
      "dialog_detail_hu.handling_no": huRow.handling_no || "",
      "dialog_detail_hu.hu_material_id": huRow.hu_material_id || "",
      "dialog_detail_hu.hu_type": huRow.hu_type || "",
      "dialog_detail_hu.hu_uom": huRow.hu_uom || "",
    });

    await this.openDialog("dialog_detail_hu");
  } catch (error) {
    console.error("PackingViewDetailHU error:", error);
    this.$message.error(error.message || String(error));
  }
})();
