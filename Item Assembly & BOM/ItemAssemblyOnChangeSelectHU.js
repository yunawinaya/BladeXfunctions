// onChange handler for hu_select checkbox on HU header rows in the LOT inventory dialog.
// When checked (1): sets sm_quantity = item_quantity for all item rows in this HU.
// When unchecked (0): sets sm_quantity = 0 for all item rows in this HU.
// LOT enforces NO_SPLIT (whole-HU pick), so this is always active.

(async () => {
  const data = this.getValues();
  const { rowIndex, value } = arguments[0];

  const huTableData = data.sm_item_balance?.table_hu || [];
  const currentRow = huTableData[rowIndex];

  // Only header rows have hu_select
  if (!currentRow || currentRow.row_type !== "header") return;

  // Don't allow selection of disabled HUs (defensive — LOT skips reserved HUs at load)
  if (currentRow.hu_disabled) {
    this.setData({
      [`sm_item_balance.table_hu.${rowIndex}.hu_select`]: 0,
    });
    return;
  }

  const isSelected = value === 1 || value === true;
  const handlingUnitId = currentRow.handling_unit_id;

  // Find all item rows belonging to this HU
  const updates = {};
  huTableData.forEach((row, idx) => {
    if (row.row_type === "item" && row.handling_unit_id === handlingUnitId) {
      if (isSelected) {
        // Checked: set sm_quantity to full item_quantity
        updates[`sm_item_balance.table_hu.${idx}.sm_quantity`] =
          parseFloat(row.item_quantity) || 0;
      } else {
        // Unchecked: reset sm_quantity to 0
        updates[`sm_item_balance.table_hu.${idx}.sm_quantity`] = 0;
      }
    }
  });

  if (Object.keys(updates).length > 0) {
    this.setData(updates);
  }
})();
