// Bulk Pick HUs from table_hu_source.
// Processes all HEADER rows with hu_select === 1 that aren't already Picked,
// adding each as a new Locked row in table_hu.
// Paste into a new handler slot (e.g. "PackingBulkPickHUs") and wire to a
// toolbar button "Pick Selected HUs" above or near table_hu_source.

(async () => {
  try {
    const data = this.getValues();
    const huSource = data.table_hu_source || [];
    const selectedHeaders = huSource.filter(
      (r) =>
        r.row_type === "header" &&
        (r.hu_select === 1 || r.hu_select === true) &&
        r.hu_status !== "Picked",
    );

    if (selectedHeaders.length === 0) {
      this.$message.warning(
        "No HU headers selected (or all already picked).",
      );
      return;
    }

    const tableHu = data.table_hu || [];
    const newRows = [];
    const pickedHuIds = new Set();
    const skipped = [];

    for (const headerRow of selectedHeaders) {
      const sourceHuId = headerRow.handling_unit_id;
      if (!sourceHuId) {
        skipped.push(headerRow.handling_no || "(no handling_no)");
        continue;
      }

      const childItems = huSource.filter(
        (r) => r.row_type === "item" && r.handling_unit_id === sourceHuId,
      );

      const tempDataEntries = childItems.map((child, idx) => ({
        line_index: idx,
        line_item_id: child.id,
        item_id: child.item_id,
        item_code: child.item_code,
        item_name: child.item_name,
        item_desc: child.item_desc,
        item_uom: child.item_uom,
        batch_no: child.batch_no,
        bin_location: child.bin_location,
        total_quantity: Number(child.total_quantity) || 0,
        so_id: child.so_id,
        so_no: child.so_no,
        so_line_id: child.so_line_id,
        gd_id: child.gd_id,
        gd_no: child.gd_no,
        gd_line_id: child.gd_line_id,
        to_id: child.to_id,
        to_no: child.to_no,
        to_line_id: child.to_line_id,
      }));

      const distinctItemIds = new Set(
        tempDataEntries.map((e) => e.item_id).filter(Boolean),
      );
      const totalQty = tempDataEntries.reduce(
        (s, e) => s + e.total_quantity,
        0,
      );

      newRows.push({
        hu_row_type: "locked",
        source_hu_id: sourceHuId,
        handling_unit_id: headerRow.handling_unit_id,
        handling_no: headerRow.handling_no,
        hu_material_id: headerRow.hu_material_id,
        hu_type: headerRow.hu_type,
        hu_uom: headerRow.hu_uom,
        storage_location: headerRow.storage_location,
        target_location: headerRow.target_location,
        gross_weight: headerRow.gross_weight,
        net_weight: headerRow.net_weight,
        net_volume: headerRow.net_volume,
        hu_status: "Packed",
        temp_data: JSON.stringify(tempDataEntries),
        item_count: distinctItemIds.size,
        total_quantity: totalQty,
      });
      pickedHuIds.add(sourceHuId);
    }

    if (newRows.length === 0) {
      this.$message.warning(
        `No valid HUs picked (${skipped.length} skipped).`,
      );
      return;
    }

    const newTableHu = [...tableHu, ...newRows];
    const newHuSource = huSource.map((r) =>
      pickedHuIds.has(r.handling_unit_id)
        ? { ...r, hu_status: "Picked", hu_select: 0 }
        : r,
    );

    await this.setData({
      table_hu: newTableHu,
      table_hu_source: newHuSource,
    });

    const msg =
      skipped.length > 0
        ? `Picked ${newRows.length} HUs, skipped ${skipped.length}.`
        : `Picked ${newRows.length} HU(s) as locked rows.`;
    this.$message.success(msg);
  } catch (error) {
    console.error("PackingBulkPickHUs error:", error);
    this.$message.error(error.message || String(error));
  }
})();
