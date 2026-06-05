const convertBaseToAlt = (baseQty, table_uom_conversion, uom) => {
  if (
    !Array.isArray(table_uom_conversion) ||
    table_uom_conversion.length === 0 ||
    !uom
  ) {
    return baseQty;
  }

  const uomConversion = table_uom_conversion.find(
    (conv) => conv.alt_uom_id === uom,
  );

  if (!uomConversion || !uomConversion.base_qty) {
    return baseQty;
  }

  return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
};

// Find the packing detail row whose uom_id matches the selected UOM.
const getPackingDetail = (table_packing_detail, uom) => {
  if (
    !Array.isArray(table_packing_detail) ||
    table_packing_detail.length === 0 ||
    !uom
  ) {
    return null;
  }

  return table_packing_detail.find((conv) => conv.uom_id === uom) || null;
};

// How many base UOM units make up 1 unit of the selected UOM (1 if base UOM
// or no matching conversion row).
const getBaseQty = (table_uom_conversion, uom) => {
  if (
    !Array.isArray(table_uom_conversion) ||
    table_uom_conversion.length === 0 ||
    !uom
  ) {
    return 1;
  }

  const uomConversion = table_uom_conversion.find(
    (conv) => conv.alt_uom_id === uom,
  );

  return uomConversion && uomConversion.base_qty ? uomConversion.base_qty : 1;
};

(async () => {
  const uom = arguments[0].value;
  const rowIndex = arguments[0].rowIndex;

  if (arguments[0]) {
    const itemId = this.getValue(`table_so.${rowIndex}.item_name`);
    const baseUnrestrictedQty = this.getValue(
      `table_so.${rowIndex}.base_unrestricted_qty`,
    );

    console.log("Base Unrestricted Qty:", baseUnrestrictedQty);
    if (itemId) {
      const resItem = await db.collection("Item").where({ id: itemId }).get();

      if (resItem && resItem.data.length > 0) {
        const itemData = resItem.data[0];

        const finalQty = await convertBaseToAlt(
          baseUnrestrictedQty,
          itemData.table_uom_conversion,
          uom,
        );

        console.log("Final Qty:", finalQty);

        // Packing: match the packing detail row by uom_id === selected UOM.
        // packing_conversion is stored on the line so SOonBlurQty can reuse it
        // without re-fetching the Item.
        const packingDetail = getPackingDetail(
          itemData.table_packing_detail,
          uom,
        );
        const packingConversion = packingDetail?.quantity || 1;
        const packingUOM = packingDetail?.packing_uom_id || "";
        const soQuantity =
          this.getValue(`table_so.${rowIndex}.so_quantity`) || 0;
        const packingQty = packingConversion
          ? Math.round((soQuantity / packingConversion) * 1000) / 1000
          : 0;

        // Net weight: Item.net_weight is the weight of 1 base UOM unit, so the
        // weight of 1 unit in the SO's UOM is net_weight * base_qty. Store that
        // per-unit weight as weight_conversion so SOonBlurQty can reuse it, and
        // set net_weight to the qty-driven line total.
        const baseQty = getBaseQty(itemData.table_uom_conversion, uom);
        const weightConversion =
          Math.round((Number(itemData.net_weight) || 0) * baseQty * 1000) /
          1000;
        const netWeight =
          Math.round(soQuantity * weightConversion * 1000) / 1000;

        this.setData({
          [`table_so.${rowIndex}.unrestricted_qty`]: finalQty,
          [`table_so.${rowIndex}.packing_uom`]: packingUOM,
          [`table_so.${rowIndex}.packing_conversion`]: packingConversion,
          [`table_so.${rowIndex}.packing_qty`]: packingQty,
          [`table_so.${rowIndex}.weight_conversion`]: weightConversion,
          [`table_so.${rowIndex}.net_weight`]: netWeight,
        });
      }
    }
  }
})();
