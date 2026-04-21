// Bulk Pick to HU from table_item_source.
// Processes all rows with select_item === 1, picking each row's qty_to_pick
// into the currently-selected target HU's temp_data.
// Paste into a new handler slot (e.g. "PackingBulkPickItems") and wire to a
// toolbar button "Pick Selected to HU" above or near table_item_source.

(async () => {
  try {
    const data = this.getValues();
    const itemSource = data.table_item_source || [];
    const selected = itemSource.filter(
      (r) => r.select_item === 1 || r.select_item === true,
    );

    if (selected.length === 0) {
      this.$message.warning("No items selected.");
      return;
    }

    const selectedHuIndex = Number(data.selected_hu_index);
    if (!Number.isFinite(selectedHuIndex) || selectedHuIndex < 0) {
      this.$message.warning(
        "Please select a target HU in the packing table first.",
      );
      return;
    }

    const tableHu = data.table_hu || [];
    const targetHu = tableHu[selectedHuIndex];
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

    const existing = JSON.parse(targetHu.temp_data || "[]");
    const pickedIds = new Set();
    const skipped = [];

    for (const sourceRow of selected) {
      if (!sourceRow.id) {
        skipped.push({ code: sourceRow.item_code, reason: "no id" });
        continue;
      }
      const qtyToPick = Number(sourceRow.qty_to_pick) || 0;
      const remaining = Number(sourceRow.remaining_qty) || 0;
      if (qtyToPick <= 0) {
        skipped.push({ code: sourceRow.item_code, reason: "qty 0" });
        continue;
      }
      if (qtyToPick > remaining) {
        skipped.push({
          code: sourceRow.item_code,
          reason: `qty ${qtyToPick} > remaining ${remaining}`,
        });
        continue;
      }

      existing.push({
        line_index: existing.length,
        line_item_id: sourceRow.id,
        item_id: sourceRow.item_code,
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
        to_line_id: sourceRow.to_line_id,
      });
      pickedIds.add(sourceRow.id);
    }

    if (pickedIds.size === 0) {
      this.$message.warning(`No valid rows picked (${skipped.length} skipped).`);
      return;
    }

    const distinctItemIds = new Set(existing.map((e) => e.item_id));
    const totalQty = existing.reduce(
      (s, e) => s + (Number(e.total_quantity) || 0),
      0,
    );

    const newItemSource = itemSource.map((r) =>
      pickedIds.has(r.id) ? { ...r, select_item: 0 } : r,
    );

    await this.setData({
      [`table_hu.${selectedHuIndex}.temp_data`]: JSON.stringify(existing),
      [`table_hu.${selectedHuIndex}.item_count`]: distinctItemIds.size,
      [`table_hu.${selectedHuIndex}.total_quantity`]: totalQty,
      [`table_hu.${selectedHuIndex}.hu_status`]: "Packed",
      table_item_source: newItemSource,
    });

    await this.triggerEvent("PackingRecomputeSource");

    const msg =
      skipped.length > 0
        ? `Picked ${pickedIds.size}, skipped ${skipped.length}.`
        : `Picked ${pickedIds.size} item(s) to HU ${targetHu.handling_no || selectedHuIndex + 1}.`;
    this.$message.success(msg);
  } catch (error) {
    console.error("PackingBulkPickItems error:", error);
    this.$message.error(error.message || String(error));
  }
})();
