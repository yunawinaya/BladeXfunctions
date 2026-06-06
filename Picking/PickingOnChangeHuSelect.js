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

    // picked_qty is expressed in the row's picking_uom, while pending_process_qty
    // is canonical (order UOM = item_uom). For HU item rows picking_uom is forced
    // to item_uom (atomic HU pick), so this is identity today; the conversion is
    // kept for safety in case HU rows ever allow an alternate Pick UOM.
    const convertBaseToAlt = (baseQty, conv, uom) => {
      if (!Array.isArray(conv) || conv.length === 0 || !uom) return baseQty;
      const c = conv.find((x) => x.alt_uom_id === uom);
      if (!c || !c.base_qty) return baseQty;
      return Math.round((baseQty / c.base_qty) * 1000) / 1000;
    };
    const convertQuantityFromTo = (val, conv, fromUOM, toUOM, baseUOM) => {
      if (!val || fromUOM === toUOM) return val;
      let baseQty = val;
      if (fromUOM !== baseUOM) {
        const fromConv = (conv || []).find((x) => x.alt_uom_id === fromUOM);
        if (fromConv && fromConv.base_qty) baseQty = val * fromConv.base_qty;
      }
      return convertBaseToAlt(baseQty, conv, toUOM);
    };

    const updates = {};
    rows.forEach((row, idx) => {
      if (
        row.row_type === "item" &&
        row.handling_unit_id === handlingUnitId
      ) {
        let pickedQty = 0;
        if (isSelected) {
          const pending = parseFloat(row.pending_process_qty) || 0;
          const orderUom = String(row.item_uom);
          const pickingUom = row.picking_uom ? String(row.picking_uom) : orderUom;
          const cache =
            (window.pickingUOMCache &&
              window.pickingUOMCache[String(row.item_code)]) ||
            null;
          pickedQty = convertQuantityFromTo(
            pending,
            cache ? cache.table_uom_conversion : [],
            orderUom,
            pickingUom,
            cache ? cache.based_uom : orderUom,
          );
        }
        updates[`table_picking_items.${idx}.picked_qty`] = pickedQty;

        // Live packing qty + net weight from the picked qty (the workflow
        // recomputes these authoritatively on save).
        const packingConversion = parseFloat(row.packing_conversion) || 1;
        const weightConversion = parseFloat(row.weight_conversion) || 0;
        updates[`table_picking_items.${idx}.packing_qty`] =
          Math.round((pickedQty / packingConversion) * 1000) / 1000;
        updates[`table_picking_items.${idx}.net_weight`] =
          Math.round((pickedQty * weightConversion) * 1000) / 1000;
      }
    });

    if (Object.keys(updates).length > 0) {
      await this.setData(updates);
    }
  } catch (error) {
    console.error("PickingOnChangeHuSelect error:", error);
  }
})();
