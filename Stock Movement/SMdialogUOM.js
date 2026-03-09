(async () => {
  const fetchItemData = async (itemId) => {
    const itemData = await db.collection("Item").where({ id: itemId }).get();
    return itemData.data[0];
  };

  const allData = this.getValues();

  const selectedUOM = arguments[0].value;
  const rowIndex = allData.sm_item_balance.row_index;

  console.log("DEBUG - UOM Change:");
  console.log("selectedUOM:", selectedUOM);

  const quantityUOM = allData.stock_movement[rowIndex].quantity_uom;
  const itemId = allData.stock_movement[rowIndex].item_selection;
  const itemData = await fetchItemData(itemId);
  const tableUOMConversion = itemData.table_uom_conversion;
  const tableItemBalance = allData.sm_item_balance.table_item_balance;

  // Use stored current_table_uom if set, otherwise fall back to quantityUOM
  // This tracks the actual current UOM state of the table data
  const currentTableUOM =
    allData.sm_item_balance.current_table_uom || quantityUOM;

  console.log("quantityUOM:", quantityUOM);
  console.log("currentTableUOM:", currentTableUOM);
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
      (conv) => conv.alt_uom_id === uom,
    );

    if (!uomConversion || !uomConversion.base_qty) {
      return baseQty;
    }

    return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
  };

  const convertQuantityFromTo = (
    value,
    table_uom_conversion,
    fromUOM,
    toUOM,
    baseUOM,
  ) => {
    if (!value || fromUOM === toUOM) return value;

    // First convert from current UOM back to base UOM
    let baseQty = value;
    if (fromUOM !== baseUOM) {
      const fromConversion = table_uom_conversion.find(
        (conv) => conv.alt_uom_id === fromUOM,
      );
      if (fromConversion && fromConversion.base_qty) {
        baseQty = value * fromConversion.base_qty;
      }
    }

    // Then convert from base UOM to target UOM
    return convertBaseToAlt(baseQty, table_uom_conversion, toUOM);
  };

  // Only convert if the selected UOM is different from the current table UOM
  if (currentTableUOM !== selectedUOM) {
    console.log(
      `UOMs are different, converting from ${currentTableUOM} to ${selectedUOM}`,
    );

    const quantityFields = [
      "block_qty",
      "reserved_qty",
      "unrestricted_qty",
      "qualityinsp_qty",
      "intransit_qty",
      "balance_quantity",
      "sm_quantity",
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
            currentTableUOM,
            selectedUOM,
            itemData.based_uom,
          );
          console.log(`${field}: ${originalValue} -> ${updatedRecord[field]}`);
        }
      });

      return updatedRecord;
    });

    console.log("Final updatedTableItemBalance:", updatedTableItemBalance);

    await this.setData({
      [`sm_item_balance.table_item_balance`]: updatedTableItemBalance,
      [`sm_item_balance.current_table_uom`]: selectedUOM,
    });

    console.log(
      `Updated table_item_balance quantities from ${currentTableUOM} to ${selectedUOM}`,
    );
  } else {
    console.log("Table is already in selected UOM, no conversion needed");
  }
})();
