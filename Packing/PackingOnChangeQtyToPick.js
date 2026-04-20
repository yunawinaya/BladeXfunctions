// Clamps a user-edited qty_to_pick on a table_item_source row to
// [0, remaining_qty]. Toasts a warning if the value was corrected.
// Paste into the `PackingOnChangeQtyToPick` handler slot (key ojlcjhuh).

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const row = this.getValue(`table_item_source.${rowIndex}`);
    if (!row) return;

    const remaining = Number(row.remaining_qty) || 0;
    let value = Number(row.qty_to_pick);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > remaining) value = remaining;

    if (Number(row.qty_to_pick) !== value) {
      await this.setData({
        [`table_item_source.${rowIndex}.qty_to_pick`]: value,
      });
      this.$message.warning(`Quantity clamped to remaining (${remaining}).`);
    }
  } catch (error) {
    console.error("PackingOnChangeQtyToPick error:", error);
  }
})();
