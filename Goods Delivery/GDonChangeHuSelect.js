// GDonChangeHuSelect.js
// onChange handler for hu_select checkbox on HU header rows in the inventory dialog.
// When checked (1): sets deliver_quantity = item_quantity for all item rows in this HU.
// When unchecked (0): sets deliver_quantity = 0 for all item rows in this HU.
// Only active for FULL_HU_PICK and NO_SPLIT policies.

(async () => {
  const data = this.getValues();
  const { rowIndex, value } = arguments[0];
  const splitPolicy = data.split_policy || "ALLOW_SPLIT";

  // Only handle for whole-HU policies
  if (splitPolicy === "ALLOW_SPLIT") return;

  const huTableData = data.gd_item_balance.table_hu || [];
  const currentRow = huTableData[rowIndex];

  // Only header rows have hu_select
  if (!currentRow || currentRow.row_type !== "header") return;

  // Don't allow selection of disabled HUs
  if (currentRow.hu_disabled) {
    this.setData({
      [`gd_item_balance.table_hu.${rowIndex}.hu_select`]: 0,
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
        // Checked: set deliver_quantity to full item_quantity
        updates[`gd_item_balance.table_hu.${idx}.deliver_quantity`] =
          parseFloat(row.item_quantity) || 0;
      } else {
        // Unchecked: reset deliver_quantity to 0
        updates[`gd_item_balance.table_hu.${idx}.deliver_quantity`] = 0;
      }
    }
  });

  if (Object.keys(updates).length > 0) {
    this.setData(updates);
  }
})();
