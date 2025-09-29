(async () => {
  const fetchItemData = async (itemId) => {
    const itemData = await db.collection("Item").where({ id: itemId }).get();
    return itemData.data[0];
  };

  const allData = this.getValues();

  const selectedUOM = arguments[0].value;
  const rowIndex = allData.gd_item_balance.row_index;

  console.log("DEBUG - UOM Change:");
  console.log("selectedUOM:", selectedUOM);

  const goodDeliveryUOM = allData.table_gd[rowIndex].gd_order_uom_id;
  const itemId = allData.table_gd[rowIndex].material_id;
  const itemData = await fetchItemData(itemId);
  const tableUOMConversion = itemData.table_uom_conversion;
  const tableItemBalance = allData.gd_item_balance.table_item_balance;

  console.log("goodDeliveryUOM:", goodDeliveryUOM);
  console.log("itemData.based_uom:", itemData.based_uom);
  console.log("tableItemBalance length:", tableItemBalance?.length);
  console.log("tableUOMConversion:", tableUOMConversion);

  const convertBaseToAlt = (baseQty, table_uom_conversion, uom) => {
    if (
      !Array.isArray(table_uom_conversion) ||
      table_uom_conversion.length === 0 ||
      !uom
    ) {
      return baseQty;
    }

    const uomConversion = table_uom_conversion.find(
      (conv) => conv.alt_uom_id === uom
    );

    if (!uomConversion || !uomConversion.alt_qty) {
      return baseQty;
    }

    return Math.round(baseQty * uomConversion.alt_qty * 1000) / 1000;
  };

  const convertQuantityFromTo = (
    value,
    table_uom_conversion,
    fromUOM,
    toUOM,
    baseUOM
  ) => {
    if (!value || fromUOM === toUOM) return value;

    // First convert from current UOM back to base UOM
    let baseQty = value;
    if (fromUOM !== baseUOM) {
      const fromConversion = table_uom_conversion.find(
        (conv) => conv.alt_uom_id === fromUOM
      );
      if (fromConversion && fromConversion.alt_qty) {
        baseQty = value / fromConversion.alt_qty;
      }
    }

    // Then convert from base UOM to target UOM
    return convertBaseToAlt(baseQty, table_uom_conversion, toUOM);
  };

  if (goodDeliveryUOM !== selectedUOM) {
    console.log("UOMs are different, proceeding with conversion...");

    const quantityFields = [
      "block_qty",
      "reserved_qty",
      "unrestricted_qty",
      "qualityinsp_qty",
      "intransit_qty",
      "balance_quantity",
      "gd_quantity",
    ];

    const updatedTableItemBalance = tableItemBalance.map((record, index) => {
      const updatedRecord = { ...record };

      console.log(`Processing record ${index}:`, record);

      quantityFields.forEach((field) => {
        if (updatedRecord[field]) {
          const originalValue = updatedRecord[field];
          updatedRecord[field] = convertQuantityFromTo(
            updatedRecord[field],
            tableUOMConversion,
            goodDeliveryUOM,
            selectedUOM,
            itemData.based_uom
          );
          console.log(`${field}: ${originalValue} -> ${updatedRecord[field]}`);
        }
      });

      return updatedRecord;
    });

    console.log("Final updatedTableItemBalance:", updatedTableItemBalance);

    await this.setData({
      [`gd_item_balance.table_item_balance`]: updatedTableItemBalance,
    });

    console.log(
      `Updated table_item_balance quantities from ${goodDeliveryUOM} to ${selectedUOM}`
    );
  } else {
    console.log("UOMs are the same, no conversion needed");
  }
})();
