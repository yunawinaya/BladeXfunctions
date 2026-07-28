// Split rowAction on the receiving form's stock_movement table.
// Opens split_dialog for a fresh split, or confirm_split_dialog to redo an
// existing one. Flat mode only: the line is replaced by sibling Split-Parent
// rows, each of which the Complete path processes independently.
(async () => {
  try {
    const rowIndex = arguments[0].index;
    const smItem = this.getValues().stock_movement[rowIndex];

    if (!smItem) {
      return;
    }

    // A handling unit is one physical pallet and cannot land in two bins, so an
    // HU line is whole-only (the Complete path snaps a partial receive back up
    // to the full qty for exactly this reason). Unlike GR we never clear
    // temp_hu_data here: on the receiving document it describes stock that was
    // already sent, not a pending pick.
    let entries = [];
    try {
      entries = JSON.parse(smItem.temp_qty_data || "[]");
    } catch (e) {
      entries = [];
    }
    const hasHU =
      !!smItem.handling_unit_id ||
      (Array.isArray(entries) && entries.some((b) => b && b.handling_unit_id));

    if (hasHU) {
      this.$message.error(
        "Lines carrying a handling unit cannot be split. Receive the handling unit whole.",
      );
      return;
    }

    if (smItem.is_serialized_item === 1) {
      this.$message.error("Serialized item lines cannot be split.");
      return;
    }

    // The split is over what was SENT (total_quantity), not over what the user
    // has currently typed into received_quantity — the shares must add back up
    // to the sent qty so no In Transit quantity is stranded.
    const totalQty = parseFloat(smItem.total_quantity) || 0;
    if (totalQty <= 0) {
      this.$message.error("Cannot split when total quantity is 0 or less.");
      return;
    }

    if (smItem.is_split === "Yes") {
      this.setData({ [`confirm_split_dialog.rowIndex`]: rowIndex });
      await this.openDialog("confirm_split_dialog");
      return;
    }

    await this.openDialog("split_dialog");

    // is_parent_split stays 0 so the dialog's batch/manufacturing/expired
    // columns stay hidden by their own fx — Plant Transfer takes the batch from
    // the stock that was sent, never from the split dialog.
    this.setData({
      [`split_dialog.item_id`]: smItem.item_selection,
      [`split_dialog.item_name`]: smItem.item_name,
      [`split_dialog.to_received_qty`]: totalQty,
      [`split_dialog.rowIndex`]: rowIndex,
      [`split_dialog.is_parent_split`]: 0,
      [`split_dialog.no_of_split`]: 0,
      [`split_dialog.table_split`]: [],
    });

    // The dialog is shared with Goods Receiving; Plant Transfer collects only
    // quantity + storage + bin, so hide everything else at runtime.
    this.hide([
      "split_dialog.is_parent_split",
      "split_dialog.import_data",
      "split_dialog.is_batch_item",
      "split_dialog.table_split.select_serial_number",
      "split_dialog.table_split.line_remark_1",
      "split_dialog.table_split.line_remark_2",
      "split_dialog.table_split.line_remark_3",
    ]);
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || String(error));
  }
})();
