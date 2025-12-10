(async () => {
  const allData = this.getValues();
  const selectedUOM = arguments[0].value;
  const rowIndex = arguments[0].rowIndex;
  const itemId = allData.table_stock_count[rowIndex].material_id;
  const baseUOM = allData.table_stock_count[rowIndex].base_uom_id;
  const tableStockCount = allData.table_stock_count;

  // Get the previous UOM from model (before the change)
  const previousUOM = this.models[`previous_uom_${rowIndex}`] || baseUOM;

  console.log("DEBUG - UOM Change:");
  console.log("selectedUOM:", selectedUOM);
  console.log("previousUOM:", previousUOM);
  console.log("baseUOM:", baseUOM);
  console.log("rowIndex:", rowIndex);

  const itemData = await db
    .collection("Item")
    .where({ id: itemId })
    .get()
    .then((res) => res.data[0]);

  console.log("Full itemData from DB:", itemData);

  let tableUOMConversion = itemData.table_uom_conversion;

  console.log("Raw tableUOMConversion from DB:", tableUOMConversion);
  console.log("Type:", typeof tableUOMConversion);
  console.log("Is Array:", Array.isArray(tableUOMConversion));

  // Handle if table_uom_conversion is stored as JSON string in database
  if (typeof tableUOMConversion === "string") {
    try {
      tableUOMConversion = JSON.parse(tableUOMConversion);
      console.log("Parsed tableUOMConversion:", tableUOMConversion);
    } catch (e) {
      console.error("Failed to parse table_uom_conversion:", e);
    }
  }

  // Ensure it's an array
  if (tableUOMConversion && !Array.isArray(tableUOMConversion)) {
    console.log("Converting single object to array");
    tableUOMConversion = [tableUOMConversion];
  }

  console.log("Final tableUOMConversion (array):", tableUOMConversion);
  console.log("Array length:", tableUOMConversion?.length);

  // IMPORTANT: Store as JSON string to prevent platform from double-stringifying
  const tableUOMConversionString = JSON.stringify(tableUOMConversion);

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

    if (!uomConversion || !uomConversion.base_qty) {
      return baseQty;
    }

    return Math.round(baseQty / uomConversion.base_qty * 1000) / 1000;
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
      if (fromConversion && fromConversion.base_qty) {
        baseQty = value * fromConversion.base_qty;
      }
    }

    // Then convert from base UOM to target UOM
    return convertBaseToAlt(baseQty, table_uom_conversion, toUOM);
  };

  // Only convert if the UOM actually changed
  if (previousUOM !== selectedUOM) {
    console.log(`Converting from ${previousUOM} to ${selectedUOM}...`);

    const quantityFields = ["system_qty", "variance_qty", "count_qty"];

    const updatedTableStockCount = tableStockCount.map((record, index) => {
      if (index !== rowIndex) return record; // Only update the current row

      const updatedRecord = { ...record };

      console.log(`Processing record ${index}:`, record);

      // Store table_uom_conversion as JSON string for later use in SCsaveReview
      // This prevents the low-code platform from double-stringifying it
      updatedRecord.table_uom_conversion = tableUOMConversionString;

      console.log(
        "Storing table_uom_conversion as:",
        updatedRecord.table_uom_conversion
      );

      quantityFields.forEach((field) => {
        if (updatedRecord[field]) {
          const originalValue = updatedRecord[field];
          updatedRecord[field] = convertQuantityFromTo(
            updatedRecord[field],
            tableUOMConversion,
            previousUOM,
            selectedUOM,
            baseUOM
          );
          console.log(`${field}: ${originalValue} -> ${updatedRecord[field]}`);
        }
      });

      return updatedRecord;
    });

    console.log("Final updatedTableStockCount:", updatedTableStockCount);

    await this.setData({
      [`table_stock_count`]: updatedTableStockCount,
    });

    // Store the current UOM as previous for next change
    this.models[`previous_uom_${rowIndex}`] = selectedUOM;

    console.log(
      `Updated table_stock_count quantities from ${previousUOM} to ${selectedUOM}`
    );
  } else {
    console.log("UOM unchanged, no conversion needed");
  }
})();
