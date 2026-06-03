// PickingOnChangePickingUOM.js
// onChange handler for the "picking_uom" (Pick UOM) select on item rows in
// table_picking_items.
//
// Picking quantities are CANONICALLY stored in the GD order UOM (item_uom):
// qty_to_pick / pending_process_qty / picked_qty all flow back to the GD in
// that UOM, and Handling Unit + Packing inherit it. The Pick UOM is purely a
// picker-facing convenience for COUNTING in an alternate unit (e.g. base Unit
// instead of Box). The authoritative conversion of the entered picked qty back
// to the order UOM happens in the PickingProcessWorkflow "Create Table Picking
// Records" funnel. Here we only:
//   1. refresh the read-only alt-UOM display columns (to_pick_alt / pending_alt)
//   2. reset picked_qty to 0 (a value entered in the previous UOM would be
//      misread once the UOM changes)
//
// Conversion data is cached on window.pickingUOMCache by PickingOnMounted's
// enrichPickingUOM(); we fall back to identity (no conversion) if it is absent.

(async () => {
  try {
    const { rowIndex, value } = arguments[0];
    if (rowIndex === undefined || rowIndex === null) return;

    const data = this.getValues();
    const rows = data.table_picking_items || [];
    const row = rows[rowIndex];
    if (!row || row.row_type === "header") return;

    const newUom = value ? String(value) : String(row.item_uom);
    const orderUom = String(row.item_uom);

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

    const cache =
      (window.pickingUOMCache && window.pickingUOMCache[String(row.item_code)]) ||
      null;
    const conv = cache ? cache.table_uom_conversion : [];
    const baseUom = cache ? cache.based_uom : orderUom;

    // Refresh the exact conversion factor for the workflow funnel.
    const getBaseQtyForUom = (uom) => {
      if (!uom) return 1;
      if (String(uom) === String(baseUom)) return 1;
      const c = (conv || []).find((x) => x.alt_uom_id === uom);
      return c && c.base_qty ? c.base_qty : 1;
    };
    const pickingBaseQty = getBaseQtyForUom(newUom);

    const toPickAlt = convertQuantityFromTo(
      parseFloat(row.qty_to_pick) || 0,
      conv,
      orderUom,
      newUom,
      baseUom,
    );
    const pendingAlt = convertQuantityFromTo(
      parseFloat(row.pending_process_qty) || 0,
      conv,
      orderUom,
      newUom,
      baseUom,
    );

    await this.setData({
      [`table_picking_items.${rowIndex}.to_pick_alt`]: toPickAlt,
      [`table_picking_items.${rowIndex}.pending_alt`]: pendingAlt,
      [`table_picking_items.${rowIndex}.picking_base_qty`]: pickingBaseQty,
      // Reset the picker input — its previous value was in the old UOM.
      [`table_picking_items.${rowIndex}.picked_qty`]: 0,
    });
  } catch (error) {
    console.error("PickingOnChangePickingUOM error:", error);
  }
})();
