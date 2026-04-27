// Flow B: Pick an existing HU (header) from table_hu_source into table_hu
// as a Locked row (all fields disabled).
// Paste into the `onTableHuSourcefunc` handler slot (key jn616df5).
//
// Assumptions about table_hu_source shape (follows the Picking module pattern):
//   - Flat list; rows have row_type === "header" or "item".
//   - Item rows are linked to their header via handling_unit_id.
//   - Header rows carry HU-level fields (handling_no, hu_material_id, hu_type,
//     hu_uom, weights, volume, storage_location).
//   - Item rows carry item-level fields (item_id, item_code, batch_no,
//     source_bin_id, total_quantity, so/gd/to doc refs).
//
// Behavior:
//   - Clicked row must be a header; otherwise warn.
//   - Header must not already be picked (hu_status !== "Picked").
//   - Append a new Locked row to table_hu with source_hu_id for unpack lookup.
//   - Serialize all matching item rows into the new row's temp_data.
//   - Flip hu_status on header + its items to "Picked".

(async () => {
  try {
    const headerRow = arguments[0] && arguments[0].row;
    if (!headerRow) {
      this.$message.warning("Source row not found.");
      return;
    }
    const data = this.getValues();
    const huSource = data.table_hu_source || [];
    if (headerRow.row_type !== "header") {
      this.$message.warning("Please click Pick to HU on an HU header row.");
      return;
    }
    if (headerRow.hu_status === "Picked") {
      this.$message.warning("This HU has already been picked.");
      return;
    }

    const sourceHuId = headerRow.handling_unit_id;
    if (!sourceHuId) {
      this.$message.warning(
        "Source HU is missing handling_unit_id; cannot pick.",
      );
      return;
    }

    // Fetch HU master — table_hu_source headers don't carry the HU's display
    // fields (handling_no, hu_material_id, hu_type, hu_uom, weights, volume).
    const huRes = await db
      .collection("handling_unit")
      .where({ id: sourceHuId })
      .get();
    const huMaster = (huRes && huRes.data && huRes.data[0]) || {};

    const childItems = huSource.filter(
      (r) => r.row_type === "item" && r.handling_unit_id === sourceHuId,
    );

    const tempDataEntries = childItems.map((child, idx) => ({
      line_index: idx,
      line_item_id: child.id,
      balance_id: child.balance_id,
      // Form schema for table_hu_source doesn't declare item_id, so it gets
      // stripped on load. Use item_code (which IS in the schema) — matches
      // what PackingPickItemToHU does for the same reason.
      item_id: child.item_code,
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
    const totalQty = tempDataEntries.reduce((s, e) => s + e.total_quantity, 0);

    const tableHu = data.table_hu || [];
    const newRow = {
      hu_row_type: "locked",
      source_hu_id: sourceHuId,
      handling_unit_id: sourceHuId,
      handling_no: huMaster.handling_no || "",
      hu_material_id: huMaster.hu_material_id || "",
      hu_type: huMaster.hu_type || "",
      hu_uom: huMaster.hu_uom || "",
      storage_location_id:
        huMaster.storage_location_id || headerRow.storage_location || "",
      location_id: huMaster.location_id || "",
      gross_weight: huMaster.gross_weight || 0,
      net_weight: huMaster.net_weight || 0,
      net_volume: huMaster.net_volume || 0,
      hu_status: "Packed",
      temp_data: JSON.stringify(tempDataEntries),
      item_count: distinctItemIds.size,
      total_quantity: totalQty,
    };

    const newTableHu = [...tableHu, newRow];
    const newHuSource = huSource.map((r) =>
      r.row_type && r.handling_unit_id === sourceHuId
        ? { ...r, hu_status: "Picked" }
        : r,
    );

    await this.setData({
      table_hu: newTableHu,
      table_hu_source: newHuSource,
    });

    this.$message.success(
      `HU ${huMaster.handling_no || sourceHuId} added as locked row.`,
    );
  } catch (error) {
    console.error("PackingPickHUToHU error:", error);
    this.$message.error(error.message || String(error));
  }
})();
