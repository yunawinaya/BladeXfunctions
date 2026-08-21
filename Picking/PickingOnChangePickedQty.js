// PickingOnChangePickedQty.js
// onChange handler for the picked_qty field on item rows in table_picking_items.
// Recomputes packing_qty + net_weight live from the entered picked qty, and
// spreads a bundle row's quantity across the items under it.
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
    if (row.item_bundle_id && !row.item_code) {
      // The items sit under the bundle row as `children`. A document that arrives
      // flat instead -- rows pointing back at the bundle row through parent_id --
      // is handled too, the same way GD and PO handle their own trees.
      //
      // Each item comes back with the path that addresses it: its fm_key, which
      // identifies a row wherever it sits in the tree, with its position as the
      // fallback.
      const components = [];
      const nestedItems = Array.isArray(row.children) ? row.children : [];

      if (nestedItems.length > 0) {
        nestedItems.forEach((c, childIndex) => {
          components.push({
            row: c || {},
            path:
              c && c.fm_key
                ? `table_picking_items.${c.fm_key}`
                : `table_picking_items.${rowIndex}.children.${childIndex}`,
          });
        });
      } else {
        const parentKey = String(row.id || "");
        if (!parentKey) return;

        const rows = this.getValue("table_picking_items") || [];
        rows.forEach((r, idx) => {
          if (!r || idx === rowIndex) return;
          if (String(r.parent_id || "") !== parentKey) return;
          components.push({
            row: r,
            path: r.fm_key
              ? `table_picking_items.${r.fm_key}`
              : `table_picking_items.${idx}`,
          });
        });
      }

      if (components.length === 0) return;

      // A bundle carries no tolerance of its own, so the most that can be picked
      // is whatever is still outstanding on the bundle row.
      const outstanding = parseFloat(row.pending_process_qty) || 0;
      let bundlesPicked = Math.max(0, pickedQty);
      if (outstanding > 0 && bundlesPicked > outstanding) bundlesPicked = outstanding;

      const bundlesPlanned = parseFloat(row.qty_to_pick) || 0;
      const ratio = bundlesPlanned > 0 ? bundlesPicked / bundlesPlanned : 0;

      const updates = {};
      if (bundlesPicked !== pickedQty) {
        updates[`table_picking_items.${rowIndex}.picked_qty`] = bundlesPicked;
      }

      for (const c of components) {
        // qty_to_pick is in the item's order UOM; picked_qty is entered in its
        // Pick UOM, so the share is converted before it is written.
        const shareOrderUom = round3((parseFloat(c.row.qty_to_pick) || 0) * ratio);
        const cOrderUom = String(c.row.item_uom);
        const cPickUom = c.row.picking_uom ? String(c.row.picking_uom) : cOrderUom;
        const cCache = uomCacheFor(c.row.item_code);
        const sharePickUom = convertQuantityFromTo(
          shareOrderUom,
          cCache ? cCache.table_uom_conversion : [],
          cOrderUom,
          cPickUom,
          cCache ? cCache.based_uom : cOrderUom,
        );

        const cPacking = parseFloat(c.row.packing_conversion) || 1;
        const cWeight = parseFloat(c.row.weight_conversion) || 0;

        updates[`${c.path}.picked_qty`] = sharePickUom;
        updates[`${c.path}.packing_qty`] = round3(
          shareOrderUom / cPacking,
        );
        updates[`${c.path}.net_weight`] = round3(
          shareOrderUom * cWeight,
        );
      }

      await this.setData(updates);

      console.log("item bundle picked", row.item_bundle_id, {
        bundles: bundlesPicked,
        ratio,
        items: components.length,
      });

      return;
    }

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

    const packingConversion = parseFloat(row.packing_conversion) || 1;
    const weightConversion = parseFloat(row.weight_conversion) || 0;

    await this.setData({
      [`table_picking_items.${rowIndex}.packing_qty`]:
        round3(pickedQtyOrder / packingConversion),
      [`table_picking_items.${rowIndex}.net_weight`]:
        round3(pickedQtyOrder * weightConversion),
    });
  } catch (error) {
    console.error("PickingOnChangePickedQty error:", error);
  }
})();
