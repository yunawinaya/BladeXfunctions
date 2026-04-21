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

    // Re-fetch the selected HU records to get their table_hu_items (pre-existing
    // contents). The dialog only carried display fields; items live on the record.
    const huIds = selected.map((r) => r.handling_unit_id).filter(Boolean);
    const huFilter = new Filter().in("id", huIds).build();
    const huRes = await db
      .collection("handling_unit")
      .filter(huFilter)
      .get();
    const huById = {};
    for (const hu of (huRes && huRes.data) || []) huById[hu.id] = hu;

    // Collect distinct material_ids across all pre-existing items for one batch
    // Item-master lookup (so temp_data entries carry item_code/name/desc/uom).
    const materialIdSet = {};
    for (const hu of Object.values(huById)) {
      const items = hu.table_hu_items || [];
      for (const it of items) {
        if (!it.is_deleted && it.material_id) materialIdSet[it.material_id] = true;
      }
    }
    const materialIds = Object.keys(materialIdSet);
    let itemById = {};
    if (materialIds.length > 0) {
      const itemFilter = new Filter().in("id", materialIds).build();
      const itemRes = await db.collection("Item").filter(itemFilter).get();
      for (const it of (itemRes && itemRes.data) || []) itemById[it.id] = it;
    }

    const tableHu = data.table_hu || [];
    const newRows = selected.map((dialogRow) => {
      const hu = huById[dialogRow.handling_unit_id] || {};
      const huItems = (hu.table_hu_items || []).filter((i) => !i.is_deleted);

      // Pre-existing temp_data entries, tagged is_preexisting so the save
      // workflow can skip them from the "load" HU update later.
      const preexistingEntries = huItems.map((it, idx) => {
        const master = itemById[it.material_id] || {};
        const qty =
          Number(it.store_in_quantity) || Number(it.quantity) || 0;
        return {
          is_preexisting: true,
          line_index: idx,
          line_item_id: "",
          balance_id: it.balance_id || "",
          item_id: it.material_id,
          item_code: it.material_id,
          item_name: master.material_name || "",
          item_desc: master.material_desc || "",
          item_uom: master.based_uom || "",
          batch_no: it.batch_id || "",
          bin_location: "",
          total_quantity: qty,
        };
      });

      const totalPreQty = preexistingEntries.reduce(
        (s, e) => s + (Number(e.total_quantity) || 0),
        0,
      );
      const distinctItemIds = new Set(
        preexistingEntries.map((e) => e.item_id).filter(Boolean),
      );

      return {
        hu_row_type: "locked",
        source_hu_id: dialogRow.handling_unit_id,
        handling_unit_id: dialogRow.handling_unit_id,
        handling_no: dialogRow.handling_no || "",
        hu_material_id: dialogRow.hu_material_id || "",
        hu_type: dialogRow.hu_type || "",
        hu_uom: dialogRow.hu_uom || "",
        storage_location: dialogRow.storage_location || "",
        location_id: dialogRow.location_id || "",
        gross_weight: dialogRow.gross_weight || 0,
        net_weight: dialogRow.net_weight || 0,
        net_volume: dialogRow.net_volume || 0,
        hu_status: preexistingEntries.length > 0 ? "Packed" : "Unpacked",
        temp_data: JSON.stringify(preexistingEntries),
        item_count: distinctItemIds.size,
        total_quantity: totalPreQty,
      };
    });

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
