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
    const rowIndex = arguments[0].rowIndex;
    const data = this.getValues();
    const tableHu = data.table_hu || [];
    const removedRow = tableHu[rowIndex];

    if (!removedRow) {
      this.$message.warning("Row not found.");
      return;
    }

    const updates = {};

    if (removedRow.hu_row_type === "locked") {
      const sourceHuId = removedRow.source_hu_id;
      if (sourceHuId) {
        const huSource = data.table_hu_source || [];
        for (let i = 0; i < huSource.length; i++) {
          const r = huSource[i];
          if (
            r.handling_unit_id === sourceHuId &&
            (r.row_type === "header" || r.row_type === "item")
          ) {
            updates[`table_hu_source.${i}.hu_status`] = "Unpacked";
          }
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
