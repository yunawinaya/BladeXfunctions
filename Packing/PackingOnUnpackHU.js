// Unpack action on a table_hu row (custom row-action button, NOT the platform's
// built-in row Delete). This handler must splice the row out itself.
// Paste into the `PackingOnUnpackHU` handler slot (key j6g72duk).
//
// Behavior by row kind:
//   Locked    → find source HU in table_hu_source by source_hu_id,
//               flip hu_status back to "Unpacked" on header + all item rows.
//   Generated → temp_data is dropped with the row; recompute catches up.
//
// After row removal:
//   - Fix selected_hu_index: -1 if we removed the selected row, or
//     shifted down by one if the deleted row was before the selected one.
//   - Fire PackingRecomputeSource so table_item_source projects cleanly.

(async () => {
  try {
    const rowIndex =
      arguments[0] && typeof arguments[0].index === "number"
        ? arguments[0].index
        : arguments[0] && arguments[0].rowIndex;
    const data = this.getValues();
    const tableHu = data.table_hu || [];
    const removedRow =
      (arguments[0] && arguments[0].row) ||
      tableHu[rowIndex];

    if (!removedRow || rowIndex === undefined || rowIndex === null) {
      this.$message.warning("Row not found.");
      return;
    }

    // Guard against accidental data loss when the HU contains items.
    const existingEntries = JSON.parse(removedRow.temp_data || "[]");
    if (existingEntries.length > 0) {
      try {
        await this.$confirm(
          `Unpack HU ${removedRow.handling_no || rowIndex + 1}? ${existingEntries.length} item(s) will be removed from this packing.`,
          "Confirm Unpack",
          {
            confirmButtonText: "Unpack",
            cancelButtonText: "Cancel",
            type: "warning",
          },
        );
      } catch {
        // User cancelled
        return;
      }
    }

    const updates = {};

    // Collect handling_unit_ids to revert to "Unpacked" in table_hu_source:
    //   - Locked row: the Locked row's source_hu_id (Flow B / Select Existing)
    //   - Nested HU entries in temp_data: each nested_hu_id (Pick to Parent HU)
    const sourceHuIdsToRevert = new Set();
    if (removedRow.hu_row_type === "locked" && removedRow.source_hu_id) {
      sourceHuIdsToRevert.add(removedRow.source_hu_id);
    }
    for (const entry of existingEntries) {
      if (entry.type === "nested_hu" && entry.nested_hu_id) {
        sourceHuIdsToRevert.add(entry.nested_hu_id);
      }
    }

    if (sourceHuIdsToRevert.size > 0) {
      const huSource = data.table_hu_source || [];
      for (let i = 0; i < huSource.length; i++) {
        const r = huSource[i];
        if (
          sourceHuIdsToRevert.has(r.handling_unit_id) &&
          (r.row_type === "header" || r.row_type === "item")
        ) {
          updates[`table_hu_source.${i}.hu_status`] = "Unpacked";
        }
      }
    }

    const newTableHu = tableHu.filter((_, i) => i !== rowIndex);
    updates.table_hu = newTableHu;

    const selectedHuIndex = Number(this.getValue("selected_hu_index"));
    if (selectedHuIndex === rowIndex) {
      updates.selected_hu_index = -1;
    } else if (selectedHuIndex > rowIndex) {
      updates.selected_hu_index = selectedHuIndex - 1;
    }

    await this.setData(updates);
    await this.triggerEvent("PackingRecomputeSource");

    this.$message.success(
      `HU ${removedRow.handling_no || rowIndex + 1} unpacked.`,
    );
  } catch (error) {
    console.error("PackingOnUnpackHU error:", error);
    this.$message.error(error.message || String(error));
  }
})();
