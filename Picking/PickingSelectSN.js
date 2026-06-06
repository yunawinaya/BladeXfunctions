(async () => {
  try {
    const selectedSN = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    console.log("Selected SN", selectedSN);

    const pickedQty = selectedSN.length > 0 ? selectedSN.length : 0;

    // Live packing qty + net weight from the picked qty (the workflow recomputes
    // these authoritatively on save).
    const row = this.getValue(`table_picking_items.${rowIndex}`) || {};
    const packingConversion = parseFloat(row.packing_conversion) || 1;
    const weightConversion = parseFloat(row.weight_conversion) || 0;

    await this.setData({
      [`table_picking_items.${rowIndex}.picked_qty`]: pickedQty,
      [`table_picking_items.${rowIndex}.packing_qty`]:
        Math.round((pickedQty / packingConversion) * 1000) / 1000,
      [`table_picking_items.${rowIndex}.net_weight`]:
        Math.round((pickedQty * weightConversion) * 1000) / 1000,
    });
  } catch (error) {
    console.error("Unexpected error in selected SN handler:", error);
  }
})();
