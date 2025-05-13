(async () => {
  try {
    // Get all form data
    const allData = await this.getValues();
    const smTable = allData.stock_movement;

    // Fetch all UOMs at once for efficiency
    const allUOMdata = await db.collection("unit_of_measurement").get();

    // Create a lookup map for UOMs for faster access
    const uomMap = {};
    for (let i = 0; i < allUOMdata.data.length; i++) {
      const uom = allUOMdata.data[i];
      uomMap[uom.id] = uom.uom_name;
    }

    console.log("Loaded UOM map with", Object.keys(uomMap).length, "entries");

    // Process each row in the stock movement table
    for (let i = 0; i < smTable.length; i++) {
      const itemSelection = smTable[i].item_selection;

      if (!itemSelection) {
        console.log(`Row ${i}: No item selected, skipping`);
        continue;
      }

      // Fetch material data for this item
      const materialResponse = await db
        .collection("Item")
        .where({ id: itemSelection })
        .get();

      if (!materialResponse.data || materialResponse.data.length === 0) {
        console.log(`Row ${i}: Item ${itemSelection} not found in database`);
        continue;
      }

      const materialData = materialResponse.data[0];
      const based_uom = materialData.based_uom;

      console.log(
        `Row ${i}: Processing item ${itemSelection} with base UOM ${based_uom}`
      );

      // Collect all available UOMs for this item
      const itemUomOptions = [];

      // Add base UOM if it exists in our UOM map
      if (based_uom && uomMap[based_uom]) {
        itemUomOptions.push({
          value: based_uom,
          label: uomMap[based_uom],
        });
        console.log(
          `Row ${i}: Added base UOM: ${based_uom} (${uomMap[based_uom]})`
        );
      }

      // Add alternative UOMs from conversion table
      if (
        materialData.table_uom_conversion &&
        Array.isArray(materialData.table_uom_conversion)
      ) {
        for (let j = 0; j < materialData.table_uom_conversion.length; j++) {
          const conversionRow = materialData.table_uom_conversion[j];
          const altUomId = conversionRow.alt_uom_id;

          if (altUomId && uomMap[altUomId]) {
            itemUomOptions.push({
              value: altUomId,
              label: uomMap[altUomId],
            });
            console.log(
              `Row ${i}: Added alt UOM: ${altUomId} (${uomMap[altUomId]})`
            );
          }
        }
      }

      console.log(`Row ${i}: Setting ${itemUomOptions.length} UOM options`);

      // Set UOM options for this row
      if (itemUomOptions.length > 0) {
        await this.setOptionData(
          [`stock_movement.${i}.received_quantity_uom`],
          itemUomOptions
        );

        // Set the default UOM to base UOM
        if (based_uom) {
          const selectedUOM = itemUomOptions.find(
            (itemUomOptions) => itemUomOptions.value === based_uom
          );

          await this.setData(
            [`stock_movement.${i}.received_quantity_uom`],
            selectedUOM
          );
          console.log(`Row ${i}: Set default UOM to ${selectedUOM}`);
        }
      } else {
        console.log(
          `Row ${i}: No valid UOM options found for item ${itemSelection}`
        );
      }
    }

    console.log("UOM setting completed successfully");
    await console.log("arguments", arguments[0]);
  } catch (error) {
    console.error("Error setting UOM options:", error);
  }
})();
