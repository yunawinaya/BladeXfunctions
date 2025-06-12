(async () => {
  const data = this.getValues();
  const temporaryData = data.gd_item_balance.table_item_balance;
  const rowIndex = data.gd_item_balance.row_index;
  const gdUOMid = data.gd_item_balance.material_uom;
  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: gdUOMid })
    .get()
    .then((res) => {
      return res.data[0].uom_name;
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

  // Filter out items where gd_quantity is less than or equal to 0
  const filteredData = temporaryData.filter((item) => item.gd_quantity > 0);
  console.log("Filtered data (excluding gd_quantity <= 0):", filteredData);

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
      (sum, item) => sum + (item.gd_quantity || 0),
      0
    );

    let summary = `Total: ${totalQty} ${gdUOM}\n\nDETAILS:\n`;

    const details = filteredData
      .map((item, index) => {
        const locationName = locationMap[item.location_id] || item.location_id;
        const qty = item.gd_quantity || 0;

        let itemDetail = `${index + 1}. ${locationName}: ${qty} ${gdUOM}`;

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

  const textareaContent = JSON.stringify(filteredData);

  this.setData({
    [`table_gd.${rowIndex}.temp_qty_data`]: textareaContent,
    [`table_gd.${rowIndex}.view_stock`]: formattedString,
    [`gd_item_balance.table_item_balance`]: [],
  });

  console.log("Input data (filtered):", filteredData);
  console.log("Row index:", rowIndex);

  // Sum up all gd_quantity values from filtered data
  const totalGdQuantity = filteredData.reduce(
    (sum, item) => sum + (item.gd_quantity || 0),
    0
  );
  console.log("Total GD quantity:", totalGdQuantity);

  // Get the initial delivered quantity from the table_gd
  const initialDeliveredQty =
    data.table_gd[rowIndex].gd_initial_delivered_qty || 0;
  console.log("Initial delivered quantity:", initialDeliveredQty);

  const deliveredQty = initialDeliveredQty + totalGdQuantity;
  console.log("Final delivered quantity:", deliveredQty);

  // Calculate price per item for the current row
  const totalPrice = parseFloat(data.table_gd[rowIndex].total_price) || 0;
  const orderQuantity =
    parseFloat(data.table_gd[rowIndex].gd_order_quantity) || 0;

  let pricePerItem = 0;
  if (orderQuantity > 0) {
    pricePerItem = totalPrice / orderQuantity;
  } else {
    console.warn("Order quantity is zero or invalid for row", rowIndex);
  }

  const currentRowPrice = pricePerItem * totalGdQuantity;
  console.log("Price per item:", pricePerItem);
  console.log("Current row price:", currentRowPrice);

  // Store the row-specific data first
  this.setData({
    [`table_gd.${rowIndex}.gd_delivered_qty`]: deliveredQty,
    [`table_gd.${rowIndex}.gd_qty`]: totalGdQuantity,
    [`table_gd.${rowIndex}.base_qty`]: totalGdQuantity,
    [`table_gd.${rowIndex}.gd_price`]: currentRowPrice,
    [`table_gd.${rowIndex}.price_per_item`]: pricePerItem,
    error_message: "", // Clear any error message
  });

  // Recalculate total from all rows
  let newTotal = 0;

  // Loop through all rows and sum up their prices
  data.table_gd.forEach((row, index) => {
    const rowOrderQty = parseFloat(row.gd_order_quantity) || 0;
    const rowTotalPrice = parseFloat(row.total_price) || 0;

    let rowGdQty;
    if (index === rowIndex) {
      // For the current row being edited, use the new quantity we just calculated
      rowGdQty = totalGdQuantity;
    } else {
      // For other rows, use their existing gd_qty
      rowGdQty = parseFloat(row.gd_qty) || 0;
    }

    if (rowOrderQty > 0 && rowGdQty > 0) {
      const rowPricePerItem = rowTotalPrice / rowOrderQty;
      const rowPrice = rowPricePerItem * rowGdQty;
      newTotal += rowPrice;

      console.log(
        `Row ${index}: qty=${rowGdQty}, pricePerItem=${rowPricePerItem}, rowTotal=${rowPrice}`
      );
    }
  });

  console.log("Recalculated total from all rows:", newTotal);

  // Update the grand total
  this.setData({
    [`gd_total`]: newTotal,
  });

  this.closeDialog("gd_item_balance");
})();
