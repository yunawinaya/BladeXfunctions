// Flow A: Pick to HU from table_item_source.
// Paste into the `onTableItemSourcefunc` handler slot (key wj4ch5p1).
//
// Preconditions (soft — toast + no-op if violated):
//   1. Exactly one target HU row in table_hu must be selected
//      (selected_hu_index >= 0).
//   2. The selected target must be hu_row_type === "generated".
//   3. Source row's qty_to_pick must be > 0 and <= remaining_qty.
//
// Effect:
//   - Append one entry to the selected target HU's temp_data.
//   - Recompute target HU's item_count / total_quantity.
//   - Trigger PackingRecomputeSource to update all source rows.

(async () => {
  try {
    const sourceRow = arguments[0] && arguments[0].row;
    if (!sourceRow) {
      this.$message.warning("Source row not found.");
      return;
    }
    const data = this.getValues();

    const selectedHuIndex = Number(data.selected_hu_index);
    if (!Number.isFinite(selectedHuIndex) || selectedHuIndex < 0) {
      this.$message.warning(
        "Please select a target HU in the packing table first.",
      );
      return;
    }

    const targetHu = (data.table_hu || [])[selectedHuIndex];
    if (!targetHu) {
      this.$message.warning("Selected target HU no longer exists.");
      return;
    }
    if (targetHu.hu_row_type !== "generated") {
      this.$message.warning(
        "Cannot pick into a locked HU. Select a generated HU or add a new one.",
      );
      return;
    }

    if (!sourceRow.id) {
      this.$message.error(
        "Source row is missing a stable `id`. The data loader must assign one — picked entries can't be attributed back to the source without it.",
      );
      return;
    }

    const qtyToPick = Number(sourceRow.qty_to_pick) || 0;
    const remaining = Number(sourceRow.remaining_qty) || 0;
    if (qtyToPick <= 0) {
      this.$message.warning("Quantity to pick must be greater than zero.");
      return;
    }
    if (qtyToPick > remaining) {
      this.$message.warning(
        `Quantity (${qtyToPick}) exceeds remaining (${remaining}).`,
      );
      return;
    }

    const existing = JSON.parse(targetHu.temp_data || "[]");
    const entry = {
      line_index: existing.length,
      line_item_id: sourceRow.id,
      balance_id: sourceRow.balance_id,
      item_id: sourceRow.item_id,
      item_code: sourceRow.item_code,
      item_name: sourceRow.item_name,
      item_desc: sourceRow.item_desc,
      item_uom: sourceRow.item_uom,
      batch_no: sourceRow.batch_no,
      bin_location: sourceRow.bin_location,
      total_quantity: qtyToPick,
      so_id: sourceRow.so_id,
      so_no: sourceRow.so_no,
      so_line_id: sourceRow.so_line_id,
      gd_id: sourceRow.gd_id,
      gd_no: sourceRow.gd_no,
      gd_line_id: sourceRow.gd_line_id,
      to_id: sourceRow.to_id,
      to_no: sourceRow.to_no,
      to_line_id: sourceRow.to_line_id,
    };
    existing.push(entry);

    const distinctItemIds = new Set(existing.map((e) => e.item_id));
    const totalQty = existing.reduce(
      (s, e) => s + (Number(e.total_quantity) || 0),
      0,
    );

    await this.setData({
      [`table_hu.${selectedHuIndex}.temp_data`]: JSON.stringify(existing),
      [`table_hu.${selectedHuIndex}.item_count`]: distinctItemIds.size,
      [`table_hu.${selectedHuIndex}.total_quantity`]: totalQty,
      [`table_hu.${selectedHuIndex}.hu_status`]: "Packed",
    });

    await this.triggerEvent("PackingRecomputeSource");

    this.$message.success(
      `Picked ${qtyToPick} ${sourceRow.item_code || ""} to HU ${targetHu.handling_no || selectedHuIndex + 1}.`,
    );
  } catch (error) {
    console.error("PackingPickItemToHU error:", error);
    this.$message.error(error.message || String(error));
  }
})();
