(async () => {
  const fetchItemData = async (itemId) => {
    const itemData = await db.collection("Item").where({ id: itemId }).get();
    return itemData.data[0];
  };

  const allData = this.getValues();

  const selectedUOM = arguments[0].value;
  const rowIndex = allData.to_item_balance.row_index;

  console.log("DEBUG - UOM Change:");
  console.log("selectedUOM:", selectedUOM);

  const pickingPlanUOM = allData.table_to[rowIndex].to_order_uom_id;
  const itemId = allData.table_to[rowIndex].material_id;
  const itemData = await fetchItemData(itemId);
  const tableUOMConversion = itemData.table_uom_conversion;
  const tableItemBalance = allData.to_item_balance.table_item_balance;

  console.log("pickingPlanUOM:", pickingPlanUOM);
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

  if (pickingPlanUOM !== selectedUOM) {
    console.log("UOMs are different, proceeding with conversion...");

    const quantityFields = [
      "block_qty",
      "reserved_qty",
      "unrestricted_qty",
      "qualityinsp_qty",
      "intransit_qty",
      "balance_quantity",
      "to_quantity",
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
            pickingPlanUOM,
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
      [`to_item_balance.table_item_balance`]: updatedTableItemBalance,
    });

    this.models["previous_material_uom"] = selectedUOM;

    console.log(
      `Updated table_item_balance quantities from ${pickingPlanUOM} to ${selectedUOM}`
    );
  } else {
    console.log(
      "UOMs are the same, converting tableItemBalance back to original UOM"
    );

    // Get the previous UOM that the table was converted to
    const previousTableUOM = this.models["previous_material_uom"];

    if (previousTableUOM && previousTableUOM !== pickingPlanUOM) {
      console.log(
        `Converting table back from ${previousTableUOM} to ${pickingPlanUOM}`
      );

      const quantityFields = [
        "block_qty",
        "reserved_qty",
        "unrestricted_qty",
        "qualityinsp_qty",
        "intransit_qty",
        "balance_quantity",
        "to_quantity",
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
              previousTableUOM,
              pickingPlanUOM,
              itemData.based_uom
            );
            console.log(
              `${field}: ${originalValue} -> ${updatedRecord[field]}`
            );
          }
        });

        return updatedRecord;
      });

      console.log("Final updatedTableItemBalance:", updatedTableItemBalance);

      await this.setData({
        [`to_item_balance.table_item_balance`]: updatedTableItemBalance,
        [`to_item_balance.previous_material_uom`]: pickingPlanUOM,
      });

      console.log(
        `Converted table_item_balance back from ${previousTableUOM} to ${pickingPlanUOM}`
      );
    } else {
      console.log("Table is already in correct UOM, no conversion needed");
    }
  }
})();
