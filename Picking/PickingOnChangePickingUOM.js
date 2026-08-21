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
    const changedRow = arguments[0].row;
    if ((rowIndex === undefined || rowIndex === null) && !changedRow) return;

    const data = this.getValues();
    const rows = data.table_picking_items || [];

    // arguments[0].rowIndex is a position in the TOP-LEVEL array, so it does not
    // address a bundle's items -- they sit under their bundle row as `children`.
    // The row is located by fm_key instead, which identifies a row wherever it
    // sits in the tree, with id and then the top-level index as fallbacks, and
    // the path it is addressed by is built from where it was found.
    const resolveRow = (allRows, changed, idx) => {
      const keys = [];
      if (changed && changed.fm_key != null)
        keys.push(["fm_key", String(changed.fm_key)]);
      if (changed && changed.id != null) keys.push(["id", String(changed.id)]);

      for (const [field, want] of keys) {
        for (let i = 0; i < allRows.length; i++) {
          const parent = allRows[i];
          if (parent && parent[field] != null && String(parent[field]) === want) {
            return { row: parent, path: `table_picking_items.${i}` };
          }

          const kids = Array.isArray(parent && parent.children)
            ? parent.children
            : [];

          for (let j = 0; j < kids.length; j++) {
            if (kids[j] && kids[j][field] != null && String(kids[j][field]) === want) {
              return {
                row: kids[j],
                path: `table_picking_items.${i}.children.${j}`,
              };
            }
          }
        }
      }

      const fallback = allRows[idx];
      return fallback
        ? { row: fallback, path: `table_picking_items.${idx}` }
        : null;
    };

    const resolved = resolveRow(rows, changedRow, rowIndex);
    if (!resolved) return;

    const { row, path } = resolved;
    if (row.row_type === "header") return;

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
      [`${path}.to_pick_alt`]: toPickAlt,
      [`${path}.pending_alt`]: pendingAlt,
      [`${path}.picking_base_qty`]: pickingBaseQty,
      // Reset the picker input — its previous value was in the old UOM.
      [`${path}.picked_qty`]: 0,
      // picked_qty reset to 0 → packing qty + net weight reset too.
      [`${path}.packing_qty`]: 0,
      [`${path}.net_weight`]: 0,
    });
  } catch (error) {
    console.error("PickingOnChangePickingUOM error:", error);
  }
})();
