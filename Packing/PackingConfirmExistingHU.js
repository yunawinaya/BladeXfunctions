// Confirm handler for the hu_dialog ("Select Existing HU").
// Reads all checked rows from hu_dialog.table_select_hu and appends one Locked
// table_hu row per selected HU.
//
// Paste into a new handler slot (e.g. "PackingConfirmExistingHU") and wire
// to the dialog's Confirm button onClick.

(async () => {
  try {
    const data = this.getValues();
    const dialogRows =
      (data.hu_dialog && data.hu_dialog.table_select_hu) || [];

    const selected = dialogRows.filter(
      (r) => r.hu_select === 1 || r.hu_select === true,
    );

    if (selected.length === 0) {
      this.$message.warning("No HUs selected.");
      return;
    }

    const tableHu = data.table_hu || [];
    const newRows = selected.map((hu) => ({
      hu_row_type: "locked",
      source_hu_id: hu.handling_unit_id,
      handling_unit_id: hu.handling_unit_id,
      handling_no: hu.handling_no || "",
      hu_material_id: hu.hu_material_id || "",
      hu_type: hu.hu_type || "",
      hu_uom: hu.hu_uom || "",
      storage_location: hu.storage_location || "",
      target_location: "",
      gross_weight: hu.gross_weight || 0,
      net_weight: hu.net_weight || 0,
      net_volume: hu.net_volume || 0,
      hu_status: "Unpacked",
      temp_data: "[]",
      item_count: 0,
      total_quantity: 0,
    }));

    const newTableHu = [...tableHu, ...newRows];

    await this.setData({
      table_hu: newTableHu,
      "hu_dialog.table_select_hu": [],
    });
    await this.closeDialog("hu_dialog");

    this.$message.success(`${newRows.length} HU(s) added.`);
  } catch (error) {
    console.error("PackingConfirmExistingHU error:", error);
    this.$message.error(error.message || String(error));
  }
})();
