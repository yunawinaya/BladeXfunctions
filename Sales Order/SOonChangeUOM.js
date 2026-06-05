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

        this.setData({ [`table_so.${rowIndex}.unrestricted_qty`]: finalQty });
      }
    }
  }
})();
