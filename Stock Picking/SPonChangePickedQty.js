// SPonChangePickedQty.js
// onChange handler for the picked_qty field on item rows in table_picking_items.
// Recomputes net_weight live from the entered picked qty.
//
// picked_qty is entered in the Pick UOM (picking_uom), but weight_conversion is
// defined per the order UOM (item_uom). So the picked qty
// is converted back to item_uom before the factors are applied. Conversion data
// is cached on window.pickingUOMCache by SPonMounted; we fall back to
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
    const round3 = (n) => Math.round(n * 1000) / 1000;

    const convertBaseToAlt = (baseQty, c, uom) => {
      if (!Array.isArray(c) || c.length === 0 || !uom) return baseQty;
      const m = c.find((x) => x.alt_uom_id === uom);
      if (!m || !m.base_qty) return baseQty;
      return round3(baseQty / m.base_qty);
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
    const uomCacheFor = (itemCode) =>
      (window.pickingUOMCache && window.pickingUOMCache[String(itemCode)]) || null;

    // A bundle is picked as a whole. The bundle row's quantity is the number of
    // bundles, and every item under it follows from that at the ratio the bundle
    // was built with -- their own quantity fields are locked, so this is the only
    // thing that sets them. Mirrors GR's onChange_received_qty.
    //
    // The bundle row carries no material and no UOM; the items keep their own bin,
    // batch and UOM, so each item's share is converted into its own Pick UOM.

    const orderUom = String(row.item_uom);
    const pickingUom = row.picking_uom ? String(row.picking_uom) : orderUom;
    const cache = uomCacheFor(row.item_code);
    const conv = cache ? cache.table_uom_conversion : [];
    const baseUom = cache ? cache.based_uom : orderUom;

    // Pick UOM → order UOM (item_uom) so the per-item_uom factors apply.
    const pickedQtyOrder = convertQuantityFromTo(
      pickedQty,
      conv,
      pickingUom,
      orderUom,
      baseUom,
    );

    const weightConversion = parseFloat(row.weight_conversion) || 0;

    await this.setData({
      [`table_picking_items.${rowIndex}.net_weight`]:
        round3(pickedQtyOrder * weightConversion),
    });
  } catch (error) {
    console.error("SPonChangePickedQty error:", error);
  }
})();
