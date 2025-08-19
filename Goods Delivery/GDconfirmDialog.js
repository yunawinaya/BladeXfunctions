(async () => {
  const data = this.getValues();
  const temporaryData = data.gd_item_balance.table_item_balance;
  const rowIndex = data.gd_item_balance.row_index;
  const gdUOMid = data.gd_item_balance.material_uom;
  const materialId = data.table_gd[rowIndex].material_id;

  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: gdUOMid })
    .get()
    .then((res) => {
      return res.data[0].uom_name;
    });

  // Get item data to check if it's serialized
  let isSerializedItem = false;
  let isBatchManagedItem = false;

  if (materialId) {
    const resItem = await db.collection("Item").where({ id: materialId }).get();
    if (resItem.data && resItem.data[0]) {
      isSerializedItem = resItem.data[0].serial_number_management === 1;
      isBatchManagedItem = resItem.data[0].item_batch_management === 1;
    }
  }

  console.log(
    `Item type: Serialized=${isSerializedItem}, Batch=${isBatchManagedItem}`
  );

  // Re-validate all rows with quantities > 0 before confirming
  const gdStatus = data.gd_status;
  const gd_order_quantity = parseFloat(
    data.table_gd[rowIndex].gd_order_quantity || 0
  );
  const initialDeliveredQty = parseFloat(
    data.table_gd[rowIndex].gd_initial_delivered_qty || 0
  );

  let orderLimit = 0;
  if (materialId) {
    const resItem = await db.collection("Item").where({ id: materialId }).get();

    if (resItem.data && resItem.data[0]) {
      orderLimit =
        (gd_order_quantity * (100 + resItem.data[0].over_delivery_tolerance)) /
        100;
    }
  }

  // Calculate total quantity from all rows with gd_quantity > 0
  const totalDialogQuantity = temporaryData.reduce((sum, item) => {
    return sum + (item.gd_quantity > 0 ? parseFloat(item.gd_quantity || 0) : 0);
  }, 0);

  const totalDeliveredQty = initialDeliveredQty + totalDialogQuantity;

  console.log("Re-validation check:");
  console.log("Order limit with tolerance:", orderLimit);
  console.log("Initial delivered quantity:", initialDeliveredQty);
  console.log("Total dialog quantity:", totalDialogQuantity);
  console.log("Total delivered quantity:", totalDeliveredQty);

  // Check each row for validation
  for (let idx = 0; idx < temporaryData.length; idx++) {
    const item = temporaryData[idx];
    const quantity = parseFloat(item.gd_quantity || 0);

    // Skip rows with quantity <= 0
    if (quantity <= 0) {
      console.log(`Row ${idx} has quantity <= 0, skipping validation`);
      continue;
    }

    // For serialized items, validate differently
    if (isSerializedItem) {
      // For serialized items, check if serial number exists and is valid
      if (!item.serial_number || item.serial_number.trim() === "") {
        console.log(`Row ${idx} validation failed: Serial number missing`);
        alert(`Row ${idx + 1}: Serial number is required for serialized items`);
        return;
      }

      // For serialized items, quantity should typically be 1 (whole units)
      if (quantity !== Math.floor(quantity)) {
        console.log(
          `Row ${idx} validation failed: Serialized items must be whole units`
        );
        alert(
          `Row ${idx + 1}: Serialized items must be delivered in whole units`
        );
        return;
      }

      // Check unrestricted quantity for serialized items
      const unrestricted_field = item.unrestricted_qty;
      if (gdStatus === "Created") {
        // For Created status, allow more flexibility
        if (unrestricted_field < quantity) {
          console.log(
            `Row ${idx} validation failed: Serial item not available`
          );
          alert(
            `Row ${idx + 1}: Serial number ${
              item.serial_number
            } is not available`
          );
          return;
        }
      } else {
        // For other statuses, check unrestricted quantity
        if (unrestricted_field < quantity) {
          console.log(
            `Row ${idx} validation failed: Serial item unrestricted quantity insufficient`
          );
          alert(
            `Row ${idx + 1}: Serial number ${
              item.serial_number
            } unrestricted quantity is insufficient`
          );
          return;
        }
      }
    } else {
      // For non-serialized items, use existing validation logic
      const unrestricted_field = item.unrestricted_qty;
      const reserved_field = item.reserved_qty;

      if (
        gdStatus === "Created" &&
        reserved_field + unrestricted_field < quantity
      ) {
        console.log(`Row ${idx} validation failed: Quantity is not enough`);
        alert(`Row ${idx + 1}: Quantity is not enough`);
        return;
      } else if (gdStatus !== "Created" && unrestricted_field < quantity) {
        console.log(
          `Row ${idx} validation failed: Unrestricted quantity is not enough`
        );
        alert(`Row ${idx + 1}: Unrestricted quantity is not enough`);
        return;
      }
    }

    console.log(`Row ${idx} validation: passed`);
  }

  // Check total delivery limit
  if (orderLimit > 0 && orderLimit < totalDeliveredQty) {
    console.log("Validation failed: Total quantity exceeds delivery limit");
    alert("Total quantity exceeds delivery limit");
    return;
  }

  console.log("All validations passed, proceeding with confirm");

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

    // 🐛 ADD DEBUGGING HERE
    console.log("=== DEBUGGING SERIAL DISPLAY ===");
    console.log("isSerializedItem:", isSerializedItem);
    console.log("isBatchManagedItem:", isBatchManagedItem);
    console.log("filteredData:", filteredData);

    const details = filteredData
      .map((item, index) => {
        const locationName = locationMap[item.location_id] || item.location_id;
        const qty = item.gd_quantity || 0;

        let itemDetail = `${index + 1}. ${locationName}: ${qty} ${gdUOM}`;

        // 🐛 ADD MORE DEBUGGING
        console.log(`Item ${index}:`, {
          serial_number: item.serial_number,
          batch_id: item.batch_id,
          isSerializedItem: isSerializedItem,
          hasSerial: !!item.serial_number,
        });

        // 🔧 IMPROVED SERIAL DISPLAY LOGIC
        if (isSerializedItem) {
          if (item.serial_number && item.serial_number.trim() !== "") {
            itemDetail += ` [Serial: ${item.serial_number.trim()}]`;
          } else {
            itemDetail += ` [Serial: NOT SET]`;
            console.warn(
              `Row ${index + 1}: Serial number missing for serialized item`
            );
          }
        }

        // Add batch info if batch exists
        if (item.batch_id) {
          const batchName = batchMap[item.batch_id] || item.batch_id;
          if (isSerializedItem) {
            // If we already added serial on same line, add batch on new line
            itemDetail += `\n   [Batch: ${batchName}]`;
          } else {
            // For non-serialized items, add batch on new line as before
            itemDetail += `\n[Batch: ${batchName}]`;
          }
        }

        return itemDetail;
      })
      .join("\n");

    console.log("=== END DEBUGGING ===");
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
  const initialDeliveredQty2 =
    data.table_gd[rowIndex].gd_initial_delivered_qty || 0;
  console.log("Initial delivered quantity:", initialDeliveredQty2);

  const deliveredQty = initialDeliveredQty2 + totalGdQuantity;
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

  console.log(
    `Updated row ${rowIndex} with serialized=${isSerializedItem}, batch=${isBatchManagedItem}`
  );

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
