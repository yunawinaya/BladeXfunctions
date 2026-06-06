// PickingOnChangePickedQty.js
// onChange handler for the picked_qty field on item rows in table_picking_items.
// Recomputes packing_qty + net_weight live from the entered picked qty, using
// the line's stored packing_conversion / weight_conversion (seeded at creation).
// PickingProcessWorkflow recomputes these authoritatively on save as well.

(async () => {
  try {
    const { rowIndex, value } = arguments[0];
    if (rowIndex === undefined || rowIndex === null) return;

    const row = this.getValue(`table_picking_items.${rowIndex}`) || {};
    if (row.row_type === "header") return;

    const pickedQty = parseFloat(value) || 0;
    const packingConversion = parseFloat(row.packing_conversion) || 1;
    const weightConversion = parseFloat(row.weight_conversion) || 0;

    await this.setData({
      [`table_picking_items.${rowIndex}.packing_qty`]:
        Math.round((pickedQty / packingConversion) * 1000) / 1000,
      [`table_picking_items.${rowIndex}.net_weight`]:
        Math.round((pickedQty * weightConversion) * 1000) / 1000,
    });
  } catch (error) {
    console.error("PickingOnChangePickedQty error:", error);
  }
})();
