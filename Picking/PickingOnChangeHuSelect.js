// PickingOnChangeHuSelect.js
// onChange handler for hu_select checkbox on HU header rows in table_picking_items.
// When checked (1): sets picked_qty = pending_process_qty for every item row in this HU.
// When unchecked (0): resets picked_qty to 0 for those item rows.
// Only active when picking_setup.split_policy is FULL_HU_PICK or NO_SPLIT;
// under ALLOW_SPLIT the hu_select column is hidden by applyHUVisibility anyway.

(async () => {
  try {
    const data = this.getValues();
    const { rowIndex, value } = arguments[0];

    const rows = data.table_picking_items || [];
    const currentRow = rows[rowIndex];

    // Only header rows respond
    if (!currentRow || currentRow.row_type !== "header") return;

    const handlingUnitId = currentRow.handling_unit_id;
    if (!handlingUnitId) return;

    const isSelected = value === 1 || value === true;

    const updates = {};
    rows.forEach((row, idx) => {
      if (
        row.row_type === "item" &&
        row.handling_unit_id === handlingUnitId
      ) {
        if (isSelected) {
          updates[`table_picking_items.${idx}.picked_qty`] =
            parseFloat(row.pending_process_qty) || 0;
        } else {
          updates[`table_picking_items.${idx}.picked_qty`] = 0;
        }
      }
    });

    if (Object.keys(updates).length > 0) {
      await this.setData(updates);
    }
  } catch (error) {
    console.error("PickingOnChangeHuSelect error:", error);
  }
})();
