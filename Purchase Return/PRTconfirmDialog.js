(async () => {
  const data = this.getValues();
  const temporaryData = data.confirm_inventory.table_item_balance;
  const rowIndex = data.confirm_inventory.row_index;
  const returnQty = data.confirm_inventory.return_quantity;

  // Get UOM information (you'll need to add this based on your data structure)
  const materialUOMid = data.confirm_inventory.material_uom; // Adjust field name as needed
  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: materialUOMid })
    .get()
    .then((res) => {
      return res.data[0]?.uom_name || "PCS"; // Default to PCS if not found
    });

  // Check if all rows have passed validation
  const allValid = temporaryData.every((item, idx) => {
    const isValid =
      window.validationState && window.validationState[idx] !== false;
    console.log(`Row ${idx} validation: ${isValid}`);
    return isValid;
  });

  if (!allValid) {
    console.log("Validation failed, canceling confirm");
    return;
  }

  let totalReturnQty = temporaryData.reduce(
    (sum, item) => sum + (item.return_quantity || 0),
    0
  );

  if (totalReturnQty > returnQty) {
    this.$message.error("Total return quantity cannot exceed return quantity.");
    return;
  } else {
    const filteredData = temporaryData.filter(
      (item) =>
        item.return_quantity !== null &&
        item.return_quantity !== undefined &&
        item.return_quantity !== 0
    );

    const formatFilteredData = async (filteredData) => {
      // Get unique location IDs
      const locationIds = [
        ...new Set(filteredData.map((item) => item.location_id)),
      ];

      // Get unique batch IDs (filter out null/undefined values)
      const batchIds = [
        ...new Set(
          filteredData
            .map((item) => item.batch_id)
            .filter((batchId) => batchId != null && batchId !== "")
        ),
      ];

      // Fetch locations in parallel
      const locationPromises = locationIds.map(async (locationId) => {
        try {
          const resBinLocation = await db
            .collection("bin_location")
            .where({ id: locationId })
            .get();

          return {
            id: locationId,
            name:
              resBinLocation.data?.[0]?.bin_location_combine ||
              `Location ID: ${locationId}`,
          };
        } catch (error) {
          console.error(`Error fetching location ${locationId}:`, error);
          return { id: locationId, name: `${locationId} (Error)` };
        }
      });

      // Fetch batches in parallel (only if there are batch IDs)
      const batchPromises = batchIds.map(async (batchId) => {
        try {
          const resBatch = await db
            .collection("batch")
            .where({ id: batchId })
            .get();

          return {
            id: batchId,
            name: resBatch.data?.[0]?.batch_number || `Batch ID: ${batchId}`,
          };
        } catch (error) {
          console.error(`Error fetching batch ${batchId}:`, error);
          return { id: batchId, name: `${batchId} (Error)` };
        }
      });

      // Wait for both location and batch data
      const [locations, batches] = await Promise.all([
        Promise.all(locationPromises),
        Promise.all(batchPromises),
      ]);

      // Fixed category mapping - should be an object, not array of objects
      const categoryMap = {
        Blocked: "BLK",
        Reserved: "RES",
        Unrestricted: "UNR",
        "Quality Inspection": "QIP",
        "In Transit": "INT",
      };

      // Create lookup maps
      const locationMap = locations.reduce((map, loc) => {
        map[loc.id] = loc.name;
        return map;
      }, {});

      const batchMap = batches.reduce((map, batch) => {
        map[batch.id] = batch.name;
        return map;
      }, {});

      const totalQty = filteredData.reduce(
        (sum, item) => sum + (item.return_quantity || 0),
        0
      );

      let summary = `Total: ${totalQty} ${gdUOM}\n\nDETAILS:\n`;

      const details = filteredData
        .map((item, index) => {
          const locationName =
            locationMap[item.location_id] || item.location_id;
          const qty = item.return_quantity || 0;

          const categoryAbbr =
            categoryMap[item.inventory_category] ||
            item.inventory_category ||
            "";

          let itemDetail = `${
            index + 1
          }. ${locationName}: ${qty} ${gdUOM} (${categoryAbbr})`;

          // Add batch info on a new line if batch exists
          if (item.batch_id) {
            const batchName = batchMap[item.batch_id] || item.batch_id;
            itemDetail += `\n[${batchName}]`;
          }

          return itemDetail;
        })
        .join("\n");

      return summary + details;
    };

    const formattedString = await formatFilteredData(filteredData);
    console.log("📋 Formatted string:", formattedString);

    // Continue with the original logic if validation passed
    const textareaContent = JSON.stringify(filteredData);

    this.setData({
      [`table_prt.${rowIndex}.temp_qty_data`]: textareaContent,
      [`table_prt.${rowIndex}.return_summary`]: formattedString,
    });

    this.setData({
      [`confirm_inventory.table_item_balance`]: [],
    });

    console.log("Input data:", temporaryData);
    console.log("Row index:", rowIndex);

    const totalCategoryQuantity = temporaryData.reduce(
      (sum, item) => sum + (item.return_quantity || 0),
      0
    );
    console.log("Total category quantity:", totalCategoryQuantity);

    // Store the total in the form
    this.setData({
      [`table_prt.${rowIndex}.return_quantity`]: totalCategoryQuantity,
    });

    this.closeDialog("confirm_inventory");
  }
})();
