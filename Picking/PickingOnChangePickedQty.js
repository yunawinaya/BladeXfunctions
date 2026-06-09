// PickingOnChangePickedQty.js
// onChange handler for the picked_qty field on item rows in table_picking_items.
// Recomputes packing_qty + net_weight live from the entered picked qty.
//
// picked_qty is entered in the Pick UOM (picking_uom), but packing_conversion /
// weight_conversion are defined per the order UOM (item_uom). So the picked qty
// is converted back to item_uom before the factors are applied. Conversion data
// is cached on window.pickingUOMCache by PickingOnMounted; we fall back to
// identity (no conversion) when it is absent — correct when picking_uom ==
// item_uom (the default).
//
// PickingProcessWorkflow recomputes these authoritatively on save (from
// qty_to_pick, which is already in item_uom).

(async () => {
  try {
    const { rowIndex, value } = arguments[0];
    if (rowIndex === undefined || rowIndex === null) return;

    const row = this.getValue(`table_picking_items.${rowIndex}`) || {};
    if (row.row_type === "header") return;

    const pickedQty = parseFloat(value) || 0;

    const orderUom = String(row.item_uom);
    const pickingUom = row.picking_uom ? String(row.picking_uom) : orderUom;
    const cache =
      (window.pickingUOMCache &&
        window.pickingUOMCache[String(row.item_code)]) ||
      null;
    const conv = cache ? cache.table_uom_conversion : [];
    const baseUom = cache ? cache.based_uom : orderUom;

    const convertBaseToAlt = (baseQty, c, uom) => {
      if (!Array.isArray(c) || c.length === 0 || !uom) return baseQty;
      const m = c.find((x) => x.alt_uom_id === uom);
      if (!m || !m.base_qty) return baseQty;
      return Math.round((baseQty / m.base_qty) * 1000) / 1000;
    };
    const convertQuantityFromTo = (val, c, fromUOM, toUOM, bUom) => {
      if (!val || fromUOM === toUOM) return val;
      let baseQty = val;
      if (fromUOM !== bUom) {
        const f = (c || []).find((x) => x.alt_uom_id === fromUOM);
        if (f && f.base_qty) baseQty = val * f.base_qty;
      }
      return convertBaseToAlt(baseQty, c, toUOM);
    };

    // Pick UOM → order UOM (item_uom) so the per-item_uom factors apply.
    const pickedQtyOrder = convertQuantityFromTo(
      pickedQty,
      conv,
      pickingUom,
      orderUom,
      baseUom,
    );

    const packingConversion = parseFloat(row.packing_conversion) || 1;
    const weightConversion = parseFloat(row.weight_conversion) || 0;

    await this.setData({
      [`table_picking_items.${rowIndex}.packing_qty`]:
        Math.round((pickedQtyOrder / packingConversion) * 1000) / 1000,
      [`table_picking_items.${rowIndex}.net_weight`]:
        Math.round((pickedQtyOrder * weightConversion) * 1000) / 1000,
    });
  } catch (error) {
    console.error("PickingOnChangePickedQty error:", error);
  }
})();
