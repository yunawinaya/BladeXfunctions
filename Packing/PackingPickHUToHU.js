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
    const rowIndex = arguments[0] && arguments[0].index;
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

    const childItems = huSource.filter(
      (r) => r.row_type === "item" && r.handling_unit_id === sourceHuId,
    );

    const tempDataEntries = childItems.map((child, idx) => ({
      line_index: idx,
      line_item_id: child.id,
      balance_id: child.balance_id,
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
    const totalQty = tempDataEntries.reduce((s, e) => s + e.total_quantity, 0);

    const tableHu = data.table_hu || [];
    const newRow = {
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
    };

    const updates = {
      [`table_hu.${tableHu.length}`]: newRow,
      [`table_hu_source.${rowIndex}.hu_status`]: "Picked",
    };
    for (let i = 0; i < huSource.length; i++) {
      const r = huSource[i];
      if (r.row_type === "item" && r.handling_unit_id === sourceHuId) {
        updates[`table_hu_source.${i}.hu_status`] = "Picked";
      }
    }
    await this.setData(updates);

    this.$message.success(
      `HU ${headerRow.handling_no || sourceHuId} added as locked row.`,
    );
  } catch (error) {
    console.error("PackingPickHUToHU error:", error);
    this.$message.error(error.message || String(error));
  }
})();
